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

const srv = require('./lib/server')(ROOT, 8143);

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

  await page.goto('http://localhost:8143/');
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
  await addVia('Paris');
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('#segGo', { timeout: 15000 });
  for (const k of [0, 1]) while ((await page.evaluate(k => state.segs[k].n, k)) > 1) await page.click(`[data-segn="${k}"][data-d="-1"]`);
  await page.click('#segGo');
  await page.waitForSelector('#ancR', { timeout: 30000 });
  await page.waitForFunction(() => !state.busy);
  await page.waitForTimeout(1000);
  const pos = await page.evaluate(() => {
    const c = state.pending.cands.find(c => c._m);
    const p = map.latLngToContainerPoint(c._m.getLatLng());
    const r = $('#map').getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, id: c.id, n: state.pending.cands.length, mode: state.pending.mode };
  });
  console.log('marker', JSON.stringify(pos));
  const top = await page.evaluate(p => {
    const e = document.elementFromPoint(p.x, p.y);
    return e.tagName + '.' + (e.getAttribute('class') || '') + ' in ' + (e.closest('.leaflet-pane')?.className || '');
  }, pos);
  console.log('top element:', top);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(600);
  const pop = await page.$('.leaflet-popup-content');
  console.log('popup:', pop ? (await pop.textContent()).slice(0, 200) : 'KEIN POPUP');
  const posOf = id =>
    page.evaluate(id => {
      const c = state.pending.cands.find(c => c.id === id);
      const p = map.latLngToContainerPoint(c._m.getLatLng());
      const r = $('#map').getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y + 4 };
    }, id);
  let pp = await posOf(pos.id);
  await page.mouse.click(pp.x, pp.y);
  await page.waitForTimeout(500);
  ok(!(await page.$('.leaflet-popup')), 'zweiter Klick schließt das Info-Fenster');
  pos.x = pp.x;
  pos.y = pp.y;
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(500);
  ok(!!(await page.$('.leaflet-popup [data-pick]')), 'dritter Klick öffnet es wieder');
  const other = await page.evaluate(() => {
    const c = state.pending.cands.filter(c => c._m)[1];
    if (!c) return null;
    const p = map.latLngToContainerPoint(c._m.getLatLng());
    const r = $('#map').getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  if (other) {
    await page.mouse.click(other.x, other.y);
    await page.waitForTimeout(500);
    ok(!!(await page.$('.leaflet-popup')), 'Klick auf anderen Punkt öffnet dessen Fenster');
  }
  pp = await posOf(pos.id);
  await page.mouse.click(pp.x, pp.y);
  await page.waitForTimeout(500);
  console.log('pick button:', !!(await page.$('.leaflet-popup [data-pick]')));
  if (await page.$('.leaflet-popup [data-pick]')) {
    await page.click('.leaflet-popup [data-pick]');
    await page.waitForTimeout(2500);
    console.log('stages:', await page.evaluate(() => state.stages.length), 'pending:', await page.evaluate(() => !!state.pending));
  }
  await page.screenshot({ path: path.join(OUT, 'probe.png') });
  await page.click('.basebtn');
  await page.waitForTimeout(300);
  console.log('sat:', await page.evaluate(() => [baseSat, map.hasLayer(satLayer), map.hasLayer(tileLayer), localStorage.getItem('gp.ui.base')].join(',')));
  await page.screenshot({ path: path.join(OUT, 'probe-sat.png') });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const z = document.querySelector('.leaflet-control-zoom').getBoundingClientRect(),
      p = $('#panel').getBoundingClientRect();
    return { zoomBottom: Math.round(z.bottom), panelTop: Math.round(p.top), sheet: getComputedStyle(document.documentElement).getPropertyValue('--sheet-h') };
  });
  console.log('mobil:', JSON.stringify(r));
  await page.screenshot({ path: path.join(OUT, 'probe-mob.png') });
  await page.click('#fabMenu');
  await page.waitForTimeout(800);
  console.log('mobil ausgeblendet:', await page.evaluate(() => Math.round(document.querySelector('.leaflet-control-zoom').getBoundingClientRect().bottom)));
  await browser.close();
  srv.close();
  console.log(failures ? failures + ' FEHLER' : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
