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

const srv = require('./lib/server')(ROOT, 8145);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true, viewport: { width: 1200, height: 900 } });
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

  await page.goto('http://localhost:8145/');
  await page.evaluate(() => localStorage.setItem('gp.settings', JSON.stringify({ key: 'eyJtest' })));
  await page.reload();
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Frankreich-Tour' : undefined));
  const addVia = async t => {
    const n0 = await page.evaluate(() => state.via.length);
    await page.fill('#viaIn', t);
    await page.waitForTimeout(600);
    await page.press('#viaIn', 'Enter');
    await page.waitForFunction(n => state.via.length === n, n0 + 1);
  };
  await page.route('**/photon.komoot.io/api/**', r =>
    r.fulfill({
      json: {
        features: [
          {
            geometry: { coordinates: [2.47, 48.83] },
            properties: {
              name: 'Camping Indigo Paris',
              city: 'Paris',
              country: 'Frankreich',
              osm_type: 'N',
              osm_id: 777,
              osm_key: 'tourism',
              osm_value: 'camp_site'
            }
          },
          {
            geometry: { coordinates: [2.35, 48.86] },
            properties: { name: 'Rue Indigo', city: 'Paris', country: 'Frankreich', osm_type: 'W', osm_id: 5, osm_key: 'highway', osm_value: 'residential' }
          },
          {
            geometry: { coordinates: [13.4, 52.5] },
            properties: { name: 'Indigo Berlin', city: 'Berlin', country: 'Deutschland', osm_type: 'N', osm_id: 6, osm_key: 'tourism', osm_value: 'camp_site' }
          }
        ]
      }
    })
  );
  await addVia('Paris');
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('#segGo', { timeout: 15000 });
  for (const k of [0, 1]) while ((await page.evaluate(k => state.segs[k].n, k)) > 1) await page.click(`[data-segn="${k}"][data-d="-1"]`);
  const seen = page
    .waitForFunction(() => !$('#mapBusy').hidden && /Campingpl|Route|Entfernung/.test($('#mapBusy').textContent), null, { timeout: 15000, polling: 20 })
    .then(() => true)
    .catch(() => false);
  T.opDelay = 800;
  await page.click('#segGo');
  ok(await seen, 'Lade-Anzeige über der Karte sichtbar');
  T.opDelay = 0;
  await page.waitForSelector('#ancR', { timeout: 30000 });
  await page.waitForFunction(() => !state.busy);
  ok(await page.evaluate(() => $('#mapBusy').hidden), 'Lade-Anzeige danach weg');
  // Info-Fenster mit Straßenentfernung
  await page.evaluate(() => {
    const c = state.pending.cands[1];
    c._m.openPopup();
  });
  await page.waitForFunction(() => /★ .+: [\d,]+ km/.test(document.querySelector('.leaflet-popup .pdist')?.textContent || ''), null, { timeout: 5000 });
  ok(true, 'Info-Fenster: ' + (await page.textContent('.leaflet-popup .pdist')).trim());
  await page.evaluate(() => map.closePopup());
  const n0 = await page.evaluate(() => state.pending.cands.length);
  // a) Koordinaten
  await page.fill('form.addcamp input', '48.80000, 2.40000');
  await page.click('form.addcamp button');
  await page.waitForFunction(n => state.pending.cands.length === n + 1 && !state.busy, n0);
  let c = await page.evaluate(() => {
    const c = state.pending.cands.find(x => x.added);
    return { name: c.tags.name, sd: c.sight && Math.round(c.sight.d) };
  });
  ok(c.name === 'Frankreich-Tour' && c.sd > 0, 'Koordinaten ergänzt (Name aus Abfrage): ' + JSON.stringify(c));
  ok((await page.textContent('#result')).includes('von dir ergänzt'), 'Badge „von dir ergänzt“');
  // b) Name über Photon: Campingplatz zuerst, weit entfernte (Berlin) ausgefiltert
  await page.fill('form.addcamp input', 'Indigo');
  await page.click('form.addcamp button');
  await page.waitForSelector('.addres [data-ar]');
  const res = await page.$$eval('.addres [data-ar]', e => e.map(x => x.textContent.trim()));
  ok(res.length === 2 && res[0].startsWith('1 ⛺ Camping Indigo Paris') && !res.some(x => x.includes('Berlin')), 'Namenssuche: ' + res.join(' | '));
  await page.click('.addres [data-ar="0"]');
  await page.waitForFunction(n => state.pending.cands.length === n + 2 && !state.busy, n0);
  ok(await page.evaluate(() => state.pending.cands.some(x => x.id === 'node/777' && x.added)), 'OSM-Platz mit echter ID ergänzt');
  // c) Google-Maps-Link
  await page.fill('form.addcamp input', 'https://www.google.com/maps/place/Camping+Le+Test/@48.9,2.3,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d48.85!4d2.31');
  await page.click('form.addcamp button');
  await page.waitForFunction(n => state.pending.cands.length === n + 3 && !state.busy, n0);
  c = await page.evaluate(() => {
    const c = state.pending.cands.find(x => x.tags.name === 'Camping Le Test');
    return c && [c.lat, c.lon];
  });
  ok(c && c[0] === 48.85 && c[1] === 2.31, 'Google-Link: Name + Platz-Koordinaten (!3d/!4d) ' + JSON.stringify(c));
  await page.fill('form.addcamp input', 'https://maps.app.goo.gl/abc');
  await page.click('form.addcamp button');
  ok((await page.textContent('.addres')).includes('Kurzlinks'), 'Kurzlink → Erklärung');
  await page.screenshot({ path: path.join(OUT, 'addcamp.png') });
  // ergänzten Platz wählen
  const id = await page.evaluate(() => state.pending.cands.find(x => x.tags.name === 'Camping Le Test').id);
  await page.click(`#result [data-pick="${id}"]`);
  await page.waitForFunction(() => !state.busy && state.stages.length >= 1, null, { timeout: 20000 });
  ok(
    await page.evaluate(() => state.stages[0].to.label === 'Camping Le Test' && state.stages[0].to.near && /Paris/.test(state.stages[0].to.near.label)),
    'Ergänzter Platz ist Etappenziel bei Paris'
  );
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => $('#scroll').scrollWidth <= $('#scroll').clientWidth + 1), 'kein waagerechtes Scrollen (Handy)');
  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
