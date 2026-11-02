const { chromium } = require('playwright');
const fs = require('fs'),
  path = require('path'),
  http = require('http');
const ROOT = path.join(__dirname, '..'),
  OUT = path.join(__dirname, 'out');
(fs.mkdirSync(OUT, { recursive: true }), (LF = path.join(ROOT, 'node_modules/leaflet/dist')));
const hav = (a, b) => {
  const R = 6371000,
    r = Math.PI / 180,
    dLa = (b[0] - a[0]) * r,
    dLo = (b[1] - a[1]) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const PLACES = { Witten: [51.4436, 7.3532], 'Sant Pere Pescador': [42.1885, 3.0806], Paris: [48.8566, 2.3522], Lyon: [45.764, 4.8357] };
const A = PLACES['Witten'],
  B = PLACES['Sant Pere Pescador'];
let failures = 0;
const ok = (c, m) => {
  console.log((c ? 'OK   ' : 'FAIL ') + m);
  if (!c) failures++;
};

const srv = require('./lib/server')(ROOT, 8151);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true, viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => {
    console.log('PAGEERROR', e.message);
    failures++;
  });
  const dirBodies = [];
  let opCount = 0,
    mxCount = 0,
    revCount = 0;
  const opFail = { n: 0, status: 504 };
  global.T = {
    get op() {
      return opCount;
    },
    get mx() {
      return mxCount;
    },
    opFail
  };
  await page.route('**/*', async r => {
    const u = r.request().url();
    if (u.includes('cdnjs.cloudflare.com') && u.includes('leaflet')) {
      const f = u.endsWith('.css') ? 'leaflet.css' : u.includes('images/') ? 'images/' + u.split('/').pop() : 'leaflet.js';
      return r.fulfill({
        body: fs.readFileSync(path.join(LF, f)),
        contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.png') ? 'image/png' : 'text/javascript'
      });
    }
    if (u.includes('tile.openstreetmap.org')) return r.fulfill({ status: 204, body: '' });
    if (u.includes('/geocode/reverse')) {
      revCount++;
      return r.fulfill({ json: { features: [{ properties: { label: 'Route de Test 1, 21000 Dijon, Frankreich' } }] } });
    }
    if (u.includes('/geocode/')) {
      const t = new URL(u).searchParams.get('text');
      const k = Object.keys(PLACES).find(k => t.includes(k));
      const p = PLACES[k];
      return r.fulfill({ json: { features: p ? [{ geometry: { coordinates: [p[1], p[0]] }, properties: { label: k + ', Testland' } }] : [] } });
    }
    if (u.includes('/v2/directions/')) {
      const b = JSON.parse(r.request().postData());
      dirBodies.push(b);
      const P = b.coordinates;
      let coords = [],
        dist = 0;
      for (let k = 1; k < P.length; k++) {
        const [lo1, la1] = P[k - 1],
          [lo2, la2] = P[k];
        const N = 100;
        for (let i = k === 1 ? 0 : 1; i <= N; i++) coords.push([lo1 + ((lo2 - lo1) * i) / N, la1 + ((la2 - la1) * i) / N]);
        dist += hav([la1, lo1], [la2, lo2]);
      }
      // Schritte: 70 % Autobahn mit 120 km/h, 30 % Landstraße mit 60 km/h
      const s1 = dist * 0.7,
        s2 = dist * 0.3,
        d1 = s1 / (120 / 3.6),
        d2 = s2 / (60 / 3.6);
      const props = { summary: { distance: dist, duration: d1 + d2 } };
      if (b.instructions)
        props.segments = [
          {
            distance: dist,
            duration: d1 + d2,
            steps: [
              { distance: s1, duration: d1 },
              { distance: s2, duration: d2 }
            ]
          }
        ];
      return r.fulfill({
        json: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props }] }
      });
    }
    if (u.includes('/v2/matrix/')) {
      mxCount++;
      const b = JSON.parse(r.request().postData());
      const L = b.locations.map(l => [l[1], l[0]]);
      const distances = b.sources.map(s => b.destinations.map(d => hav(L[s], L[d]) * 1.3));
      return r.fulfill({ json: { distances, durations: distances.map(row => row.map(x => x / 15)) } });
    }
    if (u.includes('overpass')) {
      opCount++;
      if (T.opDelay) await new Promise(res => setTimeout(res, T.opDelay));
      if (opFail.n > 0) {
        opFail.n--;
        return r.fulfill({ status: opFail.status, body: 'busy' });
      }
      const q = decodeURIComponent(r.request().postData().slice(5));
      const m = q.match(/\(([\d.\-]+),([\d.\-]+),([\d.\-]+),([\d.\-]+)\)/);
      if (!m) return r.fulfill({ json: { elements: (global.T && T.sightEls) || [] } });
      const [S, W, N, E] = m.slice(1).map(Number);
      const all = [];
      for (let f = 0.02; f < 1; f += 0.02) {
        const id = Math.round(f * 1000),
          la = A[0] + (B[0] - A[0]) * f + 0.01,
          lo = A[1] + (B[1] - A[1]) * f;
        all.push({
          type: 'node',
          id,
          lat: la,
          lon: lo,
          tags: {
            tourism: 'camp_site',
            name: 'Platz ' + Math.round(f * 100),
            caravans: f > 0.5 ? 'yes' : undefined,
            website: 'https://platz' + id + '.example',
            phone: '+33 1 23',
            description: 'x'.repeat(200)
          }
        });
        all.push({
          type: 'node',
          id: id + 5000,
          lat: la + 0.03,
          lon: lo + 0.02,
          tags: {
            tourism: 'camp_site',
            name: 'Nachbar ' + Math.round(f * 100),
            caravans: 'yes',
            dog: 'yes',
            power_supply: 'yes',
            website: 'nachbar' + id + '.example'
          }
        });
        all.push({
          type: 'node',
          id: id + 7000,
          lat: la - 0.04,
          lon: lo - 0.02,
          tags: {
            tourism: 'camp_site',
            name: 'Nachbar2 ' + Math.round(f * 100),
            'addr:street': 'Rue du Lac',
            'addr:housenumber': '5',
            'addr:postcode': '12345',
            'addr:city': 'Lacville'
          }
        });
      }
      for (let i = 0; i < 3; i++)
        all.push({
          type: 'node',
          id: 9000 + i,
          lat: B[0] + 0.01 * (i + 1),
          lon: B[1] + 0.01,
          tags: { tourism: 'camp_site', name: 'Zielplatz ' + i, caravans: 'yes' }
        });
      if (N - S < 1.2) {
        const cy = (S + N) / 2,
          cx = (W + E) / 2,
          base = Math.round(cy * 100) * 1000 + Math.round(cx * 100);
        for (let i = 0; i < 4; i++)
          all.push({
            type: 'node',
            id: 100000000 + base * 10 + i,
            lat: cy + 0.03 * (i + 1) * (i % 2 ? 1 : -1),
            lon: cx + 0.02 * (i + 1),
            tags: { tourism: 'camp_site', name: 'Lokal ' + i, caravans: i % 2 ? 'yes' : undefined, website: 'lokal' + i + '.example' }
          });
      }
      return r.fulfill({ json: { elements: all.filter(e => e.lat >= S && e.lat <= N && e.lon >= W && e.lon <= E) } });
    }
    return r.continue();
  });

  await page.route('**/cdn.jsdelivr.net/npm/docx@*/**', r =>
    r.fulfill({ body: fs.readFileSync(path.join(ROOT, 'node_modules/docx/dist/index.iife.js')), contentType: 'text/javascript' })
  );
  T.sightEls = [
    {
      type: 'node',
      id: 4711,
      lat: 48.8584,
      lon: 2.2945,
      tags: {
        tourism: 'attraction',
        name: 'Paris Tour',
        website: 'https://paris.example',
        opening_hours: 'Mo-Su 09:00-23:00',
        charge: 'EUR 29',
        'addr:street': 'Av. Test',
        'addr:housenumber': '5',
        'addr:postcode': '75007',
        'addr:city': 'Paris'
      }
    },
    { type: 'node', id: 4712, lat: 48.86, lon: 2.3, tags: { amenity: 'cafe', name: 'Café X' } }
  ];
  let gSightReq = 0;
  await page.route('**/places.googleapis.com/**', r => {
    const u = r.request().url(),
      fm = r.request().headers()['x-goog-fieldmask'] || '';
    if (u.includes('searchNearby')) return r.fulfill({ json: { places: [] } });
    const c = JSON.parse(r.request().postData()).locationBias.circle.center;
    if (fm.includes('regularOpeningHours')) {
      gSightReq++;
      return r.fulfill({
        json: {
          places: [
            {
              displayName: { text: 'Tour Paris' },
              formattedAddress: 'Champ de Mars, 75007 Paris',
              location: { latitude: c.latitude + 0.001, longitude: c.longitude },
              rating: 4.7,
              userRatingCount: 1234,
              googleMapsUri: 'https://maps.google.com/?cid=9',
              websiteUri: 'https://google-web.example/',
              regularOpeningHours: { weekdayDescriptions: ['Montag: 09:00–23:00', 'Dienstag: 09:00–23:00'] },
              currentOpeningHours: { openNow: true }
            }
          ]
        }
      });
    }
    return r.fulfill({ json: { places: [] } });
  });
  await page.goto('http://localhost:8151/');
  await page.evaluate(() => localStorage.setItem('gp.settings', JSON.stringify({ key: 'eyJtest', gkey: 'gtest' })));
  await page.reload();
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Paris-Tour' : undefined));
  const addVia = async t => {
    const n0 = await page.evaluate(() => state.via.length);
    await page.fill('#viaIn', t);
    await page.waitForTimeout(600);
    await page.press('#viaIn', 'Enter');
    await page.waitForFunction(n => state.via.length === n, n0 + 1);
  };
  await addVia('Paris');
  await page.waitForFunction(() => state.via[0].info, null, { timeout: 8000 });
  const inf = await page.evaluate(() => state.via[0].info);
  ok(
    inf.web === 'https://paris.example/' &&
      inf.oh === 'Mo-Su 09:00-23:00' &&
      inf.charge === 'EUR 29' &&
      /Av. Test 5, 75007 Paris/.test(inf.addr) &&
      inf.osm === 'node/4711',
    'beim Hinzufügen: Infos aus OpenStreetMap ' + JSON.stringify(inf)
  );
  await page.fill('#dateIn', '2027-07-03');
  await page.dispatchEvent('#dateIn', 'change');
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('#segGo', { timeout: 15000 });
  for (const k of [0, 1]) while ((await page.evaluate(k => state.segs[k].n, k)) > 1) await page.click(`[data-segn="${k}"][data-d="-1"]`);
  await page.click('#segGo');
  for (let i = 0; i < 8; i++) {
    await page.waitForFunction(
      () => !state.busy && (document.querySelector('#result [data-pick]') || document.querySelector('#result [data-endpick]') || state.done),
      null,
      { timeout: 30000 }
    );
    if (await page.evaluate(() => state.done && !document.querySelector('#result [data-endpick]'))) break;
    if (await page.$('#result [data-endpick]')) {
      await page.click('#result [data-endpick]');
      await page.waitForFunction(() => !state.busy);
      break;
    }
    await page.click('#result [data-pick]');
  }
  await page.waitForFunction(() => uiTab === 'trip', null, { timeout: 5000 });
  const rowS = async () => (await page.textContent('#tripView tr.sight')).replace(/\s+/g, ' ');
  const rowC = async () => (await page.textContent('#tripView tr.camp')).replace(/\s+/g, ' ');
  // Reiseplan-Tabelle: eingeklappt Kurzzeile, aufgeklappt eigene Zeile je Sehenswürdigkeit unter dem Platz
  ok(
    !(await page.$('#tripView tr.sight')) &&
      /▶\s*1 Sehenswürdigkeit/.test(await page.textContent('#tripView .sgtog')) &&
      !/★ 1/.test(await page.textContent('#tripView tr.camp')),
    'zugeklappt: Aufklapp-Zeile „▶ 1 Sehenswürdigkeit“ unter dem Platz, ohne Unterzeilen, kein ★-Zähler'
  );
  await page.click('#tripView [data-grp="0"]');
  await page.waitForSelector('#tripView tr.sight');
  ok(
    (await page.$$eval('#tripView tr.sight', e => e.length)) === 1 && /★ Paris/.test(await rowS()),
    'eigene Zeile „★ Paris“ unter dem Platz: ' + (await rowS()).slice(0, 60)
  );
  const campTxt = await rowC();
  ok(/Rezeption/.test(campTxt) && !/★ Paris/.test(campTxt), 'Platz-Zeile: nur Platz-Infos');
  await page.waitForFunction(() => /laut Google/.test(document.querySelector('#tripView tr.sight')?.textContent || ''), null, { timeout: 6000 });
  let st = await rowS();
  ok(
    /[\d,]+ km/.test(st) && /Champ de Mars, 75007 Paris/.test(st) && /29 € \(OSM\)/.test(st) && /paris\.example/.test(st) && !/Wohnwagen|🧭/.test(st),
    'Sehenswürdigkeit: Entfernung, Adresse, Preis in Euro, Website: ' + st.slice(0, 200)
  );
  ok(
    await page.evaluate(() => {
      const r = $('#tripView tr.sight');
      return /maps\/dir\/.*origin=/.test(r.querySelector('td[data-l="Adresse"] a').href) && /^https?:/.test(r.querySelector('.pname a').href);
    }),
    'Adresse → Navigation vom Platz, Name → Google-Eintrag'
  );
  ok(/laut Google.*jetzt geöffnet/.test(st) && /★ 4,7/.test(st), 'Google live: Öffnungszeiten + Bewertung');
  ok(await page.evaluate(() => !!$('#tripView tbody[data-grpb="0"].open')), 'Gruppe bleibt dabei offen');
  // Ergebnis des GitHub-Helfers
  await page.evaluate(() => {
    rzData['web:https://paris.example/'] = {
      v: 2,
      status: 'ok',
      checkedAt: new Date().toISOString(),
      hoursS: { text: '09:00–23:00', snippet: 'Öffnungszeiten – täglich 9–23 Uhr', url: 'https://paris.example/info' },
      price: { text: '29 €', adult: 'ab 29 €', child: '7 €', snippet: 'Tickets – Erwachsene ab 29 € · Kinder 7 €', url: 'https://paris.example/tickets' }
    };
    renderTrip();
  });
  st = await rowS();
  ok(
    /Website: 09:00–23:00 · Quelle/.test(st) && /Erw\. ab 29 € · Kind 7 €/.test(st) && /≈ 58 € für 2 Erw\./.test(st) && !/Eintritt EUR 29/.test(st),
    'Website-Recherche: Öffnungszeiten + Preise Erwachsene/Kinder, geschätzt für die Reisenden: ' + st.slice(0, 260)
  );
  await page.screenshot({ path: path.join(OUT, 'sights.png') });
  await page.evaluate(() => {
    rzData['web:https://paris.example/'] = { v: 1, status: 'ok', price: { text: '85 kr', snippet: 'Parkering 85 kr/dag', url: 'x' } };
    renderTrip();
  });
  st = await rowS();
  ok(!/85 kr|85 SEK|Parkering/.test(st), 'alte Recherche (Parkgebühr als Preis) wird ignoriert: ' + st.slice(0, 300));
  await page.evaluate(() => {
    rzData['web:https://paris.example/'] = {
      v: 4,
      status: 'ok',
      lang: 'de',
      season: { from: '1.4.', to: '31.10.', snippet: 'Der Park ist vom 1. April bis 31. Oktober täglich geöffnet.', url: 'https://paris.example/' },
      hoursUrl: 'https://paris.example/oppettider',
      priceUrl: 'https://paris.example/biljetter'
    };
    state.via[0].info.charge = '';
    renderTrip();
  });
  st = await rowS();
  ok(/Saison 1\. April – 31\. Oktober/.test(st), 'Saison von der Website als Datum: ' + (st.match(/Saison[^€]{0,30}/) || [''])[0]);
  ok(
    /Öffnungszeiten auf der Website/.test(st) && /Preise auf der Website/.test(st) && !/nicht gefunden/.test(st),
    'nichts gefunden → direkte Links zu Öffnungszeiten-/Preis-Seite: ' + st.slice(0, 300)
  );
  await page.evaluate(() => {
    rzData['web:https://paris.example/'] = {
      v: 2,
      status: 'ok',
      checkedAt: new Date().toISOString(),
      hoursS: { text: '09:00–23:00', snippet: 'Öffnungszeiten – täglich 9–23 Uhr', url: 'https://paris.example/info' },
      price: { text: '29 €', adult: 'ab 29 €', child: '7 €', snippet: 'x', url: 'https://paris.example/tickets' }
    };
    renderTrip();
  });
  // ohne Website: eintragen
  await page.evaluate(() => {
    state.via[0].info.web = '';
    renderTrip();
  });
  ok(
    !(await page.$('#tripView tr.sight form[data-sweb]')) && !!(await page.$('#tripView tr.sight [data-swebopen]')),
    'ohne Website: nur kleiner Link „+ Website“'
  );
  await page.click('#tripView tr.sight [data-swebopen]');
  ok(await page.$('#tripView tr.sight form[data-sweb] input'), 'ohne Website: Eingabefeld (vorbelegt mit Google-Website)');
  await page.fill('#tripView tr.sight form[data-sweb] input', 'www.eigene-seite.example');
  await page.click('#tripView tr.sight form[data-sweb] button');
  ok(await page.evaluate(() => state.via[0].info.web === 'https://www.eigene-seite.example/'), 'Website gemerkt');
  await page.evaluate(() => {
    state.via[0].info.web = 'https://paris.example/';
    renderTrip();
  });
  // gespeicherte Tour enthält die Infos (für den Helfer)
  await page.click('[data-act="save"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => loadTours()[0].via[0].info.web === 'https://paris.example/'), 'Tour-Datei enthält via.info.web');
  // Word: Sehenswürdigkeit mit Adresse, Öffnungszeiten (Google mit Stand), Website, Preisen
  const dlP = page.waitForEvent('download', { timeout: 30000 });
  await page.click('[data-act="docx"]');
  const dl = await dlP;
  const fp = path.join(OUT, 'sights.docx');
  await dl.saveAs(fp);
  const W = require('./lib/docx')(fp);
  ok(
    /★ Paris/.test(W.text) &&
      /Champ de Mars, 75007 Paris/.test(W.text) &&
      /lt\. Google, Stand \d/.test(W.text) &&
      /paris\.example/.test(W.text) &&
      /Erw\. ab 29 € · Kind 7 €/.test(W.text),
    'Word: Sehenswürdigkeit mit Adresse, Öffnungszeiten (lt. Google, Stand …), Website, Preisen'
  );
  // Info-Fenster gewählter Platz: Entfernung zur Sehenswürdigkeit, keine Wohnwagen-/Ausstattungs-/Navigationszeile
  await page.evaluate(() => {
    const m = lyr.pins
      .getLayers()
      .find(
        l =>
          l.getPopup &&
          /Lokal|Platz|Nachbar/.test(String(l.getPopup().getContent && (typeof l.getPopup().getContent() === 'function' ? '' : l.getPopup().getContent())))
      );
  });
  await page.evaluate(() => {
    const to = state.stages[0].to;
    const m = lyr.pins.getLayers().find(l => {
      const ll = l.getLatLng();
      return Math.abs(ll.lat - to.lat) < 1e-6 && Math.abs(ll.lng - to.lon) < 1e-6;
    });
    map.setView([to.lat, to.lon], 11, { animate: false });
    m.openPopup();
  });
  await page
    .waitForFunction(() => /★ Paris: [\d,]+ km/.test(document.querySelector('.leaflet-popup .pdist')?.textContent || ''), null, { timeout: 5000 })
    .catch(() => {});
  let pop = (await page.textContent('.leaflet-popup .ci')).replace(/\s+/g, ' ');
  ok(
    /★ Paris: [\d,]+ km \/ \d+ min/.test(pop) && !/Wohnwagen|keine Angabe|🔌|🧭|Strom|\+33/.test(pop) && /Google-Eintrag · park4night · Navigation/.test(pop),
    'Info-Fenster Platz: Entfernung zur Sehenswürdigkeit, ohne Wohnwagen/Ausstattung/Navigation: ' + pop.slice(0, 160)
  );
  await page.evaluate(() => map.closePopup());
  await page.waitForTimeout(500);
  // Info-Fenster der Sehenswürdigkeit auf der Karte
  await page.evaluate(() => {
    const v = state.via[0];
    const m = lyr.pins.getLayers().find(l => {
      const ll = l.getLatLng();
      return Math.abs(ll.lat - v.lat) < 1e-6 && Math.abs(ll.lng - v.lon) < 1e-6;
    });
    m.openPopup();
  });
  pop = (await page.textContent('.leaflet-popup .ci')).replace(/\s+/g, ' ');
  await page.waitForTimeout(400);
  pop = (await page.textContent('.leaflet-popup .ci')).replace(/\s+/g, ' ');
  ok(
    /Öffnungszeiten laut Google/.test(pop) && /Erwachsene ab 29 € · Kinder 7 €/.test(pop) && (await page.$('.leaflet-popup details.gh')),
    'Info-Fenster Sehenswürdigkeit: Öffnungszeiten (Woche aufklappbar) + Preis in Euro: ' + pop.slice(0, 160)
  );
  ok(
    /Navigation/.test(pop) && !/🧭/.test(pop) && /Google-Eintrag/.test(pop) && !/Zwischenziel|Nächte/.test(pop),
    'Info-Fenster Sehenswürdigkeit: Navigation + Google-Eintrag: ' + pop
  );
  await page.evaluate(() => map.closePopup());
  // Preis pro Nacht: Website-Recherche (rezeption.json) und Google-Preisspanne
  await page.evaluate(() => {
    const c = state.stages[0].to;
    rzData[c.id] = {
      v: 3,
      website: webOf(c),
      status: 'ok',
      checkedAt: new Date().toISOString(),
      price: { text: '395 kr', snippet: 'Priser – Tomt med el, husvagn per natt · 395 kr', url: 'https://x.example/priser' }
    };
    tlOpen.add(0);
    renderTrip();
  });
  const camp0 = await rowC();
  await page.evaluate(() => {
    const c = state.stages[0].to;
    rzData[c.id].price = { text: '415:-', snippet: 'exkl. el – 415:-', url: 'https://x.example/priser', power: 'without', elec: '60:-' };
    renderTrip();
  });
  const campE = await rowC();
  ok(/≈ 36 € \(415 SEK\) \/ Nacht · ohne Strom \(\+ ≈ 5 € Strom\)/.test(campE), 'Platzpreis ohne Strom + Stromzuschlag: ' + campE.slice(0, 300));
  await page.evaluate(() => {
    const c = state.stages[0].to;
    rzData[c.id].price = { text: '395 kr', snippet: 'Priser – Tomt med el, husvagn per natt · 395 kr', url: 'https://x.example/priser', power: 'with' };
    renderTrip();
  });
  const campW = await rowC();
  ok(/≈ \d+ € \(395 SEK\) \/ Nacht · mit Strom/.test(campW), 'Platzpreis mit Strom');
  ok(
    /≈ \d+ € \(395 SEK\)/.test(camp0) &&
      !/husvagn per natt/.test(camp0) &&
      /· Website/.test(camp0) &&
      /gesamt ≈?\s?\d+ €/.test(camp0) &&
      !/Wohnwagen erlaubt|keine Angabe/.test(camp0),
    'Tabelle: Preis pro Nacht von der Website + Gesamtpreis, keine Wohnwagen-Angabe: ' + camp0.slice(camp0.indexOf('≈'), camp0.indexOf('≈') + 200)
  );
  await page.evaluate(() => {
    const c = state.stages[0].to;
    delete rzData[c.id];
    gRate.set(c.id, {
      name: 'Hultsfreds Camping',
      near: true,
      r: 4.2,
      n: 10,
      uri: 'https://g.example',
      oh: ['Montag: 08:00–20:00'],
      open: true,
      price: gPriceText({ startPrice: { currencyCode: 'SEK', units: '300' }, endPrice: { currencyCode: 'SEK', units: '450' } }),
      web: ''
    });
    renderTrip();
  });
  const camp1 = await rowC();
  ok(
    /Hultsfreds Camping \(OSM: Lokal 0\)/.test(await page.textContent('#tripView tr.camp .pname')),
    'Google-Name als Überschrift, OSM-Name klein dahinter: ' + (await page.textContent('#tripView tr.camp .pname')).trim()
  );
  ok(
    /≈ \d+–\d+ € \(SEK 300–450\)/.test(camp1) && /· Google/.test(camp1) && /Öffnungszeiten laut Google/.test(camp1),
    'Google: Preisspanne + Öffnungszeiten am Platz'
  );
  // Preisanfrage an den Helfer (anfragen.json im Online-Speicher)
  const puts = [];
  await page.route('**/api.github.com/**', r => {
    const m = r.request().method();
    if (m === 'PUT') {
      puts.push({ url: r.request().url(), body: JSON.parse(r.request().postData()) });
      return r.fulfill({ json: { content: { sha: 'abc' } } });
    }
    return r.fulfill({ status: 404, json: { message: 'Not Found' } });
  });
  await page.evaluate(() => {
    settings.ghToken = 't';
    settings.ghRepo = 'a/b';
    priceReq.clear();
    requestPrices([
      { id: 'node/1', tags: { name: 'A', website: 'https://a.example' } },
      { id: 'node/2', tags: { name: 'B' } },
      { id: 'node/3', tags: { name: 'C', website: 'c.example' } }
    ]);
  });
  await page.waitForTimeout(2500);
  const req = puts.find(p => p.url.includes('anfragen.json'));
  const body = req && JSON.parse(Buffer.from(req.body.content, 'base64').toString('utf8'));
  ok(
    body && body.camps.length === 2 && body.camps.map(c => c.id).join() === 'node/1,node/3' && body.camps[0].website === 'https://a.example',
    'Preisanfrage: nur Plätze mit Website in anfragen.json: ' + (body ? body.camps.map(c => c.id + '=' + c.website).join(', ') : 'keine')
  );
  // Platz im Reiseplan mit toter OSM-Website: Google-Website wird angefragt (Schlüssel cw:)
  puts.length = 0;
  await page.evaluate(() => {
    const c = state.stages[0].to;
    priceReq.clear();
    rzData[c.id] = { v: 5, website: webOf(c), status: 'error', error: 'HTTP 404' };
    gRate.set(c.id, { r: 4, n: 3, near: true, web: 'https://neu.example/camping', oh: [] });
    renderTrip();
  });
  await page.waitForTimeout(2500);
  const req2 = puts.find(p => p.url.includes('anfragen.json')),
    body2 = req2 && JSON.parse(Buffer.from(req2.body.content, 'base64').toString('utf8'));
  ok(
    body2 && body2.camps.some(c => c.id === 'cw:https://neu.example/camping' && c.website === 'https://neu.example/camping'),
    'Reiseplan: tote OSM-Website → Google-Website wird recherchiert'
  );
  ok(/neu\.example/.test(await rowC()), 'Link zeigt die Google-Website');
  await page.evaluate(() => {
    settings.ghToken = '';
    settings.ghRepo = '';
    pricePoll.forEach(clearTimeout);
  });
  // Stadt als Ziel (Stockholm, Göteborg …): keine Öffnungszeiten/Preise
  T.sightEls = [{ type: 'node', id: 99, lat: 48.8566, lon: 2.3522, tags: { place: 'city', name: 'Paris' } }, ...T.sightEls];
  await page.evaluate(async () => {
    state.via[0].info.v = 1;
    await enrichSight(state.via[0]);
    renderTrip();
  });
  ok(await page.evaluate(() => state.via[0].info.town === true && !state.via[0].info.oh), 'Ort erkannt (place=city) → info.town');
  st = await rowS();
  ok(
    !/Öffnungszeiten|Preis|Eintritt|Website eintragen/.test(st) && /[\d,]+ km/.test(st) && !(await page.$('#tripView tr.sight form[data-sweb]')),
    'Ort: keine Öffnungszeiten/Preise, nur Entfernung + Links: ' + st.slice(0, 120)
  );
  await page.evaluate(() => {
    const c = state.stages[0].to;
    delete rzData[c.id];
    gRate.set(c.id, { r: null, n: 0, near: false, oh: [] });
    tlOpen.add(0);
    renderTrip();
  });
  const campN = await rowC();
  const phC = await page.$$eval('#tripView tr.camp .ed .ph', x => x.map(y => y.textContent).join('|'));
  ok(
    /Preis \/ Nacht/.test(phC) && /Rezeption, Check-in/.test(phC) && !/Preis –|Rezeption –/.test(campN),
    'nichts gefunden: blasse Platzhalter „Preis / Nacht“, „Rezeption, Check-in“ am Platz'
  );
  await page.evaluate(() => {
    state.via[0].info = { v: INFO_V, web: '', oh: '' };
    gSight.set(sightKey(state.via[0]), { oh: [], r: null });
    renderTrip();
  });
  st = await rowS();
  const phS = await page.$$eval('#tripView tr.sight .ed .ph', x => x.map(y => y.textContent).join('|'));
  ok(/Öffnungszeiten/.test(phS) && /Preis/.test(phS), 'Sehenswürdigkeit ohne Angaben: blasse Platzhalter „Öffnungszeiten“, „Preis“');
  // Handy
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => setSheet('full'));
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => $('#scroll').scrollWidth <= $('#scroll').clientWidth + 1), 'kein waagerechtes Scrollen (Handy)');
  await page.screenshot({ path: path.join(OUT, 'sights-handy.png') });
  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
