/* Reiseplaner – Ablaufsteuerung und Karte (Info-Fenster, Ebenen, Zoom-Plätze).
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
/* ---------- Ablaufsteuerung ---------- */
async function run(fn) {
  if (state.busy) return;
  state.busy = true;
  areaCtl?.abort();
  renderAll();
  try {
    await fn();
    setStatus('');
  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e), 'error');
  } finally {
    state.busy = false;
    renderAll();
    loadArea();
  }
}
function setStatus(text, kind) {
  const el = $('#status');
  el.className = kind === 'error' ? 'error' : '';
  el.innerHTML = text ? (kind === 'busy' ? '<span class="spin"></span>' : '') + `<span>${esc(text)}</span>` : '';
  // gut sichtbar auch über der Karte, solange etwas läuft (Menü kann weggescrollt/eingeklappt sein)
  const mb = $('#mapBusy');
  if (mb) {
    mb.hidden = !(text && kind === 'busy');
    if (!mb.hidden) mb.innerHTML = `<span class="spin"></span><span>${esc(text)}</span>`;
  }
}

/* ---------- Karte ---------- */
// Zweiter Klick auf denselben Punkt schließt das Info-Fenster (Leaflet macht das nur bei Stecknadeln, nicht bei Kreisen)
// Leaflet schließt das offene Fenster schon beim „preclick“ der Karte – deshalb merken, welches gerade zuging.
const _openPopup0 = L.Layer.prototype._openPopup;
let lastClosed = { src: null, t: 0 };
L.Layer.prototype._openPopup = function (e) {
  const t = e.layer || e.target;
  if (this._popup && this._map && t instanceof L.Path) {
    if (this._popup._source === t && this._map.hasLayer(this._popup)) {
      L.DomEvent.stop(e);
      this.closePopup();
      return;
    }
    if (lastClosed.src === t && Date.now() - lastClosed.t < 400) {
      L.DomEvent.stop(e);
      lastClosed.src = null;
      return;
    }
  }
  return _openPopup0.call(this, e);
};
const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([51.2, 10.4], 6);
L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);
const ATTR_ROUTE = ' · Routing © openrouteservice.org';
const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  crossOrigin: 'anonymous',
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' + ATTR_ROUTE
});
// Satellitenbild (Esri World Imagery) + Ortsnamen/Grenzen als zweite Ebene
const satLayer = L.layerGroup([
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    maxNativeZoom: 18,
    crossOrigin: 'anonymous',
    attribution: 'Bild © Esri, Maxar · Daten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' + ATTR_ROUTE
  }),
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    maxNativeZoom: 18,
    crossOrigin: 'anonymous'
  })
]);
let baseSat = false;
try {
  baseSat = localStorage.getItem('gp.ui.base') === 'sat';
} catch (e) {}
const activeTiles = () => (baseSat ? satLayer.getLayers()[0] : tileLayer);
function setBase(sat) {
  baseSat = sat;
  map.removeLayer(sat ? tileLayer : satLayer);
  (sat ? satLayer : tileLayer).addTo(map);
  try {
    localStorage.setItem('gp.ui.base', sat ? 'sat' : 'osm');
  } catch (e) {}
  const b = document.querySelector('.basebtn');
  if (b) {
    b.textContent = sat ? '🗺' : '🛰';
    b.title = b.ariaLabel = sat ? 'Straßenkarte' : 'Satellitenansicht';
  }
}
const BaseCtl = L.Control.extend({
  options: { position: 'bottomright' },
  onAdd() {
    const d = L.DomUtil.create('div', 'leaflet-bar'),
      b = L.DomUtil.create('a', 'basebtn', d);
    b.href = '#';
    b.role = 'button';
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.on(b, 'click', e => {
      L.DomEvent.preventDefault(e);
      setBase(!baseSat);
    });
    return d;
  }
});
new BaseCtl().addTo(map);
setBase(baseSat);
const lyr = {
  route: L.layerGroup().addTo(map),
  corridor: L.layerGroup().addTo(map),
  area: L.layerGroup().addTo(map),
  cands: L.layerGroup().addTo(map),
  pins: L.layerGroup().addTo(map),
  hits: L.layerGroup().addTo(map)
};

function pinIcon(text, cls) {
  return L.divIcon({
    className: '',
    html: `<div class="pin ${cls || ''}"><span>${esc(text)}</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 30],
    popupAnchor: [0, -28]
  });
}
// park4night: Kartenansicht an der Koordinate (Zoom 12, damit auch Plätze in der Umgebung erscheinen)
const p4nUrl = c => `https://park4night.com/de/search?lat=${c.lat.toFixed(5)}&lng=${c.lon.toFixed(5)}&z=12`;
function campInfo(c, mode) {
  return `<div class="ci" data-cp="${esc(String(c.id))}"><b data-cn="${esc(String(c.id))}">${nameHtml(c)}</b>${settings.gkey ? `<span class="gname-slot" data-gn="${esc(String(c.id))}" hidden></span>` : ''}${mode === 'cand' || mode === 'split' ? prevBadge(c) : ''}
    <div data-pr="${esc(String(c.id))}">${priceHtml(c, true, true)}</div>
    ${mode === 'alt' && c.air != null ? `<div>${fkm1(c.air)} vom bisherigen Platz (Luftlinie)</div>` : ''}
    ${c.detour ? `<div>${fkm1(c.detour.d)} / ${fdur(c.detour.t)} von der Route bis zum Platz</div>` : ''}
    ${c.stageKm != null && mode === 'cand' ? `<div>Liegt bei Etappen-km ${fkm(c.stageKm)}</div>` : ''}
    ${c.afterPlan && mode === 'cand' ? `<div>${afterText(c)}</div>` : ''}
    ${mode === 'end' && c.air != null ? `<div>${fkm1(c.air)} vom Zielort (Luftlinie)</div>` : ''}
    ${mode === 'area' ? (state.pending ? '<div class="muted">außerhalb des Suchkorridors</div>' : '') : ''}
    ${pdHtml(c, mode)}
    <div class="links" data-lk="${esc(String(c.id))}">${campLinks(c)}</div>
    ${mode === 'alt' && state.alt && !state.busy ? `<button class="btn primary" type="button" data-altpick="${esc(c.id)}">Als Ausweichplatz übernehmen</button>` : ''}
    ${(mode === 'cand' || mode === 'area') && state.pending && !state.busy ? `<button class="btn primary" type="button" data-pick="${esc(c.id)}">Als Etappenziel wählen</button>` : ''}
    ${(mode === 'split' || mode === 'area') && state.split && !state.pending && !state.busy ? `<button class="btn primary" type="button" data-splitpick="${esc(c.id)}">Als Zwischenstopp in Etappe ${state.split.i + 1} einfügen</button>` : ''}
    ${mode === 'split' && c.stageKm != null ? `<div>${fkm(c.stageKm)} ab ${esc(shortLabel(state.stages[state.split.i]?.from.label || ''))}, danach noch ${fkm(c.after)}</div>` : ''}
    ${mode === 'end' && state.done && !state.busy ? `<button class="btn primary" type="button" data-endpick="${esc(c.id)}">Als Ziel wählen</button>` : ''}
    ${mode === 'area' && !state.pending && !state.split && !state.busy && targetStage(c) >= 0 ? `<button class="btn primary" type="button" data-stagepick="${esc(c.id)}" data-stage="${targetStage(c)}">Als Ziel von Etappe ${targetStage(c) + 1} übernehmen</button>` : ''}
  </div>`;
}
// Etappe, deren Ziel ein Platz aus der Karte ersetzen soll: offene Ausweichplatz-Suche, sonst das nächstgelegene Ziel
function targetStage(c) {
  if (!state.stages.length) return -1;
  if (state.alt) return state.alt.i;
  let best = -1,
    bd = Infinity;
  state.stages.forEach((s, i) => {
    const d = hav([s.to.lat, s.to.lon], [c.lat, c.lon]);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}
// Info-Fenster: echte Straßenentfernung zum geplanten Ziel (wird beim Öffnen berechnet, ORS-Matrix mit Zwischenspeicher)
const pdMem = new Map();
const pdHtml = (c, mode) =>
  `<div class="pdist" data-pd="${esc(String(c.id))}" data-pdm="${mode || ''}"><span class="muted">Entfernungen werden berechnet …</span></div>`;
// Sehenswürdigkeiten der Tour (★-Ziele und ihre weiteren Sehenswürdigkeiten) in der Nähe eines Platzes (≤ 60 km Luftlinie, max. 3)
function nearSights(c) {
  return state.via
    .filter(v => v.kind === 'stay')
    .flatMap(v => [v, ...(v.sights || [])])
    .map(x => ({ x, d: hav([x.lat, x.lon], [c.lat, c.lon]) }))
    .filter(o => o.d <= 60000)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map(o => o.x);
}
const sightLine = (x, r) => `★ ${esc(shortLabel(x.label))}: <b>${fkm1(r.d)}</b> / ${fdur(r.t)}`;
async function sightLines(c) {
  const S = nearSights(c);
  if (!S.length) return '';
  const r = await roadPairs(S, c);
  return S.map((x, i) => (r[i] && r[i].d != null ? sightLine(x, r[i]) : ''))
    .filter(Boolean)
    .join('<br>');
}
const capT = (d, t) => Math.max(t || 0, d / (Math.max(80, +settings.speed || 80) / 3.6)); // Fahrzeit mit Wohnwagen
async function roadPairs(froms, to) {
  const j = await matrix({
    locations: [...froms.map(x => [+(+x.lon).toFixed(5), +(+x.lat).toFixed(5)]), [+(+to.lon).toFixed(5), +(+to.lat).toFixed(5)]],
    sources: froms.map((_, i) => i),
    destinations: [froms.length],
    metrics: ['distance', 'duration']
  });
  return froms.map((_, i) => ({ d: j.distances?.[i]?.[0], t: j.durations?.[i]?.[0] }));
}
async function popDist(c, mode) {
  const p = state.pending,
    sp = state.split;
  // gewählter Platz: Entfernungen zu seinen Sehenswürdigkeiten sind schon bekannt
  if (mode === 'chosen') {
    const st = state.stages.find(s => s.to.id === c.id),
      to = st ? st.to : c;
    if (to.sights && to.sights.length)
      return to.sights
        .map(x => (x.d != null ? sightLine(x, x) : ''))
        .filter(Boolean)
        .join('<br>');
    return await sightLines(to);
  }
  if (p && p.mode === 'anchor') {
    const S = p.sights && p.sights.length ? p.sights : [p.sight];
    const r = c.sightD ? c.sightD.map(x => x && { d: x.d, t: x.t }) : await roadPairs(S, c);
    return S.map((x, i) => (r[i] && r[i].d != null ? `★ ${esc(shortLabel(x.label))}: <b>${fkm1(r[i].d)}</b> / ${fdur(r[i].t)}` : ''))
      .filter(Boolean)
      .join('<br>');
  }
  if (p) {
    const [r] = await roadPairs([p.from], c);
    if (r.d == null) return '';
    const left = p.plan ? p.plan.n - 1 : 0,
      rest = Math.max(0, p.remain - r.d);
    const sl = await sightLines(c);
    return `${sl ? sl + '<br>' : ''}Etappe bis hier: <b>${fkm(r.d)}</b> / ≈ ${fdur(capT(r.d, r.t))} (Straße, ab ${esc(shortLabel(p.from.label))})${left > 0 ? `<br><span class="muted">danach noch ≈ ${fkm(rest)}${left > 1 ? ` (${left} Etappen à ~${fkm(rest / left)})` : ''}</span>` : ''}`;
  }
  if (sp) {
    const st = state.stages[sp.i];
    if (!st) return '';
    const [a] = await roadPairs([st.from], c),
      [b] = await roadPairs([c], st.to);
    if (a.d == null || b.d == null) return '';
    const sl = await sightLines(c);
    return `${sl ? sl + '<br>' : ''}Teilt Etappe ${sp.i + 1}: <b>${fkm(a.d)} + ${fkm(b.d)}</b> (Straße; bisher ${fkm(st.dist)})`;
  }
  const sl = await sightLines(c);
  const i = targetStage(c);
  if (i < 0) return sl;
  const t = state.stages[i].to,
    [r] = await roadPairs([t], c);
  return (
    (sl ? sl + '<br>' : '') +
    (r.d != null ? `<span class="muted">${fkm1(r.d)} / ${fdur(r.t)} von ${esc(shortLabel(t.label))} (Ziel Etappe ${i + 1})</span>` : '')
  );
}
async function fillPopDist(el, c, mode) {
  const key = [
    c.id,
    mode || '',
    state.pending ? (state.pending.mode || 't') + ':' + ptKey(state.pending.from) : '',
    state.split ? 's' + state.split.i : '',
    state.stages.length
  ].join('|');
  try {
    let h = pdMem.get(key);
    if (h == null) {
      h = await popDist(c, mode);
      pdMem.set(key, h);
    }
    el.innerHTML = h || '';
  } catch (e) {
    const ref = state.pending ? state.pending.sight || state.pending.from : null;
    el.innerHTML = ref
      ? `<span class="muted">${fkm1(hav([ref.lat, ref.lon], [c.lat, c.lon]))} Luftlinie zu ${esc(shortLabel(ref.label))} (Straße gerade nicht abrufbar)</span>`
      : '';
  }
}
function nearStopHtml(c) {
  const i = targetStage(c);
  if (i < 0) return '';
  const t = state.stages[i].to;
  return `<div class="muted">${fkm1(hav([t.lat, t.lon], [c.lat, c.lon]))} von ${esc(shortLabel(t.label))} (Ziel Etappe ${i + 1}, Luftlinie)</div>`;
}
function afterText(c) {
  const a = c.afterPlan;
  return a.n === 1 ? `danach noch ${fkm(a.len)} bis zum Ziel` : `danach noch ${a.n} Etappen à ~${fkm(a.len)}`;
}
map.on('popupclose', e => {
  lastClosed = { src: e.popup._source, t: Date.now() };
});
// Info-Fenster neu ausrichten, ohne den Inhalt neu zu zeichnen (popup.update() würde bei Funktions-Inhalten das
// HTML neu erzeugen – Knöpfe und nachgeladene Entfernungen gingen verloren)
function relayoutPopup(p) {
  if (p && p._map) {
    p._updateLayout();
    p._updatePosition();
  }
}
map.on('popupopen', e => {
  const root = e.popup.getElement();
  const cp = root.querySelector('[data-cp]');
  if (cp && settings.gkey) {
    const id = cp.dataset.cp,
      c = state.stages.map(s => s.to).find(t => String(t.id) === id) || campIndex.get(id);
    if (c && !gRate.has(c.id))
      gFetch(c)
        .then(g => {
          gRate.set(c.id, g);
          if (!e.popup.isOpen()) return;
          root.querySelectorAll('[data-cn]').forEach(b => (b.innerHTML = nameHtml(c)));
          root.querySelectorAll('[data-pr]').forEach(b => (b.innerHTML = priceHtml(c, true, true)));
          root.querySelectorAll('[data-lk]').forEach(b => (b.innerHTML = campLinks(c)));
          relayoutPopup(e.popup);
        })
        .catch(() => {});
  }
  const sp = root.querySelector('[data-sp]');
  if (sp) {
    const k = sp.dataset.sp,
      x = [...state.via, ...state.via.flatMap(v => v.sights || [])].find(v => sightKey(v) === k);
    if (x)
      Promise.all([enrichSight(x), loadGSight(x)]).then(r => {
        if (r.some(Boolean) && e.popup.isOpen()) e.popup.setContent(() => sightPopHtml(x));
      });
  }
  root.querySelectorAll('[data-gn]').forEach(el => {
    const c = campIndex.get(el.dataset.gn) || state.stages.map(s => s.to).find(t => String(t.id) === el.dataset.gn);
    if (c)
      loadGName(c).then(() => {
        root.querySelectorAll(`[data-cn="${CSS.escape(el.dataset.gn)}"]`).forEach(b => (b.innerHTML = nameHtml(c)));
        relayoutPopup(e.popup);
      });
  });
  root.querySelectorAll('[data-pd]').forEach(el => {
    const m = el.dataset.pdm;
    const c = (m === 'chosen' && state.stages.map(s => s.to).find(t => String(t.id) === el.dataset.pd)) || campIndex.get(el.dataset.pd);
    if (c) fillPopDist(el, c, m).then(() => relayoutPopup(e.popup));
  });
});
// Knöpfe im Info-Fenster: ein Klick-Abfänger für alle (Capture-Phase, weil Leaflet Klicks im Fenster nicht weiterreicht)
$('#map').addEventListener(
  'click',
  ev => {
    const b = ev.target.closest(
      '.leaflet-popup [data-pick], .leaflet-popup [data-altpick], .leaflet-popup [data-stagepick], .leaflet-popup [data-splitpick], .leaflet-popup [data-endpick]'
    );
    if (!b) return;
    ev.preventDefault();
    ev.stopPropagation();
    const d = b.dataset;
    map.closePopup();
    if (d.pick != null) {
      const c = campIndex.get(d.pick);
      if (c) run(() => selectCamp(c));
    } else if (d.altpick != null) {
      const c = campIndex.get(d.altpick),
        i = state.alt?.i;
      if (c && i != null) run(() => replaceStop(i, c));
    } else if (d.stagepick != null) {
      const c = campIndex.get(d.stagepick),
        i = +d.stage;
      if (c && state.stages[i]) run(() => replaceStop(i, c));
    } else if (d.splitpick != null) {
      const c = campIndex.get(d.splitpick),
        i = state.split?.i;
      if (c && i != null) run(() => splitStage(i, c));
    } else if (d.endpick != null) {
      const c = campIndex.get(d.endpick);
      if (c) run(() => selectEnd(c));
    }
  },
  true
);

function renderMap() {
  lyr.route.clearLayers();
  lyr.corridor.clearLayers();
  lyr.cands.clearLayers();
  lyr.pins.clearLayers();
  drawArea();
  state.stages.forEach(s => L.polyline(s.line, { color: COL.brand, weight: 5, opacity: 0.9 }).addTo(lyr.route));
  if (askingN()) L.polyline(state.overview.line, { color: COL.brand, weight: 5, opacity: 0.8 }).addTo(lyr.route);
  const p = state.pending;
  if (p) {
    L.polyline(p.line, { color: COL.pending, weight: 4, opacity: 0.7, dashArray: '8 8' }).addTo(lyr.route);
    const end = Math.min(p.cmax * 1000, p.remain);
    if (end > p.cmin * 1000)
      L.polyline(slice(p.line, p.cum, p.cmin * 1000, end), { color: COL.corridor, weight: 10, opacity: 0.45, interactive: false }).addTo(lyr.corridor);
    p.cands.filter(passFilter).forEach(c => {
      c._m = L.circleMarker([c.lat, c.lon], { radius: 9, color: c.best ? COL.corridor : '#fff', weight: c.best ? 4 : 2, fillColor: COL.ok, fillOpacity: 1 })
        .bindPopup(() => campInfo(c, 'cand'))
        .addTo(lyr.cands);
    });
    if (p.plan) {
      L.circleMarker(pointAt(p.line, p.cum, p.plan.len), { radius: 6, color: '#fff', weight: 2, fillColor: COL.corridor, fillOpacity: 1 })
        .bindTooltip(`Ideal ~${fkm(p.plan.len)}`, { permanent: true, direction: 'top', offset: [0, -6] })
        .addTo(lyr.corridor);
    }
  }
  if (state.split && state.split.list) {
    const ss = state.stages[state.split.i];
    if (ss) {
      const cm = cumul(ss.line);
      L.polyline(slice(ss.line, cm, ss.dist * 0.25, ss.dist * 0.75), { color: COL.corridor, weight: 10, opacity: 0.45, interactive: false }).addTo(
        lyr.corridor
      );
      L.circleMarker(pointAt(ss.line, cm, ss.dist / 2), { radius: 6, color: '#fff', weight: 2, fillColor: COL.corridor, fillOpacity: 1 })
        .bindTooltip(`Hälfte ~${fkm(ss.dist / 2)}`, { permanent: true, direction: 'top', offset: [0, -6] })
        .addTo(lyr.corridor);
    }
    state.split.list.filter(passFilter).forEach(c => {
      c._m = L.circleMarker([c.lat, c.lon], { radius: 9, color: c.best ? COL.corridor : '#fff', weight: c.best ? 4 : 2, fillColor: COL.ok, fillOpacity: 1 })
        .bindPopup(() => campInfo(c, 'split'))
        .addTo(lyr.cands);
    });
  }
  if (state.alt && state.alt.list) {
    state.alt.list.filter(passFilter).forEach(c => {
      c._m = L.circleMarker([c.lat, c.lon], { radius: 8, color: COL.corridor, weight: 3, fillColor: COL.ok, fillOpacity: 1 })
        .bindPopup(() => campInfo(c, 'alt'))
        .addTo(lyr.cands);
    });
  }
  const last = state.stages[state.stages.length - 1];
  const endIsCamp = state.done && last && last.to.kind === 'camp';
  if (!endIsCamp || state.showEndList)
    state.endCands.filter(passFilter).forEach(c => {
      if (endIsCamp && last.to.id === c.id) return;
      c._m = L.circleMarker([c.lat, c.lon], { radius: 7, color: COL.ok, weight: 3, fillColor: '#fff', fillOpacity: 1 })
        .bindPopup(() => campInfo(c, 'end'))
        .addTo(lyr.cands);
    });
  state.via.forEach(v =>
    (v.sights || []).forEach(x =>
      L.marker([x.lat, x.lon], { icon: pinIcon('★', 'sight'), zIndexOffset: -120 })
        .bindPopup(() => sightPopHtml(x))
        .addTo(lyr.pins)
    )
  );
  state.via.forEach((v, i) =>
    L.marker([v.lat, v.lon], {
      icon: pinIcon(v.kind === 'visit' ? '•' : v.kind === 'rest' ? 'P' : '★', v.kind === 'visit' ? 'visit' : 'sight'),
      zIndexOffset: -100
    })
      .bindPopup(() => sightPopHtml(v))
      .addTo(lyr.pins)
  );
  if (state.pending && state.pending.mode === 'anchor') {
    const q = state.pending.sight;
    const circ = L.circle([q.lat, q.lon], {
      radius: state.pending.radius * 1000,
      color: COL.corridor,
      weight: 2,
      fillOpacity: 0.05,
      dashArray: '6 6',
      interactive: false
    }).addTo(lyr.corridor);
    if (!state.busy) radiusHandle(circ, state.pending);
  }
  if (state.start)
    L.marker([state.start.lat, state.start.lon], { icon: pinIcon('S') })
      .bindPopup(esc(state.start.label))
      .addTo(lyr.pins);
  if (state.end && !endIsCamp)
    L.marker([state.end.lat, state.end.lon], { icon: pinIcon('Z', 'end') })
      .bindPopup(esc(state.end.label))
      .addTo(lyr.pins);
  state.stages.forEach((s, i) => {
    if (s.to.kind !== 'camp') return;
    const fin = state.done && i === state.stages.length - 1;
    L.marker([s.to.lat, s.to.lon], { icon: fin ? pinIcon('Z', 'end') : pinIcon(String(i + 1)) })
      .bindPopup(() => campInfo(s.to, 'chosen'))
      .addTo(lyr.pins);
  });
}
// Griff am Kreisrand: Umkreis um die Sehenswürdigkeit durch Ziehen ändern, beim Loslassen wird neu gesucht
const edgeAt = (q, m) => L.latLng(q.lat, q.lon + m / (111320 * Math.cos(q.lat * RAD)));
function radiusHandle(circ, p) {
  const q = p.sight,
    kmAt = ll => Math.max(3, Math.min(100, Math.round(map.distance([q.lat, q.lon], ll) / 1000)));
  const h = L.marker(edgeAt(q, p.radius * 1000), {
    draggable: true,
    zIndexOffset: 1000,
    keyboard: false,
    title: 'Umkreis ändern: ziehen',
    icon: L.divIcon({ className: '', html: '<div class="rhandle">↔</div>', iconSize: [30, 30], iconAnchor: [15, 15] })
  })
    .bindTooltip(`${p.radius} km`, { permanent: true, direction: 'right', offset: [16, 0], className: 'rtip' })
    .addTo(lyr.corridor);
  h.on('drag', () => {
    const km = kmAt(h.getLatLng());
    circ.setRadius(km * 1000);
    h.setTooltipContent(`${km} km – loslassen = suchen`);
  });
  h.on('dragend', () => {
    const km = kmAt(h.getLatLng());
    if (km === p.radius || state.pending !== p || state.busy) {
      h.setLatLng(edgeAt(q, p.radius * 1000));
      circ.setRadius(p.radius * 1000);
      h.setTooltipContent(`${p.radius} km`);
      return;
    }
    run(() => loadAnchorCands(p.from, p.seg, p.visits, { line: p.line, dist: p.remain, dur: p.remainDur }, km));
  });
  return h;
}
// Karte folgt der Liste: Platz unter der Maus hervorheben, liegt er außerhalb des Kartenbilds, dorthin schieben
let hlTimer = 0,
  hlCamp = null;
function hlCampOn(c, on) {
  if (!c || !c._m || !c._m.setStyle) return;
  const m = c._m;
  if (on) {
    hlCamp = c;
    if (!m._o0) m._o0 = { r: m.getRadius(), color: m.options.color, weight: m.options.weight };
    m.setRadius(m._o0.r + 5);
    m.setStyle({ color: '#3b6fb6', weight: 5 });
    m.bringToFront();
  } else if (m._o0) {
    m.setRadius(m._o0.r);
    m.setStyle({ color: m._o0.color, weight: m._o0.weight });
    delete m._o0;
    if (hlCamp === c) hlCamp = null;
  }
}
function followCamp(c) {
  if (!c) return;
  const ll = L.latLng(c.lat, c.lon),
    pad = sheetPad();
  if (!map.getBounds().pad(-0.05).contains(ll)) map.panInside(ll, { paddingTopLeft: pad.paddingTopLeft, paddingBottomRight: pad.paddingBottomRight });
}
function sightPopHtml(v) {
  const s = sightSrc(v) || v;
  return `<div class="ci" data-sp="${esc(sightKey(s))}"><b>${esc(shortLabel(s.label))}</b>${sightFacts(s, true)}<div class="links">${sightLinks(s)}</div></div>`;
}
function sheetPad() {
  const mobile = window.innerWidth < 900,
    hidden = $('#panel').classList.contains('hide');
  return { paddingTopLeft: [mobile ? 70 : 30, 30], paddingBottomRight: [30, mobile && !hidden ? $('#panel').offsetHeight + 20 : 30] };
}
function fitCorridor() {
  const p = state.pending;
  if (!p) return;
  const end = Math.min(p.cmax * 1000, p.remain);
  const pts = slice(p.line, p.cum, Math.max(0, p.cmin * 1000), end).concat(p.cands.map(c => [c.lat, c.lon]));
  if (pts.length) map.fitBounds(L.latLngBounds(pts), sheetPad());
}
function fitAll() {
  const pts = askingN() ? state.overview.line : state.stages.flatMap(s => s.line);
  if (pts.length) map.fitBounds(L.latLngBounds(pts), sheetPad());
}

/* Q20: alle Campingplätze im Ausschnitt beim Reinzoomen */
let areaKey = '',
  areaCtl = null,
  areaCamps = [];
// Zoom-Plätze zeichnen – ohne Plätze, die schon als Vorschlag, Ausweichplatz, Platz am Ziel oder Etappenziel
// auf der Karte sind (sonst läge der einfache Marker über dem mit dem vollständigen Popup)
function drawArea() {
  lyr.area.clearLayers();
  if (map.getZoom() < AREA_ZOOM) return;
  const shown = new Set(
    [...(state.pending?.cands || []), ...(state.alt?.list || []), ...(state.split?.list || []), ...state.endCands, ...state.stages.map(s => s.to)].map(
      c => c.id
    )
  );
  areaCamps.forEach(c => {
    if (shown.has(c.id)) return;
    if (!campIndex.has(c.id)) campIndex.set(c.id, c);
    const cc = campIndex.get(c.id);
    L.circleMarker([c.lat, c.lon], { radius: 6, color: COL.ok, weight: 2, fillColor: '#fff', fillOpacity: 0.95 })
      .bindPopup(() => campInfo(cc, 'area'))
      .addTo(lyr.area);
  });
}
const loadArea = debounce(async () => {
  if (map.getZoom() < AREA_ZOOM) {
    lyr.area.clearLayers();
    areaKey = '';
    areaCtl?.abort();
    return;
  }
  // Während einer Etappensuche nicht zusätzlich abfragen (Overpass erlaubt nur wenige gleichzeitige Abfragen)
  if (state.busy) {
    areaKey = '';
    return;
  }
  const b = map.getBounds().pad(0.1);
  const box = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
  const k = box.map(v => v.toFixed(2)).join(',');
  if (k === areaKey) return;
  areaKey = k;
  areaCtl?.abort(); // ältere Zoom-Abfrage abbrechen
  const ctl = (areaCtl = new AbortController());
  try {
    const camps = await campsInBox(box, { signal: ctl.signal, passes: 1 });
    if (k !== areaKey) return;
    areaCamps = camps;
    drawArea();
  } catch (e) {
    if (e.name !== 'AbortError') console.warn(e);
    if (k === areaKey) areaKey = '';
  }
}, 700);
map.on('moveend', loadArea);
