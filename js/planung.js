/* Reiseplaner – Kernlogik: Campingplätze im Korridor, Abschnitte, Platz fehlt, Ziel-/Ausweichplatz, Zwischenstopp.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
/* ---------- Kernlogik: Plätze im Korridor ---------- */
async function findCandidates(line, cum, cminKm, cmaxKm, detourKm) {
  const total = cum[cum.length - 1];
  const d0 = cminKm * 1000,
    d1 = Math.min(cmaxKm * 1000, total);
  if (d1 <= d0) return [];
  // 1) Vorauswahl: alle Campingplätze im Rechteck um den Korridor (schonend für den Server),
  //    dann Luftlinie zur Route lokal filtern
  const poly = sample(line, cum, d0, d1, Math.max(2, Math.ceil((d1 - d0) / 1000)));
  const lats = poly.map(o => o.p[0]),
    lons = poly.map(o => o.p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  // Rand mind. 20 km: deckt auch die Stufe „Umweg 20 km“ ab → dieselbe Abfrage kommt dann aus dem Zwischenspeicher
  const padKm = Math.max(20, detourKm);
  const pLat = padKm / 111,
    pLon = padKm / (111 * Math.cos(midLat * RAD));
  const box = [Math.min(...lats) - pLat, Math.min(...lons) - pLon, Math.max(...lats) + pLat, Math.max(...lons) + pLon];
  let camps = await campsInBox(box, { onStatus: t => setStatus(t, 'busy') });
  for (const c of camps) {
    let best = Infinity;
    for (const o of poly) {
      const h = hav(o.p, [c.lat, c.lon]);
      if (h < best) best = h;
    }
    c.air = best;
  }
  camps = camps.filter(c => c.air <= detourKm * 1000);
  camps.sort((a, b) => a.air - b.air);
  camps = camps.slice(0, 60);
  if (!camps.length) return [];
  // 2) Echter Umweg: Straßenentfernung von Ankerpunkten auf der Route zum Platz (Matrix)
  const nAnch = Math.min(40, Math.max(6, Math.ceil((d1 - d0) / 3000)));
  const anchors = sample(line, cum, d0, d1, nAnch - 1).map(a => ({ d: Math.round(a.d), p: [+a.p[0].toFixed(5), +a.p[1].toFixed(5)] }));
  for (let i = 0; i < camps.length; i += 30) {
    const chunk = camps.slice(i, i + 30);
    const j = await matrix({
      locations: [...anchors.map(a => [a.p[1], a.p[0]]), ...chunk.map(c => [c.lon, c.lat])],
      sources: anchors.map((_, k) => k),
      destinations: chunk.map((_, k) => anchors.length + k),
      metrics: ['distance', 'duration']
    });
    chunk.forEach((c, k) => {
      let best = null;
      anchors.forEach((a, s) => {
        const dd = j.distances?.[s]?.[k];
        if (dd != null && (!best || dd < best.d)) best = { d: dd, t: j.durations?.[s]?.[k] ?? 0, km: a.d };
      });
      c.detour = best ? { d: best.d, t: best.t } : null;
      c.stageKm = best ? best.km : null;
    });
  }
  return camps.filter(c => c.detour && c.detour.d <= detourKm * 1000).sort((a, b) => a.detour.d - b.detour.d);
}

/* Suchkorridor um die ideale Etappenlänge (km); stufenweise erweitern, wenn nichts gefunden wird */
function corridor(optKm, extra) {
  const hw = halfWidth() + extra;
  return { cmin: Math.max(10, Math.round((optKm - hw) / 5) * 5), cmax: Math.round((optKm + hw) / 5) * 5 };
}
const LEVELS = [
  k => ({ ...corridor(k, 0), detour: +settings.detour, note: null }),
  k => ({ ...corridor(k, 0), detour: Math.max(20, +settings.detour), note: 'Nichts im normalen Korridor – Umweg auf 20 km erweitert.' }),
  k => {
    const c = corridor(k, 50);
    return { ...c, detour: Math.max(20, +settings.detour), note: `Nichts gefunden – Korridor auf ${c.cmin}–${c.cmax} km und 20 km Umweg erweitert.` };
  }
];

function campPoint(c) {
  return { lat: c.lat, lon: c.lon, kind: 'camp', id: c.id, tags: c.tags, label: c.tags.name || 'Campingplatz ohne Namen', detour: c.detour || null };
}

/* Empfehlung: so wenige Etappen wie möglich (jede ≤ max), alle gleich lang */
function plan(R) {
  const cm = +settings.cmax * 1000;
  const n = Math.max(1, Math.ceil(R / cm));
  return { n, len: R / n };
}
// halbe Korridorbreite um die ideale Etappenlänge (aus „Etappe min./max.“, Standard 350–450 → ±50 km)
const halfWidth = () => Math.max(25, (+settings.cmax - +settings.cmin) / 2);

/* Schritt 1: Gesamtstrecke berechnen, danach fragt das Panel nach der Anzahl der Etappen */
async function computeOverview() {
  state.stages = [];
  state.pending = null;
  state.done = false;
  state.endCands = [];
  state.n = null;
  state.tourId = null;
  state.segs = null;
  state.split = null;
  state.prevPicks = null;
  state.keepEnd = null;
  setStatus('Gesamtstrecke wird berechnet …', 'busy');
  renderAll();
  if (state.via.length) {
    await computeSegs();
    renderAll();
    fitAll();
    return;
  }
  const r = await route(state.start, state.end);
  state.overview = { from: state.start, ...r };
  renderAll();
  fitAll();
}
/* Zwischenziele → Abschnitte: jedes Ziel mit Übernachtung beendet einen Abschnitt; „Besuch unterwegs“ sind
   Durchgangspunkte im Abschnitt. Lange Abschnitte bekommen Transit-Etappen (Anzahl je Abschnitt wählbar). */
async function computeSegs() {
  const segs = [];
  let pend = [];
  for (const v of state.via) {
    if (v.kind === 'visit') {
      pend.push(v);
      continue;
    }
    const sights = v.kind === 'rest' ? [] : [{ uid: v.uid, label: v.label, lat: v.lat, lon: v.lon }, ...(v.sights || [])];
    segs.push({
      to: { lat: v.lat, lon: v.lon, label: v.label, uid: v.uid },
      kind: 'sight',
      rest: v.kind === 'rest',
      sights,
      visits: pend,
      nights: Math.max(1, +v.nights || 1),
      radius: +v.radius || 20
    });
    pend = [];
  }
  segs.push({ to: { ...(state.round ? state.start : state.end) }, kind: state.round ? 'home' : 'end', visits: pend });
  let from = state.start,
    dist = 0,
    dur = 0,
    line = [];
  for (let k = 0; k < segs.length; k++) {
    const g = segs[k];
    setStatus(`Abschnitt ${k + 1} von ${segs.length} wird berechnet …`, 'busy');
    const r = await route(from, g.to, g.visits);
    g.dist = r.dist;
    g.dur = r.dur;
    g.rec = plan(r.dist).n;
    g.n = g.rec;
    g._r = { ...r, from };
    dist += r.dist;
    dur += r.dur;
    line = line.concat(r.line);
    from = g.to;
  }
  state.segs = segs;
  state.overview = { from: state.start, multi: true, line, dist, dur };
}
const segDone = k => state.stages.filter(s => s.seg === k).length;
/* Erneut „Strecke berechnen“ (z. B. Ziel nachträglich eingefügt): Etappen unveränderter Abschnitte werden übernommen.
   Ein Abschnitt gilt als unverändert, wenn Start, Ziel, Art, Besuche unterwegs und Sehenswürdigkeiten gleich sind. */
const ptKey = p => (p ? p.uid || `${(+p.lat).toFixed(4)},${(+p.lon).toFixed(4)}` : '');
const segKey = (from, g) =>
  [
    ptKey(from),
    ptKey(g.to),
    g.kind,
    g.rest ? 'r' : '',
    (g.visits || []).map(v => v.uid).join('+'),
    (g.sights || []).map(x => x.uid || ptKey(x)).join('+')
  ].join('|');
function snapshotKeep() {
  const st = state.stages;
  if (!st.length) return null;
  const secs = new Map(),
    prev = new Set(st.filter(s => s.to.kind === 'camp').map(s => String(s.to.id)));
  const keepEnd = { endCands: state.endCands, endSearched: state.endSearched };
  if (state.segs) {
    let from = st[0].from;
    state.segs.forEach((g, k) => {
      const ss = st.filter(s => s.seg === k);
      const complete = ss.length === g.n && (g.kind !== 'sight' || ss[ss.length - 1].to.kind === 'camp') && (g.kind === 'sight' || state.done);
      if (complete)
        secs.set(
          segKey(from, g),
          ss.map(s => ({ ...s }))
        );
      from = g.to;
    });
  } else if (state.done && state.end) {
    secs.set(
      segKey(st[0].from, { to: state.end, kind: state.round ? 'home' : 'end', visits: [] }),
      st.map(s => ({ ...s }))
    );
  }
  return { secs, prev, keepEnd };
}
// nach computeSegs: passende Abschnitte markieren (g.keep = alte Etappen, Anzahl wie bisher)
function applyKeep(kp) {
  state.prevPicks = kp ? kp.prev : null;
  state.keepEnd = kp ? kp.keepEnd : null;
  if (!kp || !state.segs) return 0;
  let from = state.start,
    n = 0;
  state.segs.forEach(g => {
    const ss = kp.secs.get(segKey(from, g));
    if (ss) {
      g.keep = ss;
      g.n = ss.length;
      n++;
    }
    from = g.to;
  });
  return n;
}
const prevBadge = c =>
  (c.added ? ' <span class="badge prev">von dir ergänzt</span>' : '') +
  (state.prevPicks && state.prevPicks.has(String(c.id)) ? ' <span class="badge prev">bisher gewählt</span>' : '');
/* Platz fehlt in der Liste? Name suchen (Photon = alle benannten OSM-Orte) oder Google-Maps-Link / Koordinaten einfügen.
   Google-Inhalte selbst werden nicht übernommen (Google-Regeln) – nur die Koordinaten, die der Nutzer einfügt. */
const addCampHtml =
  ctx => `<form class="addcamp" data-ctx="${ctx}"><input name="q" placeholder="Platz fehlt? Name, Google-Maps-Link oder Koordinaten" enterkeyhint="search" aria-label="Fehlenden Campingplatz suchen" autocomplete="off">
  <button class="btn small" type="submit">Suchen</button></form><ul class="addres"></ul>`;
function parseCoords(t) {
  const pats = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i,
    /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
    /^\s*(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)\s*$/
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (m) {
      const lat = +m[1],
        lon = +m[2];
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
    }
  }
  return null;
}
const nameFromUrl = t => {
  const m = t.match(/\/place\/([^/@?]+)/);
  try {
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  } catch (e) {
    return '';
  }
};
function addCtxCenter(ctx) {
  const p = state.pending;
  if (ctx === 'alt' && state.alt) return state.stages[state.alt.i]?.to || null;
  if (ctx === 'split' && state.split) {
    const st = state.stages[state.split.i];
    const q = pointAt(st.line, cumul(st.line), st.dist / 2);
    return { lat: q[0], lon: q[1] };
  }
  if (p && p.mode === 'anchor') return p.sight;
  if (p) {
    const q = pointAt(p.line, p.cum, p.plan ? p.plan.len : p.remain / 2);
    return { lat: q[0], lon: q[1] };
  }
  return null;
}
// Kennzahlen wie bei gefundenen Plätzen berechnen (Umweg/Etappen-km bzw. Entfernung zur Sehenswürdigkeit)
async function enrichAdded(ctx, c) {
  const p = state.pending;
  if (ctx === 'alt') {
    const t = state.alt && state.stages[state.alt.i]?.to;
    if (t) c.air = hav([t.lat, t.lon], [c.lat, c.lon]);
    return;
  }
  const along = async (line, cum, total) => {
    const anchors = sample(line, cum, 0, total, 40).map(a => ({ d: Math.round(a.d), p: [+a.p[0].toFixed(5), +a.p[1].toFixed(5)] }));
    const j = await matrix({
      locations: [...anchors.map(a => [a.p[1], a.p[0]]), [c.lon, c.lat]],
      sources: anchors.map((_, k) => k),
      destinations: [anchors.length],
      metrics: ['distance', 'duration']
    });
    let best = null;
    anchors.forEach((a, k) => {
      const d = j.distances?.[k]?.[0];
      if (d != null && (!best || d < best.d)) best = { d, t: j.durations?.[k]?.[0] ?? 0, km: a.d };
    });
    if (best) {
      c.detour = { d: best.d, t: best.t };
      c.stageKm = best.km;
    }
  };
  if (ctx === 'split') {
    const st = state.stages[state.split.i];
    await along(st.line, cumul(st.line), st.dist);
    if (c.detour) {
      c.after = Math.max(0, st.dist - c.stageKm + c.detour.d);
      c.dev = Math.abs(c.stageKm - st.dist / 2);
    }
    return;
  }
  if (p && p.mode === 'anchor') {
    const S = p.sights && p.sights.length ? p.sights : [p.sight];
    c.air = hav([p.sight.lat, p.sight.lon], [c.lat, c.lon]);
    const r = await roadPairs(S, c);
    c.sightD = S.map((x, q) => (r[q].d != null ? { uid: x.uid, label: x.label, d: r[q].d, t: r[q].t } : null));
    const ok = c.sightD.filter(Boolean);
    c.sight = ok.length ? { d: ok.reduce((a, x) => a + x.d, 0) / ok.length, t: ok.reduce((a, x) => a + x.t, 0) / ok.length } : null;
    return;
  }
  if (p) {
    await along(p.line, p.cum, p.remain);
    if (c.detour) {
      c.after = Math.max(0, p.remain - c.stageKm + c.detour.d);
      const n = Math.max(1, p.plan.n - 1);
      c.afterPlan = { n, len: c.after / n };
      c.dev = Math.abs(c.stageKm - p.plan.len);
    }
  }
}
async function addCustomCamp(ctx, o) {
  const id = o.id || `eigen/${o.lat.toFixed(5)},${o.lon.toFixed(5)}`;
  const c = campIndex.get(id) || { id, lat: o.lat, lon: o.lon, tags: { tourism: 'camp_site', name: o.name || 'Eigener Platz', ...(o.tags || {}) } };
  c.added = true;
  campIndex.set(id, c);
  setStatus(`Entfernungen für „${c.tags.name}“ …`, 'busy');
  await enrichAdded(ctx, c);
  const list = ctx === 'split' ? state.split?.list : ctx === 'alt' ? state.alt?.list : state.pending?.cands;
  if (!list) return;
  if (!list.includes(c)) list.push(c);
  if (ctx === 'alt') list.sort((a, b) => (a.added ? -1 : 0) - (b.added ? -1 : 0) || a.air - b.air);
  else if (ctx === 'split' || (state.pending && state.pending.mode !== 'anchor')) list.sort((a, b) => (a.dev ?? 1e12) - (b.dev ?? 1e12));
  else list.sort((a, b) => (a.sight ? a.sight.d : a.air * 1.4) - (b.sight ? b.sight.d : b.air * 1.4));
  renderAll();
  map.setView([c.lat, c.lon], Math.max(map.getZoom(), 11));
  setTimeout(() => {
    c._m?.openPopup();
    const row = document.querySelector(`#result [data-show="${CSS.escape(String(id))}"]`);
    row?.closest('li')?.classList.add('flashrow');
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 50);
  flash(`„${c.tags.name}“ ist jetzt in der Liste und auf der Karte – mit „${ctx === 'alt' ? 'Übernehmen' : 'Wählen'}“ übernehmen.`);
}
async function searchAddCamp(form) {
  const ctx = form.dataset.ctx,
    t = form.q.value.trim(),
    out = form.nextElementSibling;
  if (!t) return;
  if (/goo\.gl|maps\.app/i.test(t)) {
    out.innerHTML =
      '<li class="muted">Kurzlinks kann die App nicht öffnen. In Google Maps lange auf den Platz drücken (bzw. rechts klicken), die angezeigten Koordinaten kopieren und hier einfügen – oder den langen Link aus der Adresszeile des Browsers.</li>';
    return;
  }
  const co = parseCoords(t);
  if (co) {
    const name = nameFromUrl(t) || prompt('Name des Campingplatzes:', 'Eigener Platz');
    if (name === null) return;
    out.innerHTML = '';
    return run(() => addCustomCamp(ctx, { ...co, name: name.trim() || 'Eigener Platz' }));
  }
  const ctr = addCtxCenter(ctx);
  out.innerHTML = '<li class="muted">Suche …</li>';
  try {
    const j = await getJson(
      `${PHOTON}/api/?q=${encodeURIComponent(t)}&limit=12&lang=de${ctr ? `&lat=${ctr.lat.toFixed(4)}&lon=${ctr.lon.toFixed(4)}` : ''}`,
      'Suche (Photon)'
    );
    const T = { N: 'node', W: 'way', R: 'relation' };
    let r = (j.features || [])
      .map(f => {
        const pr = f.properties,
          lat = f.geometry.coordinates[1],
          lon = f.geometry.coordinates[0];
        return {
          lat,
          lon,
          name: pr.name || t,
          label: photonLabel(pr),
          camp: ['camp_site', 'caravan_site'].includes(pr.osm_value),
          id: pr.osm_type && pr.osm_id ? `${T[pr.osm_type] || pr.osm_type}/${pr.osm_id}` : null,
          dist: ctr ? hav([ctr.lat, ctr.lon], [lat, lon]) : 0
        };
      })
      .filter(x => !ctr || x.dist <= 150000);
    r.sort((a, b) => b.camp - a.camp || a.dist - b.dist);
    r = r.slice(0, 8);
    if (!r.length) {
      out.innerHTML =
        '<li class="muted">Nichts in der Nähe gefunden. In Google Maps den Platz antippen, Koordinaten oder Link kopieren und hier einfügen.</li>';
      return;
    }
    out.innerHTML = r
      .map(
        (x, i) =>
          `<li><button type="button" data-ar="${i}"><b>${i + 1}</b> ${x.camp ? '⛺ ' : ''}${esc(x.label)}${ctr ? ` <span class="muted">· ${fkm(x.dist)} entfernt</span>` : ''}</button></li>`
      )
      .join('');
    const take = i => {
      const x = r[i];
      out.innerHTML = '';
      lyr.hits.clearLayers();
      run(() => addCustomCamp(ctx, { lat: x.lat, lon: x.lon, name: x.name, id: x.camp ? x.id : null }));
    };
    // Treffer auch auf der Karte (Nummern wie in der Liste) – Karte fährt dorthin
    lyr.hits.clearLayers();
    const mk = r.map((x, i) =>
      L.marker([x.lat, x.lon], { icon: pinIcon(String(i + 1), 'hit'), zIndexOffset: 800 })
        .bindTooltip(`${x.camp ? '⛺ ' : ''}${esc(x.name)} – antippen zum Hinzufügen`, { direction: 'top', offset: [0, -26] })
        .on('click', () => take(i))
        .addTo(lyr.hits)
    );
    map.fitBounds(L.latLngBounds([...r.map(x => [x.lat, x.lon]), ...(ctr ? [[ctr.lat, ctr.lon]] : [])]).pad(0.15), { ...sheetPad(), maxZoom: 13 });
    out.querySelectorAll('[data-ar]').forEach(b => {
      const i = +b.dataset.ar;
      b.onclick = () => take(i);
      b.onmouseenter = () => {
        mk[i].openTooltip();
        followCamp(r[i]);
      };
      b.onmouseleave = () => mk[i].closeTooltip();
    });
  } catch (e) {
    out.innerHTML = `<li class="muted">${esc(e.message)} – alternativ Koordinaten oder Google-Maps-Link einfügen.</li>`;
  }
}
const viaByUid = uid => state.via.find(v => v.uid === uid);
const visitsOf = s => (s.vias || []).map(viaByUid).filter(Boolean);
// Abstand eines Punktes entlang der Linie (nächster Linienpunkt)
function posOnLine(line, cum, p) {
  let best = 0,
    bd = Infinity;
  for (let i = 0; i < line.length; i++) {
    const d = hav(line[i], [p.lat, p.lon]);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return cum[best];
}
function chooseN(n) {
  n = Math.round(n);
  if (!(n >= 1) || !state.overview || state.busy) return;
  state.n = Math.min(n, 30);
  state.stages = [];
  state.done = false;
  run(() => computeNext(state.start));
}
function startSegs() {
  if (!state.segs || state.busy) return;
  state.n = state.segs.reduce((a, g) => a + g.n, 0);
  state.stages = [];
  state.done = false;
  run(() => computeNext(state.start));
}

async function computeNext(from) {
  state.pending = null;
  state.done = false;
  state.endCands = [];
  state.endSearched = false;
  state.showEndList = false;
  setStatus('Route wird berechnet …', 'busy');
  renderAll();
  const segs = state.segs;
  let k = 0,
    g = null,
    target = state.end,
    visits = [],
    left,
    r;
  if (segs) {
    k = segs.findIndex((x, i) => segDone(i) < x.n);
    if (k < 0) {
      state.done = true;
      renderAll();
      return;
    }
    g = segs[k];
    target = g.to;
    if (g.keep && segDone(k) === 0) {
      const ks = g.keep.map(s => ({ ...s, seg: k }));
      delete g.keep;
      if (ptKey(ks[0].from) !== ptKey(from)) {
        // Platz davor hat sich geändert → nur die erste Etappe neu routen
        setStatus('Übernommene Etappe wird neu berechnet …', 'busy');
        const r0 = await route(from, ks[0].to, visitsOf(ks[0]));
        ks[0] = { ...ks[0], from, line: r0.line, dist: r0.dist, dur: r0.dur, ex: r0.ex, countries: undefined };
      }
      if (g.kind === 'sight') ks[ks.length - 1].nights = g.nights;
      state.stages.push(...ks);
      if (g.kind === 'sight') return computeNext(ks[ks.length - 1].to);
      state.done = true;
      state.pending = null;
      const ke = state.keepEnd;
      if (ke && ke.endSearched) {
        state.endCands = ke.endCands || [];
        state.endSearched = true;
      }
      renderAll();
      fitAll();
      if (g.kind !== 'home' && !state.endSearched && ks[ks.length - 1].to.kind !== 'camp') await loadEndCands();
      return;
    }
    const passed = new Set(state.stages.flatMap(s => s.vias || []));
    visits = g.visits.filter(v => !passed.has(v.uid));
    left = g.n - segDone(k);
    r = g._r && g._r.from === from && visits.length === g.visits.length ? g._r : await route(from, target, visits);
  } else {
    const ov = state.overview;
    r = ov && ov.from === from ? ov : await route(from, state.end);
    if (!state.n) state.n = plan(r.dist).n + state.stages.length;
    left = state.n - state.stages.length; // noch zu fahrende Etappen inkl. dieser
  }
  if (left <= 1) {
    if (g && g.kind === 'sight') {
      await loadAnchorCands(from, k, visits, r);
      return;
    } // Platz an der Sehenswürdigkeit wählen
    state.stages.push({
      seg: k,
      vias: visits.map(v => v.uid),
      from,
      to: { ...target, kind: 'end' },
      line: r.line,
      dist: r.dist,
      dur: r.dur,
      ex: r.ex,
      note: null
    });
    state.done = true;
    state.pending = null;
    renderAll();
    fitAll();
    if (!(g && g.kind === 'home')) await loadEndCands();
    return;
  }
  const cum = cumul(r.line);
  const visitPos = visits.map(v => ({ uid: v.uid, d: posOnLine(r.line, cum, v) }));
  const pl = { n: left, len: r.dist / left },
    optKm = pl.len / 1000; // Reststrecke gleichmäßig auf die übrigen Etappen
  for (let lv = 0; lv < LEVELS.length; lv++) {
    const L = LEVELS[lv](optKm);
    setStatus(lv === 0 ? 'Suche Campingplätze im Korridor …' : 'Erweitere die Suche …', 'busy');
    const cands = await findCandidates(r.line, cum, L.cmin, L.cmax, L.detour);
    if (cands.length || lv === LEVELS.length - 1) {
      cands.forEach(c => {
        campIndex.set(c.id, c);
        c.after = Math.max(0, r.dist - c.stageKm + c.detour.d); // Reststrecke ab diesem Platz (Näherung)
        c.afterPlan = { n: left - 1, len: c.after / (left - 1) }; // danach: übrige Etappen gleich lang
        c.dev = Math.abs(c.stageKm - pl.len);
      });
      cands.sort((a, b) => a.dev - b.dev);
      cands.forEach((c, i) => (c.best = i === 0));
      state.pending = {
        from,
        seg: k,
        visits,
        visitPos,
        line: r.line,
        cum,
        remain: r.dist,
        remainDur: r.dur,
        cands,
        cmin: L.cmin,
        cmax: L.cmax,
        detour: L.detour,
        plan: pl,
        info: null,
        note: cands.length ? L.note : 'Keine Campingplätze gefunden. Zoom auf der Karte rein und wähle einen Platz manuell.'
      };
      break;
    }
  }
  renderAll();
  fitCorridor();
}

/* Campingplätze rund um eine Sehenswürdigkeit (Ende eines Abschnitts); Entfernung Platz ↔ Sehenswürdigkeit auf der
   Straße mit normaler Pkw-Geschwindigkeit (Ausflug ohne Wohnwagen) */
async function loadAnchorCands(from, k, visits, r, km) {
  const g = state.segs[k],
    S = g.sights && g.sights.length ? g.sights : [g.to];
  // Basislager: Suche um den Mittelpunkt aller Sehenswürdigkeiten, Umkreis mindestens bis zur entferntesten + 10 km
  const sight = S.length > 1 ? { lat: S.reduce((a, x) => a + x.lat, 0) / S.length, lon: S.reduce((a, x) => a + x.lon, 0) / S.length, label: g.to.label } : g.to;
  const spread = Math.max(0, ...S.map(x => hav([sight.lat, sight.lon], [x.lat, x.lon]))) / 1000;
  km = km || g.radius || 20;
  if (S.length > 1) km = Math.max(km, Math.ceil(spread + 10));
  g.radius = km;
  const rad = km * 1000,
    dLat = rad / 111000,
    dLon = rad / (111000 * Math.cos(sight.lat * RAD));
  setStatus(`Suche Campingplätze bei ${shortLabel(sight.label)} …`, 'busy');
  const all = await campsInBox([sight.lat - dLat, sight.lon - dLon, sight.lat + dLat, sight.lon + dLon], { onStatus: t => setStatus(t, 'busy') });
  let camps = all
    .map(c => {
      c.air = hav([sight.lat, sight.lon], [c.lat, c.lon]);
      campIndex.set(c.id, c);
      return c;
    })
    .filter(c => c.air <= rad)
    .sort((a, b) => a.air - b.air)
    .slice(0, 40);
  if (camps.length) {
    setStatus(S.length > 1 ? 'Entfernungen zu den Sehenswürdigkeiten …' : 'Entfernungen zur Sehenswürdigkeit …', 'busy');
    try {
      const j = await matrix({
        locations: [...S.map(x => [+x.lon.toFixed(5), +x.lat.toFixed(5)]), ...camps.map(c => [c.lon, c.lat])],
        sources: S.map((_, i) => i),
        destinations: camps.map((_, i) => S.length + i),
        metrics: ['distance', 'duration']
      });
      camps.forEach((c, i) => {
        c.sightD = S.map((x, q) => {
          const d = j.distances?.[q]?.[i];
          return d != null ? { uid: x.uid, label: x.label, d, t: j.durations?.[q]?.[i] ?? 0 } : null;
        });
        const ok = c.sightD.filter(Boolean);
        c.sight = ok.length
          ? { d: ok.reduce((a, x) => a + x.d, 0) / ok.length, t: ok.reduce((a, x) => a + x.t, 0) / ok.length, sum: ok.reduce((a, x) => a + x.d, 0) }
          : null;
      });
    } catch (e) {
      console.warn(e);
    }
    // Basislager: kleinste Summe der Wege zu allen Sehenswürdigkeiten
    camps.sort((a, b) => (a.sight ? a.sight.d : a.air * 1.4) - (b.sight ? b.sight.d : b.air * 1.4));
  }
  // selbst ergänzte Plätze bleiben bei neuer Suche (z. B. anderer Umkreis) erhalten
  const old = state.pending && state.pending.mode === 'anchor' && state.pending.seg === k ? state.pending.cands.filter(c => c.added && !camps.includes(c)) : [];
  if (old.length) {
    camps.push(...old);
    camps.sort((a, b) => (a.sight ? a.sight.d : a.air * 1.4) - (b.sight ? b.sight.d : b.air * 1.4));
  }
  camps.forEach((c, i) => (c.best = i === 0));
  state.pending = {
    mode: 'anchor',
    seg: k,
    from,
    visits,
    line: r.line,
    cum: cumul(r.line),
    remain: r.dist,
    remainDur: r.dur,
    cands: camps,
    sight,
    sights: S,
    radius: km,
    plan: null,
    cmin: 0,
    cmax: 0,
    detour: 0,
    note: camps.length ? null : `Keine Campingplätze im Umkreis von ${km} km – Umkreis vergrößern oder auf der Karte reinzoomen.`
  };
  renderAll();
  map.fitBounds(
    L.latLng(sight.lat, sight.lon)
      .toBounds(rad * 2.15)
      .extend(L.latLngBounds([...S.map(x => [x.lat, x.lon]), ...camps.map(c => [c.lat, c.lon])])),
    sheetPad()
  );
}

/* Campingplätze rund um den Zielort, um das Ziel auf einen Platz zu legen */
async function loadEndCands() {
  state.endCands = [];
  state.endSearched = false;
  const e = state.end,
    rad = Math.max(10, +settings.detour) * 1000;
  try {
    setStatus('Suche Campingplätze am Ziel …', 'busy');
    const dLat = rad / 111000,
      dLon = rad / (111000 * Math.cos(e.lat * RAD));
    const camps = await campsInBox([e.lat - dLat, e.lon - dLon, e.lat + dLat, e.lon + dLon], { onStatus: t => setStatus(t, 'busy') });
    camps.forEach(c => {
      c.air = hav([e.lat, e.lon], [c.lat, c.lon]);
      campIndex.set(c.id, c);
    });
    state.endCands = camps
      .filter(c => c.air <= rad)
      .sort((a, b) => a.air - b.air)
      .slice(0, 20);
    state.endSearched = true;
  } catch (err) {
    console.warn(err);
  }
  renderAll();
}
async function selectEnd(c) {
  const i = state.stages.length - 1,
    s = state.stages[i];
  if (!state.done || !s) return;
  setStatus('Letzte Etappe wird neu berechnet …', 'busy');
  const to = campPoint(c);
  to.air = c.air;
  const r = await route(s.from, to, visitsOf(s));
  state.stages[i] = { ...s, to, line: r.line, dist: r.dist, dur: r.dur, ex: r.ex, countries: undefined, note: null };
  state.showEndList = false;
  state.alt = null;
  touch();
  renderAll();
  fitAll();
}

/* Platz ändern (früher „Ausweichplatz“): Campingplätze im Umkreis um den Platz einer Etappe, nur dieser Platz wird getauscht */
async function loadAlt(i, km) {
  const s = state.stages[i];
  if (!s) return;
  const c = s.to,
    rad = km * 1000;
  state.split = null;
  state.alt = { i, r: km, list: null };
  renderAll();
  setStatus(`Suche Campingplätze im Umkreis von ${km} km …`, 'busy');
  const dLat = rad / 111000,
    dLon = rad / (111000 * Math.cos(c.lat * RAD));
  const camps = await campsInBox([c.lat - dLat, c.lon - dLon, c.lat + dLat, c.lon + dLon], { onStatus: t => setStatus(t, 'busy') });
  camps.forEach(x => {
    x.air = hav([c.lat, c.lon], [x.lat, x.lon]);
    campIndex.set(x.id, x);
  });
  if (!state.alt || state.alt.i !== i) return;
  state.alt.list = camps
    .filter(x => x.id !== c.id && x.air <= rad)
    .sort((a, b) => a.air - b.air)
    .slice(0, 30);
  renderAll();
  const pts = [[c.lat, c.lon], ...state.alt.list.filter(passFilter).map(x => [x.lat, x.lon])];
  map.fitBounds(L.latLngBounds(pts).pad(0.15), sheetPad());
}
// Platz tauschen: diese und die folgende Etappe neu berechnen, spätere bleiben; die eigene Notiz bleibt
// (Preise/Status gehören zum alten Platz: `my.cid`)
async function replaceStop(i, c) {
  const s = state.stages[i];
  if (!s) return;
  const to = campPoint(c);
  setStatus('Etappe wird neu berechnet …', 'busy');
  if (s.to.near) to.near = { label: s.to.near.label, d: null, t: null, air: hav([c.lat, c.lon], [s.to.lat, s.to.lon]) + (s.to.near.air || 0) };
  if (s.to.sights) to.sights = s.to.sights.map(x => ({ ...x, d: x.lat != null ? hav([c.lat, c.lon], [x.lat, x.lon]) * 1.3 : null, t: null, est: true }));
  const r = await route(s.from, to, visitsOf(s));
  const memo = s.memo?.text ? { text: s.memo.text } : undefined;
  state.stages[i] = { ...s, to, line: r.line, dist: r.dist, dur: r.dur, ex: r.ex, countries: undefined, note: null, memo };
  // eigene Zeilen (Fähre/Kosten) dieses Aufenthalts bleiben beim neuen Platz
  const oldKey = String(s.to.id || s.to.label);
  (state.extras || []).forEach(e => {
    if (e.at === oldKey) e.at = String(to.id || to.label);
  });
  const nx = state.stages[i + 1];
  if (nx) {
    const r2 = await route(to, nx.to, visitsOf(nx));
    state.stages[i + 1] = { ...nx, from: to, line: r2.line, dist: r2.dist, dur: r2.dur, ex: r2.ex, countries: undefined };
  }
  state.alt = null;
  state.openDet.add(i);
  if (!state.done && i === state.stages.length - 1) {
    await computeNext(to);
  }
  touch();
  renderAll();
  fitAll();
}

// Alle Strecken neu berechnen, gewählte Plätze und alle Eingaben bleiben: z. B. nach geänderten Routen-Einstellungen
// (Autobahn/Maut) oder für Touren mit geraden Linien (Beispiel-Tour aus dem Nachbau-Test). Entfernungen Platz ↔
// Sehenswürdigkeiten werden ebenfalls neu über die Straße gemessen.
let rerouting = false;
async function rerouteAll() {
  if (rerouting || state.busy || !state.stages.length) return;
  rerouting = true;
  const n = state.stages.length;
  let fails = 0;
  try {
    for (let i = 0; i < n; i++) {
      const s = state.stages[i];
      if (!s) continue;
      if (i > 0) s.from = state.stages[i - 1].to;
      setStatus(`Strecke ${i + 1} von ${n} wird berechnet …`, 'busy');
      try {
        const r = await route(s.from, s.to, visitsOf(s));
        Object.assign(s, { line: r.line, dist: r.dist, dur: r.dur, ex: r.ex, countries: undefined });
      } catch (e) {
        fails++;
        continue;
      }
      const S = (s.to.sights || []).filter(x => x.lat != null);
      if (S.length) {
        try {
          const r = await roadPairs(S, s.to);
          S.forEach((x, q) => {
            if (r[q].d != null) Object.assign(x, { d: r[q].d, t: r[q].t, est: undefined });
          });
          const ok = S.filter(x => x.d != null && !x.est);
          if (s.to.near && ok.length)
            Object.assign(s.to.near, { d: ok.reduce((a, x) => a + x.d, 0) / ok.length, t: ok.reduce((a, x) => a + (x.t || 0), 0) / ok.length });
        } catch (e) {}
      }
    }
  } finally {
    rerouting = false;
  }
  touch();
  renderAll();
  fitAll();
  if (fails) setStatus(`${fails} von ${n} Strecken konnten nicht berechnet werden – bitte später noch einmal versuchen.`, 'error');
  else {
    setStatus('');
    flash(`Alle ${n} Strecken neu berechnet ✓`);
  }
}

/* Zwischenstopp in eine fertige Etappe einfügen: Plätze im mittleren Teil (25–75 %) der Etappe, sortiert nach Nähe
   zur Hälfte; beim Übernehmen wird die Etappe geteilt, alle anderen Etappen bleiben unverändert */
async function loadSplit(i) {
  const s = state.stages[i];
  if (!s) return;
  state.alt = null;
  state.split = { i, list: null, note: null };
  renderAll();
  const cum = cumul(s.line),
    km = s.dist / 1000,
    half = s.dist / 2;
  let list = [],
    note = null;
  for (const [lv, det] of [
    [0, +settings.detour],
    [1, Math.max(20, +settings.detour)]
  ]) {
    setStatus(lv ? 'Erweitere die Suche (Umweg 20 km) …' : 'Suche Campingplätze auf halbem Weg …', 'busy');
    list = await findCandidates(s.line, cum, Math.max(5, km * 0.25), km * 0.75, det);
    if (list.length) {
      if (lv) note = 'Nichts im normalen Umkreis der Route – Umweg auf 20 km erweitert.';
      break;
    }
  }
  if (!state.split || state.split.i !== i) return;
  list.forEach(c => {
    campIndex.set(c.id, c);
    c.dev = Math.abs(c.stageKm - half);
    c.after = Math.max(0, s.dist - c.stageKm + c.detour.d);
  });
  list.sort((a, b) => a.dev - b.dev);
  list.forEach((c, k) => (c.best = k === 0));
  state.split = { i, list: list.slice(0, 40), note };
  renderAll();
  const pts = [...s.line.filter((_, k) => k % 10 === 0), ...state.split.list.filter(passFilter).map(x => [x.lat, x.lon])];
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.1), sheetPad());
}
async function splitStage(i, c) {
  const s = state.stages[i];
  if (!s) return;
  const to = campPoint(c),
    cum = cumul(s.line);
  const at = c.stageKm ?? posOnLine(s.line, cum, to);
  const vs = visitsOf(s),
    v1 = vs.filter(v => posOnLine(s.line, cum, v) < at),
    v2 = vs.filter(v => !v1.includes(v));
  setStatus('Etappe wird geteilt …', 'busy');
  const r1 = await route(s.from, to, v1),
    r2 = await route(to, s.to, v2);
  const a = { seg: s.seg, vias: v1.map(v => v.uid), from: s.from, to, line: r1.line, dist: r1.dist, dur: r1.dur, ex: r1.ex, note: null };
  const b = { ...s, vias: v2.map(v => v.uid), from: to, line: r2.line, dist: r2.dist, dur: r2.dur, ex: r2.ex, countries: undefined };
  state.stages.splice(i, 1, a, b);
  if (state.segs && s.seg != null && state.segs[s.seg]) state.segs[s.seg].n += 1;
  if (state.n) state.n += 1;
  state.split = null;
  state.openDet = new Set([...state.openDet].map(k => (k > i ? k + 1 : k)));
  touch();
  renderAll();
  fitAll();
  flash(`Zwischenstopp „${shortLabel(to.label)}“ eingefügt – Etappe ${i + 1} ist jetzt zweigeteilt.`);
}

async function selectCamp(c) {
  const p = state.pending;
  if (!p) return;
  const to = campPoint(c);
  // Besuche unterwegs, die vor diesem Platz liegen (am Ende eines Abschnitts: alle)
  const vias =
    p.mode === 'anchor'
      ? p.visits || []
      : (p.visitPos || [])
          .filter(v => c.stageKm == null || v.d < c.stageKm)
          .map(v => viaByUid(v.uid))
          .filter(Boolean);
  if (p.mode === 'anchor') {
    to.near = { label: p.sight.label, d: c.sight ? c.sight.d : null, t: c.sight ? c.sight.t : null, air: c.air };
    if (p.sights && p.sights.length)
      to.sights = p.sights.map((x, q) => ({ uid: x.uid, label: x.label, lat: x.lat, lon: x.lon, d: c.sightD?.[q]?.d ?? null, t: c.sightD?.[q]?.t ?? null }));
  }
  setStatus('Etappe wird berechnet …', 'busy');
  const r = await route(p.from, to, vias);
  const st = { seg: p.seg, vias: vias.map(v => v.uid), from: p.from, to, line: r.line, dist: r.dist, dur: r.dur, ex: r.ex, note: p.note };
  if (p.mode === 'anchor') st.nights = state.segs[p.seg].nights;
  state.stages.push(st);
  state.pending = null;
  await computeNext(to);
}
