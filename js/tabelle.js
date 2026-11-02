/* Reiseplaner – Reiseplan als Tabelle (Reiter 3): 7 Spalten wie in Sebastians Reise-PDF, je Aufenthalt eine Gruppe
   (Platz-Zeile immer vollständig, darunter aufklappbar „▶ n Sehenswürdigkeiten“ und die Besuche der Weiterfahrt).
   Werte antippen = bearbeiten (keine Symbole): eigene Werte gewinnen; beim Bearbeiten steht der gefundene Wert darunter
   („gefunden: … übernehmen“). Name und Adresse sind nur Links (Google-Eintrag, Navigation), nicht bearbeitbar.
   Eigene Angaben: Platz → `stage.my` {cid, name, addr, ort, hours, arr, dep, ppn, total, paid, status}
   (gilt nur, solange der Platz derselbe ist: `cid`), Notiz (ein freies Feld) in `stage.memo.text`; Sehenswürdigkeit →
   `my` am Ziel-Eintrag (`sightSrc`) {day, name, addr, hours, amount, status, note}. Ältere Felder nr/pitch/phone werden
   nicht mehr angezeigt (Sebastian: verwerfen). Handy: dieselben Zellen als Karten.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
const PT_COLS = ['Datum', 'Name', 'Adresse', 'Zeiten', 'Preis / Status', 'Notiz', 'Weiter / Entfernung'];
const ST_CAMP = [
  ['open', 'offen'],
  ['booked', 'gebucht'],
  ['partial', 'angezahlt'],
  ['paid', 'bezahlt'],
  ['onsite', 'gebucht, vor Ort zahlen']
];
const ST_SIGHT = [
  ['open', 'offen'],
  ['bought', 'Tickets gekauft'],
  ['onsite', 'vor Ort zahlen'],
  ['free', 'kein Ticket nötig']
];
const stLabel = (list, k) => (list.find(x => x[0] === k) || list[0])[1];
/* Ausgabemodus für PDF und Word (`XP`): dieselbe Tabelle, aber alles aufgeklappt, ohne Eingabefelder, Knöpfe und
   „+ Zeile“, leere Angaben weggelassen; Google-Öffnungszeiten als Wochentext mit „lt. Google, Stand …“ */
let XP = false;
const gStand = () => `lt. Google, Stand ${new Date().toLocaleDateString('de-DE')}`;
function ohText(oh) {
  const v = (oh || []).map(l => [l.split(':')[0], l.replace(/^[^:]+:\s*/, '')]);
  if (!v.length) return '';
  if (v.every(x => x[1] === v[0][1])) return 'täglich ' + v[0][1];
  return v.map(([d, t]) => d.slice(0, 2) + ' ' + t).join(' · ');
}
const xpDay = d => (d ? fdate(new Date(d + 'T12:00:00')) : '');

/* ---------- eigene Angaben ---------- */
function campMy(s) {
  const m = s.my;
  return m && (!m.cid || m.cid === s.to.id) ? m : {};
}
const campStatus = s => campMy(s).status || (s.memo?.res ? 'booked' : 'open');
function sightMy(x) {
  return sightSrc(x)?.my || {};
}
function findSightByKey(k) {
  return (
    [...state.via, ...state.via.flatMap(v => v.sights || [])].find(v => sightKey(v) === k) ||
    state.stages.flatMap(s => s.to.sights || (s.to.near ? [s.to.near] : [])).find(v => sightKey(v) === k)
  );
}
function setOwn(scope, id, f, v) {
  v = v == null ? '' : String(v).trim();
  if (scope === 'f' || scope === 'x') {
    const o = scope === 'f' ? state.stages[+id] && (state.stages[+id].ferry = state.stages[+id].ferry || {}) : extraById(id);
    if (!o) return;
    if (v === '') delete o[f];
    else o[f] = v;
    return;
  }
  if (scope === 'c') {
    const s = state.stages[+id];
    if (!s) return;
    if (f === 'note') {
      s.memo = { ...(s.memo || {}), text: v };
      return;
    }
    const m = s.my && (!s.my.cid || s.my.cid === s.to.id) ? s.my : {};
    if (s.to.id) m.cid = s.to.id;
    if (v === '') delete m[f];
    else m[f] = v;
    s.my = m;
    if (f === 'status') s.memo = { ...(s.memo || {}), res: !!v && v !== 'open' }; // „reserviert“ der Etappenkarte folgt dem Status
  } else {
    const x = findSightByKey(id),
      src = x && sightSrc(x);
    if (!src) return;
    const m = src.my || {};
    if (v === '') delete m[f];
    else m[f] = v;
    src.my = m;
  }
}

/* ---------- Beträge (Originalwährung, gerechnet in Euro) ---------- */
// „4 × 35 €“ / „4 x 35 €“ = Anzahl × Einzelpreis
function splitTimes(t) {
  const s = String(t || '').replace(/^ab\s+/i, ''),
    m = s.match(/^\s*(\d+)\s*[×x*]\s*/i);
  return m ? { f: +m[1], s: s.slice(m[0].length) } : { f: 1, s };
}
const eurOf = (t, c, url) => {
  if (!t) return null;
  const q = splitTimes(t),
    e = toEuro(q.s, c, url);
  return e ? e.eur * q.f : null;
};
const fEur = v =>
  v == null ? '–' : (Math.round(v * 100) / 100).toLocaleString('de-DE', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';
// umgerechneter Betrag (fremde Währung): gerundet mit „≈“
const fEurA = (v, approx) => (v == null ? '–' : approx ? `≈ ${Math.round(v).toLocaleString('de-DE')} €` : fEur(v));
// eingegebener Betrag: „1170 SEK“ → „1.170 SEK (≈ 103 €)“, „45,10 €“ → „45,10 €“
function moneyHtml(t, c, url) {
  const q = splitTimes(t),
    e = t ? toEuro(q.s, c, url) : null;
  if (!e) return esc(t || '');
  if (q.f > 1) return `${esc(t)} <span class="muted">(${e.orig ? '≈ ' + Math.round(e.eur * q.f) + ' €' : '= ' + fEur(e.eur * q.f)})</span>`;
  return e.orig ? `${esc(e.orig)} <span class="muted">(≈ ${Math.round(e.eur).toLocaleString('de-DE')} €)</span>` : fEur(e.eur);
}
const nightsOf = s => Math.max(1, +s.nights || 1);
function campMoney(s) {
  const c = s.to,
    m = campMy(s),
    n = nightsOf(s),
    url = webOf(c);
  const p = m.ppn ? { text: m.ppn, own: true } : priceOf(c);
  const ppnE = p ? eurOf(p.text, c, p.url || url) : null;
  const total = m.total ? eurOf(m.total, c, url) : ppnE != null ? ppnE * n : null;
  const st = campStatus(s);
  const paid = m.paid ? eurOf(m.paid, c, url) : st === 'paid' ? total : null;
  const open = total != null && st !== 'paid' ? Math.max(0, total - (paid || 0)) : st === 'paid' ? 0 : null;
  const fx = t => !!(t && toEuro(splitTimes(t).s, c, url)?.orig);
  return {
    p,
    ppnE,
    total,
    paid,
    open,
    st,
    n,
    approx: m.total ? fx(m.total) : fx(p?.text),
    approxPaid: m.paid ? fx(m.paid) : m.total ? fx(m.total) : fx(p?.text)
  };
}
const sightRz = s => {
  const w = s.info?.web,
    r = w ? rzData['web:' + w] : null;
  return r && (r.v || 0) >= 2 ? r : null;
};
function sightMoney(x) {
  const s = sightSrc(x),
    m = s.my || {},
    inf = s.info || {},
    url = inf.web;
  if (inf.town) return { town: true };
  const r = sightRz(s),
    g = gSight.get(sightKey(s));
  const ad = Math.max(0, +settings.adults || 0),
    ki = Math.max(0, +settings.kids || 0);
  let est = null,
    src = '';
  if (r && r.price) {
    const a = eurOf(r.price.adult, s, url),
      ch = eurOf(r.price.child, s, url);
    if (a != null || ch != null) est = (a ?? ch) * ad + (ch ?? a) * ki;
    else if (eurOf(r.price.text, s, url) != null) est = eurOf(r.price.text, s, url) * (ad + ki);
    src = 'Website';
  } else if (inf.fee === 'no') {
    est = 0;
    src = 'OSM';
  } else if (inf.charge && eurOf(inf.charge, s, url) != null) {
    est = eurOf(inf.charge, s, url) * (ad + ki);
    src = 'OSM';
  } else if (g && g.price && eurOf(g.price, s) != null) {
    est = eurOf(g.price, s) * (ad + ki);
    src = 'Google';
  }
  const own = m.amount ? eurOf(m.amount, s, url) : null;
  const st = m.status || (inf.fee === 'no' ? 'free' : 'open');
  const total = st === 'free' ? 0 : (own ?? est);
  return { est, src, own, total, st, paid: st === 'bought' ? total : null, open: st === 'open' || st === 'onsite' ? total : 0, ad, ki };
}
const persons = (ad, ki) => [ad && `${ad} Erw.`, ki && `${ki} ${ki === 1 ? 'Kind' : 'Kinder'}`].filter(Boolean).join(' + ') || 'niemand (⚙︎ Reisende)';

/* ---------- gefundene Werte (zum Vorbelegen beim Bearbeiten) ---------- */
function campAddrFound(c) {
  const g = gRate.get(c.id);
  return (g?.near && g.addr) || (c.addr && c.addr !== 'unbekannt' ? c.addr : '');
}
function campHoursFound(c) {
  const r = c.kind === 'camp' ? rzFor(c) : null;
  if (!r || !(r.status === 'ok' || r.status === 'partial')) return '';
  return [
    r.status === 'ok' && r.hours ? 'Rezeption ' + r.hours : '',
    r.checkin ? 'Check-in ' + r.checkin.text : '',
    r.checkout ? 'Check-out ' + r.checkout.text : ''
  ]
    .filter(Boolean)
    .join(' · ');
}
function sightHoursFound(s) {
  const m = s.my || {},
    g = gSight.get(sightKey(s)),
    r = sightRz(s),
    inf = s.info || {};
  if (inf.town) return null;
  const day = m.day ? new Date(m.day + 'T12:00:00') : null;
  if (g && g.oh && g.oh.length) {
    const wd = (day || new Date()).toLocaleDateString('de-DE', { weekday: 'long' }).toLowerCase(),
      l = g.oh.find(y => y.toLowerCase().startsWith(wd));
    if (l) return { t: l.replace(/^[^:]+:\s*/, ''), src: 'Google', pre: day ? fdate(day) : 'heute' };
  }
  if (r && r.hoursS && r.hoursS.text) return { t: r.hoursS.text, src: 'Website', url: r.hoursS.url };
  if (inf.oh) return { t: inf.oh, src: 'OSM' };
  return null;
}
function foundVal(scope, id, f) {
  if (scope === 'f' || scope === 'x') return '';
  if (scope === 'c') {
    const s = state.stages[+id],
      c = s.to;
    if (f === 'name') return c.kind === 'camp' ? nameText(c) : c.label;
    if (f === 'addr') return campAddrFound(c);
    if (f === 'hours') return campHoursFound(c);
    if (f === 'ppn') return priceOf(c)?.text || '';
    if (f === 'total') {
      const mo = campMoney({ ...s, my: { ...campMy(s), total: '' } });
      return mo.total != null ? fEurA(mo.total, mo.approx) : '';
    }
    if (f === 'phone') return (c.kind === 'camp' && phoneOf(c)) || '';
    if (f === 'ort') return townOf(campMy(s).addr || campAddrFound(c));
    return '';
  }
  const x = findSightByKey(id),
    s = x && sightSrc(x);
  if (!s) return '';
  if (f === 'name') return shortLabel(s.label);
  if (f === 'addr') return gSight.get(sightKey(s))?.addr || s.info?.addr || '';
  if (f === 'hours') return sightHoursFound(s)?.t || '';
  if (f === 'amount') {
    const mo = sightMoney(s);
    return mo.est != null ? fEur(mo.est) : '';
  }
  return '';
}
function ownVal(scope, id, f) {
  if (scope === 'f') return state.stages[+id]?.ferry?.[f] || '';
  if (scope === 'x') return extraById(id)?.[f] || '';
  if (scope === 'c') {
    const s = state.stages[+id];
    return f === 'note' ? s.memo?.text || '' : campMy(s)[f] || '';
  }
  const x = findSightByKey(id);
  return (x && sightMy(x)[f]) || '';
}

/* ---------- Zellen-Bausteine ---------- */
const FIELD = {
  name: { l: 'Name' },
  ort: { l: 'Ort', ph: 'Ort' },
  dur: { l: 'Dauer der Überfahrt', ph: 'Dauer der Überfahrt' },
  addr: { l: 'Adresse' },
  hours: { l: 'Zeiten', multi: true, ph: 'Zeiten' },
  arr: { l: 'Ankunft', ph: 'Ankunft' },
  dep: { l: 'Abfahrt', ph: 'Abfahrt' },
  ppn: { l: 'Preis pro Nacht', ph: 'Preis / Nacht' },
  total: { l: 'Gesamtpreis', ph: 'gesamt' },
  paid: { l: 'bezahlt', ph: 'bezahlt' },
  note: { l: 'Notiz', multi: true, ph: '' },
  amount: { l: 'Betrag', ph: 'Preis' },
  price: { l: 'Preis', ph: 'Preis' },
  text: { l: 'Aufgabe', ph: 'Aufgabe' }
};
const edKey = (scope, id, f) => esc(`${scope}|${id}|${f}`);
// bearbeitbarer Wert: antippen → Eingabefeld (keine Symbole, keine Marke „von dir“). Leer → blasser Platzhalter;
// fill = füllt die Zelle (Notiz: Klick irgendwo in die Zelle bearbeitet)
function ed(scope, id, f, html, opt = {}) {
  if (XP) return html || '';
  const k = edKey(scope, id, f),
    F = FIELD[f] || {},
    ph = opt.ph ?? F.ph ?? F.l ?? '';
  return `<span class="ed${opt.fill ? ' fill' : ''}" data-ed="${k}" role="button" tabindex="0" title="antippen zum Bearbeiten">${html || (ph ? `<span class="ph">${esc(ph)}</span>` : '')}</span>`;
}
// Zeilen mit offenem Punkt (noch nicht gebucht, offener Betrag, Tickets fehlen …): Status wie der Chip hinterlegt
let openRows = new Set();
const selHtml = (scope, id, f, list, cur, label) =>
  XP
    ? `<span class="st st-${esc(cur)}">${esc(stLabel(list, cur))}</span>`
    : `<select class="stsel st-${esc(cur)}${openRows.has(scope + id) ? ' isopen' : ''}" data-sel="${edKey(scope, id, f)}" aria-label="${esc(label)}">${list.map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
// Ausgabe: leere Beschriftungen („Buchungsnr. “, „bezahlt “ …) weglassen
const xpClean = h =>
  h
    .replace(/<div(?: class="x")?>\s*(?:gesamt|bezahlt|Ankunft|Abfahrt|Überfahrt)\s*<\/div>/g, '')
    .replace(/bezahlt\s+·\s+/g, '')
    .replace(/<div(?: class="x")?>\s*<\/div>/g, '');
const td = (l, h, cls) => `<td data-l="${esc(l)}"${cls ? ` class="${cls}"` : ''}>${XP ? xpClean(h) : h}</td>`;
const line = h => (h ? `<div class="x">${h}</div>` : '');

/* ---------- Ort eines Aufenthalts ---------- */
// aus der Adresse: letzter Teil ohne Land und Postleitzahl („Folkparksvägen 10, 577 36 Hultsfred“ → „Hultsfred“)
const COUNTRY_RE =
  /^(deutschland|germany|schweden|sverige|sweden|dänemark|danmark|denmark|norwegen|norge|norway|frankreich|france|spanien|españa|spain|italien|italia|italy|niederlande|nederland|netherlands|belgien|belgique|belgium|österreich|austria|schweiz|suisse|switzerland|polen|polska|poland|tschechien|finnland|suomi|finland)$/i;
function townOf(addr) {
  const parts = String(addr || '')
    .split(',')
    .map(x => x.trim())
    .filter(x => x && !COUNTRY_RE.test(x));
  if (parts.length < 2) return '';
  const t = parts[parts.length - 1].replace(/^(?:[A-Z]{1,2}-?)?\d[\d\s-]*\s+/, '').trim();
  return /\d/.test(t) ? '' : t;
}
// Ort des Aufenthalts i: eigener Wert, sonst aus der (eigenen bzw. gefundenen) Adresse
function stayTown(i) {
  const s = state.stages[i];
  if (!s) return '';
  const m = campMy(s);
  return m.ort || townOf(m.addr || campAddrFound(s.to)) || (s.to.kind !== 'camp' ? shortLabel(s.to.label) : '');
}

/* ---------- Zeilen ---------- */
// Weiterfahrt ab einem Aufenthalt = Etappe j (die nächste) – „nach <Ort>“ wie in der Reise-PDF, sonst Platzname
function driveHtml(j) {
  const s = state.stages[j];
  if (!s) return '<span class="muted">–</span>';
  const fl = [s.ex?.ferry > 200 ? 'Fähre' : '', s.ex?.toll > 1000 ? 'Maut' : ''].filter(Boolean).join(' · ');
  return `<div>nach ${esc(stayTown(j) || shortLabel(s.to.label))}</div><div class="muted">${fkm(s.dist)} · ${fdur(s.dur)}${fl ? ' · ' + fl : ''}</div>`;
}
// Aufklapp-Zeile unter dem Platz: „▶ 2 Sehenswürdigkeiten · 1 Besuch unterwegs“ (Gruppe i, Start = -1)
function sgRowHtml(i, open, ns, nv) {
  if (XP || !(ns + nv)) return '';
  const t = [ns && `${ns} ${ns === 1 ? 'Sehenswürdigkeit' : 'Sehenswürdigkeiten'}`, nv && `${nv} ${nv === 1 ? 'Besuch' : 'Besuche'} unterwegs`]
    .filter(Boolean)
    .join(' · ');
  return `<tr class="sgrow"><td colspan="7"><button class="sgtog" type="button" data-grp="${i}" aria-expanded="${open}"><span class="tri" aria-hidden="true">${open ? '▼' : '▶'}</span> ${t}</button></td></tr>`;
}
function startRows(ds, open) {
  const vs = state.stages[0] ? visitsOf(state.stages[0]) : [];
  let h = `<tr class="pt" data-row="start">${td('Datum', ds ? `<span class="dat">${fdate(ds[0])}</span>` : '')}${td('Name', `<b>Start: ${esc(shortLabel(state.start.label))}</b>`)}${td('Adresse', esc(cleanLabel(state.start.label)))}${td('Zeiten', '')}${td('Preis / Status', '')}${td('Notiz', '')}${td('Weiter / Entfernung', driveHtml(0))}</tr>`;
  h += sgRowHtml(-1, open, 0, vs.length);
  if (open) vs.forEach(v => (h += visitRowHtml(v)));
  return h + groupExtrasHtml(-1, ds);
}
// Platz-Zeile: immer vollständig (Datum, Nächte, Ort · Name + Links · Adresse, Telefon, Koordinaten · Zeiten, Ankunft,
// Abfahrt · Preis/Nacht, gesamt, Status, bezahlt · Notiz · Weiterfahrt)
function campRowHtml(i, ds, cur) {
  const s = state.stages[i],
    c = s.to,
    camp = c.kind === 'camp',
    m = campMy(s),
    last = i === state.stages.length - 1,
    n = nightsOf(s);
  const own = f => !!m[f],
    nN = `${n} ${n === 1 ? 'Nacht' : 'Nächte'}`;
  // Datum (ohne Umbruch), Nächte (− n +), Ort
  let dat = ds ? `<b class="dat">${fdate(ds[i])}${!last || camp ? ` – ${fdate(addDays(ds[i], n))}` : ''}</b>` : `Etappe ${i + 1}`;
  dat += XP
    ? `<div class="muted">${nN}</div>`
    : `<div class="nstep" title="Nächte"><button type="button" data-tlnight="${i}" data-d="-1" aria-label="eine Nacht weniger" ${n <= 1 ? 'disabled' : ''}>−</button><span>${nN}</span><button type="button" data-tlnight="${i}" data-d="1" aria-label="eine Nacht mehr">+</button></div>`;
  if (camp) dat += `<div class="ort">${ed('c', i, 'ort', esc(stayTown(i)))}</div>`;
  // Name = Link Google-Eintrag (eigener Name aus älteren Touren wird weiter angezeigt)
  const nm = own('name') ? esc(m.name) : camp ? nameHtml(c) : esc(c.label);
  let name = `<span class="pname"><a href="${esc(gEntryUrl(c))}" target="_blank" rel="noopener">${nm}</a></span>`;
  if (i === cur) name += ' <span class="badge best">heute/nächste</span>';
  if (camp) {
    const w = campWeb(c),
      g = settings.gkey && gRate.has(c.id) ? rateHtml(c) : '';
    name += line([w && linkA(safeUrl(w), hostOf(w)), linkA(p4nUrl(c), 'park4night')].filter(Boolean).join(' · ') + g);
    if (!XP)
      name += `<div class="x sbtns"><button class="linkbtn" type="button" data-share="${i}">Teilen</button> · <button class="linkbtn" type="button" data-tledit="${i}">Platz ändern</button></div>`;
  }
  // Adresse = Link Navigation, darunter gefundene Telefonnummer und Koordinaten
  const addr = own('addr') ? m.addr : campAddrFound(c);
  let ad = `<a href="${esc(navUrl(c))}" target="_blank" rel="noopener">${esc(addr || (camp ? 'Navigation' : cleanLabel(c.label)))}</a>`;
  const tel = camp ? phoneOf(c) : '';
  if (tel) ad += line(`<a href="tel:${esc(String(tel).replace(/[^+\d]/g, ''))}">${esc(tel)}</a>`);
  ad += line(XP ? `<span class="muted">${fcoord(c)}</span>` : coordHtml(c).replace(/<a class="btn small"[^]*$/, ''));
  // Zeiten
  const hf = campHoursFound(c),
    gR = gRate.get(c.id);
  let zt = ed('c', i, 'hours', esc(own('hours') ? m.hours : hf), { ph: camp ? 'Rezeption, Check-in' : 'Zeiten' });
  if (!own('hours') && !hf && gR?.oh?.length) zt += XP ? line(`${esc(ohText(gR.oh))} <span class="muted">(${gStand()})</span>`) : gHoursHtml(gR.oh, gR.open);
  const r = camp ? rzFor(c) : null;
  if (!own('hours') && r?.url) zt += line(`<a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">Quelle</a>`);
  zt += line(ed('c', i, 'arr', m.arr ? 'Ankunft ' + esc(m.arr) : ''));
  zt += line(ed('c', i, 'dep', m.dep ? 'Abfahrt ' + esc(m.dep) : ''));
  // Preis / Status
  let pr = '';
  if (camp) {
    const mo = campMoney(s),
      p = mo.p;
    const ppn = p ? (p.own ? moneyHtml(p.text, c) : euroText(p, c) || esc(p.text)) : '';
    const srcN = { web: 'Website', osm: 'OSM', google: 'Google' }[p?.src];
    const tot = mo.total != null ? 'gesamt ' + (own('total') ? moneyHtml(m.total, c) : `${fEurA(mo.total, mo.approx)} <span class="muted">(${nN})</span>`) : '';
    const paid = m.paid ? 'bezahlt ' + moneyHtml(m.paid, c) : mo.st === 'paid' && mo.total != null ? 'bezahlt ' + fEurA(mo.total, mo.approx) : '';
    pr =
      `<div>${ed('c', i, 'ppn', ppn ? ppn + ' <span class="muted">/ Nacht</span>' : '')}${!p?.own && p ? `<span class="muted">${powerHtml(p, c)} · ${p.url ? `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${srcN}</a>` : srcN}</span>` : ''}</div>` +
      `<div>${ed('c', i, 'total', tot)}</div><div>${selHtml('c', i, 'status', ST_CAMP, mo.st, 'Bezahlstatus')}</div>` +
      `<div>${ed('c', i, 'paid', paid)}${mo.open ? ` · <span class="openamt">offen ${fEurA(mo.open, mo.approxPaid)}</span>` : ''}</div>`;
  }
  // Notiz: ein freies Feld
  const nt = ed('c', i, 'note', esc(s.memo?.text || ''), { fill: true });
  return `<tr class="camp${i === cur ? ' cur' : ''}" data-row="c${i}">${td('Datum', dat)}${td('Name', name, 'nm')}${td('Adresse', ad)}${td('Zeiten', zt)}${td('Preis / Status', pr)}${td('Notiz', nt)}${td('Weiter / Entfernung', last ? '<span class="muted">–</span>' : driveHtml(i + 1))}</tr>`;
}
function sightRowHtml(x, from) {
  const s = sightSrc(x),
    k = sightKey(s),
    m = s.my || {},
    inf = s.info || {},
    g = gSight.get(k),
    own = f => !!m[f];
  const dir = from
    ? `https://www.google.com/maps/dir/?api=1&origin=${from.lat.toFixed(6)},${from.lon.toFixed(6)}&destination=${(+s.lat).toFixed(6)},${(+s.lon).toFixed(6)}&travelmode=driving`
    : navUrl(s);
  const day = XP
    ? xpDay(m.day)
    : `<input type="date" class="dayin" data-sel="${edKey('s', k, 'day')}" value="${esc(m.day || '')}" aria-label="Besuchstag" title="Besuchstag (freiwillig)">`;
  const nm = own('name') ? m.name : shortLabel(s.label);
  let name = `<span class="pname">★ <a href="${esc(sightGUrl(s))}" target="_blank" rel="noopener">${esc(nm)}</a></span>`;
  const w = inf.web;
  if (w)
    name += line(
      linkA(safeUrl(w), hostOf(w)) +
        (g && g.r != null
          ? ` · <a class="stars" href="${esc(g.uri)}" target="_blank" rel="noopener">★ ${g.r.toLocaleString('de-DE', { minimumFractionDigits: 1 })} <span>(${g.n.toLocaleString('de-DE')})</span></a>`
          : '')
    );
  else if (XP);
  else if ((s.info || g) && !inf.town && !swebOpen.has(k))
    name += line(`<button class="linkbtn swebadd" type="button" data-swebopen="${esc(k)}">Website eintragen</button>`);
  else if ((s.info || g) && !inf.town)
    name += `<form class="sweb x" data-sweb="${esc(k)}"><input name="w" type="text" inputmode="url" autocomplete="url" placeholder="Website eintragen" aria-label="Website der Sehenswürdigkeit" value="${g && g.web ? esc(g.web) : ''}"><button class="btn small" type="submit">Merken</button></form>`;
  if (!XP && !s.info && sightBusy.has(k)) name += line('<span class="muted">Infos werden geladen …</span>');
  const addr = own('addr') ? m.addr : g?.addr || inf.addr || cleanLabel(s.label);
  const ad = `<a href="${esc(dir)}" target="_blank" rel="noopener">${esc(addr)}</a>`;
  let zt = '',
    pr = '';
  if (!inf.town) {
    const hf = sightHoursFound(s),
      r = sightRz(s);
    const gx = XP && !own('hours') && hf && hf.src === 'Google' && g && g.oh ? (m.day ? `${xpDay(m.day)}: ${esc(hf.t)}` : esc(ohText(g.oh))) : '';
    zt = ed('s', k, 'hours', own('hours') ? esc(m.hours) : gx || (hf ? `${hf.pre ? hf.pre + ': ' : ''}${esc(hf.t)}` : ''), { ph: 'Öffnungszeiten' });
    if (!own('hours') && hf)
      zt += ` <span class="muted">(${hf.url ? `<a href="${esc(safeUrl(hf.url))}" target="_blank" rel="noopener">${hf.src}</a>` : XP && hf.src === 'Google' ? gStand() : hf.src})</span>`;
    if (!own('hours') && hf && hf.src === 'Google' && r && r.hoursS && r.hoursS.text)
      zt += line(`Website: ${esc(r.hoursS.text)}${r.hoursS.url ? ' · ' + linkA(safeUrl(r.hoursS.url), 'Quelle') : ''}`);
    if (g && g.oh && g.oh.length && !XP) zt += gHoursHtml(g.oh, g.open);
    if (r && r.hoursUrl && !(r.hoursS && r.hoursS.text)) zt += line(linkA(safeUrl(r.hoursUrl), 'Öffnungszeiten auf der Website'));
    if (r && r.season && r.season.from && dmDe(r.season.from) && dmDe(r.season.to)) zt += line(`Saison ${dmDe(r.season.from)} – ${dmDe(r.season.to)}`);
    const mo = sightMoney(s);
    const ageP =
      r && r.price && (r.price.adult || r.price.child)
        ? [r.price.adult && 'Erw. ' + euroAb(r.price.adult, s), r.price.child && 'Kind ' + euroAb(r.price.child, s)].filter(Boolean).join(' · ')
        : r && r.price
          ? euroText(r.price, s) + ' p. P.'
          : inf.fee === 'no'
            ? 'Eintritt frei'
            : inf.charge
              ? euroText({ text: inf.charge }, s)
              : g && g.price
                ? euroText({ text: g.price }, s)
                : '';
    pr =
      (ageP
        ? `<div>${ageP}${mo.src ? ` <span class="muted">(${XP && mo.src === 'Google' ? gStand() : mo.src})</span>` : ''}</div>`
        : r && r.priceUrl
          ? line(linkA(safeUrl(r.priceUrl), 'Preise auf der Website'))
          : '') +
      `<div>${ed('s', k, 'amount', own('amount') ? moneyHtml(m.amount, s, inf.web) : mo.est != null ? `≈ ${fEur(mo.est)} <span class="muted">für ${persons(mo.ad, mo.ki)}</span>` : '')}</div>
      ${XP && mo.st === 'open' && !mo.total ? '' : `<div>${selHtml('s', k, 'status', ST_SIGHT, mo.st, 'Ticket-Status')}</div>`}`;
  }
  const nt = ed('s', k, 'note', esc(m.note || ''), { fill: true });
  const dist =
    x.d != null
      ? `${x.est ? '≈' : ''}${fkm1(x.d)}${x.t ? `<div class="muted">${fdur(x.t)}</div>` : ''}`
      : x.air != null
        ? `${fkm1(x.air)} <span class="muted">Luftlinie</span>`
        : '';
  return `<tr class="sight" data-row="s${esc(k)}">${td('Besuchstag', day)}${td('Name', name, 'nm')}${td('Adresse', ad)}${td('Öffnungszeiten', zt)}${td('Preis / Ticket', pr)}${td('Notiz', nt)}${td('Entfernung vom Platz', dist)}</tr>`;
}
// Besuch unterwegs (auf der Weiterfahrt): wie eine Sehenswürdigkeit, Spalte rechts = Dauer + Parken
function visitRowHtml(v) {
  return sightRowHtml(v, null)
    .replace(
      /<td data-l="Entfernung vom Platz">[^]*?<\/td><\/tr>$/,
      `<td data-l="Besuch unterwegs">unterwegs · ≈ ${fhours(v.hours)}<div><a href="${parkUrl(v)}" target="_blank" rel="noopener">Parken fürs Gespann</a></div></td></tr>`
    )
    .replace('<span class="pname">★ ', '<span class="pname">◆ ');
}
function endRowHtml(i, ds) {
  const s = state.stages[i],
    home = state.segs && state.segs[state.segs.length - 1].kind === 'home';
  return `<tr class="pt" data-row="end">${td('Datum', ds ? `<span class="dat">${fdate(ds[i])}</span>` : '')}${td('Name', `<b>${home ? 'Zurück in' : 'Ziel:'} ${esc(shortLabel(s.to.label))}</b>`)}${td('Adresse', `<a href="${esc(navUrl(s.to))}" target="_blank" rel="noopener">${esc(cleanLabel(s.to.label))}</a>`)}${td('Zeiten', '')}${td('Preis / Status', '')}${td('Notiz', '')}${td('Weiter / Entfernung', '<span class="muted">–</span>')}</tr>`;
}
/* Auf-/zugeklappte Gruppen je Tour merken (gp.ui.grp {tourId: [Gruppen]}; Start-Gruppe = -3), beim ersten Mal alle zu */
let grpFor = null;
const grpTourKey = () => String(state.tourId || 'neu');
function loadGrp() {
  const k = grpTourKey();
  if (grpFor === k) return;
  let all = {};
  try {
    all = JSON.parse(localStorage.getItem('gp.ui.grp') || '{}') || {};
  } catch (e) {}
  // neue Tour wurde gerade gespeichert: aufgeklappte Gruppen mitnehmen
  if (!(grpFor === 'neu' && !all[k])) {
    tlOpen.clear();
    (all[k] || []).forEach(x => tlOpen.add(x));
  }
  grpFor = k;
}
function saveGrp() {
  try {
    const all = JSON.parse(localStorage.getItem('gp.ui.grp') || '{}') || {};
    all[grpTourKey()] = [...tlOpen].filter(x => x !== -1);
    localStorage.setItem('gp.ui.grp', JSON.stringify(all));
  } catch (e) {}
}
/* Spaltenbreiten (nur online, je Gerät): Prozent je Spalte in gp.ui.cols, Ziehen am rechten Rand der Überschrift */
const COLW0 = [11, 19, 16, 14, 15, 15, 10];
function colWidths() {
  try {
    const w = JSON.parse(localStorage.getItem('gp.ui.cols') || 'null');
    if (Array.isArray(w) && w.length === 7 && w.every(x => x > 2)) return w;
  } catch (e) {}
  return COLW0;
}
function planTableHtml() {
  const ds = stageDates(),
    cur = currentStage(),
    st = state.stages,
    last = st.length - 1;
  if (!XP) loadGrp();
  openRows = new Set(tripMoney().items.map(x => x.row));
  const cw = colWidths();
  let h = `<table class="ptab"><colgroup>${['dat', 'nm', 'ad', 'zt', 'pr', 'nt', 'wt'].map((c, k) => `<col class="c-${c}"${XP ? '' : ` style="width:${cw[k]}%"`}>`).join('')}</colgroup>
    <thead><tr>${PT_COLS.map((c, k) => `<th>${c}${!XP && k < 6 ? `<span class="colrs" data-colrs="${k}" title="Spaltenbreite ziehen (Doppelklick = zurücksetzen)"></span>` : ''}</th>`).join('')}</tr></thead>`;
  const o0 = XP || tlOpen.has(-3);
  h += `<tbody class="grp start${o0 ? ' open' : ''}" data-grpb="-1">${startRows(ds, o0)}</tbody>`;
  st.forEach((s, i) => {
    if (i === last && s.to.kind !== 'camp') {
      h += `<tbody class="grp">${endRowHtml(i, ds)}${groupExtrasHtml(i, ds)}</tbody>`;
      return;
    }
    const open = XP || tlOpen.has(i),
      sg = s.to.sights || [],
      vs = st[i + 1] ? visitsOf(st[i + 1]) : [];
    let b = campRowHtml(i, ds, cur) + sgRowHtml(i, open, sg.length, vs.length);
    if (open) {
      sortSights(sg).forEach(x => (b += sightRowHtml(x, s.to)));
      vs.forEach(v => (b += visitRowHtml(v)));
    }
    b += groupExtrasHtml(i, ds);
    h += `<tbody class="grp${open ? ' open' : ''}" data-grpb="${i}">${b}</tbody>`;
  });
  return h + '</table>' + (XP ? '' : openListHtml());
}
// Sehenswürdigkeiten einer Gruppe: mit Besuchstag zuerst (nach Datum), dann nach Entfernung vom Platz
function sortSights(list) {
  return list
    .map((x, n) => ({ x, n, d: sightMy(x).day || '', e: x.d ?? x.air ?? 9e9 }))
    .sort((a, b) => (a.d && b.d ? a.d.localeCompare(b.d) : a.d ? -1 : b.d ? 1 : a.e - b.e || a.n - b.n))
    .map(o => o.x);
}

const swebOpen = new Set(); // Sehenswürdigkeiten, bei denen „+ Website“ angetippt wurde
/* ---------- Bearbeiten (eine Ereignis-Delegation auf #tripView) ---------- */
function afterEdit() {
  touch();
  renderTrip();
}
// Eingabefeld statt des Werts; Cursor ans Ende (nichts markieren – Sebastian will ergänzen, nicht überschreiben).
// Gibt es einen gefundenen Wert und ist ein eigener eingetragen: darunter „gefunden: … übernehmen“
function openEditor(el) {
  if (el.classList.contains('editing')) return;
  const [scope, id, f] = el.dataset.ed.split('|'),
    F = FIELD[f] || {};
  const own = ownVal(scope, id, f),
    found = foundVal(scope, id, f),
    raw = own || found;
  const inp = document.createElement(F.multi ? 'textarea' : 'input');
  inp.className = 'edin';
  inp.value = raw;
  inp.placeholder = F.ph || F.l || '';
  inp.setAttribute('aria-label', F.l || f);
  if (F.multi) inp.rows = Math.min(6, Math.max(2, raw.split('\n').length + 1));
  const keep = el.innerHTML;
  el.innerHTML = '';
  el.classList.add('editing');
  el.appendChild(inp);
  let done = false;
  if (own && found && own !== found) {
    const fb = document.createElement('div');
    fb.className = 'edfound';
    fb.innerHTML = `gefunden: ${esc(found)} <button type="button" class="linkbtn" data-usefound>übernehmen</button>`;
    el.appendChild(fb);
    const b = fb.querySelector('button');
    b.addEventListener('mousedown', ev => ev.preventDefault()); // Feld nicht verlassen (sonst würde erst gespeichert)
    b.addEventListener('click', ev => {
      ev.stopPropagation();
      if (done) return;
      done = true;
      setOwn(scope, id, f, '');
      afterEdit();
    });
  }
  inp.focus();
  try {
    inp.setSelectionRange(inp.value.length, inp.value.length);
  } catch (e) {}
  if (F.multi) inp.scrollTop = inp.scrollHeight;
  const commit = save => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    // abgebrochen oder unverändert übernommen → kein eigener Wert (bleibt „gefunden“)
    if (!save || (v === raw && !own)) {
      el.classList.remove('editing');
      el.innerHTML = keep;
      return;
    }
    setOwn(scope, id, f, v && v === found && f !== 'note' ? '' : v);
    afterEdit();
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      commit(false);
    } else if (e.key === 'Enter' && (!F.multi || !e.shiftKey)) {
      e.preventDefault();
      commit(true);
    }
  });
  inp.addEventListener('blur', () => commit(true));
}
// Gruppe einer Zeile (für Karte → Tabelle): sub = Zeile liegt im aufklappbaren Teil
function rowGroup(row) {
  if (row === 'start') return { g: -1 };
  if (row === 'end') return { g: state.stages.length - 1 };
  if (row[0] === 'c') return { g: +row.slice(1) };
  if (row[0] === 's') {
    const k = row.slice(1);
    for (let i = 0; i < state.stages.length; i++) {
      if ((state.stages[i].to.sights || []).some(x => sightKey(sightSrc(x) || x) === k)) return { g: i, sub: true };
      if (visitsOf(state.stages[i]).some(v => sightKey(v) === k)) return { g: i - 1, sub: true };
    }
  }
  return null;
}
// Karte → Tabelle: Gruppe aufklappen, zur Zeile scrollen, Zeile kurz hervorheben
function focusRow(row) {
  if (uiTab !== 'trip' && !window.__allTabs) return;
  const r = rowGroup(row);
  if (!r) return;
  const k = r.g === -1 ? -3 : r.g;
  if (r.sub && !tlOpen.has(k)) {
    tlOpen.add(k);
    saveGrp();
    if (r.g >= 0) openedGroup(r.g);
    renderTrip();
  }
  if (isMobile() && (sheetHidden() || curSheet() === 'min')) setSheet('half');
  setTimeout(() => {
    const el = document.querySelector(`#tripView tr[data-row="${CSS.escape(row)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('rowflash');
    void el.offsetWidth;
    el.classList.add('rowflash');
    setTimeout(() => el.classList.remove('rowflash'), 2600);
  }, 30);
}
// Tabelle → Karte: Karte schwenkt zum Punkt der Zeile und hebt ihn kurz hervor (ohne Info-Fenster)
function rowPoint(row) {
  if (row === 'start') return state.start;
  if (row === 'end') return state.stages[state.stages.length - 1]?.to;
  if (row[0] === 'c') return state.stages[+row.slice(1)]?.to;
  if (row[0] === 's') {
    const x = findSightByKey(row.slice(1));
    return x && x.lat != null ? x : null;
  }
  return null;
}
let rowMark = null;
function showRowOnMap(row) {
  const p = rowPoint(row);
  if (!p || p.lat == null) return;
  if (rowMark) rowMark.remove();
  rowMark = L.circleMarker([+p.lat, +p.lon], { radius: 22, color: COL.brand, weight: 5, fill: false, interactive: false, className: 'rowmark' }).addTo(map);
  map.setView([+p.lat, +p.lon], Math.max(map.getZoom(), 10), { animate: true });
  const m = rowMark;
  setTimeout(() => {
    m.remove();
    if (rowMark === m) rowMark = null;
  }, 2600);
}
$('#tripView').addEventListener('click', e => {
  if (e.target.closest('.edin, .edfound')) return; // Klick im offenen Eingabefeld: nur Cursor setzen
  const b = e.target.closest('[data-ed]');
  if (b && !e.target.closest('a')) {
    e.preventDefault();
    openEditor(b);
    return;
  }
  // Klick in die freie Fläche einer Notiz-Zelle → bearbeiten
  const cell = e.target.closest('td');
  if (cell && e.target === cell) {
    const f = cell.querySelector('[data-ed].fill');
    if (f) {
      openEditor(f);
      return;
    }
  }
  const wo = e.target.closest('[data-swebopen]');
  if (wo) {
    swebOpen.add(wo.dataset.swebopen);
    renderTrip();
    setTimeout(() => document.querySelector(`#tripView form[data-sweb="${CSS.escape(wo.dataset.swebopen)}"] input`)?.focus(), 0);
    return;
  }
  const g = e.target.closest('[data-grp]');
  if (g) {
    const i = +g.dataset.grp,
      k = i === -1 ? -3 : i;
    if (tlOpen.has(k)) tlOpen.delete(k);
    else {
      tlOpen.add(k);
      if (i === -1) {
        if (state.stages[0]) visitsOf(state.stages[0]).forEach(x => Promise.all([enrichSight(x), loadGSight(x)]).then(r => r.some(Boolean) && renderTrip()));
      } else openedGroup(i);
    }
    saveGrp();
    renderTrip();
    return;
  }
  const tr = e.target.closest('tr[data-row]');
  if (tr && !e.target.closest('a, button, input, select, textarea, label, form, details, [data-ed]')) showRowOnMap(tr.dataset.row);
});
$('#tripView').addEventListener('keydown', e => {
  const b = e.target.closest('span[data-ed]');
  if (b && !b.classList.contains('editing') && e.target === b && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openEditor(b);
  }
});
$('#tripView').addEventListener('change', e => {
  const sel = e.target.closest('[data-sel]');
  if (!sel) return;
  const [scope, id, f] = sel.dataset.sel.split('|');
  setOwn(scope, id, f, sel.type === 'checkbox' ? (sel.checked ? '1' : '') : sel.value);
  afterEdit();
});
// Spaltenbreite ziehen: Grenze zwischen Spalte k und k+1, Summe bleibt 100 %
$('#tripView').addEventListener('pointerdown', e => {
  const h = e.target.closest('[data-colrs]');
  if (!h) return;
  e.preventDefault();
  const tab = h.closest('table'),
    cols = [...tab.querySelectorAll('col')],
    k = +h.dataset.colrs,
    W = tab.getBoundingClientRect().width;
  const px = [...tab.querySelectorAll('thead th')].map(t => t.getBoundingClientRect().width);
  const x0 = e.clientX,
    a0 = px[k],
    b0 = px[k + 1],
    MIN = 48;
  try {
    h.setPointerCapture(e.pointerId);
  } catch (er) {}
  tab.classList.add('resizing');
  const move = ev => {
    const d = Math.max(MIN - a0, Math.min(b0 - MIN, ev.clientX - x0));
    px[k] = a0 + d;
    px[k + 1] = b0 - d;
    cols.forEach((c, j) => (c.style.width = ((px[j] / W) * 100).toFixed(2) + '%'));
  };
  const up = () => {
    h.removeEventListener('pointermove', move);
    h.removeEventListener('pointerup', up);
    h.removeEventListener('pointercancel', up);
    tab.classList.remove('resizing');
    try {
      localStorage.setItem('gp.ui.cols', JSON.stringify(px.map(p => +((p / W) * 100).toFixed(2))));
    } catch (er) {}
  };
  h.addEventListener('pointermove', move);
  h.addEventListener('pointerup', up);
  h.addEventListener('pointercancel', up);
});
$('#tripView').addEventListener('dblclick', e => {
  if (!e.target.closest('[data-colrs]')) return;
  try {
    localStorage.removeItem('gp.ui.cols');
  } catch (er) {}
  renderTrip();
});
// beim Aufklappen einer Gruppe: Adresse, Google-Daten und Infos der Sehenswürdigkeiten nachladen
function openedGroup(i) {
  const s = state.stages[i];
  if (!s) return;
  ensureOneAddr(i);
  if (settings.gkey && s.to.kind === 'camp') {
    loadRatings([s.to]);
    loadGName(s.to).then(f => f && renderPanel());
  }
  const xs = [...(s.to.sights || []), ...(state.stages[i + 1] ? visitsOf(state.stages[i + 1]) : [])];
  xs.forEach(x =>
    Promise.all([enrichSight(x), loadGSight(x)]).then(r => {
      if (r.some(Boolean) && (uiTab === 'trip' || window.__allTabs)) renderTrip();
    })
  );
}
