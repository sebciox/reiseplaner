/* Reiseplaner – Ausstattung, Reisedatum/Reiseende, Links, Adressen.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
/* Ausstattung aus OSM-Tags (oft lückenhaft – gefiltert wird nur auf ausdrückliche Angaben) */
const AMEN = [
  { k: 'power', i: '🔌', t: 'Strom', f: t => !!t.power_supply && t.power_supply !== 'no' },
  { k: 'wifi', i: '📶', t: 'WLAN', f: t => !!t.internet_access && t.internet_access !== 'no' },
  { k: 'shower', i: '🚿', t: 'Duschen', f: t => !!t.shower && t.shower !== 'no' },
  { k: 'pool', i: '🏊', t: 'Pool', f: t => !!t.swimming_pool && t.swimming_pool !== 'no' }
];
const amenList = c => AMEN.filter(a => a.f(c.tags || {}));
function amenHtml() {
  return '';
} // Ausstattung wird bewusst nicht mehr angezeigt (Strom/Duschen/WLAN setzt Sebastian voraus)
const FILTERS = [
  { k: 'caravan', l: 'Wohnwagen ✓', f: c => isOk(c) },
  { k: 'power', l: '🔌 Strom', f: c => AMEN[0].f(c.tags || {}) }
];
const passFilter = () => true; // Filter „Wohnwagen ✓ / Strom“ entfernt (caravans=no wird weiterhin beim Laden aussortiert)
function chipsHtml() {
  return '';
}
/* Datum je Etappe: Abfahrt + Nächte an den Zwischenstopps (Standard 1) */
function stageDates() {
  if (!state.date || !state.stages.length) return null;
  const d0 = new Date(state.date + 'T12:00:00');
  if (isNaN(d0)) return null;
  let off = 0;
  return state.stages.map(s => {
    const d = new Date(d0);
    d.setDate(d.getDate() + off);
    off += Math.max(1, +s.nights || 1);
    return d;
  });
}
const fdate = d => (d ? d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' }) : '');
/* Voraussichtliches Reiseende (Tag der letzten Ankunft): geplante Etappen + Nächte, noch offene Etappen geschätzt
   (Transit-Stopp 1 Nacht, Zwischenziel mit seinen Nächten). nOverride: Etappenzahl für die Abfrage „Wie viele?“ */
function tripEnd(nOverride) {
  if (!state.date) return null;
  const d0 = new Date(state.date + 'T12:00:00');
  if (isNaN(d0)) return null;
  const st = state.stages,
    nts = s => Math.max(1, +s.nights || 1);
  let off = 0;
  if (state.done) {
    if (!st.length) return null;
    st.forEach((s, i) => {
      if (i < st.length - 1) off += nts(s);
    });
  } else {
    st.forEach(s => {
      off += nts(s);
    }); // → Abfahrtstag der nächsten offenen Etappe
    const rem = [];
    if (state.segs)
      state.segs.forEach((g, k) => {
        const r = g.n - segDone(k);
        if (r > 0) rem.push({ r, stop: k < state.segs.length - 1 ? (g.kind === 'sight' ? g.nights : 1) : 0 });
      });
    else {
      const n = nOverride || state.n || (state.overview ? plan(state.overview.dist).n : 0);
      if (n - st.length > 0) rem.push({ r: n - st.length, stop: 0 });
    }
    if (!rem.length) return null;
    rem.forEach(x => {
      off += x.r - 1 + x.stop;
    }); // Transit-Stopps 1 Nacht, Zwischenziel mit seinen Nächten
  }
  const e = new Date(d0);
  e.setDate(e.getDate() + off);
  return e;
}
const dayDiff = (a, b) => Math.round((a - b) / 864e5);
function tripHtml(nOverride) {
  const e = tripEnd(nOverride);
  if (!e) return state.stages.length || state.overview ? '<div class="trip muted">Abfahrtsdatum oben eintragen → Datum je Etappe und Reiseende.</div>' : '';
  const d0 = new Date(state.date + 'T12:00:00'),
    days = dayDiff(e, d0) + 1,
    est = !state.done ? ' (geschätzt)' : '';
  let h = `Reise: ${fdate(d0)} – ${fdate(e)}${est} · ${days} ${days === 1 ? 'Tag' : 'Tage'}`;
  if (state.ret) {
    const r = new Date(state.ret + 'T12:00:00'),
      over = dayDiff(e, r);
    if (over > 0)
      return `<div class="trip warn"><b>⚠ ${over} ${over === 1 ? 'Tag' : 'Tage'} zu lang:</b> ${h} – ${state.round ? 'zurück' : 'Ankunft'} spätestens ${fdate(r)} – weniger Nächte/freie Tage, weniger Zwischenziele oder längere Etappen einplanen.</div>`;
    h += ` · ${-over === 0 ? 'genau passend' : `${-over} ${-over === 1 ? 'Tag' : 'Tage'} Puffer`} bis ${fdate(r)}`;
  }
  return `<div class="trip">${h}</div>`;
}
// Reisezeile oben als Kurzinfo (Chips); antippen klappt den vollständigen Text (tripHtml) auf
let tripOpen = false;
function tripChips() {
  if (!state.stages.length && !state.overview) return '';
  const e = tripEnd(),
    dm = d => `${d.getDate()}.${d.getMonth() + 1}.`;
  if (!e)
    return `<div class="tripline"><button type="button" class="tripchips" data-tripdate><span class="chip">📅 Abfahrtsdatum eintragen</span></button>${saveChipHtml()}</div><div class="tripdet" hidden>${tripHtml()}</div>`;
  const d0 = new Date(state.date + 'T12:00:00'),
    days = dayDiff(e, d0) + 1;
  let st = '';
  if (state.ret) {
    const over = dayDiff(e, new Date(state.ret + 'T12:00:00'));
    st =
      over > 0
        ? `<span class="chip bad">⚠ ${over} ${over === 1 ? 'Tag' : 'Tage'} zu lang</span>`
        : `<span class="chip good">✓ ${over === 0 ? 'passt genau' : `${-over} ${-over === 1 ? 'Tag' : 'Tage'} Puffer`}</span>`;
  }
  return `<div class="tripline"><button type="button" class="tripchips" data-tripx aria-expanded="${tripOpen}" title="${tripOpen ? 'Details ausblenden' : 'Details anzeigen'}">
    <span class="chip">📅 ${dm(d0)} – ${dm(e)}${!state.done ? ' <span class="est">geschätzt</span>' : ''}</span><span class="chip">${days} ${days === 1 ? 'Tag' : 'Tage'}</span>${st}<span class="caret">${tripOpen ? '▴' : '▾'}</span></button>${saveChipHtml()}</div>
    <div class="tripdet"${tripOpen ? '' : ' hidden'}>${tripHtml()}</div>`;
}
const dayKey = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
// Während der Tour: Index der nächsten anstehenden Etappe, sonst -1
function currentStage() {
  const ds = stageDates();
  if (!ds) return -1;
  const today = dayKey(new Date());
  if (today < dayKey(ds[0]) || today > dayKey(ds[ds.length - 1])) return -1;
  return ds.findIndex(d => dayKey(d) >= today);
}

/* Links */
const fhours = h => (+h || 2).toLocaleString('de-DE') + ' h';
// Parkplätze rund um einen Besuch unterwegs (Google-Maps-Suche; Gespann braucht lange Stellplätze)
const parkUrl = p => `https://www.google.com/maps/search/${encodeURIComponent('Parkplatz Wohnmobil Bus')}/@${p.lat.toFixed(5)},${p.lon.toFixed(5)},15z`;
const navUrl = p => `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(6)},${p.lon.toFixed(6)}&travelmode=driving`;
const mapsUrl = p => `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
// Google-Eintrag des Platzes (Bewertungen, Fotos, Öffnungszeiten): mit Google-Schlüssel der gefundene Eintrag,
// sonst Suche nach dem Namen rund um die Koordinate
function gEntryUrl(c) {
  const g = typeof gRate !== 'undefined' && gRate.get(c.id);
  if (g && g.uri) return g.uri;
  const name = c.tags?.name || (c.kind === 'camp' ? c.label : '');
  return name ? `https://www.google.com/maps/search/${encodeURIComponent(name)}/@${c.lat.toFixed(5)},${c.lon.toFixed(5)},15z` : mapsUrl(c);
}
const webOf = c => {
  const t = c.tags || {};
  return t.website || t['contact:website'] || t.url || null;
};
const phoneOf = c => {
  const t = c.tags || {};
  return t.phone || t['contact:phone'] || null;
};
const hostOf = u => {
  try {
    return new URL(safeUrl(u)).host.replace(/^www\./, '');
  } catch (e) {
    return shortUrl(u);
  }
};
// Website eines Platzes: Google (aktueller, nur wenn sicher derselbe Platz) vor OpenStreetMap – OSM-Links sind oft veraltet
function campWeb(c) {
  const g = typeof gRate !== 'undefined' && gRate.get(c.id);
  return (g && g.near && g.web) || webOf(c) || '';
}
// Website-Recherche: zuerst die OSM-Website (Schlüssel = Platz-id); war sie nicht erreichbar, die Google-Website (Schlüssel „cw:<URL>“)
function researchTarget(c) {
  const o = webOf(c),
    r = rzData[c.id],
    g = typeof gRate !== 'undefined' && gRate.get(c.id),
    gw = g && g.near ? g.web : '';
  if (o && !(r && r.website === o && r.status === 'error' && gw && normWeb(gw) !== normWeb(o))) return { key: c.id, web: o };
  if (gw) return { key: 'cw:' + gw, web: gw };
  return null;
}
function rzFor(c) {
  const t = researchTarget(c);
  if (!t) return null;
  const r = rzData[t.key];
  return r && (t.key !== c.id || r.website === t.web) ? r : null;
}
// Linkzeile wie in allen Info-Fenstern und Einträgen: Website · Google-Eintrag · park4night / Navigation
const linkA = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;
function campLinks(c) {
  const w = campWeb(c);
  return [w && linkA(safeUrl(w), hostOf(w)), linkA(gEntryUrl(c), 'Google-Eintrag'), linkA(p4nUrl(c), 'park4night'), linkA(navUrl(c), 'Navigation')]
    .filter(Boolean)
    .join(' · ');
}
function sightGUrl(s) {
  const g = gSight.get(sightKey(s));
  return (
    g?.uri ||
    `https://www.google.com/maps/search/${encodeURIComponent(shortLabel(s.label))}/@${(+s.lat).toFixed(5)},${(+s.lon).toFixed(5)},${s.info?.town ? 12 : 15}z`
  );
}
const sightWebOf = s => s.info?.web || gSight.get(sightKey(s))?.web || '';
function sightLinks(s, from) {
  const w = sightWebOf(s);
  const dir = from
    ? `https://www.google.com/maps/dir/?api=1&origin=${from.lat.toFixed(6)},${from.lon.toFixed(6)}&destination=${(+s.lat).toFixed(6)},${(+s.lon).toFixed(6)}&travelmode=driving`
    : navUrl(s);
  return [w && linkA(safeUrl(w), hostOf(w)), linkA(sightGUrl(s), 'Google-Eintrag'), linkA(dir, from ? 'Navigation vom Platz' : 'Navigation')]
    .filter(Boolean)
    .join(' · ');
}
const shortUrl = u =>
  String(u)
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/\/$/, '');

/* Adresse: aus OSM-Tags, sonst einmalig per ORS-Ortssuche (rückwärts) ermitteln und in der Tour speichern */
function addrFromTags(t = {}) {
  const st = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  const city = [t['addr:postcode'], t['addr:city'] || t['addr:place']].filter(Boolean).join(' ');
  return [st, city].filter(Boolean).join(', ') || null;
}
async function reverseAddr(p) {
  if (useFallback || !settings.key) {
    const q = await photonReverse(p);
    return q ? photonLabel(q) : null;
  }
  const url = `${ORS}/geocode/reverse?api_key=${encodeURIComponent(settings.key)}&point.lon=${p.lon}&point.lat=${p.lat}&size=1&lang=de`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Adresse: ' + r.status);
  const j = await r.json();
  return j.features?.[0]?.properties?.label || null;
}
async function ensureAddrs() {
  let changed = false;
  for (const s of state.stages) {
    const c = s.to;
    if (c.kind !== 'camp' || c.addr) continue;
    const a = addrFromTags(c.tags);
    if (a) {
      c.addr = a;
      changed = true;
      continue;
    }
    if (!settings.key) continue;
    try {
      const r = await reverseAddr(c);
      if (r) {
        c.addr = r;
        changed = true;
      }
    } catch (e) {
      console.warn(e);
    }
  }
  if (changed) touch();
  return changed;
}
