/* Reiseplaner – Speichern, Laden, GPX, Tour-Datei, Excel.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
/* ---------- Speichern, Laden, GPX ---------- */
function loadTours() {
  try {
    return JSON.parse(localStorage.getItem('gp.tours') || '[]');
  } catch (e) {
    return [];
  }
}
function slimPoint(p) {
  const o = { lat: p.lat, lon: p.lon, label: p.label, kind: p.kind };
  if (p.kind === 'camp') {
    o.id = p.id;
    o.tags = p.tags;
    o.detour = p.detour;
    if (p.addr) o.addr = p.addr;
    if (p.near) o.near = p.near;
    if (p.sights) o.sights = p.sights;
  }
  return o;
}
const defaultName = () => (state.round ? `Rundreise ab ${shortLabel(state.start.label)}` : `${shortLabel(state.start.label)} → ${shortLabel(state.end.label)}`);
function buildTour(name, id) {
  return {
    id: id || state.tourId || Date.now(),
    name: (name || '').trim() || defaultName(),
    savedAt: new Date().toISOString(),
    start: slimPoint(state.start),
    end: slimPoint(state.end),
    done: state.done,
    n: state.n,
    date: state.date || undefined,
    via: state.via.length ? state.via : undefined,
    round: state.round || undefined,
    ret: state.ret || undefined,
    segs: state.segs
      ? state.segs.map(g => ({
          to: g.to,
          kind: g.kind,
          rest: g.rest || undefined,
          sights: g.sights,
          visits: g.visits,
          n: g.n,
          rec: g.rec,
          nights: g.nights,
          radius: g.radius,
          dist: g.dist,
          dur: g.dur
        }))
      : undefined,
    stages: state.stages.map(s => ({
      from: slimPoint(s.from),
      to: slimPoint(s.to),
      dist: s.dist,
      dur: s.dur,
      note: s.note,
      line: thin(s.line),
      ex: s.ex || undefined,
      countries: s.countries || undefined,
      seg: s.seg || undefined,
      vias: s.vias && s.vias.length ? s.vias : undefined,
      memo: s.memo && (s.memo.res || s.memo.text) ? s.memo : undefined,
      nights: s.nights > 1 ? s.nights : undefined,
      dayPlan: s.dayPlan && Object.keys(s.dayPlan).length ? s.dayPlan : undefined
    })),
    endCands: state.endSearched ? state.endCands.map(c => ({ id: c.id, lat: c.lat, lon: c.lon, tags: c.tags, air: Math.round(c.air) })) : undefined
  };
}
function storeTour(tour) {
  const rest = loadTours().filter(t => t.id !== tour.id),
    str = JSON.stringify([tour, ...rest]);
  try {
    localStorage.setItem('gp.tours', str);
  } catch (e) {
    cacheClear();
    localStorage.setItem('gp.tours', str);
  } // Touren gehen vor Zwischenspeicher
}
function flash(msg) {
  setStatus(msg);
  // zusätzlich kurz als Hinweis über der Karte (die Statuszeile im Menü ist oft weggescrollt)
  const t = $('#toast');
  if (t) {
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(flash._t);
    flash._t = setTimeout(() => {
      t.hidden = true;
    }, 3200);
  }
  setTimeout(() => {
    if ($('#status').textContent === msg) setStatus('');
  }, 2500);
}
const normName = n =>
  String(n || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
const fstamp = iso => new Date(iso).toLocaleString('de-DE', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
// Tour lokal löschen (und die Löschung für den Online-Speicher vormerken)
function deleteTourLocal(id) {
  try {
    localStorage.setItem('gp.tours', JSON.stringify(loadTours().filter(x => x.id !== id)));
  } catch (e) {}
  const m = syncMeta();
  if (m.known[id] && !m.deleted.includes(id)) {
    m.deleted.push(id);
    saveSyncMeta(m);
  }
}
function saveTour(asCopy) {
  if (!state.stages.length) return;
  const tours = loadTours(),
    old = tours.find(t => t.id === state.tourId);
  if (old && !asCopy) {
    // schon gespeichert → ohne Rückfrage aktualisieren, nur Hinweis
    const tour = buildTour(old.name, old.id);
    try {
      storeTour(tour);
    } catch (e) {
      setStatus('Speicher voll – bitte alte Touren löschen.', 'error');
      return;
    }
    renderPanel();
    if (ghOn()) {
      setStatus(`Tour „${old.name}“ aktualisiert – wird online gesichert …`, 'busy');
      syncAndReport(`Tour „${old.name}“ aktualisiert · online gesichert`, `Tour „${old.name}“ aktualisiert – aber nur in diesem Browser. `);
    } else flash(`Tour „${old.name}“ aktualisiert ✓`);
    return;
  }
  let name = old ? (asCopy ? `${old.name} (Kopie)` : old.name) : defaultName(),
    targetId = asCopy ? Date.now() : state.tourId;
  // Gleicher Name wie eine andere Tour → Warnung: überschreiben oder anderen Namen wählen
  for (;;) {
    name = prompt('Name der Tour', name);
    if (name === null) return;
    name = name.trim() || defaultName();
    const twin = tours.find(t => (asCopy || t.id !== state.tourId) && normName(t.name) === normName(name));
    if (!twin) {
      break;
    }
    if (
      confirm(
        `Es gibt schon eine Tour „${twin.name}“ (gespeichert ${fstamp(twin.savedAt)}).\n\nOK = diese Tour damit überschreiben\nAbbrechen = anderen Namen wählen`
      )
    ) {
      if (!asCopy && state.tourId && state.tourId !== twin.id && old) deleteTourLocal(state.tourId); // bisherigen eigenen Eintrag entfernen
      targetId = twin.id;
      break;
    }
    let k = 2;
    while (tours.some(t => normName(t.name) === normName(`${name} (${k})`))) k++;
    name = `${name} (${k})`;
  }
  const tour = buildTour(name, targetId);
  try {
    storeTour(tour);
    state.tourId = tour.id;
  } catch (e) {
    setStatus('Speicher voll – bitte alte Touren löschen.', 'error');
    return;
  }
  renderPanel();
  if (ghOn()) {
    setStatus('Tour gespeichert – wird online gesichert …', 'busy');
    syncAndReport('Tour gespeichert · online gesichert', 'Tour gespeichert – aber nur in diesem Browser. ');
  } else flash('Tour gespeichert.');
}
function download(text, fname, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const fileBase = name =>
  name
    .replace(/[^\wäöüÄÖÜß\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '_') || 'Tour';

/* Tour als Datei exportieren (am Handy über das Teilen-Menü, sonst Download) */
async function exportTour() {
  if (!state.stages.length) return;
  const old = loadTours().find(t => t.id === state.tourId);
  const tour = buildTour(old ? old.name : defaultName());
  const json = JSON.stringify({ app: 'gespann-etappen', version: 1, tour });
  const fname = fileBase(tour.name) + '.etappen.json';
  try {
    const file = new File([json], fname, { type: 'application/json' });
    if (window.innerWidth < 900 && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: tour.name });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  download(json, fname, 'application/json');
}
/* Tour-Datei importieren */
async function importTour(file) {
  try {
    const obj = JSON.parse(await file.text());
    const t = obj && (obj.tour || obj);
    if (!t || !t.start || !t.end || !Array.isArray(t.stages)) throw new Error();
    t.id = t.id || Date.now();
    t.name = t.name || `${shortLabel(t.start.label)} → ${shortLabel(t.end.label)}`;
    try {
      storeTour(t);
    } catch (e) {}
    if ($('#toursDlg').open) $('#toursDlg').close();
    loadTour(t.id, t);
    flash(`„${t.name}“ geladen und gespeichert.`);
    syncAndReport();
  } catch (e) {
    setStatus('Diese Datei ist keine gültige Tour-Datei.', 'error');
  }
}
function openTours(fromButton) {
  const tours = loadTours(),
    ul = $('#toursList'),
    meta = syncMeta();
  $('#syncBtn').hidden = !ghOn();
  $('#syncInfo').innerHTML = ghOn()
    ? `Online-Speicher: ${esc(settings.ghRepo)}${syncing ? ' · wird abgeglichen …' : meta.last ? ' · abgeglichen ' + new Date(meta.last).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : ''}`
    : 'Nur in diesem Browser gespeichert. Online-Speicher für Handy + Laptop unter ⚙︎ einrichten.';
  ul.innerHTML = tours.length
    ? tours
        .map(t => {
          const km = t.stages.reduce((a, s) => a + s.dist, 0);
          return `<li><div class="t"><b>${esc(t.name)}</b><div class="muted">${t.stages.length} Etappen${t.done ? '' : ' (unvollständig)'} · ${fkm(km)} · ${fstamp(t.savedAt)}</div></div>
      <button class="btn small primary" type="button" data-load="${t.id}">Laden</button>
      <button class="btn small" type="button" data-ren="${t.id}" aria-label="Umbenennen" title="Umbenennen">✎</button>
      <button class="btn small" type="button" data-del="${t.id}" aria-label="Löschen">✕</button></li>`;
        })
        .join('')
    : '<li class="muted">Noch keine Touren gespeichert.</li>';
  ul.querySelectorAll('[data-load]').forEach(
    b =>
      (b.onclick = () => {
        $('#toursDlg').close();
        loadTour(+b.dataset.load);
      })
  );
  ul.querySelectorAll('[data-ren]').forEach(
    b =>
      (b.onclick = () => {
        const t = tours.find(x => x.id === +b.dataset.ren);
        if (!t) return;
        let name = prompt('Neuer Name der Tour', t.name);
        if (name === null) return;
        name = name.trim();
        if (!name || name === t.name) return;
        const twin = tours.find(x => x.id !== t.id && normName(x.name) === normName(name));
        if (twin && !confirm(`Es gibt schon eine Tour „${twin.name}“. Trotzdem so nennen?`)) return;
        storeTour({ ...t, name, savedAt: new Date().toISOString() });
        openTours();
        renderPanel();
        if (ghOn()) syncAndReport(`Tour „${name}“ umbenannt · online gesichert`, 'Umbenannt – aber nur in diesem Browser. ');
        else flash(`Tour heißt jetzt „${name}“.`);
      })
  );
  ul.querySelectorAll('[data-del]').forEach(
    b =>
      (b.onclick = () => {
        const t = tours.find(x => x.id === +b.dataset.del);
        if (t && confirm(`„${t.name}“ löschen?`)) {
          deleteTourLocal(t.id);
          if (state.tourId === t.id) state.tourId = null;
          openTours();
          syncAndReport();
        }
      })
  );
  if (!$('#toursDlg').open) {
    $('#toursDlg').showModal();
    if (ghOn() && !fromButton) syncAndReport();
  }
}
function loadTour(id, given) {
  const t = given || loadTours().find(x => x.id === id);
  if (!t || state.busy) return;
  uiTab = t.done ? 'trip' : 'plan';
  prevDone = !!t.done; // fertige Tour → gleich der Reiseplan
  Object.assign(state, {
    start: t.start,
    end: t.end,
    stages: t.stages,
    done: t.done,
    pending: null,
    tourId: t.id,
    endCands: (t.endCands || []).map(c => ({ ...c })),
    endSearched: !!t.endCands,
    n: t.n || (t.done ? t.stages.length : null),
    overview: null,
    date: t.date || null,
    alt: null,
    split: null,
    prevPicks: null,
    keepEnd: null,
    openDet: new Set(),
    showEndList: false,
    via: t.via || [],
    round: !!t.round,
    segs: t.segs || null,
    ret: t.ret || null
  });
  t.stages.forEach(s => {
    if (s.seg == null) s.seg = 0;
  });
  renderVia();
  t.stages.forEach(s => {
    if (s.to.kind === 'camp') campIndex.set(s.to.id, s.to);
  });
  state.endCands.forEach(c => campIndex.set(c.id, c));
  $('#startIn').value = t.start.label;
  $('#endIn').value = t.end.label;
  renderVia();
  setStatus('');
  renderAll();
  fitAll();
  // Unfertige Tour: Planung geht weiter (braucht die Suche). Fertige Tour: keine Abfrage – Plätze am Ziel kommen
  // aus der gespeicherten Tour oder erst auf Knopfdruck.
  if (!t.done) {
    const last = t.stages.length ? t.stages[t.stages.length - 1].to : t.start;
    run(() => computeNext(last));
  } else if (isMobile()) {
    setSheet('min');
    setTimeout(fitAll, 320);
  }
}
function resetTour() {
  if (state.busy) return;
  Object.assign(state, {
    start: null,
    end: null,
    stages: [],
    pending: null,
    done: false,
    tourId: null,
    endCands: [],
    n: null,
    overview: null,
    date: null,
    alt: null,
    split: null,
    prevPicks: null,
    keepEnd: null,
    openDet: new Set(),
    showEndList: false,
    via: [],
    round: false,
    segs: null,
    endSearched: false,
    ret: null
  });
  $('#startIn').value = DEMO.start;
  $('#endIn').value = DEMO.end;
  renderVia();
  uiTab = 'goals';
  prevDone = false;
  setStatus('');
  renderAll();
}
async function loadXlsx() {
  if (window.XLSX) return window.XLSX;
  await new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = res;
    sc.onerror = () => rej(new Error('Excel-Export braucht einmal Internet (Bibliothek konnte nicht geladen werden).'));
    document.head.appendChild(sc);
  });
  return window.XLSX;
}
/* Ein Blatt: je Etappe Fahrt-Besuche, Campingplatz/Ziel, darunter seine Sehenswürdigkeiten (Spalte „Typ“) */
function xlsxRows() {
  const ds = stageDates(),
    st = state.stages,
    last = st.length - 1,
    home = state.segs && state.segs[state.segs.length - 1].kind === 'home';
  const H = [
    'Etappe',
    'Typ',
    'Datum',
    'Bis',
    'Nächte',
    'Name',
    'Adresse',
    'Koordinaten',
    'Entfernung',
    'Fahrt km',
    'Fahrzeit',
    'Rezeption',
    'Check-in',
    'Check-out',
    'Website',
    'Telefon',
    'Navigation',
    'Notiz',
    'Reserviert',
    'Preis'
  ];
  const rows = [H],
    links = [];
  const day = d => (d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : '');
  st.forEach((s, i) => {
    const c = s.to,
      camp = c.kind === 'camp',
      n = Math.max(1, +s.nights || 1),
      web = camp ? campWeb(c) : '',
      r = camp && rzFor(c);
    const okR = r && (r.status === 'ok' || r.status === 'partial');
    visitsOf(s).forEach(v =>
      rows.push([
        i + 1,
        'Besuch unterwegs',
        day(ds && ds[i]),
        '',
        '',
        v.label,
        '',
        fcoord(v),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        `≈ ${fhours(v.hours)} Besuch`,
        ''
      ])
    );
    const row = [
      i + 1,
      camp ? 'Campingplatz' : i === last && home ? 'Zuhause' : 'Ziel',
      day(ds && ds[i]),
      ds && i < last ? day(addDays(ds[i], n)) : '',
      i < last ? n : '',
      c.label,
      c.addr && c.addr !== 'unbekannt' ? c.addr : '',
      fcoord(c),
      c.detour ? `${fkm1(c.detour.d)} von der Route` : '',
      Math.round(s.dist / 1000),
      fdur(s.dur),
      okR ? r.hours || '' : '',
      okR ? r.checkin?.text || '' : '',
      okR ? r.checkout?.text || '' : '',
      web || '',
      camp ? phoneOf(c) || '' : '',
      'Route',
      s.memo?.text || '',
      s.memo?.res ? 'ja' : '',
      camp && priceOf(c) ? euroPlain(priceOf(c), c) + powerHtml(priceOf(c), c).replace(/<[^>]+>/g, '') : ''
    ];
    rows.push(row);
    if (web) links.push({ r: rows.length - 1, c: 14, url: safeUrl(web) });
    links.push({ r: rows.length - 1, c: 16, url: navUrl(c) });
    stopSights(c).forEach(x => {
      const src = sightSrc(x) || x,
        inf = src.info || {},
        rr = inf.web && (rzData['web:' + inf.web]?.v || 0) >= 2 ? rzData['web:' + inf.web] : null;
      const oh = inf.town ? '' : [inf.oh, rr?.hoursS?.text].filter(Boolean).join(' / '),
        pr = inf.town
          ? ''
          : rr?.price
            ? (rr.price.adult || rr.price.child
                ? [rr.price.adult && 'Erwachsene ' + euroAb(rr.price.adult, src), rr.price.child && 'Kinder ' + euroAb(rr.price.child, src)]
                    .filter(Boolean)
                    .join(' · ')
                : euroText(rr.price, src)
              ).replace(/<[^>]+>/g, '')
            : inf.charge
              ? euroPlain({ text: inf.charge }, src)
              : '';
      rows.push([
        i + 1,
        'Sehenswürdigkeit',
        '',
        '',
        '',
        x.label,
        inf.addr || '',
        x.lat != null ? fcoord(x) : '',
        x.d != null ? `${x.est ? '≈ ' : ''}${fkm1(x.d)}${x.t ? ' / ' + fdur(x.t) : ''} vom Platz` : x.air != null ? `${fkm1(x.air)} Luftlinie` : '',
        '',
        '',
        oh ? 'Geöffnet: ' + oh : '',
        '',
        '',
        inf.web || '',
        inf.phone || '',
        '',
        pr ? 'Preise: ' + pr : '',
        ''
      ]);
      if (inf.web) links.push({ r: rows.length - 1, c: 14, url: safeUrl(inf.web) });
    });
  });
  return { rows, links };
}
async function exportXlsx() {
  if (!state.stages.length) return;
  setStatus('Excel-Datei wird erstellt …', 'busy');
  try {
    await ensureAddrs();
    const X = await loadXlsx(),
      { rows, links } = xlsxRows();
    const ws = X.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: 'ddd dd"."mm"."yyyy' });
    links.forEach(l => {
      const a = X.utils.encode_cell({ r: l.r, c: l.c });
      if (ws[a]) ws[a].l = { Target: l.url };
    });
    ws['!cols'] = [6, 16, 14, 14, 7, 34, 34, 20, 26, 8, 9, 22, 18, 18, 28, 16, 11, 28, 9].map(w => ({ wch: w }));
    ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Reiseplan');
    X.writeFile(wb, fileBase(tourTitle()) + '.xlsx');
    flash('Excel-Datei erstellt.');
  } catch (e) {
    setStatus(e.message || String(e), 'error');
  }
}
function exportGpx() {
  if (!state.stages.length) return;
  const x = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
  const name = `${shortLabel(state.start.label)} → ${shortLabel(state.end.label)}`;
  const wpt = (p, n, d) => `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><name>${x(n)}</name>${d ? `<desc>${x(d)}</desc>` : ''}</wpt>\n`;
  let w = wpt(state.start, 'Start: ' + shortLabel(state.start.label));
  state.stages.forEach((s, i) => {
    const fin = state.done && i === state.stages.length - 1;
    if (s.to.kind !== 'camp') {
      if (fin) w += wpt(s.to, 'Ziel: ' + shortLabel(s.to.label));
      return;
    }
    const t = s.to.tags || {};
    const d = [`Etappe ${i + 1}: ${fkm(s.dist)}`, t.phone || t['contact:phone'], t.website || t['contact:website']].filter(Boolean).join(' · ');
    w += wpt(s.to, `${fin ? 'Ziel' : 'Etappe ' + (i + 1)}: ${s.to.label}`, d);
  });
  const pts = [];
  state.stages.forEach((s, i) => (i ? s.line.slice(1) : s.line).forEach(p => pts.push(p)));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Reiseplaner" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${x(name)}</name></metadata>
${w}  <trk><name>${x(name)}</name><trkseg>
${pts.map(p => `    <trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"/>`).join('\n')}
  </trkseg></trk>
</gpx>
`;
  download(xml, fileBase(name) + '.gpx', 'application/gpx+xml');
}
