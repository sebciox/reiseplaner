/* Reiseplaner – Koordinaten, Fähre/Maut, Etappe teilen, automatisch sichern.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
/* ---------- Koordinaten ---------- */
const fcoord = p => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
const nearUrl = p => `https://www.google.com/maps/search/camping/@${p.lat.toFixed(5)},${p.lon.toFixed(5)},12z`;
const ICON_COPY =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/></svg>';
const ICON_OK =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
function coordHtml(p) {
  return `<span class="coordrow"><span class="coord">${fcoord(p)}</span><button class="icobtn" type="button" data-copy="${fcoord(p)}" title="Koordinaten kopieren" aria-label="Koordinaten kopieren">${ICON_COPY}</button></span>
    <a class="btn small" href="${nearUrl(p)}" target="_blank" rel="noopener">Camping in der Nähe</a>`;
}
async function copyText(t, btn) {
  try {
    await navigator.clipboard.writeText(t);
  } catch (e) {
    const a = document.createElement('textarea');
    a.value = t;
    document.body.appendChild(a);
    a.select();
    try {
      document.execCommand('copy');
    } catch (x) {}
    a.remove();
  }
  if (btn && btn.classList.contains('icobtn')) {
    btn.innerHTML = ICON_OK;
    btn.classList.add('done');
    setTimeout(() => {
      btn.innerHTML = ICON_COPY;
      btn.classList.remove('done');
    }, 1500);
  } else flash('Kopiert: ' + (t.length > 40 ? t.slice(0, 40) + '…' : t));
}

/* ---------- Länder, Tempo für Gespanne, Maut/Vignette, Fähre ---------- */
// Richtwerte für Pkw + Wohnwagen bis 3,5 t – ohne Gewähr, vor der Reise prüfen
const LAND = {
  DE: ['Deutschland', '80 km/h (100 mit Tempo-100-Zulassung)', 'keine Pkw-Maut'],
  NL: ['Niederlande', '80 außerorts, 90 Autobahn', 'keine Autobahnmaut (einzelne Tunnel)'],
  BE: ['Belgien', 'regional unterschiedlich – vorher prüfen', 'keine Pkw-Maut (Liefkenshoek-Tunnel mautpflichtig)'],
  LU: ['Luxemburg', 'vorher prüfen', 'keine Maut'],
  FR: [
    'Frankreich',
    'bis 3,5 t wie Pkw (80/90 Landstraße, 110 Schnellstraße, 130 Autobahn; bei Regen weniger)',
    'Autobahnen meist mautpflichtig (Gespann = Klasse 2)'
  ],
  ES: ['Spanien', '80 außerorts, 90 Autobahn', 'einzelne Autobahnen (AP) mautpflichtig'],
  PT: ['Portugal', '70–80 außerorts, 100 Autobahn', 'Autobahnen mautpflichtig (teils nur elektronisch)'],
  IT: ['Italien', '70 außerorts, 80 Autobahn', 'Autobahnen mautpflichtig'],
  AT: ['Österreich', '80 Landstraße, 100 Autobahn', 'Vignette für das Zugfahrzeug Pflicht'],
  CH: ['Schweiz', '80 überall', 'Vignette für Zugfahrzeug UND Anhänger Pflicht'],
  DK: ['Dänemark', '80 km/h', 'Storebælt-Brücke mautpflichtig'],
  SE: ['Schweden', '80 km/h (gebremster Anhänger)', 'Øresund-Brücke mautpflichtig; Staugebühr Stockholm/Göteborg'],
  NO: ['Norwegen', '80 km/h', 'viele elektronische Mautstationen (AutoPASS)'],
  PL: ['Polen', '70 außerorts, 80 Autobahn', 'Autobahnabschnitte mautpflichtig'],
  CZ: ['Tschechien', '80 km/h', 'E-Vignette Pflicht'],
  SI: ['Slowenien', '80 km/h', 'E-Vignette Pflicht'],
  HR: ['Kroatien', '80 außerorts, 90 Autobahn', 'Autobahnen mautpflichtig']
};
// Länder einer Etappe: Punkte alle ~60 km per Photon (ohne Schlüssel) zuordnen, Ergebnis in der Etappe speichern
async function stageCountries(s) {
  if (s.countries) return s.countries;
  const cum = cumul(s.line),
    L = cum[cum.length - 1],
    n = Math.min(14, Math.max(2, Math.ceil(L / 60000)));
  const codes = [];
  for (const o of sample(s.line, cum, 0, L, n)) {
    try {
      const q = await photonReverse({ lat: o.p[0], lon: o.p[1] });
      const cc = q?.countrycode?.toUpperCase();
      if (cc && codes[codes.length - 1] !== cc) codes.push(cc);
    } catch (e) {
      return null;
    }
  }
  s.countries = codes;
  return codes;
}
// Strecke: nur Fähre/Maut (Sebastian: keine Länder-Richtwerte – zu viel Text für den Platz)
function landHtml(s) {
  const ex = s.ex || {},
    parts = [];
  if (ex.ferry > 200) parts.push(`Fähre auf der Strecke (${fkm(ex.ferry)})`);
  if (ex.toll > 1000) parts.push(`Mautstrecke ca. ${fkm(ex.toll)}`);
  return parts.join(' · ');
}
async function ensureCountries() {
  return;
} // Länder werden nicht mehr angezeigt (Sebastian: zu viel Text) – keine Abfragen mehr
/* ---------- Etappe teilen ---------- */
function shareText(i) {
  const s = state.stages[i],
    c = s.to,
    ds = stageDates(),
    r = c.kind === 'camp' ? rzFor(c) : null;
  return [
    `Etappe ${i + 1}${ds ? ' · ' + fdate(ds[i]) : ''}: ${shortLabel(s.from.label)} → ${c.label}`,
    `${fkm(s.dist)} · ${fdur(s.dur)}`,
    s.vias && s.vias.length
      ? 'Unterwegs: ' +
        visitsOf(s)
          .map(v => v.label)
          .join(', ')
      : '',
    c.near ? `Sehenswürdigkeit: ${c.near.label}${c.near.d != null ? ' · ' + fkm1(c.near.d) : ''}` : '',
    c.addr && c.addr !== 'unbekannt' ? 'Adresse: ' + c.addr : '',
    'Koordinaten: ' + fcoord(c),
    r && r.status === 'ok' && r.hours ? 'Rezeption: ' + r.hours : '',
    r && r.checkin ? 'Check-in: ' + r.checkin.text : '',
    r && r.checkout ? 'Check-out: ' + r.checkout.text : '',
    phoneOf(c) ? 'Telefon: ' + phoneOf(c) : '',
    webOf(c) ? 'Website: ' + safeUrl(webOf(c)) : '',
    'Navigation: ' + navUrl(c),
    s.memo?.text ? 'Notiz: ' + s.memo.text : ''
  ]
    .filter(Boolean)
    .join('\n');
}
async function shareStage(i) {
  const c = state.stages[i].to;
  if (c.kind === 'camp' && !c.addr) await ensureOneAddr(i);
  const text = shareText(i);
  if (navigator.share) {
    try {
      await navigator.share({ title: `Etappe ${i + 1}: ${c.label}`, text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  copyText(text);
}

/* Änderungen (Notiz, Datum, Adresse, eigene Angaben …) automatisch sichern – siehe autosaveNow() in export.js */
const touch = () => autosaveSoon();
