/* Reiseplaner – Online-Speicher (privates GitHub-Repo).
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
/* ---------- Online-Speicher: privates GitHub-Repo ----------
   Dateien: einstellungen.json (ohne Token) und touren/<id>.json (Format wie die Tour-Datei).
   gp.sync merkt sich je Tour den zuletzt abgeglichenen Stand { sha, at } und ausstehende Löschungen. */
const GH = 'https://api.github.com';
const SYNC_KEYS = ['key', 'speed', 'detour', 'cmin', 'cmax', 'highway', 'noToll', 'altRadius', 'filters', 'gkey', 'sortBy', 'adults', 'kids'];
const ghOn = () => !!(settings.ghToken && /^[\w.-]+\/[\w.-]+$/.test(settings.ghRepo || ''));
function syncMeta() {
  try {
    return { known: {}, deleted: [], ...JSON.parse(localStorage.getItem('gp.sync') || '{}') };
  } catch (e) {
    return { known: {}, deleted: [] };
  }
}
function saveSyncMeta(m) {
  try {
    localStorage.setItem('gp.sync', JSON.stringify(m));
  } catch (e) {}
}
function b64enc(str) {
  const b = new TextEncoder().encode(str);
  let out = '';
  for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(out);
}
function b64dec(b64) {
  const bin = atob(String(b64).replace(/\s/g, '')),
    u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(u);
}
async function gh(method, path, body, raw) {
  let res;
  try {
    res = await fetch(`${GH}/repos/${settings.ghRepo}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + settings.ghToken,
        'X-GitHub-Api-Version': '2022-11-28',
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new Error('GitHub nicht erreichbar (Netzwerk).', { cause: e });
  }
  if (res.status === 404 && method === 'GET' && path) return null; // Datei/Ordner gibt es (noch) nicht
  if (!res.ok) {
    let msg = '';
    try {
      msg = (await res.json()).message || '';
    } catch (e) {}
    const err = new Error(
      res.status === 401
        ? 'GitHub-Token ungültig oder abgelaufen. Tipp: Im Browser, in dem es funktioniert, unter ⚙︎ „Link für anderen Browser kopieren“ nutzen – oder auf GitHub einen neuen Token erzeugen.'
        : (res.status === 403 || res.status === 404) && !/sha/i.test(msg)
          ? `Kein Zugriff auf ${settings.ghRepo} – Repo-Name und Token-Recht „Contents: Read and write“ prüfen.`
          : `GitHub-Fehler ${res.status}${msg ? ': ' + msg : ''}`
    );
    err.status = res.status;
    throw err;
  }
  return raw ? res.text() : res.json();
}
async function ghRead(path) {
  const j = await gh('GET', '/contents/' + path);
  if (!j) return null;
  const text = j.content ? b64dec(j.content) : await gh('GET', '/contents/' + path, null, true); // > 1 MB: roh laden
  return { sha: j.sha, data: JSON.parse(text) };
}
async function ghWrite(path, data, sha, message) {
  const put = sh => gh('PUT', '/contents/' + path, { message, content: b64enc(JSON.stringify(data, null, 1)), ...(sh ? { sha: sh } : {}) });
  try {
    return (await put(sha)).content.sha;
  } catch (e) {
    if (![409, 422].includes(e.status)) throw e;
    const cur = await gh('GET', '/contents/' + path); // Stand hat sich geändert → aktuellen sha holen, überschreiben
    return (await put(cur && cur.sha)).content.sha;
  }
}
async function ghDelete(path, sha, message) {
  try {
    await gh('DELETE', '/contents/' + path, { message, sha });
  } catch (e) {
    if (e.status === 404) return;
    if (![409, 422].includes(e.status)) throw e;
    const cur = await gh('GET', '/contents/' + path);
    if (cur) await gh('DELETE', '/contents/' + path, { message, sha: cur.sha });
  }
}
const tourPath = id => `touren/${id}.json`;
const tourFile = t => ({ app: 'gespann-etappen', version: 1, tour: t });

let syncing = null,
  syncQueued = null;
function syncNow() {
  if (!ghOn()) return Promise.resolve(null);
  // Läuft schon ein Abgleich, danach noch einen – sonst gingen Änderungen von währenddessen erst später online
  if (syncing) {
    if (!syncQueued)
      syncQueued = syncing
        .catch(() => {})
        .then(() => {
          syncQueued = null;
          return syncNow();
        });
    return syncQueued;
  }
  syncing = doSync().finally(() => {
    syncing = null;
  });
  return syncing;
}
async function doSync() {
  await gh('GET', ''); // Repo erreichbar und Token gültig?
  const meta = syncMeta(),
    res = { settings: false, pulled: 0, pushed: 0, removed: 0, pulledIds: [] };
  // 1) Einstellungen
  const f = await ghRead('einstellungen.json');
  const pushSettings = async sha => {
    const data = { app: 'gespann-etappen', savedAt: settings.savedAt || new Date().toISOString(), settings: {} };
    SYNC_KEYS.forEach(k => (data.settings[k] = settings[k]));
    meta.set = { sha: await ghWrite('einstellungen.json', data, sha, 'Einstellungen gespeichert'), at: data.savedAt };
    if (!settings.savedAt) {
      settings.savedAt = data.savedAt;
      saveSettings();
    }
  };
  if (!f) await pushSettings(null);
  else if (meta.set && meta.set.sha === f.sha) {
    // online unverändert
    if (settings.savedAt && settings.savedAt !== meta.set.at) await pushSettings(f.sha);
  } else if (!meta.set || !settings.savedAt || new Date(f.data.savedAt) >= new Date(settings.savedAt)) {
    const rs = f.data.settings || {}; // online neuer bzw. erstes Verbinden → übernehmen
    SYNC_KEYS.forEach(k => {
      if (rs[k] !== undefined) settings[k] = rs[k];
    });
    settings.savedAt = f.data.savedAt;
    saveSettings();
    meta.set = { sha: f.sha, at: f.data.savedAt };
    res.settings = true;
  } else await pushSettings(f.sha);
  saveSyncMeta(meta);
  // 2) ausstehende Löschungen
  for (const id of meta.deleted.slice()) {
    await ghDelete(tourPath(id), meta.known[id]?.sha, 'Tour gelöscht');
    delete meta.known[id];
    meta.deleted = meta.deleted.filter(x => x !== id);
    saveSyncMeta(meta);
  }
  // 3) Touren abgleichen
  const list = (await gh('GET', '/contents/touren')) || [];
  const remote = new Map((Array.isArray(list) ? list : []).filter(x => /^\d+\.json$/.test(x.name)).map(x => [+x.name.slice(0, -5), x.sha]));
  const local = new Map(loadTours().map(t => [t.id, t]));
  let changed = false;
  const push = async (t, sha) => {
    meta.known[t.id] = { sha: await ghWrite(tourPath(t.id), tourFile(t), sha, `Tour „${t.name}“ gespeichert`), at: t.savedAt };
    res.pushed++;
  };
  for (const id of new Set([...remote.keys(), ...local.keys()])) {
    if (meta.deleted.includes(id)) continue;
    const r = remote.get(id),
      l = local.get(id),
      k = meta.known[id];
    const localChanged = l && (!k || k.at !== l.savedAt);
    if (r && (!k || k.sha !== r || !l)) {
      // online neu oder geändert
      const rf = await ghRead(tourPath(id));
      if (!rf) continue;
      const rt = rf.data.tour || rf.data;
      // offene Tour hier und dort geändert → nicht still überschreiben, sondern nachfragen (afterSync → askConflict)
      if (l && localChanged && k && id === state.tourId) {
        res.conflict = { id, rt, sha: rf.sha };
        continue;
      }
      if (!l || !localChanged || new Date(rt.savedAt) >= new Date(l.savedAt)) {
        local.set(id, rt);
        changed = true;
        res.pulled++;
        res.pulledIds.push(id);
        meta.known[id] = { sha: rf.sha, at: rt.savedAt };
      } else await push(l, rf.sha);
    } else if (r && localChanged) await push(l, r);
    else if (!r && l) {
      if (k && !localChanged) {
        local.delete(id);
        delete meta.known[id];
        changed = true;
        res.removed++;
      } // auf anderem Gerät gelöscht
      else await push(l, null);
    }
    saveSyncMeta(meta);
  }
  if (changed) {
    const arr = [...local.values()].sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    try {
      localStorage.setItem('gp.tours', JSON.stringify(arr));
    } catch (e) {
      cacheClear();
      localStorage.setItem('gp.tours', JSON.stringify(arr));
    }
  }
  // 4) Rezeptionszeiten vom GitHub-Helfer
  try {
    const rz = await ghRead('rezeption.json');
    if (rz && rz.sha !== meta.rz) {
      rzData = rz.data || {};
      meta.rz = rz.sha;
      res.rz = true;
      try {
        localStorage.setItem('gp.rezeption', JSON.stringify(rzData));
      } catch (e) {}
    }
  } catch (e) {
    console.warn(e);
  }
  meta.last = new Date().toISOString();
  saveSyncMeta(meta);
  return res;
}
// Nach dem Hochladen einer Tour sucht der Helfer 1–2 Min. lang die Rezeptionszeiten → danach einmal nachladen
let rzTimer = null;
function rzRecheck() {
  clearTimeout(rzTimer);
  rzTimer = setTimeout(
    () =>
      syncNow()
        .then(r => {
          if (r && r.rz) {
            renderPanel();
            if ($('#sumDlg').open) renderSummary();
          }
        })
        .catch(() => {}),
    120000
  );
}
// Abgleich im Hintergrund mit kurzer Rückmeldung
async function syncAndReport(okMsg, errMsg) {
  if (!ghOn()) return;
  try {
    const r = await syncNow();
    if (saveInfo.online !== 'conflict') saveInfo.online = 'ok';
    afterSync(r);
    renderSaveChip();
    if (r && r.settings && $('#status').classList.contains('error') && settings.key) setStatus('');
    if (r && r.pushed) rzRecheck();
    if (r && (r.rz || r.pulled)) renderPanel();
    const parts = !r
      ? []
      : [
          r.settings && 'Einstellungen übernommen',
          r.pulled && `${r.pulled} ${r.pulled === 1 ? 'Tour' : 'Touren'} geladen`,
          r.removed && `${r.removed} gelöscht`
        ].filter(Boolean);
    if (okMsg) flash(okMsg + ' ✓' + (parts.length ? ' – ' + parts.join(', ') : ''));
    else if (parts.length) flash('Online-Speicher: ' + parts.join(', ') + '.');
  } catch (e) {
    console.warn(e);
    saveInfo.online = 'error';
    renderSaveChip();
    setStatus((errMsg || 'Online-Speicher: ') + e.message, 'error');
  }
  if ($('#toursDlg').open) openTours();
}
