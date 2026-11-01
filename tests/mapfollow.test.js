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

const srv = require('./lib/server')(ROOT, 8147);

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

  await page.route('**/places.googleapis.com/**', r => {
    const u = r.request().url();
    if (u.includes('searchNearby')) {
      const c = JSON.parse(r.request().postData()).locationRestriction.circle.center;
      return new Promise(res => setTimeout(res, 300)).then(() =>
        r.fulfill({
          json: {
            places: [
              {
                displayName: { text: 'Ganz Anderer Name Camping' },
                location: { latitude: c.latitude, longitude: c.longitude },
                googleMapsUri: 'https://maps.google.com/?cid=1'
              }
            ]
          }
        })
      );
    }
    return r.fulfill({ json: { places: [] } });
  });
  await page.goto('http://localhost:8147/');
  await page.evaluate(() => localStorage.setItem('gp.settings', JSON.stringify({ key: 'eyJtest', gkey: 'AIzaTest' })));
  await page.reload();
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Test' : undefined));
  const addVia = async t => {
    const n0 = await page.evaluate(() => state.via.length);
    await page.fill('#viaIn', t);
    await page.waitForTimeout(600);
    await page.press('#viaIn', 'Enter');
    await page.waitForFunction(n => state.via.length === n, n0 + 1);
  };
  await page.evaluate(() => map.setView([60, 20], 6, { animate: false }));
  await page.evaluate(() => {
    state.start = { lat: 51.4436, lon: 7.3532, label: 'Witten, Testland' };
  });
  await addVia('Paris');
  await page.waitForTimeout(1200);
  ok(
    await page.evaluate(() => map.getBounds().contains([48.8566, 2.3522]) && map.getBounds().contains([51.4436, 7.3532])),
    'Ziel eingegeben → Karte zeigt Start und Zwischenziel'
  );
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('#segGo', { timeout: 15000 });
  while ((await page.evaluate(() => state.segs[0].n)) < 2) await page.click(`[data-segn="0"][data-d="1"]`);
  while ((await page.evaluate(() => state.segs[0].n)) > 2) await page.click(`[data-segn="0"][data-d="-1"]`);
  while ((await page.evaluate(() => state.segs[1].n)) > 1) await page.click(`[data-segn="1"][data-d="-1"]`);
  await page.click('#segGo');
  await page.waitForFunction(() => state.pending && !state.busy, null, { timeout: 30000 });
  // 0) Transit-Platz: Info-Fenster, Google-Name lädt nach (Fenster wird neu ausgerichtet) → Knopf funktioniert
  ok(await page.evaluate(() => state.pending.mode !== 'anchor'), 'erst Transit-Etappe');
  await page.evaluate(() => {
    const c = state.pending.cands.find(c => c._m);
    map.setView([c.lat, c.lon], 11, { animate: false });
    c._m.openPopup();
  });
  await page.waitForFunction(() => /\(OSM: /.test(document.querySelector('.leaflet-popup')?.textContent || ''), null, { timeout: 5000 });
  await page.click('.leaflet-popup [data-pick]');
  await page.waitForFunction(() => state.stages.length === 1 && !state.busy, null, { timeout: 15000 });
  ok(true, '„Als Etappenziel wählen“ (Transit) funktioniert nach Google-Name');
  await page.waitForSelector('#ancR', { timeout: 30000 });
  await page.waitForFunction(() => !state.busy);
  // 1) Griff am Kreisrand ziehen → größerer Umkreis, neue Suche
  ok(!!(await page.$('.rhandle')), 'Griff ↔ am Kreisrand vorhanden');
  const r0 = await page.evaluate(() => state.pending.radius);
  await page.waitForTimeout(1200);
  const hb = await (await page.$('.rhandle')).boundingBox();
  const cx = hb.x + hb.width / 2,
    cy = hb.y + hb.height / 2;
  const px20 = await page.evaluate(() => {
    const q = state.pending.sight;
    const a = map.latLngToContainerPoint([q.lat, q.lon]);
    const b = map.latLngToContainerPoint(edgeAt(q, 20000));
    return b.x - a.x;
  });
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + (px20 * 0.75 * i) / 10, cy, { steps: 2 });
  const tip = await page.evaluate(() => document.querySelector('.rtip')?.textContent);
  await page.mouse.up();
  await page.waitForFunction(r0 => state.pending && state.pending.radius !== r0 && !state.busy, r0, { timeout: 15000 });
  const r1 = await page.evaluate(() => state.pending.radius);
  ok(r1 >= 33 && r1 <= 37, `Umkreis gezogen ${r0} → ${r1} km (Anzeige beim Ziehen: „${tip}“)`);
  ok(await page.evaluate(r1 => $('#ancR').value === String(r1), r1), 'Auswahlfeld zeigt den gezogenen Wert');
  ok(
    await page.evaluate(() => {
      const q = state.pending.sight,
        b = map.getBounds();
      return b.contains(edgeAt(q, state.pending.radius * 1000));
    }),
    'Karte zeigt den ganzen Kreis'
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'mapfollow-radius.png') });
  // 2) Liste: Maus über Eintrag außerhalb des Kartenbilds → Karte fährt hin
  const cid = await page.evaluate(() => state.pending.cands[state.pending.cands.length - 1].id);
  await page.evaluate(() => map.setView([60, 20], 12, { animate: false }));
  await page.hover(`#result li.cand:has([data-show="${cid}"]) .name`);
  await page.waitForTimeout(900);
  ok(
    await page.evaluate(id => {
      const c = campIndex.get(id);
      return map.getBounds().contains([c.lat, c.lon]);
    }, cid),
    'Maus über Listeneintrag → Karte fährt zum Platz'
  );
  ok(await page.evaluate(id => campIndex.get(id)._m.getRadius() > 9, cid), 'Platz auf der Karte hervorgehoben');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(100);
  ok(await page.evaluate(id => campIndex.get(id)._m.getRadius() === 9, cid), 'Hervorhebung danach zurück');
  // 3) „Platz fehlt?“-Suche: Treffer auf der Karte, Ansicht fährt dorthin
  await page.route('**/photon.komoot.io/api/**', r =>
    r.fulfill({
      json: {
        features: [
          {
            geometry: { coordinates: [2.9, 48.4] },
            properties: {
              name: 'Camping Fern',
              city: 'Fontainebleau',
              country: 'Frankreich',
              osm_type: 'N',
              osm_id: 778,
              osm_key: 'tourism',
              osm_value: 'camp_site'
            }
          },
          {
            geometry: { coordinates: [2.2, 48.95] },
            properties: { name: 'Camping Nah', city: 'Paris', country: 'Frankreich', osm_type: 'N', osm_id: 779, osm_key: 'tourism', osm_value: 'camp_site' }
          }
        ]
      }
    })
  );
  await page.evaluate(() => map.setView([60, 20], 12, { animate: false }));
  await page.fill('form.addcamp input', 'Camping');
  await page.click('form.addcamp button');
  await page.waitForSelector('.addres [data-ar]');
  await page.waitForTimeout(500);
  ok(
    await page.evaluate(() => lyr.hits.getLayers().length === 2 && map.getBounds().contains([48.4, 2.9]) && map.getBounds().contains([48.95, 2.2])),
    'Suchtreffer als Nummern auf der Karte, Karte zeigt sie'
  );
  const mk = await page.evaluate(() => {
    const m = lyr.hits.getLayers()[0];
    const p = map.latLngToContainerPoint(m.getLatLng());
    const r = $('#map').getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y - 16 };
  });
  const n0 = await page.evaluate(() => state.pending.cands.length);
  await page.mouse.click(mk.x, mk.y);
  await page.waitForFunction(n => state.pending.cands.length === n + 1 && !state.busy, n0, { timeout: 10000 });
  ok(
    await page.evaluate(() => state.pending.cands.some(c => c.id === 'node/779' && c.added) && lyr.hits.getLayers().length === 0),
    'Treffer auf der Karte antippen → ergänzt, Nummern weg'
  );
  // ergänzter Platz bleibt bei neuem Umkreis
  await page.selectOption('#ancR', '50');
  await page.waitForFunction(() => state.pending.radius === 50 && !state.busy, null, { timeout: 15000 });
  ok(await page.evaluate(() => state.pending.cands.some(c => c.id === 'node/779')), 'ergänzter Platz bleibt bei neuem Umkreis');
  // 4) Info-Fenster: Google-Name lädt nach → Knopf „Als Etappenziel wählen“ funktioniert trotzdem
  await page.evaluate(() => map.closePopup());
  await page.evaluate(() => {
    const c = state.pending.cands.find(c => c._m && !c.added);
    map.setView([c.lat, c.lon], 11, { animate: false });
    c._m.openPopup();
  });
  await page.waitForFunction(() => /\(OSM: /.test(document.querySelector('.leaflet-popup')?.textContent || ''), null, { timeout: 5000 });
  await page.waitForTimeout(400);
  ok(
    await page.evaluate(() => /★ .+: [\d,]+ km/.test(document.querySelector('.leaflet-popup .pdist')?.textContent || '')),
    'Straßenentfernung bleibt nach Google-Name stehen'
  );
  const s0 = await page.evaluate(() => state.stages.length);
  await page.click('.leaflet-popup [data-pick]');
  await page.waitForTimeout(1500);
  await page.waitForFunction(s0 => state.stages.length > s0 && !state.busy, s0, { timeout: 15000 });
  ok(true, '„Als Etappenziel wählen“ im Info-Fenster übernimmt den Platz (nach Google-Name)');
  await page.screenshot({ path: path.join(OUT, 'mapfollow.png') });
  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
