/* Reiseplaner – Website-Recherche: Rezeptionszeiten, Sehenswürdigkeiten-Infos, Preise/Euro.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
/* Rezeptionszeiten (vom GitHub-Helfer im Online-Speicher, Datei rezeption.json) */
let rzData = (() => {
  try {
    return JSON.parse(localStorage.getItem('gp.rezeption') || '{}');
  } catch (e) {
    return {};
  }
})();
function cioHtml(r, compact) {
  return ['checkin', 'checkout']
    .filter(k => r[k])
    .map(
      k => `<div><b>${k === 'checkin' ? 'Check-in' : 'Check-out'}: ${esc(r[k].text)}</b>
    ${compact ? '' : `<div class="snip">„${esc(r[k].snippet)}“ – <a href="${esc(safeUrl(r[k].url))}" target="_blank" rel="noopener">Quelle</a></div>`}</div>`
    )
    .join('');
}
function rzHtml(c, compact) {
  if (c.kind !== 'camp') return '';
  const r = rzFor(c),
    web = researchTarget(c)?.web || webOf(c);
  if (r && (r.status === 'ok' || r.status === 'partial'))
    return `<div class="rz">${r.status === 'ok' ? `<b>Rezeption: ${esc(r.hours || 'siehe Website')}</b>${compact || !deEn(r.lang) ? '' : `<div class="snip">„${esc(r.snippet)}“</div>`}` : ''}
      ${cioHtml(r, compact || !deEn(r.lang))}
      ${r.url ? `<div><a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">Quelle: ${esc(shortUrl(r.url))}</a> <span class="muted">· geprüft ${new Date(r.checkedAt).toLocaleDateString('de-DE')}</span></div>` : ''}</div>`;
  if (r && web) return compact ? '' : `<div><span class="k">Rezeption</span> –</div>`;
  if (!web)
    return compact
      ? ''
      : `<div class="rz none">Keine Website in OpenStreetMap – <a href="https://www.google.com/search?q=${encodeURIComponent((c.tags?.name || c.label) + ' ' + (c.addr || ''))}" target="_blank" rel="noopener">im Web suchen</a>.</div>`;
  if (compact) return '';
  return `<div class="rz none">Rezeptionszeiten: ${ghOn() ? (state.tourId ? 'werden gesucht (1–2 Min. nach dem Speichern) …' : 'werden nach dem Speichern der Tour gesucht.') : 'Suche braucht den Online-Speicher (⚙︎).'}</div>`;
}

/* ---------- Sehenswürdigkeiten: Infos ----------
   1) OpenStreetMap beim Hinzufügen (bzw. beim ersten Aufklappen): Website, Öffnungszeiten, Telefon, Eintritt, Adresse
      → in der Tour gespeichert (`via.info`, ODbL)
   2) Website-Recherche (Öffnungszeiten, Preise) durch den GitHub-Helfer im Online-Speicher → rezeption.json, Schlüssel „web:<URL>“
   3) Google live (Adresse, Öffnungszeiten der Woche, Website, Bewertung) – nicht gespeichert (Google-Regeln) */
function sightSrc(x) {
  if (!x) return null;
  if (x.uid)
    for (const v of state.via) {
      if (v.uid === x.uid) return v;
      const y = (v.sights || []).find(z => z.uid === x.uid);
      if (y) return y;
    }
  return x;
}
const normWeb = u => {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    const x = new URL(u);
    x.hash = '';
    return x.href;
  } catch (e) {
    return '';
  }
};
const sightKey = x => x.uid || x.label + '@' + (+x.lat).toFixed(4);
const sightBusy = new Set(),
  INFO_V = 2; // INFO_V erhöhen → Infos aller Sehenswürdigkeiten neu holen
async function enrichSight(x) {
  const s = sightSrc(x);
  if (!s || (s.info && s.info.v === INFO_V) || s.lat == null || sightBusy.has(sightKey(s))) return false;
  sightBusy.add(sightKey(s));
  try {
    const ll = `${(+s.lat).toFixed(5)},${(+s.lon).toFixed(5)}`;
    const q = `[out:json][timeout:20];(nwr(around:800,${ll})[name][~"^(tourism|leisure|amenity|historic)$"~"."];node(around:6000,${ll})[place~"^(city|town|village|suburb|borough|quarter|hamlet|municipality|island|islet|locality)$"][name];);out tags center 80;`;
    const all = await overpass(q, { passes: 1 });
    // Ort statt Attraktion (z. B. Stockholm, Göteborg): Name gleich dem Suchbegriff → keine Öffnungszeiten/Preise
    const plain = t =>
      (t || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const head = plain(shortLabel(s.label));
    const town = all.find(e => e.tags?.place && (plain(e.tags.name) === head || plain(e.tags['name:de']) === head || plain(e.tags['name:en']) === head));
    if (town) {
      const old = s.info && s.info.webManual ? { web: s.info.web, webManual: true } : {};
      s.info = {
        v: INFO_V,
        at: new Date().toISOString(),
        town: true,
        place: town.tags.place,
        osm: `${town.type}/${town.id}`,
        name: town.tags.name,
        web: '',
        oh: '',
        phone: '',
        fee: '',
        charge: '',
        addr: '',
        ...old
      };
      touch();
      return true;
    }
    const els = all.filter(e => !e.tags?.place);
    const want = nameTokens(shortLabel(s.label)),
      match = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
    let best = null;
    for (const e of els) {
      const t = e.tags || {},
        toks = nameTokens(t.name),
        hit = want.filter(w => toks.some(y => match(w, y))).length;
      if (want.length && !hit) continue;
      const la = e.lat ?? e.center?.lat,
        lo = e.lon ?? e.center?.lon,
        d = la != null ? hav([s.lat, s.lon], [la, lo]) : 9e9;
      const score = hit * 10 + (t.website || t['contact:website'] || t.url ? 3 : 0) + (t.opening_hours ? 1 : 0) - d / 400;
      if (!best || score > best.score) best = { score, e, t };
    }
    const t = best ? best.t : {};
    const keep = s.info && s.info.webManual ? { web: s.info.web, webManual: true } : {};
    s.info = {
      v: INFO_V,
      at: new Date().toISOString(),
      osm: best ? `${best.e.type}/${best.e.id}` : null,
      name: t.name || '',
      web: normWeb(t.website || t['contact:website'] || t.url || ''),
      oh: t.opening_hours || '',
      phone: t.phone || t['contact:phone'] || '',
      fee: t.fee || '',
      charge: t.charge || '',
      addr: addrFromTags(t) || '',
      ...keep
    };
  } catch (e) {
    console.warn(e);
    return false;
  } finally {
    sightBusy.delete(sightKey(s));
  }
  if (!s.info.addr && settings.key) {
    try {
      s.info.addr = (await reverseAddr(s)) || '';
    } catch (e) {}
  }
  touch();
  return true;
}
// alle Sehenswürdigkeiten/Besuche der Tour nacheinander ergänzen (z. B. für ältere Touren), danach neu zeichnen
let enrichRun = false;
async function enrichAll() {
  if (enrichRun) return;
  enrichRun = true;
  try {
    const all = state.via
      .filter(v => v.kind !== 'rest')
      .flatMap(v => [v, ...(v.sights || [])])
      .filter(v => !v.info || v.info.v !== INFO_V);
    for (const v of all) {
      if ((await enrichSight(v)) && (uiTab === 'trip' || window.__allTabs)) renderTrip();
    }
  } finally {
    enrichRun = false;
  }
}
const gSight = new Map(); // sightKey → { addr, web, oh:[…], open, r, n, uri } | null
async function loadGSight(x) {
  if (!settings.gkey) return false;
  const s = sightSrc(x),
    k = sightKey(s);
  if (gSight.has(k) || s.info?.town) return false;
  gSight.set(k, null);
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': settings.gkey,
        'X-Goog-FieldMask':
          'places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.websiteUri,places.regularOpeningHours.weekdayDescriptions,places.currentOpeningHours.weekdayDescriptions,places.currentOpeningHours.openNow,places.priceRange'
      },
      body: JSON.stringify({
        textQuery: shortLabel(s.label),
        languageCode: 'de',
        maxResultCount: 3,
        locationBias: { circle: { center: { latitude: +s.lat, longitude: +s.lon }, radius: 2000 } }
      })
    });
    if (!res.ok) return false;
    const j = await res.json();
    const b = (j.places || [])
      .map(p => ({ p, d: p.location ? hav([s.lat, s.lon], [p.location.latitude, p.location.longitude]) : 1e9 }))
      .filter(q => q.d < 3000)
      .sort((a, c) => a.d - c.d)[0];
    if (b)
      gSight.set(k, {
        name: b.p.displayName?.text || '',
        addr: b.p.formattedAddress || '',
        web: b.p.websiteUri || '',
        oh: b.p.currentOpeningHours?.weekdayDescriptions?.length
          ? b.p.currentOpeningHours.weekdayDescriptions
          : b.p.regularOpeningHours?.weekdayDescriptions || [],
        open: b.p.currentOpeningHours?.openNow,
        r: b.p.rating,
        n: b.p.userRatingCount || 0,
        uri: b.p.googleMapsUri,
        price: gPriceText(b.p.priceRange)
      });
    return true;
  } catch (e) {
    console.warn(e);
    return false;
  }
}
function sightFacts(s, compact) {
  const inf = s.info || {},
    g = gSight.get(sightKey(s)),
    web = inf.web || '',
    r0 = web ? rzData['web:' + web] : null;
  const r = r0 && (r0.v || 0) >= 2 ? r0 : null; // ältere Recherche (v1) verwechselte z. B. Parkgebühren mit Eintritt
  if (inf.town) return '';
  let h = '';
  const hasHours = (g && g.oh && g.oh.length) || (r && r.hoursS && r.hoursS.text) || inf.oh;
  if (!hasHours) h += `<div><span class="k">Öffnungszeiten</span> –${r && r.hoursUrl ? ' · ' + linkA(safeUrl(r.hoursUrl), 'auf der Website') : ''}</div>`;
  if (g && g.oh && g.oh.length) h += gHoursHtml(g.oh, g.open);
  if (r && r.hoursS && r.hoursS.text)
    h += compact
      ? `<div>Öffnungszeiten laut Website: ${linkA(safeUrl(r.hoursS.url), r.hoursS.text)}</div>`
      : `<div class="rz"><b>Öffnungszeiten laut Website: ${esc(r.hoursS.text)}</b>${snipLink(r.hoursS, r.lang)}</div>`;
  else if (r && r.hoursUrl && hasHours) h += `<div>${linkA(safeUrl(r.hoursUrl), 'Öffnungszeiten auf der Website')}</div>`;
  if (r && r.season) {
    const se = r.season,
      dates = se.from && se.to && dmDe(se.from) && dmDe(se.to) ? `${dmDe(se.from)} – ${dmDe(se.to)}` : '';
    h += `<div>Saison laut Website: ${dates ? `<b>${dates}</b>` : ''}${!dates && deEn(r.lang) ? `„${esc(se.snippet)}“` : ''}${!dates && !deEn(r.lang) ? 'siehe Website' : ''}${se.url ? ' – ' + linkA(safeUrl(se.url), 'Quelle') : ''}</div>`;
  }
  if (inf.oh && !(g && g.oh && g.oh.length)) h += `<div>Öffnungszeiten (OSM): ${esc(inf.oh)}</div>`;
  const ageP = p =>
    p && (p.adult || p.child) ? [p.adult && 'Erwachsene ' + euroAb(p.adult, s), p.child && 'Kinder ' + euroAb(p.child, s)].filter(Boolean).join(' · ') : '';
  if (r && r.price && ageP(r.price))
    h += compact
      ? `<div class="price">${ageP(r.price)}</div>`
      : `<div class="rz"><b>${ageP(r.price)}</b> <span class="muted">(Website)</span>${snipLink(r.price, r.lang)}</div>`;
  else if (r && r.price)
    h += compact
      ? `<div class="price">Preis ${euroText(r.price, s)}</div>`
      : `<div class="rz"><b>Preis: ${euroText(r.price, s)}</b> <span class="muted">(Website)</span>${snipLink(r.price, r.lang)}</div>`;
  else if (inf.charge) h += `<div class="price">Preis ${euroText({ text: inf.charge }, s)} <span class="muted">(OSM)</span></div>`;
  else if (inf.fee === 'no') h += `<div class="price">Eintritt frei <span class="muted">(OSM)</span></div>`;
  else if (g && g.price) h += `<div class="price">Preis ${euroText({ text: g.price }, s)} <span class="muted">(Google)</span></div>`;
  else h += `<div><span class="k">Preise</span> –${r && r.priceUrl ? ' · ' + linkA(safeUrl(r.priceUrl), 'auf der Website') : ''}</div>`;
  return h;
}
// Textausschnitt von der Website nur zeigen, wenn die Seite deutsch oder englisch war (Sebastian: Hinweise nur DE/EN), sonst nur „Quelle“
const deEn = lang => lang === 'de' || lang === 'en';
const snipLink = (o, lang) =>
  deEn(o.lang ?? lang)
    ? `<div class="snip">„${esc(o.snippet)}“${o.url ? ` – <a href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener">Quelle</a>` : ''}</div>`
    : o.url
      ? `<div class="snip"><a href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener">Quelle</a></div>`
      : '';
const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const dmDe = x => {
  const m = String(x || '').match(/^(\d{1,2})\.(\d{1,2})\.$/);
  return m ? `${+m[1]}. ${MON[+m[2] - 1]}` : '';
};
// Inhalt eines Sehenswürdigkeiten-Eintrags (from = Platz, von dem aus man hinfährt)
function sightBodyHtml(x, from) {
  const s = sightSrc(x),
    inf = s.info || {},
    g = gSight.get(sightKey(s)),
    web = inf.web || '';
  const k = esc(sightKey(s));
  const pending = !s.info && sightBusy.has(sightKey(s));
  let h = '';
  if (x.d != null) h += `<div><span class="k">Vom Platz</span> ${x.est ? '≈' : ''}${fkm1(x.d)}${x.t ? ' / ' + fdur(x.t) : ''}</div>`;
  else if (x.air != null) h += `<div><span class="k">Vom Platz</span> ${fkm1(x.air)} Luftlinie</div>`;
  if (x.hours != null)
    h += `<div><span class="k">Dauer</span> ≈ ${fhours(x.hours)} · <a href="${parkUrl(s)}" target="_blank" rel="noopener">Parken fürs Gespann</a></div>`;
  if (pending) h += '<div class="muted">Infos werden geladen …</div>';
  if (inf.town) {
    // Stadt/Ort (Stockholm, Göteborg …): keine Öffnungszeiten, Preise oder Website-Recherche
    h += `<div><span class="k">Koordinaten</span> <span class="coordrow"><span class="coord">${fcoord(s)}</span><button class="icobtn" type="button" data-copy="${fcoord(s)}" title="Koordinaten kopieren" aria-label="Koordinaten kopieren">${ICON_COPY}</button></span></div>`;
    h += `<div class="links">${sightLinks(s, from)}</div>`;
    return `<div class="tl-body">${h}</div>`;
  }
  h += sightFacts(s, false);
  // Stand der Website-Recherche
  const r = web && (rzData['web:' + web]?.v || 0) >= 2 ? rzData['web:' + web] : null;
  if (web && !r)
    h += `<div class="rz none">Öffnungszeiten und Preise von der Website: ${ghOn() ? (state.tourId ? 'werden gesucht (1–2 Min. nach dem Speichern) …' : 'werden nach dem Speichern der Tour gesucht.') : 'Suche braucht den Online-Speicher (⚙︎).'}</div>`;

  h += `<div><span class="k">Adresse</span> ${esc(g?.addr || inf.addr || cleanLabel(s.label))}</div>`;
  if (!web && (s.info || g))
    h += `<form class="sweb" data-sweb="${k}"><input name="w" type="text" inputmode="url" autocomplete="url" placeholder="Website eintragen – dann werden Öffnungszeiten/Preise gesucht" aria-label="Website der Sehenswürdigkeit" value="${g && g.web ? esc(g.web) : ''}"><button class="btn small" type="submit">Merken</button></form>`;
  if (inf.phone) h += `<div><span class="k">Telefon</span> <a href="tel:${esc(inf.phone.replace(/[^+\d]/g, ''))}">${esc(inf.phone)}</a></div>`;
  if (g && g.r != null)
    h += `<div><span class="k">Google</span> <a class="stars" href="${esc(g.uri)}" target="_blank" rel="noopener">★ ${g.r.toLocaleString('de-DE', { minimumFractionDigits: 1 })} <span>(${g.n.toLocaleString('de-DE')})</span></a></div>`;
  h += `<div><span class="k">Koordinaten</span> <span class="coordrow"><span class="coord">${fcoord(s)}</span><button class="icobtn" type="button" data-copy="${fcoord(s)}" title="Koordinaten kopieren" aria-label="Koordinaten kopieren">${ICON_COPY}</button></span></div>`;
  h += `<div class="links">${sightLinks(s, from)}</div>`;
  return `<div class="tl-body">${h}</div>`;
}

/* ---------- Preis pro Nacht (Campingplatz): Website-Recherche des GitHub-Helfers, sonst OSM `charge` ----------
   Für Plätze in Vorschlagslisten fragt die App den Helfer über `anfragen.json` im Online-Speicher an (max. 15 je Liste). */
/* Währung → Euro: Kurse der EZB (frankfurter.app, 1× täglich, im Browser gemerkt), sonst Richtwerte */
let fx = (() => {
  try {
    const j = JSON.parse(localStorage.getItem('gp.fx') || 'null');
    return j && Date.now() - j.at < 864e5 * 7 ? j : null;
  } catch (e) {
    return null;
  }
})();
const FX0 = { SEK: 11.4, NOK: 11.7, DKK: 7.46, CHF: 0.94, GBP: 0.85, PLN: 4.3, CZK: 25, HUF: 400 };
const fxRate = cur => (fx && fx.rates && fx.rates[cur]) || FX0[cur];
async function loadFx() {
  if (fx && Date.now() - fx.at < 864e5) return;
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=EUR');
    if (!r.ok) return;
    const j = await r.json();
    fx = { at: Date.now(), rates: j.rates };
    try {
      localStorage.setItem('gp.fx', JSON.stringify(fx));
    } catch (e) {}
  } catch (e) {}
}
// „kr“ / „:-“ ohne Währungscode: Land aus Website-Endung, sonst grob aus der Lage
function krCur(c, url) {
  const tld = (String(url || '') + ' ' + (webOf(c) || '')).match(/\.(se|no|dk)(\/|\s|$)/i);
  if (tld) return { se: 'SEK', no: 'NOK', dk: 'DKK' }[tld[1].toLowerCase()];
  if (c && c.lat < 57.8 && c.lat > 54.5 && c.lon > 8 && c.lon < 12.65) return 'DKK';
  if (c && ((c.lat > 58.9 && c.lon < 11.3) || (c.lat > 61.5 && c.lon < 12.2) || (c.lat > 65 && c.lon < 14.5))) return 'NOK';
  return 'SEK';
}
function toEuro(text, c, url) {
  const t = String(text || '');
  if (!t) return null;
  const m = t.match(/(\d{1,3}(?:[ .]\d{3})+|\d+)(?:[.,](\d{1,2}))?/);
  if (!m) return null;
  const val = +(m[1].replace(/[ .]/g, '') + (m[2] ? '.' + m[2] : ''));
  let cur = /€|eur/i.test(t)
    ? 'EUR'
    : /sek|kronor/i.test(t)
      ? 'SEK'
      : /nok/i.test(t)
        ? 'NOK'
        : /dkk/i.test(t)
          ? 'DKK'
          : /chf/i.test(t)
            ? 'CHF'
            : /£|gbp/i.test(t)
              ? 'GBP'
              : /pln|zł/i.test(t)
                ? 'PLN'
                : /czk|kč/i.test(t)
                  ? 'CZK'
                  : /kr|:-|,-/i.test(t)
                    ? krCur(c, url)
                    : 'EUR';
  if (cur === 'EUR') return { eur: val, orig: null };
  const rate = fxRate(cur);
  if (!rate) return null;
  return { eur: val / rate, orig: `${Math.round(val).toLocaleString('de-DE')} ${cur}` };
}
// Preistext in Euro, z. B. „≈ 36 €  (415 kr (SEK))“; Spannen „SEK 300–450“ → „≈ 26–39 €“
function euroText(p, c) {
  if (!p || !p.text) return '';
  const range = String(p.text).match(/^(\D*)(\d[\d .]*)\s*[–-]\s*(\d[\d .]*)(\D*)$/);
  if (range) {
    const a = toEuro(range[1] + range[2] + range[4], c, p.url),
      b = toEuro(range[1] + range[3] + range[4], c, p.url);
    if (a && b) return `${a.orig ? '≈ ' : ''}${Math.round(a.eur)}–${Math.round(b.eur)} €${a.orig ? ` <span class="muted">(${esc(p.text)})</span>` : ''}`;
  }
  const e = toEuro(p.text, c, p.url);
  if (!e) return esc(p.text);
  return e.orig
    ? `≈ ${Math.round(e.eur)} € <span class="muted">(${esc(e.orig)})</span>`
    : `${e.eur.toLocaleString('de-DE', e.eur % 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {})} €`;
}
// „ab 465 kr“ → „ab ≈ 41 € (465 SEK)“
const euroAb = (t, c) => {
  const ab = /^ab\s/i.test(t);
  return (ab ? 'ab ' : '') + euroText({ text: String(t).replace(/^ab\s+/i, '') }, c);
};
const euroPlain = (p, c) => euroText(p, c).replace(/<[^>]+>/g, '');
function priceOf(c) {
  const r = rzFor(c);
  if (r && r.price) return { ...r.price, src: 'web', lang: r.lang };
  if (c.tags?.charge) return { text: c.tags.charge, src: 'osm' };
  const g = gRate.get(c.id);
  if (g && g.price) return { text: g.price, src: 'google', url: g.uri };
  return null;
}
const priceReq = new Map(); // camp id → Zeitpunkt der Anfrage
// Strom-Hinweis zum Platzpreis: „mit Strom“ / „ohne Strom (+ ≈ 5 € Strom)“
function powerHtml(p, c) {
  if (!p || !p.power) return '';
  return p.power === 'with'
    ? ' · mit Strom'
    : ` · ohne Strom${p.elec ? ` (+ ${euroText({ text: p.elec, url: p.url }, c).replace(/ <span[^>]*>.*<\/span>/, '')} Strom)` : ''}`;
}
function priceHtml(c, compact, placeholder) {
  const p = priceOf(c);
  const srcName = { web: 'Website', osm: 'OSM', google: 'Google' };
  if (p && compact)
    return `<div class="price">Preis ${euroText(p, c) || 'siehe Website'} <span class="muted">${powerHtml(p, c)} · ${p.url ? `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener" title="${esc(p.snippet || '')}">${srcName[p.src]}</a>` : srcName[p.src]}</span></div>`;
  if (p)
    return `<div class="rz"><b>Preis${p.text ? ': ' + euroText(p, c) : ''}</b><span class="muted">${powerHtml(p, c)}${p.src === 'google' ? ' (Google)' : p.src === 'osm' ? ' (OSM)' : ''}</span>${p.snippet ? snipLink(p) : ''}</div>`;
  const t = researchTarget(c);
  if (t && priceReq.has(t.key) && Date.now() - priceReq.get(t.key) < 8 * 60000) return `<div class="muted price">Preis wird auf der Website gesucht …</div>`;
  if (!compact) return `<div><span class="k">Preis</span> –</div>`;
  return placeholder ? `<div class="price muted">Preis: –</div>` : '';
}
let priceQueue = new Map(),
  priceTimer = null,
  pricePoll = [];
function requestPrices(list) {
  if (!ghOn() || !list || !list.length) return;
  for (const c of list.slice(0, 15)) {
    const t = researchTarget(c);
    if (!t || priceReq.has(t.key)) continue;
    const r = rzData[t.key];
    if (r && (t.key !== c.id || (r.website === t.web && r.v >= 3))) continue;
    priceReq.set(t.key, Date.now());
    priceQueue.set(t.key, { id: t.key, name: c.tags?.name || c.label || '', website: t.web });
  }
  if (!priceQueue.size) return;
  clearTimeout(priceTimer);
  priceTimer = setTimeout(async () => {
    const camps = [...priceQueue.values()];
    priceQueue.clear();
    try {
      const cur = await ghRead('anfragen.json').catch(() => null);
      const old = (cur?.data?.camps || []).filter(x => Date.now() - Date.parse(x.at || 0) < 864e5 && !camps.some(y => y.id === x.id));
      const at = new Date().toISOString();
      await ghWrite('anfragen.json', { camps: [...old, ...camps.map(x => ({ ...x, at }))].slice(-60) }, cur?.sha, `Preise anfragen: ${camps.length} Plätze`);
    } catch (e) {
      console.warn(e);
      camps.forEach(x => priceReq.delete(x.id));
      return;
    }
    // Ergebnis kommt nach ~2–5 Min. → rezeption.json mehrmals nachladen
    pricePoll.forEach(clearTimeout);
    pricePoll = [120, 210, 330].map(sec =>
      setTimeout(
        () =>
          syncNow()
            .then(r => {
              if (r && r.rz) renderAll();
            })
            .catch(() => {}),
        sec * 1000
      )
    );
  }, 1500);
}
