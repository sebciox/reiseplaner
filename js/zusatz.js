/* Reiseplaner – Reiseplan-Tabelle, Teil 2: Fähren, eigene Zeilen („+ Zeile“), eigene Unterkunft, Kostensumme, Offene Punkte.
   Fähre einer Etappe (ORS erkennt sie, `stage.ex.ferry`): Angaben in `stage.ferry` {name, dep, arr, price, status, nr, note},
   Zeile in der Gruppe des Aufenthalts, von dem aus man losfährt (Start-Gruppe für Etappe 1).
   Eigene Zeilen: `state.extras` [{id, kind:'ferry'|'cost'|'task', at: Gruppen-Schlüssel, ai: Index (Rückfall), …}]
   – Fähre/Kosten stehen in ihrer Gruppe, Aufgaben {text, done, due} nur in „Offene Punkte“.
   Eigene Unterkunft (z. B. Bauernhof): statt des Platzes (`replaceStop`) oder als zusätzlicher Stopp auf der Weiterfahrt
   (`splitStage`) – wird Etappenziel, die Route wird neu berechnet.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
const extraById = id => (state.extras || []).find(e => e.id === id);
const newId = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// Gruppen-Schlüssel: Start oder der Aufenthalt (Platz-id bzw. Name) – bleibt gültig, wenn Etappen davor eingefügt werden
const groupKey = i => (i < 0 ? 'start' : state.stages[i] ? String(state.stages[i].to.id || state.stages[i].to.label) : 'end');
function groupOfExtra(e) {
  if (e.at === 'start') return -1;
  const i = state.stages.findIndex(s => String(s.to.id || s.to.label) === e.at);
  if (i >= 0) return i;
  return Math.max(-1, Math.min(state.stages.length - 1, e.ai ?? state.stages.length - 1));
}
const extrasIn = (i, kind) => (state.extras || []).filter(e => e.kind === kind && groupOfExtra(e) === i);
const refPoint = i => (i >= 0 && state.stages[i] ? state.stages[i].to : state.start); // für „kr“ ohne Währungscode
const delBtn = id => (XP ? '' : `<button class="rs xdel" type="button" data-xdel="${esc(id)}" title="Zeile löschen" aria-label="Zeile löschen">✕</button>`);

/* ---------- Zeilen ---------- */
// Fähre auf der Fahrt der Etappe j (automatisch erkannt) bzw. eigene Fähr-Zeile e
function ferryRowHtml(j, ds, e) {
  const scope = e ? 'x' : 'f',
    id = e ? e.id : j,
    s = state.stages[j],
    f = e || s?.ferry || {},
    ref = e ? refPoint(groupOfExtra(e)) : s.to;
  const date = e
    ? XP
      ? xpDay(f.date)
      : `<input type="date" class="dayin" data-sel="${edKey('x', id, 'date')}" value="${esc(f.date || '')}" aria-label="Datum">`
    : ds
      ? fdate(ds[j])
      : '';
  const def = s ? `Fähre (Fahrt nach ${shortLabel(s.to.label)})` : 'Fähre';
  const name = `<span class="pname">⛴ ${ed(scope, id, 'name', esc(f.name || (e ? '' : def)), { ph: '+ Fähre, z. B. Travemünde – Malmö' })}</span>`;
  const zt = line(`Abfahrt ${ed(scope, id, 'dep', esc(f.dep || ''), { ph: '–' })}`) + line(`Ankunft ${ed(scope, id, 'arr', esc(f.arr || ''), { ph: '–' })}`);
  const pr = `<div>${ed(scope, id, 'price', f.price ? moneyHtml(f.price, ref) : '', { ph: 'Preis –' })}</div><div>${selHtml(scope, id, 'status', ST_CAMP, f.status || 'open', 'Status der Fähre')}</div>`;
  const nt = ed(scope, id, 'note', esc(f.note || ''), {}) + line(`Buchungsnr. ${ed(scope, id, 'nr', esc(f.nr || ''), { ph: '–' })}`);
  // Dauer der Überfahrt (z. B. „ca. 9 Std.“) – sonst die km auf der Fähre
  const km = !e && s.ex?.ferry ? `${fkm(s.ex.ferry)} auf der Fähre` : '';
  const wt =
    (f.dur
      ? `Überfahrt ${ed(scope, id, 'dur', esc(f.dur), {})}${km ? `<div class="muted">${km}</div>` : ''}`
      : `${km ? km + ' ' : ''}<div>${ed(scope, id, 'dur', '', {})}</div>`) + (e ? delBtn(id) : '');
  return `<tr class="ferry" data-row="${scope}${esc(id)}">${td('Datum', date)}${td('Name', name, 'nm')}${td('Adresse', '')}${td('Zeiten', zt)}${td('Preis / Status', pr)}${td('Notiz / Buchung', nt)}${td('Überfahrt', wt)}</tr>`;
}
function costRowHtml(e) {
  const ref = refPoint(groupOfExtra(e));
  return `<tr class="cost" data-row="x${esc(e.id)}">${td('Datum', XP ? xpDay(e.date) : `<input type="date" class="dayin" data-sel="${edKey('x', e.id, 'date')}" value="${esc(e.date || '')}" aria-label="Datum">`)}${td(
    'Name',
    `<span class="pname">€ ${ed('x', e.id, 'name', esc(e.name || ''), { ph: '+ Bezeichnung, z. B. Maut Öresundbrücke' })}</span>`,
    'nm'
  )}${td('Adresse', '')}${td('Zeiten', '')}${td(
    'Preis / Status',
    `<div>${ed('x', e.id, 'amount', e.amount ? moneyHtml(e.amount, ref) : '', { ph: 'Betrag –' })}</div><div>${selHtml('x', e.id, 'status', ST_CAMP, e.status || 'open', 'Status')}</div>`
  )}${td('Notiz / Buchung', ed('x', e.id, 'note', esc(e.note || ''), {}))}${td('Löschen', delBtn(e.id))}</tr>`;
}
let ownForm = null; // { i, hits } – Formular „Eigene Unterkunft“ in Gruppe i
function addRowHtml(i) {
  if (ownForm && ownForm.i === i) {
    const s = state.stages[i],
      canReplace = i >= 0 && s && s.to.kind === 'camp',
      canSplit = !!state.stages[i + 1];
    const hits = ownForm.hits
      ? `<ul class="sugg ownhits">${ownForm.hits.length ? ownForm.hits.map((x, k) => `<li><button type="button" data-ownhit="${k}">${x.camp ? '⛺ ' : ''}${esc(x.label)}</button></li>`).join('') : '<li class="muted">Nichts gefunden – Koordinaten oder Google-Maps-Link einfügen.</li>'}</ul>`
      : '';
    return `<tr class="addrow"><td colspan="7"><form class="ownstay" data-ownform="${i}">
      <b>Eigene Unterkunft</b> <span class="muted">– wird Etappenziel, die Route wird neu berechnet</span>
      <div class="ownf"><input name="n" placeholder="Name, z. B. Bauernhof Vellinge" aria-label="Name der Unterkunft" value="${esc(ownForm.n || '')}">
      <input name="q" placeholder="Adresse, Google-Maps-Link oder Koordinaten" aria-label="Adresse, Link oder Koordinaten" value="${esc(ownForm.q || '')}"></div>
      <div class="ownf">${canReplace ? `<label class="check"><input type="radio" name="m" value="replace" ${ownForm.m !== 'split' ? 'checked' : ''}><span>statt „${esc(shortLabel(s.to.label))}“</span></label>` : ''}
      ${canSplit ? `<label class="check"><input type="radio" name="m" value="split" ${ownForm.m === 'split' || !canReplace ? 'checked' : ''}><span>zusätzlicher Stopp auf der Fahrt nach ${esc(shortLabel(state.stages[i + 1].to.label))}</span></label>` : ''}</div>
      <div class="sbtns"><button class="btn small primary" type="submit">Übernehmen</button> <button class="btn small" type="button" data-owncancel>Abbrechen</button></div>
      ${hits}</form></td></tr>`;
  }
  return `<tr class="addrow"><td colspan="7"><span class="muted">+ Zeile:</span> <button class="linkbtn" type="button" data-xadd="ferry" data-at="${i}">Fähre</button> · <button class="linkbtn" type="button" data-xadd="cost" data-at="${i}">Kosten</button>${
    (i >= 0 && state.stages[i]?.to.kind === 'camp') || state.stages[i + 1]
      ? ` · <button class="linkbtn" type="button" data-xadd="stay" data-at="${i}">Eigene Unterkunft</button>`
      : ''
  }</td></tr>`;
}
// alles, was in einer Gruppe unter Platz/Sehenswürdigkeiten steht: Fähre der Weiterfahrt, eigene Fähren/Kosten, „+ Zeile“
function groupExtrasHtml(i, ds, open) {
  const nx = state.stages[i + 1];
  let h = '';
  if (nx && nx.ex && nx.ex.ferry > 500) h += ferryRowHtml(i + 1, ds);
  extrasIn(i, 'ferry').forEach(e => (h += ferryRowHtml(-1, ds, e)));
  extrasIn(i, 'cost').forEach(e => (h += costRowHtml(e)));
  if (open && !XP) h += addRowHtml(i);
  return h;
}

/* ---------- Kosten und offene Punkte ---------- */
function ferryMoney(f, ref) {
  const total = f && f.price ? eurOf(f.price, ref) : null,
    st = (f && f.status) || 'open';
  return { total, st, paid: st === 'paid' ? total : null, open: st === 'paid' ? 0 : total, approx: !!(f?.price && toEuro(splitTimes(f.price).s, ref)?.orig) };
}
function allSights() {
  const out = [];
  state.stages.forEach((s, i) => {
    (s.to.sights || []).forEach(x => out.push({ x, i, from: s.to }));
    visitsOf(s).forEach(v => out.push({ x: v, i: i - 1, from: null, visit: true }));
  });
  return out;
}
// Kostensumme und offene Punkte in einem Durchgang
function tripMoney() {
  const cat = { camp: 'Plätze', sight: 'Eintritte', ferry: 'Fähren', other: 'Sonstiges' };
  const sum = Object.fromEntries(Object.keys(cat).map(k => [k, { l: cat[k], total: 0, paid: 0, open: 0, unknown: 0 }]));
  const items = [],
    ds = stageDates();
  const add = (k, total, paid, open) => {
    const c = sum[k];
    if (total == null) c.unknown++;
    else {
      c.total += total;
      c.paid += paid || 0;
      c.open += open || 0;
    }
  };
  const when = i => (ds && ds[i] ? fdate(ds[i]) : '');
  state.stages.forEach((s, i) => {
    if (s.to.kind === 'camp') {
      const mo = campMoney(s),
        nm = campMy(s).name || nameText(s.to) || s.to.label;
      add('camp', mo.total, mo.paid, mo.open);
      if (mo.st === 'open') items.push({ kind: 'book', text: `Noch nicht gebucht: ${nm}`, eur: mo.total, approx: true, date: when(i), grp: i, row: 'c' + i });
      else if (mo.open)
        items.push({ kind: 'pay', text: `${stLabel(ST_CAMP, mo.st)}: ${nm}`, eur: mo.open, approx: mo.approxPaid, date: when(i), grp: i, row: 'c' + i });
    }
    if (s.ex && s.ex.ferry > 500) {
      const mo = ferryMoney(s.ferry, s.to),
        nm = s.ferry?.name || `Fähre (Fahrt nach ${shortLabel(s.to.label)})`;
      add('ferry', mo.total, mo.paid, mo.open);
      if (mo.st === 'open')
        items.push({ kind: 'book', text: `Noch nicht gebucht: ${nm}`, eur: mo.total, approx: mo.approx, date: when(i), grp: i - 1, row: 'f' + i });
      else if (mo.open)
        items.push({ kind: 'pay', text: `${stLabel(ST_CAMP, mo.st)}: ${nm}`, eur: mo.open, approx: mo.approx, date: when(i), grp: i - 1, row: 'f' + i });
    }
  });
  allSights().forEach(({ x, i }) => {
    const mo = sightMoney(x);
    if (mo.town || mo.st === 'free') return;
    add('sight', mo.total, mo.paid, mo.open);
    const nm = sightMy(x).name || shortLabel(x.label),
      day = sightMy(x).day ? fdate(new Date(sightMy(x).day + 'T12:00:00')) : '';
    const row = 's' + sightKey(sightSrc(x));
    if (mo.st === 'open' && mo.total) items.push({ kind: 'ticket', text: `Tickets fehlen: ${nm}`, eur: mo.total, approx: true, date: day, grp: i, row: row });
    else if (mo.st === 'onsite' && mo.total)
      items.push({ kind: 'pay', text: `Vor Ort zahlen: ${nm}`, eur: mo.total, approx: true, date: day, grp: i, row: row });
  });
  (state.extras || []).forEach(e => {
    const ref = refPoint(groupOfExtra(e)),
      d = e.date ? fdate(new Date(e.date + 'T12:00:00')) : '';
    if (e.kind === 'ferry') {
      const mo = ferryMoney(e, ref);
      add('ferry', mo.total, mo.paid, mo.open);
      if (mo.st === 'open')
        items.push({
          kind: 'book',
          text: `Noch nicht gebucht: ${e.name || 'Fähre'}`,
          eur: mo.total,
          approx: mo.approx,
          date: d,
          grp: groupOfExtra(e),
          row: 'x' + e.id
        });
      else if (mo.open)
        items.push({
          kind: 'pay',
          text: `${stLabel(ST_CAMP, mo.st)}: ${e.name || 'Fähre'}`,
          eur: mo.open,
          approx: mo.approx,
          date: d,
          grp: groupOfExtra(e),
          row: 'x' + e.id
        });
    } else if (e.kind === 'cost') {
      const mo = ferryMoney({ price: e.amount, status: e.status }, ref);
      add('other', mo.total, mo.paid, mo.open);
      if (mo.st !== 'paid' && (mo.total || !e.amount))
        items.push({ kind: 'pay', text: `Offen: ${e.name || 'Kosten'}`, eur: mo.total, approx: mo.approx, date: d, grp: groupOfExtra(e), row: 'x' + e.id });
    }
  });
  const tasks = (state.extras || []).filter(e => e.kind === 'task');
  return { sum, items, tasks, count: items.length + tasks.filter(t => !t.done).length };
}
let costsOpen = { sum: true, open: true };
function costsHtml() {
  const t = tripMoney(),
    rows = Object.values(t.sum).filter(c => c.total || c.unknown);
  const tot = rows.reduce((a, c) => ({ total: a.total + c.total, paid: a.paid + c.paid, open: a.open + c.open }), { total: 0, paid: 0, open: 0 });
  const r = v => `≈ ${Math.round(v).toLocaleString('de-DE')} €`;
  const sumH = rows.length
    ? `<table class="costtab"><thead><tr><th></th><th>gesamt</th><th>bezahlt</th><th>offen</th></tr></thead><tbody>${rows
        .map(
          c =>
            `<tr><td>${c.l}${c.unknown ? ` <span class="muted">(${c.unknown}× Preis unbekannt)</span>` : ''}</td><td>${r(c.total)}</td><td>${r(c.paid)}</td><td>${r(c.open)}</td></tr>`
        )
        .join('')}<tr class="tot"><td>Summe</td><td>${r(tot.total)}</td><td>${r(tot.paid)}</td><td>${r(tot.open)}</td></tr></tbody></table>`
    : '<div class="muted">Noch keine Beträge.</div>';
  const itemsH = t.items
    .map(
      x =>
        `<li class="op-${x.kind}"><button class="linkbtn" type="button" data-opgo="${x.grp}">${esc(x.text)}</button>${x.date ? ` <span class="muted">· ${esc(x.date)}</span>` : ''}${x.eur ? ` <b class="openamt">${fEurA(x.eur, x.approx)}</b>` : ''}</li>`
    )
    .join('');
  const tasksH = t.tasks
    .slice()
    .sort((a, b) => !!a.done - !!b.done)
    .map(
      e =>
        `<li class="task${e.done ? ' done' : ''}"><input type="checkbox" data-sel="${edKey('x', e.id, 'done')}" ${e.done ? 'checked' : ''} aria-label="erledigt"> ${ed('x', e.id, 'text', esc(e.text || ''), {})}
        <span class="muted">bis</span> <input type="date" class="dayin" data-sel="${edKey('x', e.id, 'due')}" value="${esc(e.due || '')}" aria-label="fällig bis"> ${delBtn(e.id)}</li>`
    )
    .join('');
  return `<section class="costs" id="openList">
    <details data-costs="sum"${costsOpen.sum ? ' open' : ''}><summary><b>Kosten</b> <span class="muted">· gesamt ${r(tot.total)} · offen ${r(tot.open)}</span></summary>${sumH}</details>
    <details data-costs="open"${costsOpen.open ? ' open' : ''}><summary><b>Offene Punkte (${t.count})</b> <span class="muted">· Beträge sind Richtwerte</span></summary>
      <ul class="oplist">${itemsH}${tasksH}</ul>
      <button class="btn small" type="button" data-xadd="task">+ Aufgabe</button></details></section>`;
}
// Chip in der Reisezeile: nur die Anzahl, z. B. „3 offen“ (Sebastian: Beträge sind nur Richtwerte – nicht aufaddieren)
function openChipHtml() {
  if (!state.stages.length) return '';
  const t = tripMoney();
  if (!t.count) return '<button type="button" class="savechip" data-opento title="Offene Punkte">✓ nichts offen</button>';
  return `<button type="button" class="savechip openchip" data-opento title="Offene Punkte anzeigen">${t.count} offen</button>`;
}
function gotoOpenList() {
  costsOpen.open = true;
  setTab('trip');
  if (isMobile()) setSheet('full');
  setTimeout(() => $('#openList')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
}

/* ---------- Eigene Unterkunft übernehmen ---------- */
async function applyOwnStay(i, mode, o) {
  const id = `eigen/${o.lat.toFixed(5)},${o.lon.toFixed(5)}`;
  const c = { id, lat: o.lat, lon: o.lon, tags: { tourism: 'camp_site', name: o.name || 'Eigene Unterkunft', 'gp:own': 'yes' }, added: true };
  campIndex.set(id, c);
  ownForm = null;
  if (mode === 'split') await splitStage(i + 1, c);
  else await replaceStop(i, c);
  const k = state.stages.findIndex(s => s.to.id === id);
  if (k >= 0 && o.addr) state.stages[k].to.addr = o.addr;
  if (k >= 0) tlOpen.add(k);
  touch();
  renderAll();
  flash(`„${c.tags.name}“ ist jetzt Etappenziel – die Route wurde neu berechnet.`);
}
async function submitOwnStay(form) {
  const i = +form.dataset.ownform,
    n = form.n.value.trim(),
    q = form.q.value.trim(),
    m = form.querySelector('input[name=m]:checked')?.value || 'replace';
  ownForm = { ...ownForm, n, q, m };
  if (!q) {
    flash('Bitte Adresse, Google-Maps-Link oder Koordinaten eintragen.');
    return;
  }
  if (/goo\.gl|maps\.app/i.test(q)) {
    flash('Kurzlinks gehen nicht – in Google Maps die Koordinaten kopieren oder den langen Link aus der Adresszeile einfügen.');
    return;
  }
  const co = parseCoords(q);
  if (co) return run(() => applyOwnStay(i, m, { ...co, name: n || nameFromUrl(q) || 'Eigene Unterkunft' }));
  const ctr = refPoint(i);
  try {
    const j = await getJson(`${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=6&lang=de&lat=${ctr.lat.toFixed(4)}&lon=${ctr.lon.toFixed(4)}`, 'Suche (Photon)');
    ownForm.hits = (j.features || []).map(f => ({
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      label: photonLabel(f.properties),
      name: f.properties.name || '',
      camp: ['camp_site', 'caravan_site'].includes(f.properties.osm_value)
    }));
  } catch (e) {
    ownForm.hits = [];
    flash(e.message);
  }
  renderTrip();
}

/* ---------- Ereignisse ---------- */
$('#tripView').addEventListener('click', e => {
  const a = e.target.closest('[data-xadd]');
  if (a) {
    const kind = a.dataset.xadd,
      i = +a.dataset.at;
    if (kind === 'stay') {
      ownForm = { i };
      renderTrip();
      setTimeout(() => $('#tripView form.ownstay input[name=n]')?.focus(), 0);
      return;
    }
    const x = { id: newId(), kind };
    if (kind !== 'task') {
      x.at = groupKey(i);
      x.ai = i;
      const ds = stageDates();
      if (ds) x.date = (i < 0 ? ds[0] : addDays(ds[i], nightsOf(state.stages[i])) || ds[i]).toISOString().slice(0, 10);
    }
    state.extras = [...(state.extras || []), x];
    touch();
    renderTrip();
    const f = kind === 'task' ? 'text' : 'name';
    setTimeout(() => {
      const b = document.querySelector(`#tripView [data-ed="x|${x.id}|${f}"]`);
      if (b) openEditor(b);
    }, 0);
    return;
  }
  const d = e.target.closest('[data-xdel]');
  if (d) {
    state.extras = (state.extras || []).filter(x => x.id !== d.dataset.xdel);
    touch();
    renderTrip();
    flash('Zeile gelöscht.');
    return;
  }
  if (e.target.closest('[data-owncancel]')) {
    ownForm = null;
    renderTrip();
    return;
  }
  const h = e.target.closest('[data-ownhit]');
  if (h && ownForm && ownForm.hits) {
    const x = ownForm.hits[+h.dataset.ownhit],
      f = h.closest('form');
    const m = f.querySelector('input[name=m]:checked')?.value || 'replace';
    run(() => applyOwnStay(ownForm.i, m, { lat: x.lat, lon: x.lon, name: f.n.value.trim() || x.name || 'Eigene Unterkunft', addr: x.label }));
    return;
  }
  const g = e.target.closest('[data-opgo]');
  if (g) {
    const i = +g.dataset.opgo;
    tlOpen.add(-1);
    tlOpen.add(i < 0 ? -3 : i);
    renderTrip();
    setTimeout(() => document.querySelector(`#tripView tbody[data-grpb="${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
  }
});
$('#tripView').addEventListener('submit', e => {
  const f = e.target.closest('form.ownstay');
  if (!f) return;
  e.preventDefault();
  submitOwnStay(f);
});
$('#tripView').addEventListener(
  'toggle',
  e => {
    const d = e.target.closest?.('details[data-costs]');
    if (d) costsOpen[d.dataset.costs] = d.open;
  },
  true
);
