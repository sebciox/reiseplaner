/* Reiseplaner – Dienste: OpenRouteService, Ersatzdienste (OSRM/Photon), Zwischenspeicher, Overpass, Matrix.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
/* ---------- APIs ---------- */
// Fehler, bei denen ein Ersatzdienst hilft: kein/ungültiger Schlüssel, Limit, Server/Netz weg
function orsErr(msg, status) {
  const e = new Error('OpenRouteService: ' + msg);
  e.fallback = !status || [401, 403, 429].includes(status) || status >= 500;
  return e;
}
async function orsPost(path, body) {
  if (!settings.key) throw orsErr('kein Schlüssel eingetragen (⚙︎).');
  let res;
  try {
    res = await fetch(ORS + path, {
      method: 'POST',
      headers: { Authorization: settings.key, 'Content-Type': 'application/json', Accept: 'application/json, application/geo+json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw orsErr('nicht erreichbar (Netzwerk).');
  }
  if (!res.ok) {
    let msg = 'Fehler ' + res.status;
    try {
      const j = await res.json();
      msg = (j.error && (j.error.message || j.error)) || j.message || msg;
    } catch (e) {}
    if (res.status === 401 || res.status === 403) msg = 'Schlüssel ungültig oder nicht freigeschaltet.';
    if (res.status === 429) msg = 'Anfragelimit erreicht.';
    throw orsErr(msg, res.status);
  }
  return res.json();
}
async function orsGeocode(text, size, auto) {
  if (!settings.key) throw orsErr('kein Schlüssel eingetragen (⚙︎).');
  const url = `${ORS}/geocode/${auto ? 'autocomplete' : 'search'}?api_key=${encodeURIComponent(settings.key)}&text=${encodeURIComponent(text)}&size=${size}&lang=de`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw orsErr('Ortssuche nicht erreichbar (Netzwerk).');
  }
  if (!res.ok) throw orsErr('Ortssuche fehlgeschlagen (' + res.status + ').', res.status);
  const j = await res.json();
  return (j.features || []).map(f => ({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], label: cleanLabel(f.properties.label) }));
}

/* ---------- Ersatzdienste ohne Schlüssel (nur nach Rückfrage): OSRM (Route, Umwege), Photon (Ortssuche) ---------- */
const OSRM = 'https://router.project-osrm.org',
  PHOTON = 'https://photon.komoot.io';
let useFallback = false;
async function getJson(url, what) {
  let r;
  try {
    r = await fetch(url);
  } catch (e) {
    throw new Error(what + ' nicht erreichbar (Netzwerk).', { cause: e });
  }
  if (!r.ok) throw new Error(what + ': Fehler ' + r.status);
  return r.json();
}
// Ortsname für Suchtreffer ohne Postleitzahl („Stockholm, Schweden“ statt „Stockholm, 111 29, Schweden“)
const photonPlace = p => [p.name, p.city || p.town || p.village, p.state, p.country].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');
// ältere Einträge: Postleitzahl beim Anzeigen entfernen („598 37 Vimmerby“ → „Vimmerby“, „111 29“ → weg)
const cleanLabel = l =>
  String(l || '')
    .split(', ')
    .map(x => x.replace(/^(\d{3} \d{2}|\d{4,5}|[A-Z]{1,2}-\d{4,5})\s+(?=\D)/, ''))
    .filter((x, i, a) => x && !/^(\d{3} ?\d{2}|\d{4,5}|\d{4} ?[A-Z]{2})$/.test(x) && a.indexOf(x) === i)
    .join(', ');
const photonLabel = p =>
  [p.name, [p.postcode, p.city || p.town || p.village].filter(Boolean).join(' '), p.state, p.country].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');
async function photonGeocode(text, size) {
  const j = await getJson(`${PHOTON}/api/?q=${encodeURIComponent(text)}&limit=${size}&lang=de`, 'Ersatz-Ortssuche (Photon)');
  return (j.features || []).map(f => ({
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    label: photonPlace(f.properties),
    camp: f.properties.osm_value === 'camp_site' || f.properties.osm_value === 'caravan_site'
  }));
}
async function photonReverse(p) {
  const j = await getJson(`${PHOTON}/reverse?lon=${p.lon}&lat=${p.lat}&lang=de`, 'Photon');
  return j.features?.[0]?.properties || null;
}
async function osrmRoute(a, b, vmax, via = []) {
  const pts = [a, ...via, b].map(p => `${p.lon},${p.lat}`).join(';');
  const base = `${OSRM}/route/v1/driving/${pts}?overview=full&geometries=geojson&steps=true`;
  let j = await getJson(base + (settings.noToll ? '&exclude=toll' : ''), 'Ersatz-Routing (OSRM)');
  if (j.code !== 'Ok' && settings.noToll) j = await getJson(base, 'Ersatz-Routing (OSRM)');
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error('Ersatz-Routing: keine Route gefunden.');
  const r = j.routes[0],
    steps = r.legs.flatMap(l => l.steps || []);
  const ferry = steps.filter(x => x.mode === 'ferry').reduce((a, x) => a + x.distance, 0);
  return {
    line: r.geometry.coordinates.map(c => [c[1], c[0]]),
    dist: r.distance,
    dur: cappedDuration([{ steps }], r.distance, r.duration, vmax),
    ex: { ferry, toll: null, src: 'osrm' }
  };
}
async function osrmTable(body) {
  const L = body.locations.map(l => l.join(',')).join(';');
  const j = await getJson(
    `${OSRM}/table/v1/driving/${L}?sources=${body.sources.join(';')}&destinations=${body.destinations.join(';')}&annotations=distance,duration`,
    'Ersatz-Umwege (OSRM)'
  );
  if (j.code !== 'Ok') throw new Error('Ersatz-Umwege: ' + (j.message || j.code));
  return { distances: j.distances, durations: j.durations };
}
// ORS versuchen; bei Ausfall einmal fragen, ob für diese Sitzung der Ersatzdienst genutzt werden soll
async function withFallback(primary, alt, silent) {
  if (useFallback) return alt();
  try {
    return await primary();
  } catch (e) {
    if (!e.fallback || silent) throw e;
    if (!confirm(`${e.message}\n\nKostenlosen Ersatzdienst ohne Schlüssel (OSRM für Route/Umwege, Photon für die Ortssuche) für diese Sitzung verwenden?`))
      throw e;
    useFallback = true;
    renderFallbackNote();
    return alt();
  }
}
function renderFallbackNote() {
  const n = $('#fbNote');
  if (n) n.hidden = !useFallback;
}
async function geocode(text, size, auto) {
  return withFallback(
    () => orsGeocode(text, size, auto),
    () => photonGeocode(text, size),
    auto
  );
}
// Suche für Zwischenziele/Sehenswürdigkeiten: ORS + Photon (Photon kennt jeden benannten OSM-Ort, auch
// Campingplätze und Sehenswürdigkeiten – ORS liefert dafür oft nur die Ortschaft). Treffer, die alle Suchwörter
// enthalten, kommen zuerst; `full` markiert sie.
const qWords = t =>
  t
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(w => w.length >= 3);
const fullMatch = (g, t) => {
  const l = g.label.toLowerCase();
  return qWords(t).every(w => l.includes(w));
};
async function placeSearch(t, auto) {
  let err = null;
  const [a, b] = await Promise.all([
    geocode(t, auto ? 6 : 5, auto).catch(e => {
      err = e;
      return [];
    }),
    useFallback ? Promise.resolve([]) : photonGeocode(t, 6).catch(() => [])
  ]);
  const out = [];
  for (const g of [...a, ...b]) {
    const head = g.label.split(',')[0].trim().toLowerCase();
    const same = out.find(o => hav([o.lat, o.lon], [g.lat, g.lon]) < 300 && o.label.split(',')[0].trim().toLowerCase() === head);
    if (same) {
      if (g.camp) same.camp = true;
      continue;
    }
    out.push({ ...g, full: fullMatch(g, t) });
  }
  if (!out.length && err) throw err;
  return [...out.filter(g => g.full), ...out.filter(g => !g.full)].slice(0, 8);
}
const suggHtml = r => r.map((g, i) => `<li><button type="button" data-i="${i}">${g.camp ? '⛺ ' : ''}${esc(g.label)}</button></li>`).join('');
async function geocodeFirst(text) {
  text = text.trim();
  if (!text) throw new Error('Bitte Start und Ziel eingeben.');
  const r = await geocode(text, 1, false);
  if (!r.length) throw new Error('Ort nicht gefunden: ' + text);
  return r[0];
}
async function route(a, b, via = []) {
  const vmax = Math.max(80, +settings.speed || 80);
  const P = [a, ...via, b];
  const body = { coordinates: P.map(p => [p.lon, p.lat]), radiuses: P.map(() => -1), extra_info: ['waycategory', 'tollways'] };
  // Mit Tempolimit 80 sind Landstraßen für den Router oft genauso schnell wie die Autobahn → er nimmt die kürzere
  // Landstraße. „Autobahn bevorzugen“: Route mit normalen Pkw-Geschwindigkeiten berechnen und die Fahrzeit
  // anschließend je Abschnitt auf vmax deckeln (dafür braucht es die Schritte → instructions an).
  if (settings.highway) {
    body.preference = 'fastest';
    body.instructions = true;
    body.instructions_format = 'text';
  } else {
    body.instructions = false;
    body.maximum_speed = vmax;
  }
  if (settings.noToll) body.options = { avoid_features: ['tollways'] };
  const ck = hashStr(JSON.stringify(body) + (useFallback ? 'osrm' : ''));
  if (routeMem.has(ck)) return routeMem.get(ck);
  const res = await withFallback(
    async () => {
      const j = await orsPost('/v2/directions/driving-car/geojson', body);
      const f = j.features && j.features[0];
      if (!f) throw new Error('Keine Route gefunden.');
      const dist = f.properties.summary.distance || 0;
      let dur = f.properties.summary.duration || 0;
      if (settings.highway) dur = cappedDuration(f.properties.segments, dist, dur, vmax);
      // Extras: Fähre (waycategory Bit 4) und Mautstrecken in Metern
      const sum = (k, test) => (f.properties.extras?.[k]?.summary || []).filter(x => test(x.value)).reduce((a, x) => a + (x.distance || 0), 0);
      const ex = f.properties.extras ? { ferry: sum('waycategory', v => v & 4), toll: sum('tollways', v => v === 1) } : null;
      return { line: f.geometry.coordinates.map(c => [c[1], c[0]]), dist, dur, ex };
    },
    () => osrmRoute(a, b, vmax, via)
  );
  routeMem.set(ck, res);
  if (routeMem.size > 30) routeMem.delete(routeMem.keys().next().value);
  return res;
}
const routeMem = new Map(); // Routen nur solange die Seite offen ist (groß, ORS-Limit unkritisch)
// Fahrzeit, wenn nirgends schneller als vmax gefahren wird: je Schritt max(ORS-Dauer, Strecke / vmax)
function cappedDuration(segments, dist, dur, vmax) {
  const v = vmax / 3.6;
  const steps = (segments || []).flatMap(s => s.steps || []);
  if (!steps.length) return Math.max(dur, dist / v);
  const t = steps.reduce((acc, st) => acc + Math.max(st.duration || 0, (st.distance || 0) / v), 0);
  return Math.max(t, dist / v);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Zwischenspeicher im Browser (7 Tage) ---------- */
const CACHE_TTL = 7 * 864e5;
const CK = { op: 'gp.cache.op2', mx: 'gp.cache.mx' }; // op2: mit Adress- und Ausstattungs-Tags
try {
  localStorage.removeItem('gp.cache.op');
} catch (e) {}
function cacheLoad(k) {
  try {
    const now = Date.now();
    return JSON.parse(localStorage.getItem(k) || '[]').filter(e => now - e.t < CACHE_TTL);
  } catch (e) {
    return [];
  }
}
// speichert die neuesten Einträge, die in maxChars passen; gibt die behaltene Liste zurück
function cacheSave(k, list, maxChars) {
  list = list.slice();
  while (list.length) {
    const str = JSON.stringify(list);
    if (str.length <= maxChars) {
      try {
        localStorage.setItem(k, str);
        return list;
      } catch (e) {}
    }
    list.shift();
  }
  try {
    localStorage.removeItem(k);
  } catch (e) {}
  return list;
}
function cacheClear() {
  for (const k of Object.values(CK))
    try {
      localStorage.removeItem(k);
    } catch (e) {}
  opCache = [];
  mxCache = [];
}
function hashStr(str) {
  let h1 = 0x811c9dc5,
    h2 = 7;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = (Math.imul(h2, 31) + c) | 0;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + str.length.toString(36);
}

/* ---------- Overpass ---------- */
let opStart = 0;
const OP_WAITS = [0, 4, 10, 20]; // Sekunden Pause vor Versuch 1..4 (je Versuch alle Server nacheinander)
// opts: { signal, passes, onStatus(text) }
async function overpass(q, opts = {}) {
  const passes = opts.passes || OP_WAITS.length,
    say = opts.onStatus || (() => {});
  let saw429 = false,
    sawBusy = false;
  for (let pass = 0; pass < passes; pass++) {
    if (pass) {
      for (let w = OP_WAITS[pass]; w > 0; w--) {
        if (opts.signal?.aborted) throw new DOMException('abgebrochen', 'AbortError');
        say(`${saw429 ? 'Zu viele Abfragen' : 'Server ausgelastet'} – Versuch ${pass + 1} von ${passes} in ${w} s …`);
        await sleep(1000);
      }
      say(`Suche Campingplätze … (Versuch ${pass + 1} von ${passes})`);
    }
    for (let k = 0; k < OVERPASS.length; k++) {
      const i = (opStart + k) % OVERPASS.length;
      const ctl = new AbortController(),
        timer = setTimeout(() => ctl.abort(), 70000);
      const onAbort = () => ctl.abort();
      opts.signal?.addEventListener('abort', onAbort);
      try {
        const r = await fetch(OVERPASS[i], {
          method: 'POST',
          body: 'data=' + encodeURIComponent(q),
          signal: ctl.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        if (r.ok) {
          const j = await r.json();
          opStart = i;
          return j.elements || [];
        }
        if (r.status === 429) saw429 = true;
        else sawBusy = true;
      } catch (e) {
        if (opts.signal?.aborted) throw new DOMException('abgebrochen', 'AbortError');
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
    }
  }
  if (saw429) throw new Error('Campingplatz-Server: zu viele Abfragen von deinem Anschluss (429). Bitte 1–2 Minuten warten und dann nochmal versuchen.');
  if (sawBusy) throw new Error('Campingplatz-Server überlastet. Bitte in ein paar Minuten nochmal versuchen.');
  throw new Error('Campingplatz-Server nicht erreichbar. Bitte gleich nochmal versuchen.');
}

/* Campingplätze in einem Rechteck [süd, west, nord, ost] – aus dem Zwischenspeicher, wenn ein gespeichertes
   Rechteck es vollständig enthält, sonst eine Overpass-Abfrage */
const KEEP_TAGS = [
  'name',
  'caravans',
  'charge',
  'fee',
  'website',
  'contact:website',
  'url',
  'phone',
  'contact:phone',
  'opening_hours',
  'addr:street',
  'addr:housenumber',
  'addr:postcode',
  'addr:city',
  'addr:place',
  'power_supply',
  'internet_access',
  'shower',
  'swimming_pool'
];
let opCache = cacheLoad(CK.op);
const boxIn = (a, b) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
function slimEl(e) {
  const tags = {};
  for (const k of KEEP_TAGS) if (e.tags?.[k] != null) tags[k] = e.tags[k];
  return { type: e.type, id: e.id, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, tags };
}
async function campsInBox(box, opts = {}) {
  const g = 0.02,
    r2 = v => +v.toFixed(2); // nach außen auf ein 0,02°-Raster runden → bessere Wiederverwendung
  box = [r2(Math.floor(box[0] / g) * g), r2(Math.floor(box[1] / g) * g), r2(Math.ceil(box[2] / g) * g), r2(Math.ceil(box[3] / g) * g)];
  const inBox = e => e.lat >= box[0] && e.lon >= box[1] && e.lat <= box[2] && e.lon <= box[3];
  const now = Date.now();
  const hit = opCache.find(e => now - e.t < CACHE_TTL && boxIn(box, e.box));
  if (hit) return parseCamps(hit.els.filter(inBox));
  const q = `[out:json][timeout:60];nwr["tourism"="camp_site"](${box.join(',')});out center tags;`;
  const els = (await overpass(q, opts)).map(slimEl).filter(e => e.lat != null);
  opCache = opCache.filter(e => now - e.t < CACHE_TTL && !boxIn(e.box, box)); // ganz enthaltene alte Einträge ersetzen
  opCache.push({ t: now, box, els });
  opCache = cacheSave(CK.op, opCache, 1500000);
  return parseCamps(els);
}

/* ORS-Matrix mit Zwischenspeicher (gleiche Anfrage → gleiche Antwort) */
let mxCache = cacheLoad(CK.mx);
async function matrix(body) {
  const k = hashStr(JSON.stringify(body));
  const hit = mxCache.find(e => e.k === k);
  if (hit) return { distances: hit.d, durations: hit.u };
  const j = await withFallback(
    () => orsPost('/v2/matrix/driving-car', body),
    () => osrmTable(body)
  );
  const rnd = m => (m || []).map(row => row.map(v => (v == null ? null : Math.round(v))));
  const e = { t: Date.now(), k, d: rnd(j.distances), u: rnd(j.durations) };
  mxCache = cacheSave(CK.mx, [...mxCache.filter(x => x.k !== k), e], 500000);
  return { distances: e.d, durations: e.u };
}

function parseCamps(els) {
  const seen = new Set(),
    out = [];
  for (const e of els) {
    const lat = e.lat ?? e.center?.lat,
      lon = e.lon ?? e.center?.lon,
      tags = e.tags || {};
    const id = e.type + '/' + e.id;
    if (lat == null || seen.has(id) || tags.caravans === 'no') continue;
    seen.add(id);
    out.push({ id, lat, lon, tags });
  }
  return out;
}
const isOk = c => ['yes', 'designated'].includes(c.tags?.caravans);
