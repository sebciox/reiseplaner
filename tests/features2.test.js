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
const PLACES = { Witten: [51.4436, 7.3532], 'Sant Pere Pescador': [42.1885, 3.0806] };
const A = PLACES['Witten'],
  B = PLACES['Sant Pere Pescador'];
let failures = 0;
const ok = (c, m) => {
  console.log((c ? 'OK   ' : 'FAIL ') + m);
  if (!c) failures++;
};

const srv = require('./lib/server')(ROOT, 8134);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    serviceWorkers: 'block',
    acceptDownloads: true,
    viewport: { width: 1200, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write']
  });
  await ctx.addInitScript(() => {
    window.__allTabs = true;
  });
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
    photon: 0,
    osrm: 0,
    google: 0,
    orsDown: false,
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
    if (u.includes('openrouteservice') && T.orsDown) return r.fulfill({ status: 401, json: { error: 'Access to this API has been disallowed' } });
    if (u.includes('photon.komoot.io/reverse')) {
      T.photon++;
      const la = +new URL(u).searchParams.get('lat');
      return r.fulfill({
        json: { features: [{ properties: { countrycode: la > 47.5 ? 'de' : la > 42.6 ? 'fr' : 'es', name: 'Ort', city: 'Stadt', country: 'Land' } }] }
      });
    }
    if (u.includes('photon.komoot.io/api')) {
      T.photon++;
      const q = new URL(u).searchParams.get('q');
      const k = Object.keys(PLACES).find(k => q.includes(k));
      const p = PLACES[k];
      return r.fulfill({ json: { features: p ? [{ geometry: { coordinates: [p[1], p[0]] }, properties: { name: k, country: 'Testland' } }] : [] } });
    }
    if (u.includes('project-osrm.org/route')) {
      T.osrm++;
      const m = u.match(/driving\/([\d.\-]+),([\d.\-]+);([\d.\-]+),([\d.\-]+)/);
      const a = [+m[2], +m[1]],
        b = [+m[4], +m[3]];
      const N = 100,
        coords = Array.from({ length: N + 1 }, (_, i) => [a[1] + ((b[1] - a[1]) * i) / N, a[0] + ((b[0] - a[0]) * i) / N]),
        d = hav(a, b);
      return r.fulfill({
        json: {
          code: 'Ok',
          routes: [
            { distance: d, duration: d / 25, geometry: { coordinates: coords }, legs: [{ steps: [{ distance: d, duration: d / 25, mode: 'driving' }] }] }
          ]
        }
      });
    }
    if (u.includes('project-osrm.org/table')) {
      T.osrm++;
      const m = u.match(/driving\/([^?]+)\?/);
      const L = m[1]
        .split(';')
        .map(x => x.split(',').map(Number))
        .map(x => [x[1], x[0]]);
      const q = new URL(u).searchParams;
      const S = q.get('sources').split(';').map(Number),
        D = q.get('destinations').split(';').map(Number);
      const distances = S.map(i => D.map(j => hav(L[i], L[j]) * 1.3));
      return r.fulfill({ json: { code: 'Ok', distances, durations: distances.map(x => x.map(v => v / 15)) } });
    }
    if (u.includes('places:searchNearby')) return r.fulfill({ json: { places: [] } });
    if (u.includes('places.googleapis.com')) {
      T.google++;
      const b = JSON.parse(r.request().postData());
      const c = b.locationBias.circle.center;
      const rating = 3 + (Math.round(c.latitude * 1000) % 20) / 10;
      return r.fulfill({
        json: {
          places: [
            {
              id: 'p' + T.google,
              rating: Math.min(5, rating),
              userRatingCount: 10 + T.google * 7,
              googleMapsUri: 'https://maps.google.com/?cid=' + T.google,
              location: { latitude: c.latitude + 0.001, longitude: c.longitude }
            }
          ]
        }
      });
    }
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
      const [[lo1, la1], [lo2, la2]] = b.coordinates;
      const N = 200;
      const coords = Array.from({ length: N + 1 }, (_, i) => [lo1 + ((lo2 - lo1) * i) / N, la1 + ((la2 - la1) * i) / N]);
      const dist = hav([la1, lo1], [la2, lo2]) * 1.0;
      // Schritte: 70 % Autobahn mit 120 km/h, 30 % Landstraße mit 60 km/h
      const s1 = dist * 0.7,
        s2 = dist * 0.3,
        d1 = s1 / (120 / 3.6),
        d2 = s2 / (60 / 3.6);
      const props = {
        summary: { distance: dist, duration: d1 + d2 },
        extras: {
          waycategory: {
            summary: [
              { value: 1, distance: dist - 20000 },
              { value: 4, distance: 20000 }
            ]
          },
          tollways: {
            summary: [
              { value: 0, distance: dist - 150000 },
              { value: 1, distance: 150000 }
            ]
          }
        }
      };
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
      return r.fulfill({ json: { elements: all.filter(e => e.lat >= S && e.lat <= N && e.lon >= W && e.lon <= E) } });
    }
    return r.continue();
  });

  await page.addInitScript(() => {
    window.__shared = null;
    navigator.share = async d => {
      window.__shared = d;
    };
  });
  await page.goto('http://localhost:8134/');
  await page.evaluate(() => localStorage.setItem('gp.settings', JSON.stringify({ key: 'eyJtest', gkey: 'AIzaTest' })));
  await page.reload();
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Testtour' : undefined));
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('[data-n]');
  await page.click('[data-n="3"]');
  await page.waitForSelector('[data-pick]');
  await page.waitForFunction(() => document.querySelectorAll('#result .cands .stars').length > 0, null, { timeout: 15000 });
  const g1 = T.google;
  ok(g1 > 0 && g1 <= 20, `Google-Bewertungen geladen (${g1} Abfragen, max. 20)`);
  const stars = await page.$$eval('#result .cands .stars', e => e.map(x => x.textContent.trim()));
  ok(stars[0].startsWith('★'), 'Sterne in der Liste: ' + stars.slice(0, 4).join(' | '));
  await page.click('[data-sort="rating"]');
  const vals = await page.$$eval('#result .cands .stars', e => e.map(x => parseFloat(x.textContent.replace('★', '').replace(',', '.'))).filter(v => !isNaN(v)));
  ok(vals.length > 2 && vals.every((v, i) => i === 0 || v <= vals[i - 1] + 0.6), 'Sortierung nach Bewertung: ' + vals.slice(0, 6).join(', '));
  ok((await page.textContent('#result')).includes('Bewertungen: Google'), 'Hinweis „Bewertungen: Google“');
  await page.click('[data-sort="stage"]');
  // Idealpunkt-Koordinaten
  const ip = await page.textContent('.ideal .coord');
  await page.click('.ideal [data-copy]');
  ok((await page.evaluate(() => navigator.clipboard.readText())) === ip.trim(), 'Idealpunkt kopiert: ' + ip.trim());
  ok((await page.getAttribute('.ideal a', 'href')).startsWith('https://www.google.com/maps/search/camping/@'), '„Camping in der Nähe“-Link am Idealpunkt');
  for (let i = 0; i < 4; i++) {
    if (await page.$('[data-endpick]')) break;
    await page.waitForSelector('[data-pick]');
    await page.click('[data-pick]');
    await page.waitForFunction(() => document.querySelector('[data-pick]') || document.querySelector('[data-endpick]'));
    await page.waitForTimeout(200);
  }
  await page.click('[data-endpick]');
  await page.waitForSelector('.endsel');
  // Details: Koordinaten, Länder, Fähre, Maut
  await page.click('[data-det="0"]');
  await page.waitForFunction(() => /Fähre auf der Strecke/.test(document.querySelector('.det')?.textContent || ''), null, { timeout: 15000 });
  const det = (await page.textContent('.det')).replace(/\s+/g, ' ');
  ok(/Koordinaten \d+\.\d{5}, \d+\.\d{5}/.test(det), 'Details: Koordinaten');
  ok(det.includes('Fähre auf der Strecke (20 km)') && det.includes('Mautstrecke ca. 150 km'), 'Details: Fähre + Maut aus ORS');
  ok(!/km\/h|Richtwerte|ADAC/.test(det), 'Details: keine Länder-Richtwerte mehr');
  // Check-in/out vom Helfer
  const c0 = await page.evaluate(() => ({ id: state.stages[0].to.id, web: webOf(state.stages[0].to) }));
  await page.evaluate(
    ([id, web]) => {
      rzData = {
        [id]: {
          status: 'ok',
          website: web,
          hours: '08:00–20:00',
          snippet: 'Receptionen har åben kl. 8-20',
          url: web + '/info',
          checkedAt: new Date().toISOString(),
          checkin: { text: 'ab 14:00', snippet: 'Ankomst: fra kl. 14.00', url: web + '/info' },
          checkout: { text: 'bis 12:00', snippet: 'Afrejse: senest kl. 12.00', url: web + '/info' }
        }
      };
      renderPanel();
    },
    [c0.id, c0.web]
  );
  const rz = (await page.textContent('.det .rz')).replace(/\s+/g, ' ');
  ok(rz.includes('Rezeption: 08:00–20:00') && rz.includes('Check-in: ab 14:00') && rz.includes('Check-out: bis 12:00'), 'Details: Rezeption + Check-in/out');
  // Teilen
  await page.click('[data-share="0"]');
  await page.waitForFunction(() => window.__shared);
  const sh = await page.evaluate(() => window.__shared.text);
  ok(
    sh.includes('Koordinaten:') && sh.includes('Navigation: https://www.google.com/maps/dir/') && sh.includes('Check-in: ab 14:00'),
    'Teilen-Text:\n       ' + sh.split('\n').join('\n       ')
  );
  // Übersicht + Druck
  await page.addInitScript(() => {});
  await page.evaluate(() => {
    window.print = () => {
      window.__printed = 1;
    };
  });
  await page.click('#sumBtn');
  await page.waitForSelector('#sumDlg[open]');
  ok(!/km\/h|Richtwerte/.test(await page.textContent('#sumBody')), 'Übersicht ohne Länder-Richtwerte');
  await page.click('#printBtn');
  await page.waitForFunction(() => window.__printed, null, { timeout: 20000 });
  const ptxt = await page.textContent('#print');
  ok(ptxt.includes('Check-in ab 14:00') && /\d+\.\d{5}, \d+\.\d{5}/.test(ptxt) && ptxt.includes('Fähre'), 'Druck: Check-in, Koordinaten, Fähre');
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: path.join(OUT, 'tour2.pdf'), landscape: true, format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });

  // Ersatzdienst: ORS gesperrt (401)
  const ctx2 = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1200, height: 900 } });
  await ctx2.addInitScript(() => {
    window.__allTabs = true;
  });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => {
    console.log('PAGEERROR', e.message);
    failures++;
  });
  await p2.route('**/*', r => (page.context()._routes ? r.continue() : r.continue()));
  await p2.unroute('**/*');
  for (const rt of page.context()._routes || []) {
  }
  await ctx2.close();
  T.orsDown = true;
  const msgs = [];
  page.removeAllListeners('dialog');
  page.on('dialog', d => {
    msgs.push(d.message());
    d.type() === 'confirm' && msgs.length === 1 ? d.dismiss() : d.accept();
  });
  await page.evaluate(() => {
    resetTour();
    routeMem.clear();
    mxCache = [];
    cacheClear();
  });
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('#status.error');
  ok(
    msgs[0] && msgs[0].includes('Ersatzdienst') && (await page.textContent('#status')).includes('OpenRouteService'),
    'ORS 401 → Rückfrage; „Abbrechen“ → Fehlermeldung: ' + (await page.textContent('#status')).trim()
  );
  const o0 = T.osrm,
    ph0 = T.photon;
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('[data-n]', { timeout: 15000 });
  ok(
    (await page.isVisible('#fbNote')) && T.photon > ph0 && T.osrm > o0,
    `Rückfrage „OK“ → Ersatzdienst aktiv (Photon ${T.photon - ph0}×, OSRM ${T.osrm - o0}×), Hinweis sichtbar`
  );
  await page.click('[data-n="3"]');
  await page.waitForSelector('[data-pick]', { timeout: 20000 });
  ok(T.osrm - o0 >= 2 && msgs.length === 2, 'Umwege über OSRM, nur einmal gefragt');
  await page.click('#fbOff');
  ok(await page.isHidden('#fbNote'), '„zurück zu ORS“ blendet Hinweis aus');
  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
