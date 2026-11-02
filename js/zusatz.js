/* Reiseplaner – Reiseplan-Tabelle, Teil 2: Fähren, Offene Punkte, Aufgaben.
   Fähre einer Etappe (ORS erkennt sie, `stage.ex.ferry`): Angaben in `stage.ferry` {name, dep, arr, dur, price, status, note},
   Zeile in der Gruppe des Aufenthalts, von dem aus man losfährt (Start-Gruppe für Etappe 1).
   `state.extras` [{id, kind:'ferry'|'cost'|'task', at: Gruppen-Schlüssel, ai: Index (Rückfall), …}]: Aufgaben {text, done, due}
   in „Offene Punkte“; eigene Fähr-/Kosten-Zeilen gibt es nicht mehr neu (Sebastian: „+ Zeile“ weg, Kosten-Übersicht weg) –
   ältere bleiben sichtbar und lassen sich mit ✕ löschen.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
const extraById = id => (state.extras || []).find(e => e.id === id);
const newId = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
  const name = `<span class="pname">⛴ ${ed(scope, id, 'name', esc(f.name || (e ? '' : def)), { ph: 'Fähre' })}</span>`;
  const zt = line(ed(scope, id, 'dep', f.dep ? 'Abfahrt ' + esc(f.dep) : '')) + line(ed(scope, id, 'arr', f.arr ? 'Ankunft ' + esc(f.arr) : ''));
  const pr = `<div>${ed(scope, id, 'price', f.price ? moneyHtml(f.price, ref) : '')}</div><div>${selHtml(scope, id, 'status', ST_CAMP, f.status || 'open', 'Status der Fähre')}</div>`;
  const nt = ed(scope, id, 'note', esc(f.note || ''), { fill: true });
  // Dauer der Überfahrt (z. B. „ca. 9 Std.“) – sonst die km auf der Fähre
  const km = !e && s.ex?.ferry ? `${fkm(s.ex.ferry)} auf der Fähre` : '';
  const wt =
    (f.dur
      ? `${ed(scope, id, 'dur', 'Überfahrt ' + esc(f.dur))}${km ? `<div class="muted">${km}</div>` : ''}`
      : `${km ? km + ' ' : ''}<div>${ed(scope, id, 'dur', '', {})}</div>`) + (e ? delBtn(id) : '');
  return `<tr class="ferry" data-row="${scope}${esc(id)}">${td('Datum', date)}${td('Name', name, 'nm')}${td('Adresse', '')}${td('Zeiten', zt)}${td('Preis / Status', pr)}${td('Notiz', nt)}${td('Überfahrt', wt)}</tr>`;
}
function costRowHtml(e) {
  const ref = refPoint(groupOfExtra(e));
  return `<tr class="cost" data-row="x${esc(e.id)}">${td('Datum', XP ? xpDay(e.date) : `<input type="date" class="dayin" data-sel="${edKey('x', e.id, 'date')}" value="${esc(e.date || '')}" aria-label="Datum">`)}${td(
    'Name',
    `<span class="pname">€ ${ed('x', e.id, 'name', esc(e.name || ''), { ph: 'Bezeichnung' })}</span>`,
    'nm'
  )}${td('Adresse', '')}${td('Zeiten', '')}${td(
    'Preis / Status',
    `<div>${ed('x', e.id, 'amount', e.amount ? moneyHtml(e.amount, ref) : '')}</div><div>${selHtml('x', e.id, 'status', ST_CAMP, e.status || 'open', 'Status')}</div>`
  )}${td('Notiz', ed('x', e.id, 'note', esc(e.note || ''), { fill: true }))}${td('Löschen', delBtn(e.id))}</tr>`;
}
// Fähr-Zeile: Route mit Fähre – oder schon Angaben eingetragen (bleiben sichtbar, auch wenn eine neue Route ohne Fähre fährt)
const hasFerry = s => !!s && ((s.ex && s.ex.ferry > 500) || (s.ferry && Object.values(s.ferry).some(v => v != null && v !== '')));
// alles, was in einer Gruppe unter Platz/Sehenswürdigkeiten steht: Fähre der Weiterfahrt, ältere eigene Fähr-/Kosten-Zeilen
function groupExtrasHtml(i, ds) {
  const nx = state.stages[i + 1];
  let h = '';
  if (hasFerry(nx)) h += ferryRowHtml(i + 1, ds);
  extrasIn(i, 'ferry').forEach(e => (h += ferryRowHtml(-1, ds, e)));
  extrasIn(i, 'cost').forEach(e => (h += costRowHtml(e)));
  return h;
}

/* ---------- Offene Punkte ---------- */
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
// offene Punkte (noch nicht gebucht, offene Beträge, Tickets fehlen) – keine Kostensumme (Sebastian: Kosten raus)
function tripMoney() {
  const items = [],
    ds = stageDates();
  const when = i => (ds && ds[i] ? fdate(ds[i]) : '');
  state.stages.forEach((s, i) => {
    if (s.to.kind === 'camp') {
      const mo = campMoney(s),
        nm = campMy(s).name || nameText(s.to) || s.to.label;
      if (mo.st === 'open') items.push({ kind: 'book', text: `Noch nicht gebucht: ${nm}`, eur: mo.total, approx: true, date: when(i), grp: i, row: 'c' + i });
      else if (mo.open)
        items.push({ kind: 'pay', text: `${stLabel(ST_CAMP, mo.st)}: ${nm}`, eur: mo.open, approx: mo.approxPaid, date: when(i), grp: i, row: 'c' + i });
    }
    if (hasFerry(s)) {
      const mo = ferryMoney(s.ferry, s.to),
        nm = s.ferry?.name || `Fähre (Fahrt nach ${shortLabel(s.to.label)})`;
      if (mo.st === 'open')
        items.push({ kind: 'book', text: `Noch nicht gebucht: ${nm}`, eur: mo.total, approx: mo.approx, date: when(i), grp: i - 1, row: 'f' + i });
      else if (mo.open)
        items.push({ kind: 'pay', text: `${stLabel(ST_CAMP, mo.st)}: ${nm}`, eur: mo.open, approx: mo.approx, date: when(i), grp: i - 1, row: 'f' + i });
    }
  });
  allSights().forEach(({ x, i }) => {
    const mo = sightMoney(x);
    if (mo.town || mo.st === 'free') return;
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
      if (mo.st !== 'paid' && (mo.total || !e.amount))
        items.push({ kind: 'pay', text: `Offen: ${e.name || 'Kosten'}`, eur: mo.total, approx: mo.approx, date: d, grp: groupOfExtra(e), row: 'x' + e.id });
    }
  });
  const tasks = (state.extras || []).filter(e => e.kind === 'task');
  return { items, tasks, count: items.length + tasks.filter(t => !t.done).length };
}
let opOpen = true;
function openListHtml() {
  const t = tripMoney();
  const itemsH = t.items
    .map(
      x =>
        `<li class="op-${x.kind}"><button class="linkbtn" type="button" data-opgo="${x.grp}" data-oprow="${esc(x.row)}">${esc(x.text)}</button>${x.date ? ` <span class="muted">· ${esc(x.date)}</span>` : ''}${x.eur ? ` <b class="openamt">${fEurA(x.eur, x.approx)}</b>` : ''}</li>`
    )
    .join('');
  const tasksH = t.tasks
    .slice()
    .sort((a, b) => !!a.done - !!b.done)
    .map(
      e =>
        `<li class="task${e.done ? ' done' : ''}"><input type="checkbox" data-sel="${edKey('x', e.id, 'done')}" ${e.done ? 'checked' : ''} aria-label="erledigt"> ${ed('x', e.id, 'text', esc(e.text || ''))}
        <span class="muted">bis</span> <input type="date" class="dayin" data-sel="${edKey('x', e.id, 'due')}" value="${esc(e.due || '')}" aria-label="fällig bis"> ${delBtn(e.id)}</li>`
    )
    .join('');
  return `<section class="costs" id="openList">
    <details data-oplist${opOpen ? ' open' : ''}><summary><b>Offene Punkte (${t.count})</b> <span class="muted">· Beträge sind Richtwerte</span></summary>
      <ul class="oplist">${itemsH}${tasksH}</ul>
      <button class="btn small" type="button" data-xadd="task">Aufgabe hinzufügen</button></details></section>`;
}
// Chip in der Reisezeile: nur die Anzahl, z. B. „3 offen“ (Sebastian: Beträge sind nur Richtwerte – nicht aufaddieren)
function openChipHtml() {
  if (!state.stages.length) return '';
  const t = tripMoney();
  if (!t.count) return '<button type="button" class="savechip" data-opento title="Offene Punkte">✓ nichts offen</button>';
  return `<button type="button" class="savechip openchip" data-opento title="Offene Punkte anzeigen">${t.count} offen</button>`;
}
function gotoOpenList() {
  opOpen = true;
  setTab('trip');
  if (isMobile()) setSheet('full');
  setTimeout(() => $('#openList')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
}

/* ---------- Ereignisse ---------- */
$('#tripView').addEventListener('click', e => {
  const a = e.target.closest('[data-xadd="task"]');
  if (a) {
    const x = { id: newId(), kind: 'task' };
    state.extras = [...(state.extras || []), x];
    touch();
    renderTrip();
    setTimeout(() => {
      const b = document.querySelector(`#tripView [data-ed="x|${x.id}|text"]`);
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
  // Eintrag der offenen Punkte → zur Zeile springen (Gruppe aufklappen, hervorheben)
  const g = e.target.closest('[data-oprow]');
  if (g) {
    const row = g.dataset.oprow,
      i = +g.dataset.opgo;
    if (rowGroup(row)) focusRow(row);
    else document.querySelector(`#tripView tbody[data-grpb="${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
});
$('#tripView').addEventListener(
  'toggle',
  e => {
    if (e.target.matches?.('details[data-oplist]')) opOpen = e.target.open;
  },
  true
);
