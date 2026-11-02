/* Reiseplaner – Konstanten, Einstellungen, Hilfsfunktionen, Geometrie.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
'use strict';
/* ---------- Konstanten & Einstellungen ---------- */
const COL = { brand: '#6a9a74', pending: '#6f7a85', corridor: '#e07b24', ok: '#2e8b57', unk: '#8a8f98' };
const DEF = {
  key: '',
  speed: 80,
  cmin: 350,
  cmax: 450,
  detour: 10,
  highway: true,
  noToll: false,
  ghRepo: 'sebciox/touren',
  ghToken: '',
  savedAt: null,
  altRadius: 10,
  filters: { caravan: false, power: false },
  gkey: '',
  sortBy: 'stage',
  adults: 2,
  kids: 0
};
const ORS = 'https://api.openrouteservice.org';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const AREA_ZOOM = 10;
// Vorerst zum Testen: Start/Ziel vorausgefüllt (bei Bedarf hier leeren)
const DEMO = { start: 'Witten', end: 'Sant Pere Pescador, CT, Spanien' };

let settings = loadSettings();
function loadSettings() {
  let st;
  try {
    st = { ...DEF, ...JSON.parse(localStorage.getItem('gp.settings') || '{}') };
  } catch (e) {
    st = { ...DEF };
  }
  if (st.ghRepo === 'sebciox/gespann-touren' && !st.ghToken) st.ghRepo = DEF.ghRepo; // früherer Standardname
  return st;
}
function saveSettings() {
  try {
    localStorage.setItem('gp.settings', JSON.stringify(settings));
  } catch (e) {}
}

const state = {
  start: null,
  end: null,
  stages: [],
  pending: null,
  done: false,
  busy: false,
  tourId: null,
  endCands: [],
  n: null, // gewünschte Anzahl Etappen (vom Nutzer gewählt)
  overview: null, // Gesamtroute Start → Ziel { from, line, dist, dur }
  date: null, // Abfahrtsdatum 'JJJJ-MM-TT'
  alt: null, // Ausweichplatz-Suche { i, r, list }
  openDet: new Set(),
  showEndList: false,
  via: [], // Zwischenziele { uid, label, lat, lon, kind:'stay'|'visit', nights }
  round: false, // Rundreise: zurück zum Start
  segs: null,
  ret: null
}; // ret = spätestes Rückkehr-/Ankunftsdatum; segs = Abschnitte bei Zwischenzielen { to, kind:'sight'|'end'|'home', visits, n, nights, radius, dist, dur }
const campIndex = new Map();
const $ = s => document.querySelector(s);

/* ---------- Hilfsfunktionen ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};
const fkm = m => Math.round(m / 1000).toLocaleString('de-DE') + ' km';
const fkm1 = m => (m / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
function fdur(s) {
  const m = Math.round(s / 60),
    h = Math.floor(m / 60),
    r = m % 60;
  return h ? `${h} h ${String(r).padStart(2, '0')} min` : `${r} min`;
}
const shortLabel = l => String(l || '').split(',')[0];
function safeUrl(u) {
  u = String(u).trim();
  if (/^javascript:/i.test(u)) return '#';
  return /^https?:\/\//i.test(u) ? u : 'https://' + u;
}

/* Geometrie: Punkte als [lat, lon] */
const RAD = Math.PI / 180;
function hav(a, b) {
  const dLat = (b[0] - a[0]) * RAD,
    dLon = (b[1] - a[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function cumul(line) {
  const c = [0];
  for (let i = 1; i < line.length; i++) c.push(c[i - 1] + hav(line[i - 1], line[i]));
  return c;
}
function pointAt(line, cum, d) {
  const L = cum[cum.length - 1];
  if (d <= 0) return line[0];
  if (d >= L) return line[line.length - 1];
  let lo = 0,
    hi = cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= d) lo = m;
    else hi = m;
  }
  const t = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
  return [line[lo][0] + (line[hi][0] - line[lo][0]) * t, line[lo][1] + (line[hi][1] - line[lo][1]) * t];
}
function sample(line, cum, d0, d1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const d = d0 + ((d1 - d0) * i) / n;
    out.push({ p: pointAt(line, cum, d), d });
  }
  return out;
}
function slice(line, cum, d0, d1) {
  const out = [pointAt(line, cum, d0)];
  for (let i = 0; i < line.length; i++) if (cum[i] > d0 && cum[i] < d1) out.push(line[i]);
  out.push(pointAt(line, cum, d1));
  return out;
}
function thin(line, minM = 60) {
  if (line.length < 3) return line.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]);
  const out = [line[0]];
  for (let i = 1; i < line.length - 1; i++) if (hav(out[out.length - 1], line[i]) >= minM) out.push(line[i]);
  out.push(line[line.length - 1]);
  return out.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]);
}
