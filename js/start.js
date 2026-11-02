/* Reiseplaner – Dialoge, Einrichtungs-Link, Start.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
/* ---------- Dialoge ---------- */
function openSettings() {
  $('#sKey').value = settings.key;
  $('#sSpeed').value = settings.speed;
  $('#sDetour').value = settings.detour;
  $('#sMin').value = settings.cmin;
  $('#sMax').value = settings.cmax;
  $('#sHighway').checked = !!settings.highway;
  $('#sToll').checked = !!settings.noToll;
  $('#sRepo').value = settings.ghRepo || '';
  $('#sToken').value = settings.ghToken || '';
  $('#sGkey').value = settings.gkey || '';
  $('#sAdults').value = settings.adults ?? DEF.adults;
  $('#sKids').value = settings.kids ?? DEF.kids;
  $('#setupLinkBox').hidden = !ghOn();
  $('#sToken').type = 'password';
  $('#sTokenShow').textContent = 'anzeigen';
  $('#settingsDlg').returnValue = ''; // sonst würde Esc/Zurück nach einem früheren „Speichern“ erneut speichern
  $('#settingsDlg').showModal();
}
$('#settingsDlg').addEventListener('close', () => {
  if ($('#settingsDlg').returnValue !== 'save') return;
  const n = (v, d) => {
    const x = parseFloat(v);
    return isFinite(x) ? x : d;
  };
  let cmin = n($('#sMin').value, DEF.cmin),
    cmax = n($('#sMax').value, DEF.cmax);
  if (cmax <= cmin) cmax = cmin + 50;
  const ghRepo = $('#sRepo')
      .value.trim()
      .replace(/^https:\/\/github\.com\//, '')
      .replace(/\.git$|\/$/g, ''),
    ghToken = $('#sToken').value.trim();
  const newConn = ghToken && (ghToken !== settings.ghToken || ghRepo !== settings.ghRepo);
  settings = {
    ...settings,
    key: $('#sKey').value.trim(),
    speed: Math.max(80, n($('#sSpeed').value, DEF.speed)),
    detour: Math.max(1, n($('#sDetour').value, DEF.detour)),
    cmin,
    cmax,
    highway: $('#sHighway').checked,
    noToll: $('#sToll').checked,
    ghRepo,
    ghToken,
    gkey: $('#sGkey').value.trim(),
    adults: Math.max(0, Math.min(20, Math.round(n($('#sAdults').value, DEF.adults)))),
    kids: Math.max(0, Math.min(20, Math.round(n($('#sKids').value, DEF.kids))))
  };
  if (newConn) {
    try {
      localStorage.removeItem('gp.sync');
    } catch (e) {}
  } // neue Verbindung: Online-Einstellungen haben Vorrang
  else settings.savedAt = new Date().toISOString();
  saveSettings();
  if ($('#status').classList.contains('error') && settings.key) setStatus('');
  if (ghOn()) {
    setStatus(newConn ? 'Verbinde mit dem Online-Speicher …' : 'Einstellungen werden online gesichert …', 'busy');
    if (newConn) syncAndReport('Online-Speicher verbunden', 'Verbindung zum Online-Speicher fehlgeschlagen: ');
    else syncAndReport('Einstellungen gespeichert · online gesichert', 'Einstellungen gespeichert – aber nur in diesem Browser. ');
  }
});
$('#settingsBtn').onclick = $('#settingsBtnM').onclick = openSettings;
/* Einrichtungs-Link: Repo + Token im Fragment (#einrichten=…, wird nie an einen Server geschickt) → anderer Browser ist sofort verbunden */
const b64u = str =>
  btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64u = str => decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/'))));
$('#sTokenShow').onclick = () => {
  const i = $('#sToken'),
    show = i.type === 'password';
  i.type = show ? 'text' : 'password';
  $('#sTokenShow').textContent = show ? 'verbergen' : 'anzeigen';
};
$('#setupLinkBtn').onclick = async () => {
  if (!ghOn()) return;
  const link = `${location.origin}${location.pathname}#einrichten=${b64u(JSON.stringify({ r: settings.ghRepo, t: settings.ghToken }))}`;
  try {
    await navigator.clipboard.writeText(link);
    flash('Einrichtungs-Link kopiert – im anderen Browser öffnen (nur für dich, enthält deinen Token).');
  } catch (e) {
    prompt('Einrichtungs-Link (kopieren):', link);
  }
};
function setupFromLink() {
  const m = location.hash.match(/^#einrichten=([\w-]+)/);
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search); // Token sofort aus der Adresszeile entfernen
  let d = null;
  try {
    d = JSON.parse(unb64u(m[1]));
  } catch (e) {}
  if (!d || !d.t || !/^[\w.-]+\/[\w.-]+$/.test(d.r || '')) {
    flash('Der Einrichtungs-Link ist ungültig oder unvollständig.');
    return false;
  }
  if (settings.ghToken === d.t && settings.ghRepo === d.r) {
    flash('Dieser Browser ist schon mit dem Online-Speicher verbunden.');
    return false;
  }
  if (!confirm(`Online-Speicher „${d.r}“ in diesem Browser einrichten?\nDanach werden Schlüssel, Einstellungen und Touren von dort übernommen.`)) return false;
  settings = { ...settings, ghRepo: d.r, ghToken: d.t };
  try {
    localStorage.removeItem('gp.sync');
  } catch (e) {} // neue Verbindung: Online-Einstellungen haben Vorrang
  saveSettings();
  setStatus('Verbinde mit dem Online-Speicher …', 'busy');
  return true;
}
$('#toursBtn').onclick = $('#toursBtnM').onclick = () => openTours();
$('#syncBtn').onclick = () => {
  const p = syncAndReport();
  openTours(true);
  p.then(() => openTours(true));
};
$('#toursClose').onclick = $('#toursX').onclick = () => $('#toursDlg').close();
// Tippen neben den Dialog (auf den abgedunkelten Hintergrund) schließt ihn ohne zu speichern
for (const d of [$('#settingsDlg'), $('#toursDlg')])
  d.addEventListener('click', e => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close('cancel');
  });
$('#importBtn').onclick = () => $('#importIn').click();
$('#importIn').addEventListener('change', e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) importTour(f);
});

/* ---------- Start ---------- */
$('#startIn').value = DEMO.start;
$('#endIn').value = DEMO.end;
renderVia();
renderAll();
popupPad();
loadFx().then(() => renderAll());
const viaLink = setupFromLink();
if (!settings.key && !ghOn()) setStatus('Willkommen! Trag zuerst unter ⚙︎ deinen kostenlosen OpenRouteService-Schlüssel ein.');
if (viaLink) syncAndReport('Online-Speicher eingerichtet', 'Verbindung zum Online-Speicher fehlgeschlagen: ');
else {
  syncAndReport();
  setTimeout(offerDraft, 300);
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
