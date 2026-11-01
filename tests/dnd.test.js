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
const PLACES = {
  Witten: [51.4436, 7.3532],
  'Sant Pere Pescador': [42.1885, 3.0806],
  Paris: [48.8566, 2.3522],
  Lyon: [45.764, 4.8357],
  Göteborg: [57.7089, 11.9746],
  Västervik: [57.7584, 16.6373],
  'Vimmerby Astrid Lindgren Värld': [57.6806, 15.8414],
  Växjö: [56.8777, 14.8091],
  Stockholm: [59.3293, 18.0686],
  Malmö: [55.605, 13.0038]
};
const A = PLACES['Witten'],
  B = PLACES['Sant Pere Pescador'];
let failures = 0;
const ok = (c, m) => {
  console.log((c ? 'OK   ' : 'FAIL ') + m);
  if (!c) failures++;
};

const srv = require('./lib/server')(ROOT, 8137);

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

  await page.goto('http://localhost:8137/');
  await page.evaluate(() => localStorage.setItem('gp.settings', JSON.stringify({ key: 'eyJtest' })));
  await page.reload();
  page.on('dialog', d => d.accept());
  const addVia = async t => {
    const n0 = await page.evaluate(() => state.via.length);
    await page.fill('#viaIn', t);
    await page.waitForTimeout(600);
    await page.press('#viaIn', 'Enter');
    await page.waitForFunction(n => state.via.length === n, n0 + 1);
  };
  await page.fill('#startIn', 'Malmö');
  await page.check('#roundIn');
  for (const t of ['Göteborg', 'Västervik', 'Vimmerby Astrid Lindgren Värld', 'Växjö', 'Stockholm']) await addVia(t);
  const names = () => page.evaluate(() => state.via.map(v => v.label.split(',')[0] + (v.pin ? '📌' : '')));
  ok(!(await page.$('[data-vup]')) && (await page.$$('.vgrip')).length === 5, 'Pfeile weg, Griff zum Ziehen an jedem Ziel');
  await page.click('#viaOpt');
  await page.waitForTimeout(800);
  const opt1 = await names();
  // Göteborg per Maus ganz nach unten ziehen
  const gi = opt1.findIndex(n => n.startsWith('Göteborg'));
  const g = await page.$(`[data-vgrip="${gi}"]`);
  await g.scrollIntoViewIfNeeded();
  const gb = await g.boundingBox();
  const scr = await page.evaluate(() => {
    const r = document.querySelector('#scroll').getBoundingClientRect();
    return r.bottom;
  });
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  // an den unteren Rand ziehen und dort halten → Liste scrollt mit, bis ganz unten
  for (let k = 1; k <= 10; k++) await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2 + ((scr - 10 - gb.y - gb.height / 2) * k) / 10);
  await page.waitForTimeout(2500);
  await page.mouse.up();
  await page.waitForTimeout(200);
  let order = await names();
  ok(order[4] === 'Göteborg📌', `Drag & Drop: Göteborg nach unten gezogen und festgelegt: ${opt1.join(' → ')}  ⇒  ${order.join(' → ')}`);
  await page.click('#viaOpt');
  await page.waitForTimeout(500);
  const opt2 = await names();
  ok(opt2[4] === 'Göteborg📌', 'Optimieren lässt Göteborg unten, ordnet den Rest: ' + opt2.join(' → '));
  ok((await page.textContent('#status')).includes('festgelegtes Ziel bleibt'), 'Hinweis: ' + (await page.textContent('#status')).trim());
  // Tastatur
  await page.focus('[data-vgrip="0"]');
  await page.keyboard.press('ArrowDown');
  order = await names();
  ok(
    order[1].endsWith('📌') && order[1].replace('📌', '') === opt2[0].replace('📌', ''),
    'Pfeiltaste ↓ am Griff verschiebt und legt fest: ' + order.join(' → ')
  );
  // Festlegung lösen
  await page.click('[data-vpin="1"]');
  ok(!(await names())[1].endsWith('📌'), '📌 antippen löst die Festlegung');
  await page.screenshot({ path: path.join(OUT, 'dnd.png') });
  // Seitenleiste ziehen
  const rz = await (await page.$('#resizer')).boundingBox();
  await page.mouse.move(rz.x + 5, rz.y + 300);
  await page.mouse.down();
  await page.mouse.move(rz.x + 120, rz.y + 300, { steps: 6 });
  await page.mouse.move(rz.x + 200, rz.y + 300, { steps: 4 });
  await page.mouse.up();
  const w = await page.evaluate(() => ({
    p: document.querySelector('#panel').offsetWidth,
    m: document.querySelector('#map').getBoundingClientRect().left,
    s: localStorage.getItem('gp.ui.pw')
  }));
  ok(w.p > 560 && Math.abs(w.m - w.p) < 2 && +w.s === w.p, 'Seitenleiste breiter gezogen: ' + JSON.stringify(w));
  await page.reload();
  await page.waitForTimeout(300);
  ok(Math.abs((await page.evaluate(() => document.querySelector('#panel').offsetWidth)) - w.p) < 2, 'Breite nach Neuladen gemerkt');
  // keine waagerechte Scrollleiste, auch bei schmaler Leiste und langen Namen
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--pw', '320px');
    state.via = [{ uid: 'x', label: 'Astrid Lindgrens Värld, Vimmerby kommun, Kalmar län, Schweden', lat: 57.68, lon: 15.84, kind: 'rest', nights: 2 }];
    renderVia();
  });
  const ov = await page.evaluate(() => {
    const sc = document.querySelector('#scroll');
    return [sc.scrollWidth, sc.clientWidth];
  });
  ok(ov[0] <= ov[1], `keine waagerechte Scrollleiste bei 320 px (${ov[0]} ≤ ${ov[1]})`);
  await page.screenshot({ path: path.join(OUT, 'dnd-narrow.png') });
  // Handy: Ziehen per Finger (Touch-Ereignisse über Pointer)
  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
