/* Reiseplaner – Google Places: Bewertungen, Namen, Öffnungszeiten (nur live).
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
/* ---------- Google-Bewertungen (Places API New, Text Search; nur live, nicht dauerhaft gespeichert) ---------- */
const gRate = new Map(); // camp id → { r, n, uri } | null (nicht gefunden)
let gErr = null,
  gBusy = false;
async function gFetch(c) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': settings.gkey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.rating,places.userRatingCount,places.googleMapsUri,places.location,places.regularOpeningHours.weekdayDescriptions,places.currentOpeningHours.weekdayDescriptions,places.currentOpeningHours.openNow,places.priceRange,places.websiteUri,places.types,places.formattedAddress'
    },
    body: JSON.stringify({
      textQuery: c.tags?.name ? c.tags.name : 'Campingplatz',
      languageCode: 'de',
      maxResultCount: 3,
      locationBias: { circle: { center: { latitude: c.lat, longitude: c.lon }, radius: 1500 } }
    })
  });
  if (!res.ok) {
    let m = '';
    try {
      m = (await res.json()).error?.message || '';
    } catch (e) {}
    throw new Error(`Google ${res.status}${m ? ': ' + m : ''}`);
  }
  const j = await res.json();
  const best = (j.places || [])
    .map(p => ({ p, d: p.location ? hav([c.lat, c.lon], [p.location.latitude, p.location.longitude]) : 1e9 }))
    .filter(x => x.d < 2000)
    .sort((a, b) => a.d - b.d)[0];
  if (!best) return null;
  const p = best.p;
  const near = best.d <= 500 && (p.types || []).some(t => t === 'campground' || t === 'rv_park');
  return {
    name: p.displayName?.text || '',
    near,
    r: p.rating ?? null,
    n: p.userRatingCount || 0,
    uri: p.googleMapsUri,
    oh: p.currentOpeningHours?.weekdayDescriptions?.length ? p.currentOpeningHours.weekdayDescriptions : p.regularOpeningHours?.weekdayDescriptions || [],
    open: p.currentOpeningHours?.openNow,
    price: gPriceText(p.priceRange),
    web: p.websiteUri || '',
    addr: p.formattedAddress || ''
  };
}
/* Abgleich mit Google: Campingplatz an derselben Stelle (≤ 400 m) mit anderem Namen → „bei Google: …“
   (OSM-Namen sind manchmal veraltet). Nur live/im Arbeitsspeicher wie die Bewertungen. */
const gNames = new Map(); // camp id → { name, uri } | null (gleich/nichts gefunden)
const NAME_STOP = new Set([
  'camping',
  'campingplatz',
  'campsite',
  'camp',
  'camper',
  'caravan',
  'caravaning',
  'stugby',
  'stugor',
  'park',
  'plads',
  'platz',
  'resort',
  'holiday',
  'ferienpark',
  'vandrarhem',
  'family',
  'familie',
  'och',
  'and',
  'und',
  'with',
  'the',
  'der',
  'die',
  'das'
]);
const nameTokens = n =>
  (n || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 4 && !NAME_STOP.has(w));
function namesDiffer(a, b) {
  const A = nameTokens(a),
    B = nameTokens(b);
  if (!B.length) return false;
  if (!A.length) return true; // OSM ohne (sprechenden) Namen
  return !A.some(x => B.some(y => x === y || (x.length >= 5 && y.length >= 5 && x.slice(0, 5) === y.slice(0, 5))));
}
async function loadGName(c) {
  if (!settings.gkey || !c || c.id == null || gNames.has(c.id)) return false;
  gNames.set(c.id, null);
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': settings.gkey,
        'X-Goog-FieldMask': 'places.displayName,places.location,places.googleMapsUri'
      },
      body: JSON.stringify({
        includedTypes: ['campground', 'rv_park'],
        maxResultCount: 5,
        rankPreference: 'DISTANCE',
        languageCode: 'de',
        locationRestriction: { circle: { center: { latitude: c.lat, longitude: c.lon }, radius: 400 } }
      })
    });
    if (!res.ok) return;
    const j = await res.json(),
      osm = c.tags?.name || '';
    const near = (j.places || [])
      .map(p => ({ p, d: p.location ? hav([c.lat, c.lon], [p.location.latitude, p.location.longitude]) : 1e9 }))
      .sort((a, b) => a.d - b.d)[0];
    const gn = near && near.p.displayName?.text;
    if (gn && near.d <= 400 && namesDiffer(osm, gn)) gNames.set(c.id, { name: gn, uri: near.p.googleMapsUri, d: near.d });
  } catch (e) {
    console.warn(e);
  }
  return true;
}
// Aktueller Name laut Google (live, nicht gespeichert): aus der Bewertungs-Abfrage (nur echter Campingplatz ≤ 500 m) oder dem Namensabgleich
function gBetterName(c) {
  if (!c || (c.kind && c.kind !== 'camp') || c.tags?.['gp:own']) return ''; // eigene Unterkunft: kein Google-Name
  const osm = c.tags?.name || c.label || '',
    g = gRate.get(c.id);
  if (g && g.name && g.near && namesDiffer(osm, g.name)) return g.name;
  const n = gNames.get(c.id);
  return n ? n.name : '';
}
function nameHtml(c) {
  const osm = c.tags?.name || c.label || 'Campingplatz ohne Namen',
    gn = gBetterName(c);
  return gn ? `${esc(gn)} <span class="osmname" title="Name in OpenStreetMap – evtl. veraltet">(OSM: ${esc(osm)})</span>` : esc(osm);
}
const nameText = c => gBetterName(c) || c.label || c.tags?.name || '';
function gNameHtml() {
  return '';
} // früher „bei Google: …“ – jetzt steht der Google-Name direkt als Überschrift (nameHtml)
// lädt Bewertungen für die ersten (sichtbaren) Plätze einer Liste – max. 20 je Liste, um das Google-Kontingent zu schonen
async function loadRatings(list) {
  if (!settings.gkey || gBusy) return;
  const todo = list.filter(c => !gRate.has(c.id)).slice(0, 20);
  if (!todo.length) return;
  gBusy = true;
  try {
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(
        todo.slice(i, i + 4).map(async c => {
          try {
            gRate.set(c.id, await gFetch(c));
            gErr = null;
          } catch (e) {
            gErr = e.message;
          }
        })
      );
      if (gErr) break;
    }
  } finally {
    gBusy = false;
    renderPanel();
  }
}
// Preisspanne aus Google (Places priceRange) als Text, z. B. „SEK 300–450“
function gPriceText(pr) {
  if (!pr) return '';
  const v = m => (m ? +(m.units || 0) + (m.nanos || 0) / 1e9 : null),
    a = v(pr.startPrice),
    b = v(pr.endPrice),
    cur = pr.startPrice?.currencyCode || pr.endPrice?.currencyCode || '';
  const f = x => Math.round(x).toLocaleString('de-DE');
  return a != null ? `${cur} ${f(a)}${b != null && b !== a ? '–' + f(b) : ''}`.trim() : b != null ? `bis ${cur} ${f(b)}` : '';
}
// Öffnungszeiten laut Google (live): heute + aufklappbar die Woche
function gHoursHtml(oh, open, label) {
  if (!oh || !oh.length) return '';
  const wd = new Date().toLocaleDateString('de-DE', { weekday: 'long' }).toLowerCase();
  const today = oh.find(l => l.toLowerCase().startsWith(wd)) || oh[(new Date().getDay() + 6) % 7] || '';
  return `<details class="gh"><summary>${label || 'Öffnungszeiten'} laut Google${today ? ': ' + esc(today.replace(/^[^:]+:\s*/, 'heute ')) : ''}${open === true ? ' · <b>jetzt geöffnet</b>' : open === false ? ' · jetzt geschlossen' : ''}</summary><ul class="ghours">${oh.map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>`;
}
function rateHtml(c) {
  const g = gRate.get(c.id);
  if (g && g.r == null) return ' <span class="stars none">★ –</span>';
  if (g)
    return ` <a class="stars" href="${esc(g.uri)}" target="_blank" rel="noopener" title="${g.n} Google-Bewertungen">★ ${g.r.toLocaleString('de-DE', { minimumFractionDigits: 1 })} <span>(${g.n.toLocaleString('de-DE')})</span></a>`;
  if (g === null) return ' <span class="stars none">★ –</span>';
  return '';
}
// Sortierung nach Bewertung: gewichtet (wenige Bewertungen zählen weniger), unbewertet ans Ende
const rateScore = c => {
  const g = gRate.get(c.id);
  return g && g.r != null ? (g.r * g.n + 4 * 10) / (g.n + 10) : -1;
};
function sortRows(list) {
  return settings.sortBy === 'rating' ? list.slice().sort((a, b) => rateScore(b) - rateScore(a)) : list;
}
function sortHtml(list) {
  const top = list.filter(passFilter).slice(0, 20);
  setTimeout(() => requestPrices(top), 0); // nur die ersten 20 (Reihenfolge der Etappen-Empfehlung)
  if (settings.gkey && !gErr && !gBusy && top.some(c => !gRate.has(c.id))) setTimeout(() => loadRatings(top), 0);
  return `<div class="chips"><span class="muted">Sortierung:</span>
    <button type="button" class="chip${settings.sortBy !== 'rating' ? ' on' : ''}" data-sort="stage">Entfernung/Etappe</button>
    <button type="button" class="chip${settings.sortBy === 'rating' ? ' on' : ''}" data-sort="rating" ${settings.gkey ? '' : 'title="Google-API-Schlüssel unter ⚙︎ eintragen"'}>★ Google-Bewertung</button>
    ${settings.gkey ? (gBusy ? '<span class="muted">lädt …</span>' : gErr ? `<span class="muted" style="color:var(--danger)">${esc(gErr)}</span>` : '<span class="muted">Bewertungen: Google</span>') : ''}</div>`;
}
