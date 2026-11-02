/* Reiseplaner – Reiseplan als Tabelle (Reiter 3): 7 Spalten wie in Sebastians Reise-PDF, je Aufenthalt eine Gruppe
   (Platz, darunter seine Sehenswürdigkeiten und die Besuche auf der Weiterfahrt). Alles in der Zelle bearbeitbar:
   eigene Werte gewinnen und sind als „von dir“ markiert, ↺ holt den gefundenen Wert zurück.
   Eigene Angaben: Platz → `stage.my` {cid, name, addr, hours, arr, dep, ppn, total, paid, status, nr, pitch, phone}
   (gilt nur, solange der Platz derselbe ist: `cid`), Notiz weiter in `stage.memo.text`; Sehenswürdigkeit → `my` am
   Ziel-Eintrag (`sightSrc`) {day, name, addr, hours, amount, status, nr, note}. Handy: dieselben Zellen als Karten.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
const PT_COLS = ['Datum', 'Name', 'Adresse', 'Zeiten', 'Preis / Status', 'Notiz / Buchung', 'Weiter / Entfernung'];
const ST_CAMP = [
  ['open', 'offen'],
  ['booked', 'gebucht'],
  ['partial', 'angezahlt'],
  ['paid', 'bezahlt'],
  ['onsite', 'vor Ort zahlen']
];
const ST_SIGHT = [
  ['open', 'offen'],
  ['bought', 'Tickets gekauft'],
  ['onsite', 'vor Ort zahlen'],
  ['free', 'kein Ticket nötig']
];
const stLabel = (list, k) => (list.find(x => x[0] === k) || list[0])[1];

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
  ort: { l: 'Ort', ph: '+ Ort' },
  dur: { l: 'Dauer der Überfahrt', ph: '+ Dauer, z. B. ca. 9 Std.' },
  addr: { l: 'Adresse' },
  hours: { l: 'Zeiten', multi: true },
  arr: { l: 'Ankunft', ph: 'Ankunft, z. B. 20:00' },
  dep: { l: 'Abfahrt', ph: 'Abfahrt, z. B. 11:00' },
  ppn: { l: 'Preis pro Nacht', ph: 'Preis/Nacht, z. B. 440 SEK' },
  total: { l: 'Gesamtpreis', ph: 'z. B. 326,61 €' },
  paid: { l: 'bezahlt', ph: 'Betrag' },
  note: { l: 'Notiz', multi: true, ph: '+ Notiz' },
  nr: { l: 'Buchungsnr.', ph: '+ Buchungsnr.' },
  pitch: { l: 'Stellplatz', ph: '+ Stellplatz' },
  phone: { l: 'Telefon', ph: '+ Telefon' },
  amount: { l: 'Betrag', ph: 'z. B. 140 € oder 4 × 35 €' },
  price: { l: 'Preis', ph: 'Preis, z. B. 1.250 SEK' },
  text: { l: 'Aufgabe', ph: 'Aufgabe, z. B. Vignette kaufen' }
};
const edKey = (scope, id, f) => esc(`${scope}|${id}|${f}`);
const rsBtn = k =>
  `<button class="rs" type="button" data-rs="${k}" title="gefundenen Wert wiederherstellen" aria-label="gefundenen Wert wiederherstellen">↺</button>`;
// bearbeitbarer Wert: Antippen → Eingabefeld. link = Wert ist ein Link (Name, Adresse) → eigener ✎-Knopf
function ed(scope, id, f, html, opt = {}) {
  const k = edKey(scope, id, f),
    own = !!opt.own,
    F = FIELD[f] || {};
  const mark = own && opt.found !== false ? ' <span class="ownt" title="von dir eingetragen">von dir</span>' + rsBtn(k) : '';
  if (opt.link)
    return `${html}<button class="edb" type="button" data-ed="${k}" title="${esc(F.l || '')} bearbeiten" aria-label="${esc(F.l || '')} bearbeiten">✎</button>${mark}`;
  return `<span class="ed${own ? ' own' : ''}" data-ed="${k}" role="button" tabindex="0" title="antippen zum Bearbeiten">${html || `<span class="ph">${esc(opt.ph || F.ph || '+ ' + (F.l || ''))}</span>`}</span>${mark}`;
}
// Zeilen mit offenem Punkt (noch nicht gebucht, offener Betrag, Tickets fehlen …): Status wie der Chip hinterlegt
let openRows = new Set();
const selHtml = (scope, id, f, list, cur, label) =>
  `<select class="stsel st-${esc(cur)}${openRows.has(scope + id) ? ' isopen' : ''}" data-sel="${edKey(scope, id, f)}" aria-label="${esc(label)}">${list.map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const td = (l, h, cls) => `<td data-l="${esc(l)}"${cls ? ` class="${cls}"` : ''}>${h}</td>`;
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
function caret(i, open) {
  return `<button class="grptog" type="button" data-grp="${i}" aria-expanded="${open}" aria-label="${open ? 'zuklappen' : 'aufklappen'}" title="${open ? 'zuklappen' : 'aufklappen'}">${open ? '▾' : '▸'}</button>`;
}
function startRows(ds, open) {
  const vs = state.stages[0] ? visitsOf(state.stages[0]) : [];
  let h = `<tr class="pt">${td('Datum', ds ? fdate(ds[0]) : '')}${td('Name', `${caret(-1, open)}<b>Start: ${esc(shortLabel(state.start.label))}</b>`)}${td('Adresse', esc(cleanLabel(state.start.label)))}${td('Zeiten', '')}${td('Preis / Status', '')}${td('Notiz / Buchung', '')}${td('Weiter / Entfernung', driveHtml(0))}</tr>`;
  if (open) vs.forEach(v => (h += visitRowHtml(v)));
  return h + groupExtrasHtml(-1, ds, open);
}
function campRowHtml(i, open, ds, cur) {
  const s = state.stages[i],
    c = s.to,
    camp = c.kind === 'camp',
    m = campMy(s),
    last = i === state.stages.length - 1,
    n = nightsOf(s),
    sg = stopSights(c),
    vsNext = state.stages[i + 1] ? visitsOf(state.stages[i + 1]) : [];
  const own = f => !!m[f];
  // Datum
  let dat = ds ? `<b>${fdate(ds[i])}${!last || camp ? ` – ${fdate(addDays(ds[i], n))}` : ''}</b>` : `Etappe ${i + 1}`;
  dat += `<div class="muted">${n} ${n === 1 ? 'Nacht' : 'Nächte'}</div>`;
  if (camp) dat += `<div class="ort">${ed('c', i, 'ort', esc(stayTown(i)), { own: !!m.ort, ph: '+ Ort' })}</div>`;
  if (open)
    dat += `<div class="nstep" title="Nächte"><button type="button" data-tlnight="${i}" data-d="-1" aria-label="eine Nacht weniger" ${n <= 1 ? 'disabled' : ''}>−</button><b>${n}</b><button type="button" data-tlnight="${i}" data-d="1" aria-label="eine Nacht mehr">+</button></div>`;
  // Name (Link = Google-Eintrag)
  const nm = own('name') ? esc(m.name) : camp ? nameHtml(c) : esc(c.label);
  let name = `${caret(i, open)}<span class="pname">${ed('c', i, 'name', `<a href="${esc(gEntryUrl(c))}" target="_blank" rel="noopener">${nm}</a>`, { link: true, own: own('name') })}</span>`;
  if (i === cur) name += ' <span class="badge best">heute/nächste</span>';
  if (!open && sg.length + vsNext.length) name += ` <span class="cnt" title="Sehenswürdigkeiten">★ ${sg.length + vsNext.length}</span>`;
  if (open && camp) {
    const w = campWeb(c),
      g = settings.gkey && gRate.has(c.id) ? rateHtml(c) : '';
    name += line([w && linkA(safeUrl(w), hostOf(w)), linkA(p4nUrl(c), 'park4night')].filter(Boolean).join(' · ') + g);
    name += `<div class="x sbtns"><button class="btn small" type="button" data-share="${i}">Teilen</button> <button class="btn small" type="button" data-tledit="${i}">Platz ändern</button></div>`;
  }
  // Adresse (Link = Navigation)
  const addr = own('addr') ? m.addr : campAddrFound(c);
  let ad = ed('c', i, 'addr', `<a href="${esc(navUrl(c))}" target="_blank" rel="noopener">${esc(addr || (camp ? 'Navigation' : cleanLabel(c.label)))}</a>`, {
    link: true,
    own: own('addr')
  });
  if (open) ad += line(coordHtml(c).replace(/<a class="btn small"[^]*$/, ''));
  // Zeiten
  const hf = campHoursFound(c),
    gR = gRate.get(c.id);
  let zt = ed('c', i, 'hours', esc(own('hours') ? m.hours : hf || (camp ? 'Rezeption –' : '')), { own: own('hours'), ph: 'Zeiten' });
  if (open) {
    if (!own('hours') && !hf && gR?.oh?.length) zt += gHoursHtml(gR.oh, gR.open);
    const r = camp ? rzFor(c) : null;
    if (!own('hours') && r?.url) zt += line(`<a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">Quelle</a>`);
    zt += line(`Ankunft ${ed('c', i, 'arr', esc(m.arr || ''), { ph: '–' })}`) + line(`Abfahrt ${ed('c', i, 'dep', esc(m.dep || ''), { ph: '–' })}`);
  }
  // Preis / Status
  let pr = '';
  if (camp) {
    const mo = campMoney(s),
      p = mo.p;
    const ppn = p ? (p.own ? moneyHtml(p.text, c) : euroText(p, c) || esc(p.text)) : '';
    // eingeklappt: Preis/Nacht und Status ebenfalls direkt bearbeitbar
    if (!open)
      pr = `<div>${ed('c', i, 'ppn', ppn ? ppn + ' <span class="muted">/ Nacht</span>' : '', { own: own('ppn'), ph: 'Preis –' })}</div><div>${selHtml('c', i, 'status', ST_CAMP, mo.st, 'Bezahlstatus')}</div>`;
    else {
      const srcN = { web: 'Website', osm: 'OSM', google: 'Google' }[p?.src];
      pr = `<div>${ed('c', i, 'ppn', ppn ? ppn + ' <span class="muted">/ Nacht</span>' : '', { own: own('ppn'), ph: 'Preis –' })}${!p?.own && p ? `<span class="muted">${powerHtml(p, c)} · ${p.url ? `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${srcN}</a>` : srcN}</span>` : ''}</div>
        <div>gesamt ${ed('c', i, 'total', mo.total != null ? (own('total') ? moneyHtml(m.total, c) : fEurA(mo.total, mo.approx) + ` <span class="muted">(${mo.n} ${mo.n === 1 ? 'Nacht' : 'Nächte'})</span>`) : '', { own: own('total'), ph: '–' })}</div>
        <div>${selHtml('c', i, 'status', ST_CAMP, mo.st, 'Bezahlstatus')}</div>
        <div>bezahlt ${ed('c', i, 'paid', m.paid ? moneyHtml(m.paid, c) : mo.st === 'paid' && mo.total != null ? fEurA(mo.total, mo.approx) : '', { ph: '–' })}${mo.open ? ` · <span class="openamt">offen ${fEurA(mo.open, mo.approxPaid)}</span>` : ''}</div>`;
    }
  }
  // Notiz / Buchung
  let nt = ed('c', i, 'note', esc(s.memo?.text || ''), {});
  if (!open && m.nr) nt += `<div class="muted">Nr. ${esc(m.nr)}</div>`;
  if (open && camp) {
    const ph = own('phone') ? m.phone : phoneOf(c);
    nt += line(`Buchungsnr. ${ed('c', i, 'nr', esc(m.nr || ''), { ph: '–' })}`) + line(`Stellplatz ${ed('c', i, 'pitch', esc(m.pitch || ''), { ph: '–' })}`);
    nt += line(
      'Telefon ' +
        (ph
          ? ed('c', i, 'phone', `<a href="tel:${esc(String(ph).replace(/[^+\d]/g, ''))}">${esc(ph)}</a>`, { link: true, own: own('phone') })
          : ed('c', i, 'phone', '', { ph: '–' }))
    );
  }
  const cls = `camp${i === cur ? ' cur' : ''}`;
  return `<tr class="${cls}" data-row="c${i}">${td('Datum', dat)}${td('Name', name, 'nm')}${td('Adresse', ad)}${td('Zeiten', zt)}${td('Preis / Status', pr)}${td('Notiz / Buchung', nt)}${td('Weiter / Entfernung', last ? '<span class="muted">–</span>' : driveHtml(i + 1))}</tr>`;
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
  const day = `<input type="date" class="dayin" data-sel="${edKey('s', k, 'day')}" value="${esc(m.day || '')}" aria-label="Besuchstag" title="Besuchstag (freiwillig)">`;
  const nm = own('name') ? m.name : shortLabel(s.label);
  let name = `<span class="pname">★ ${ed('s', k, 'name', `<a href="${esc(sightGUrl(s))}" target="_blank" rel="noopener">${esc(nm)}</a>`, { link: true, own: own('name') })}</span>`;
  const w = inf.web;
  if (w)
    name += line(
      linkA(safeUrl(w), hostOf(w)) +
        (g && g.r != null
          ? ` · <a class="stars" href="${esc(g.uri)}" target="_blank" rel="noopener">★ ${g.r.toLocaleString('de-DE', { minimumFractionDigits: 1 })} <span>(${g.n.toLocaleString('de-DE')})</span></a>`
          : '')
    );
  else if ((s.info || g) && !inf.town && !swebOpen.has(k))
    name += line(`<button class="linkbtn swebadd" type="button" data-swebopen="${esc(k)}">+ Website</button>`);
  else if ((s.info || g) && !inf.town)
    name += `<form class="sweb x" data-sweb="${esc(k)}"><input name="w" type="text" inputmode="url" autocomplete="url" placeholder="Website eintragen" aria-label="Website der Sehenswürdigkeit" value="${g && g.web ? esc(g.web) : ''}"><button class="btn small" type="submit">Merken</button></form>`;
  if (!s.info && sightBusy.has(k)) name += line('<span class="muted">Infos werden geladen …</span>');
  const addr = own('addr') ? m.addr : g?.addr || inf.addr || cleanLabel(s.label);
  const ad = ed('s', k, 'addr', `<a href="${esc(dir)}" target="_blank" rel="noopener">${esc(addr)}</a>`, { link: true, own: own('addr') });
  let zt = '',
    pr = '';
  if (!inf.town) {
    const hf = sightHoursFound(s),
      r = sightRz(s);
    zt = ed('s', k, 'hours', own('hours') ? esc(m.hours) : hf ? `${hf.pre ? hf.pre + ': ' : ''}${esc(hf.t)}` : '', {
      own: own('hours'),
      ph: 'Öffnungszeiten –'
    });
    if (!own('hours') && hf)
      zt += ` <span class="muted">(${hf.url ? `<a href="${esc(safeUrl(hf.url))}" target="_blank" rel="noopener">${hf.src}</a>` : hf.src})</span>`;
    if (!own('hours') && hf && hf.src === 'Google' && r && r.hoursS && r.hoursS.text)
      zt += line(`Website: ${esc(r.hoursS.text)}${r.hoursS.url ? ' · ' + linkA(safeUrl(r.hoursS.url), 'Quelle') : ''}`);
    if (g && g.oh && g.oh.length) zt += gHoursHtml(g.oh, g.open);
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
        ? `<div>${ageP}${mo.src ? ` <span class="muted">(${mo.src})</span>` : ''}</div>`
        : r && r.priceUrl
          ? line(linkA(safeUrl(r.priceUrl), 'Preise auf der Website'))
          : '') +
      `<div>${ed('s', k, 'amount', own('amount') ? moneyHtml(m.amount, s, inf.web) : mo.est != null ? `≈ ${fEur(mo.est)} <span class="muted">für ${persons(mo.ad, mo.ki)}</span>` : '', { own: own('amount'), ph: 'Preise –' })}</div>
      <div>${selHtml('s', k, 'status', ST_SIGHT, mo.st, 'Ticket-Status')}</div>`;
  }
  const nt = ed('s', k, 'note', esc(m.note || ''), {}) + line(`Ticketnr. ${ed('s', k, 'nr', esc(m.nr || ''), { ph: '–' })}`);
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
  return `<tr class="pt">${td('Datum', ds ? fdate(ds[i]) : '')}${td('Name', `<b>${home ? 'Zurück in' : 'Ziel:'} ${esc(shortLabel(s.to.label))}</b>`)}${td('Adresse', `<a href="${esc(navUrl(s.to))}" target="_blank" rel="noopener">${esc(cleanLabel(s.to.label))}</a>`)}${td('Zeiten', '')}${td('Preis / Status', '')}${td('Notiz / Buchung', '')}${td('Weiter / Entfernung', '<span class="muted">–</span>')}</tr>`;
}
const grpOpen = (i, cur) => tlOpen.has(i) || (i === cur && !tlOpen.has(-1));
function planTableHtml() {
  const ds = stageDates(),
    cur = currentStage(),
    st = state.stages,
    last = st.length - 1;
  openRows = new Set(tripMoney().items.map(x => x.row));
  let h = `<table class="ptab"><colgroup><col class="c-dat"><col class="c-nm"><col class="c-ad"><col class="c-zt"><col class="c-pr"><col class="c-nt"><col class="c-wt"></colgroup>
    <thead><tr>${PT_COLS.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
  const o0 = tlOpen.has(-3);
  h += `<tbody class="grp start${o0 ? ' open' : ''}" data-grpb="-1">${startRows(ds, o0)}</tbody>`;
  st.forEach((s, i) => {
    if (i === last && s.to.kind !== 'camp') {
      h += `<tbody class="grp">${endRowHtml(i, ds)}${groupExtrasHtml(i, ds, false)}</tbody>`;
      return;
    }
    const open = grpOpen(i, cur);
    let b = campRowHtml(i, open, ds, cur);
    if (open) {
      if (s.to.sights && s.to.sights.length) sortSights(s.to.sights).forEach(x => (b += sightRowHtml(x, s.to)));
      if (st[i + 1]) visitsOf(st[i + 1]).forEach(v => (b += visitRowHtml(v)));
    }
    b += groupExtrasHtml(i, ds, open);
    h += `<tbody class="grp${open ? ' open' : ''}" data-grpb="${i}">${b}</tbody>`;
  });
  return h + '</table>' + costsHtml();
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
function openEditor(btn) {
  const [scope, id, f] = btn.dataset.ed.split('|'),
    F = FIELD[f] || {};
  const raw = ownVal(scope, id, f) || foundVal(scope, id, f);
  const inp = document.createElement(F.multi ? 'textarea' : 'input');
  inp.className = 'edin';
  inp.value = raw;
  inp.placeholder = F.ph ? F.ph.replace(/^\+\s*/, '') : F.l || '';
  inp.setAttribute('aria-label', F.l || f);
  if (F.multi) inp.rows = Math.min(6, Math.max(2, raw.split('\n').length + 1));
  const host = btn.classList.contains('edb') ? btn.parentElement : btn;
  const keep = host.innerHTML;
  host.innerHTML = '';
  host.appendChild(inp);
  inp.focus();
  inp.select?.();
  let done = false;
  const commit = save => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    if (!save) {
      host.innerHTML = keep;
      return;
    }
    const found = foundVal(scope, id, f);
    // unverändert übernommen → kein eigener Wert (bleibt „gefunden“)
    if (v === raw && !ownVal(scope, id, f)) {
      host.innerHTML = keep;
      return;
    }
    setOwn(scope, id, f, v && v === found && f !== 'note' && f !== 'nr' && f !== 'pitch' ? '' : v);
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
$('#tripView').addEventListener('click', e => {
  const b = e.target.closest('[data-ed]');
  if (b && !e.target.closest('a')) {
    e.preventDefault();
    openEditor(b);
    return;
  }
  const wo = e.target.closest('[data-swebopen]');
  if (wo) {
    swebOpen.add(wo.dataset.swebopen);
    renderTrip();
    setTimeout(() => document.querySelector(`#tripView form[data-sweb="${CSS.escape(wo.dataset.swebopen)}"] input`)?.focus(), 0);
    return;
  }
  const r = e.target.closest('[data-rs]');
  if (r) {
    const [scope, id, f] = r.dataset.rs.split('|');
    setOwn(scope, id, f, '');
    afterEdit();
    return;
  }
  const g = e.target.closest('[data-grp]');
  if (g) {
    const i = +g.dataset.grp;
    tlOpen.add(-1);
    if (i === -1) {
      if (tlOpen.has(-3)) tlOpen.delete(-3);
      else {
        tlOpen.add(-3);
        if (state.stages[0]) visitsOf(state.stages[0]).forEach(x => Promise.all([enrichSight(x), loadGSight(x)]).then(r => r.some(Boolean) && renderTrip()));
      }
    } else if (tlOpen.has(i) || (i === currentStage() && !tlOpen.has(-1))) tlOpen.delete(i);
    else {
      tlOpen.add(i);
      openedGroup(i);
    }
    renderTrip();
  }
});
$('#tripView').addEventListener('keydown', e => {
  const b = e.target.closest('span[data-ed]');
  if (b && (e.key === 'Enter' || e.key === ' ')) {
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
