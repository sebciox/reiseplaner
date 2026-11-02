/* Reiseplaner – eine Fahrt (Etappe) von Hand anpassen, ohne etwas anderes neu zu planen.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen.

   Sebastian (Nov. 2026): Der Routendienst nimmt immer den schnellsten Landweg – in Wirklichkeit fuhr er mit der Fähre.
   Drei Wege:
   1. „Fahrt anpassen“ (Reiseplan, Spalte „Weiter“): ⛴ Fähre auf dieser Fahrt (Häfen: Vorschläge aus OSM-Fährterminals am
      Anfang und Ende der Fahrt oder Suche, Dauer) und Zwischenpunkte „über …“ (Route muss dort durch).
   2. km und Zeit von Hand (Feld „drv“ in der Spalte „Weiter“, eigener Wert gewinnt).
   3. Karte: Linie einer Fahrt antippen → „Zwischenpunkt hier“, Zwischenpunkte lassen sich ziehen (Route folgt).
   Fähren und Zwischenpunkte sind normale Zwischenziele (state.via, kind 'ferry' bzw. 'pass') – so bleiben sie bei
   „Strecke berechnen“ erhalten (Plätze werden übernommen, siehe segKey loose). Neu berechnet wird nur diese Fahrt. */
let legJ = null, // Fahrt (Etappen-Index), die gerade im Dialog angepasst wird
  legFerry = null, // {from, to, hours} – Auswahl im Dialog
  legPorts = { a: null, b: null }; // vorgeschlagene Fährterminals am Anfang (a) und Ende (b) der Fahrt

// Wegpunkte einer Fahrt in Reihenfolge entlang der bisherigen Linie
function legOrder(s, list) {
  if (!s.line || s.line.length < 2) return list;
  const cum = cumul(s.line);
  return list
    .map(v => ({ v, d: posOnLine(s.line, cum, v) }))
    .sort((a, b) => a.d - b.d)
    .map(o => o.v);
}
// Besuche/Fähren/Zwischenpunkte der Abschnitte aus state.via neu zuordnen (nach dem Einfügen/Entfernen)
function syncSegVisits() {
  if (!state.segs) return;
  let k = 0,
    pend = [];
  for (const v of state.via) {
    if (v.kind === 'visit' || v.kind === 'ferry' || v.kind === 'pass') {
      pend.push(v);
      continue;
    }
    if (state.segs[k]) state.segs[k].visits = pend;
    pend = [];
    k++;
  }
  if (state.segs[k]) state.segs[k].visits = pend;
}
// Stelle in state.via, an der die Wegpunkte von Etappe j stehen müssen: vor dem ersten Wegpunkt einer späteren Etappe
// desselben Abschnitts, sonst vor dem Ziel des Abschnitts (bzw. am Ende)
function legInsertAt(j) {
  const s = state.stages[j];
  for (let i = j + 1; i < state.stages.length && state.stages[i].seg === s.seg; i++) {
    const u = (state.stages[i].vias || [])[0];
    const at = u ? state.via.findIndex(v => v.uid === u) : -1;
    if (at >= 0) return at;
  }
  const g = state.segs && state.segs[s.seg],
    at = g && g.to && g.to.uid ? state.via.findIndex(v => v.uid === g.to.uid) : -1;
  return at >= 0 ? at : state.via.length;
}
// Wegpunkte von Etappe j setzen (Liste von via-Objekten) und nur diese Fahrt neu berechnen
async function setLegVias(j, list) {
  const s = state.stages[j];
  if (!s) return;
  const old = new Set(s.vias || []);
  state.via = state.via.filter(v => !old.has(v.uid));
  const ordered = legOrder(s, list);
  state.via.splice(legInsertAt(j), 0, ...ordered);
  s.vias = ordered.map(v => v.uid);
  syncSegVisits();
  setStatus(`Fahrt nach ${shortLabel(s.to.label)} wird neu berechnet …`, 'busy');
  try {
    const r = await route(s.from, s.to, visitsOf(s));
    Object.assign(s, { line: r.line, dist: r.dist, dur: r.dur, ex: r.ex, countries: undefined });
    setStatus('');
    flash(
      `Fahrt nach „${shortLabel(stayTown(j) || s.to.label)}“ neu berechnet: ${fkm(s.dist)} · ${fdur(s.dur)}${r.ex?.ferryH ? ` + Fähre ≈ ${fhours(r.ex.ferryH)}` : ''}`
    );
  } catch (e) {
    setStatus('Fahrt konnte nicht berechnet werden: ' + e.message, 'error');
  }
  touch();
  renderVia();
  renderAll();
}

/* ---------- Dialog „Fahrt anpassen“ ---------- */
async function ferryTerminals(p) {
  const q = `[out:json][timeout:25];nwr["amenity"="ferry_terminal"]["name"](around:60000,${(+p.lat).toFixed(4)},${(+p.lon).toFixed(4)});out center tags 40;`;
  const els = await overpass(q, { passes: 1 });
  const seen = new Set();
  return (els || [])
    .map(e => ({ label: e.tags.name, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon }))
    .filter(x => x.lat != null && !seen.has(x.label) && seen.add(x.label))
    .map(x => ({ ...x, d: hav([p.lat, p.lon], [x.lat, x.lon]) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
}
function openLeg(j) {
  const s = state.stages[j];
  if (!s) return;
  legJ = j;
  const f = ferryViaOf(s);
  legFerry = f ? { from: { label: f.label, lat: f.lat, lon: f.lon }, to: f.to, hours: +f.hours || 4, uid: f.uid } : null;
  legPorts = { a: null, b: null };
  renderLeg();
  $('#legDlg').showModal();
  if (!f)
    ['a', 'b'].forEach(k =>
      Promise.race([ferryTerminals(k === 'a' ? s.from : s.to), new Promise((_, no) => setTimeout(() => no(new Error('Zeit')), 15000))])
        .then(r => {
          legPorts[k] = r;
          if (legJ === j) renderLeg();
        })
        .catch(() => {
          legPorts[k] = [];
          if (legJ === j) renderLeg();
        })
    );
}
const legPasses = s => visitsOf(s).filter(v => v.kind === 'pass');
// Eingetippte (noch nicht bestätigte) Werte überleben ein Neuzeichnen des Dialogs (z. B. wenn die Hafen-Vorschläge kommen)
function legDraft() {
  const v = q => document.querySelector('#legDlg ' + q)?.value;
  return { a: v('[data-legsearch="a"]'), b: v('[data-legsearch="b"]'), pass: v('#legPassIn'), hours: v('#legHours') };
}
function legMsg(t) {
  const el = $('#legErr');
  if (!el) return;
  el.textContent = t || '';
  el.hidden = !t;
}
function renderLeg() {
  const s = state.stages[legJ];
  if (!s) return;
  const dr = legDraft();
  $('#legTitle').textContent = `Fahrt anpassen: ${shortLabel(s.from.label)} → ${shortLabel(stayTown(legJ) || s.to.label)}`;
  const port = (k, sel) => {
    const list = legPorts[k];
    const chips =
      list == null
        ? '<span class="muted">Fährhäfen in der Nähe werden gesucht …</span>'
        : list.length
          ? list
              .map(
                (x, i) =>
                  `<button type="button" class="chip${sel && sel.label === x.label ? ' on' : ''}" data-legport="${k}:${i}">${esc(x.label)} <span class="muted">${fkm(x.d)}</span></button>`
              )
              .join('')
          : '<span class="muted">kein Fährterminal in OSM in der Nähe – bitte suchen</span>';
    return `<div class="legport"><div class="chips">${chips}</div><input data-legsearch="${k}" placeholder="${k === 'a' ? 'Abfahrtshafen' : 'Ankunftshafen'} suchen – Enter" value="${sel ? esc(cleanLabel(sel.label)) : ''}" aria-label="${k === 'a' ? 'Abfahrtshafen' : 'Ankunftshafen'}"></div>`;
  };
  const F = legFerry || {};
  const fer = `<div class="legsec"><h3>⛴ Fähre auf dieser Fahrt</h3>
    ${
      legFerry
        ? `<div class="leglab">ab</div>${port('a', F.from)}<div class="leglab">nach</div>${port('b', F.to)}
        <label class="leghrs"><input type="number" min="0.5" max="36" step="0.5" id="legHours" value="${F.hours || 4}"> h Überfahrt</label>
        ${legFerry && legFerry.uid ? '<button type="button" class="linkbtn" id="legFerryDel">Fähre entfernen (wieder Landweg)</button>' : ''}`
        : `<button type="button" class="btn small" id="legFerryOn">Fähre eintragen</button>`
    }</div>`;
  const ps = legPasses(s);
  const pas = `<div class="legsec"><h3>Route führt über …</h3>
    ${ps.length ? `<ul class="legpass">${ps.map(v => `<li>${esc(shortLabel(v.label))}<button type="button" data-legpdel="${esc(v.uid)}" aria-label="entfernen">✕</button></li>`).join('')}</ul>` : ''}
    <input id="legPassIn" placeholder="Ort, durch den die Route führen soll – Enter" aria-label="Zwischenpunkt hinzufügen">
    <div class="muted small">Oder auf der Karte: Linie der Fahrt antippen → „Zwischenpunkt hier“, den Punkt dann an die richtige Stelle ziehen.</div></div>`;
  $('#legBody').innerHTML = '<div class="legerr" id="legErr" role="alert" hidden></div>' + fer + pas;
  // eigene Eingaben wiederherstellen (gewählter Hafen gewinnt)
  const put = (q, v) => {
    const el = document.querySelector('#legDlg ' + q);
    if (el && v != null && v !== '' && !el.value) el.value = v;
  };
  if (!(legFerry && legFerry.from)) put('[data-legsearch="a"]', dr.a);
  if (!(legFerry && legFerry.to)) put('[data-legsearch="b"]', dr.b);
  put('#legPassIn', dr.pass);
  if (dr.hours && legFerry && legFerry.hoursSet) $('#legHours').value = dr.hours;
}
// eingetippten Hafen (ohne Enter) über die Suche auflösen
async function legResolvePort(k) {
  const t = document.querySelector(`#legDlg [data-legsearch="${k}"]`)?.value.trim(),
    key = k === 'a' ? 'from' : 'to',
    sel = legFerry && legFerry[key];
  if (!t || (sel && cleanLabel(sel.label) === t)) return;
  const r = await placeSearch(t, false);
  if (!r.length)
    throw new Error(`${k === 'a' ? 'Abfahrtshafen' : 'Ankunftshafen'} „${t}“ nicht gefunden – bitte anders schreiben oder einen Vorschlag antippen.`);
  legFerry[key] = { label: r[0].label, lat: +r[0].lat, lon: +r[0].lon };
}
function legPortPick(k, x) {
  legFerry = legFerry || { hours: 4 };
  legFerry[k === 'a' ? 'from' : 'to'] = { label: x.label, lat: +x.lat, lon: +x.lon };
  // Dauer grob vorbelegen (≈ 25 km/h + 1 h Ein-/Ausschiffen), solange nicht selbst geändert
  if (legFerry.from && legFerry.to && !legFerry.hoursSet) {
    const km = hav([legFerry.from.lat, legFerry.from.lon], [legFerry.to.lat, legFerry.to.lon]) / 1000;
    legFerry.hours = Math.max(0.5, Math.round((km / 25 + 1) * 2) / 2);
  }
  renderLeg();
}
async function applyLeg() {
  const j = legJ,
    s = state.stages[j];
  if (!s) return;
  const h = +$('#legHours')?.value;
  if (legFerry && h) legFerry.hours = Math.max(0.5, Math.min(36, h));
  const btn = $('#legApply');
  btn.disabled = true;
  let passT;
  try {
    // eingetippte, aber nicht mit Enter bestätigte Häfen bzw. Zwischenpunkte mitnehmen
    const typed = k => document.querySelector(`#legDlg [data-legsearch="${k}"]`)?.value.trim();
    if (legFerry && !legFerry.from && !legFerry.to && !typed('a') && !typed('b')) legFerry = null; // Fähre geöffnet, aber leer gelassen
    if (legFerry) {
      legMsg('Häfen werden gesucht …');
      await legResolvePort('a');
      await legResolvePort('b');
      if (!legFerry.from || !legFerry.to)
        throw new Error('Für die Fähre bitte Abfahrts- und Ankunftshafen eintragen (Vorschlag antippen oder Namen eingeben).');
    }
    passT = $('#legPassIn')?.value.trim() || '';
  } catch (err) {
    legMsg(err.message);
    btn.disabled = false;
    return;
  }
  btn.disabled = false;
  legMsg('');
  let list = visitsOf(s).filter(v => v.kind !== 'ferry');
  if (passT) {
    try {
      const r = await placeSearch(passT, false);
      if (!r.length) throw new Error(`„${passT}“ nicht gefunden`);
      list.push({ uid: 'v' + ++viaSeq, label: r[0].label, lat: r[0].lat, lon: r[0].lon, kind: 'pass', pin: true });
    } catch (err) {
      legMsg(err.message);
      return;
    }
  }
  if (legFerry && legFerry.from && legFerry.to) {
    const old = legFerry.uid && viaByUid(legFerry.uid);
    list.push({
      ...(old || {}),
      uid: legFerry.uid || 'v' + ++viaSeq,
      label: legFerry.from.label,
      lat: legFerry.from.lat,
      lon: legFerry.from.lon,
      kind: 'ferry',
      pin: true,
      hours: legFerry.hours || 4,
      to: { label: legFerry.to.label, lat: legFerry.to.lat, lon: legFerry.to.lon }
    });
  }
  $('#legDlg').close();
  await setLegVias(j, list);
}
$('#legDlg').addEventListener('click', async e => {
  const t = e.target;
  if (t.closest('#legCancel')) return $('#legDlg').close();
  if (t.closest('#legApply')) return applyLeg();
  if (t.closest('#legFerryOn')) {
    legFerry = { hours: 4 };
    return renderLeg();
  }
  if (t.closest('#legFerryDel')) {
    legFerry = null;
    return applyLeg();
  }
  const pp = t.closest('[data-legport]');
  if (pp) {
    const [k, i] = pp.dataset.legport.split(':');
    return legPortPick(k, legPorts[k][+i]);
  }
  const pd = t.closest('[data-legpdel]');
  if (pd) {
    const s = state.stages[legJ];
    $('#legDlg').close();
    await setLegVias(
      legJ,
      visitsOf(s).filter(v => v.uid !== pd.dataset.legpdel)
    );
  }
});
$('#legDlg').addEventListener('change', e => {
  if (e.target.id === 'legHours' && legFerry) {
    legFerry.hours = +e.target.value || 4;
    legFerry.hoursSet = true;
  }
});
$('#legDlg').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const inp = e.target.closest('[data-legsearch], #legPassIn');
  if (!inp) return;
  e.preventDefault();
  const t = inp.value.trim();
  if (!t) return;
  try {
    const r = await placeSearch(t, false);
    if (!r.length) throw new Error('nicht gefunden: ' + t);
    const g = r[0];
    if (inp.id === 'legPassIn') {
      const s = state.stages[legJ];
      $('#legDlg').close();
      await setLegVias(legJ, [...visitsOf(s), { uid: 'v' + ++viaSeq, label: g.label, lat: g.lat, lon: g.lon, kind: 'pass', pin: true }]);
    } else legPortPick(inp.dataset.legsearch, g);
  } catch (err) {
    legMsg(err.message);
  }
});

/* ---------- Karte: Linie antippen → Zwischenpunkt; Zwischenpunkte ziehen ---------- */
// welche Etappe liegt am nächsten an einem Kartenpunkt (Linie)?
function legAt(ll) {
  let best = -1,
    bd = Infinity;
  state.stages.forEach((s, j) => {
    (s.line || []).forEach(p => {
      const d = hav([ll.lat, ll.lng], p);
      if (d < bd) [bd, best] = [d, j];
    });
  });
  return best;
}
// unsichtbare breite Linie je Fahrt zum Antippen (nur wenn die Tour fertig geplant ist)
function drawLegHandles(layer) {
  if (!state.done || state.pending || state.alt || state.split) return;
  state.stages.forEach((s, j) => {
    if (!s.line || s.line.length < 2) return;
    L.polyline(
      s.line.map(p => [p[0], p[1]]),
      { weight: 18, opacity: 0, className: 'leghit' }
    )
      .on('click', e => {
        L.popup()
          .setLatLng(e.latlng)
          .setContent(
            `<b>Fahrt nach ${esc(shortLabel(stayTown(j) || s.to.label))}</b><br><span class="muted">${fkm(s.dist)} · ${fdur(s.dur)}</span>
            <div class="actions"><button class="btn small primary" type="button" data-legpt="${j}" data-lat="${e.latlng.lat}" data-lon="${e.latlng.lng}">Zwischenpunkt hier</button><button class="btn small" type="button" data-legopen="${j}">Fahrt anpassen …</button></div>`
          )
          .openOn(map);
      })
      .addTo(layer);
  });
  // vorhandene Zwischenpunkte: ziehbar, Popup mit „entfernen“
  state.via
    .filter(v => v.kind === 'pass')
    .forEach(v => {
      const j = state.stages.findIndex(s => (s.vias || []).includes(v.uid));
      L.marker([v.lat, v.lon], {
        icon: L.divIcon({ className: '', html: '<div class="passpt"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        draggable: true,
        zIndexOffset: 500
      })
        .bindPopup(
          `<b>Route über ${esc(shortLabel(v.label))}</b><br><span class="muted">Punkt ziehen, um die Route zu ändern</span><div class="actions"><button class="btn small" type="button" data-legpdel2="${esc(v.uid)}">Zwischenpunkt entfernen</button></div>`
        )
        .on('dragend', async e => {
          const ll = e.target.getLatLng();
          Object.assign(v, { lat: +ll.lat.toFixed(6), lon: +ll.lng.toFixed(6), label: 'Punkt ' + ll.lat.toFixed(3) + ', ' + ll.lng.toFixed(3) });
          if (j >= 0) await setLegVias(j, visitsOf(state.stages[j]));
          reverseAddr(v)
            .then(a => {
              if (a) {
                v.label = cleanLabel(a);
                touch();
              }
            })
            .catch(() => {});
        })
        .addTo(layer);
    });
}
$('#map').addEventListener(
  'click',
  async ev => {
    const b = ev.target.closest('.leaflet-popup [data-legpt], .leaflet-popup [data-legopen], .leaflet-popup [data-legpdel2]');
    if (!b) return;
    ev.preventDefault();
    ev.stopPropagation();
    map.closePopup();
    const d = b.dataset;
    if (d.legopen != null) return openLeg(+d.legopen);
    if (d.legpdel2 != null) {
      const j = state.stages.findIndex(s => (s.vias || []).includes(d.legpdel2));
      if (j >= 0)
        await setLegVias(
          j,
          visitsOf(state.stages[j]).filter(v => v.uid !== d.legpdel2)
        );
      return;
    }
    const j = +d.legpt,
      s = state.stages[j];
    if (!s) return;
    const v = {
      uid: 'v' + ++viaSeq,
      label: `Punkt ${(+d.lat).toFixed(3)}, ${(+d.lon).toFixed(3)}`,
      lat: +(+d.lat).toFixed(6),
      lon: +(+d.lon).toFixed(6),
      kind: 'pass',
      pin: true
    };
    await setLegVias(j, [...visitsOf(s), v]);
    reverseAddr(v)
      .then(a => {
        if (a) {
          v.label = cleanLabel(a);
          touch();
          renderVia();
        }
      })
      .catch(() => {});
  },
  true
);
