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
  Lille: [50.6292, 3.0573]
};
const A = PLACES['Witten'],
  B = PLACES['Sant Pere Pescador'];
let failures = 0;
const ok = (c, m) => {
  console.log((c ? 'OK   ' : 'FAIL ') + m);
  if (!c) failures++;
};

const srv = require('./lib/server')(ROOT, 8144);

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

  await page.goto('http://localhost:8144/');
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
  const waitIdle = () => page.waitForFunction(() => !state.busy, null, { timeout: 30000 });
  const setAllOne = async () => {
    const n = await page.evaluate(() => state.segs.length);
    for (let k = 0; k < n; k++)
      while (await page.evaluate(k => state.segs[k].n > 1 && !state.segs[k].keep, k)) await page.click(`[data-segn="${k}"][data-d="-1"]`);
  };
  const pickThrough = async () => {
    for (let i = 0; i < 10; i++) {
      await page.waitForFunction(
        () =>
          !state.busy &&
          (document.querySelector('#result [data-pick]') || document.querySelector('#result [data-endpick]') || document.querySelector('.endsel')),
        null,
        { timeout: 30000 }
      );
      if (await page.$('#result [data-endpick]')) {
        await page.click('#result [data-endpick]');
        await page.waitForSelector('.endsel');
        return;
      }
      if (await page.$('.endsel')) return;
      await page.click('#result [data-pick]');
    }
  };
  await addVia('Paris');
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('#segGo', { timeout: 15000 });
  await setAllOne();
  await page.click('#segGo');
  await pickThrough();
  const s1 = await page.evaluate(() => state.stages.map(s => ({ id: s.to.id, label: s.to.label, seg: s.seg })));
  await page.evaluate(() => {
    state.stages[0].memo = { text: 'Notiz Paris', res: true };
  });
  ok(s1.length === 2, 'Ausgangstour: ' + s1.map(s => s.label).join(' → '));
  // A) Lyon (★) hinter Paris einfügen
  await addVia('Lyon');
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('#segGo', { timeout: 15000 });
  await waitIdle();
  const ki = await page.$$eval('.keepinfo', e => e.map(x => x.textContent.trim()));
  ok(ki.length === 1 && ki[0].includes(s1[0].label), 'A: Abschnitt Witten → Paris wird übernommen: ' + ki.join(' | '));
  await setAllOne();
  await page.click('#segGo');
  await page.waitForFunction(() => !state.busy && state.pending && state.pending.mode === 'anchor', null, { timeout: 30000 });
  let st = await page.evaluate(() => state.stages.map(s => ({ id: s.to.id, memo: s.memo, seg: s.seg })));
  ok(st.length === 1 && st[0].id === s1[0].id && st[0].memo && st[0].memo.res, 'A: Etappe 1 samt Notiz/„reserviert“ übernommen, jetzt Platz bei Lyon wählen');
  ok(await page.evaluate(() => /Lyon/.test(state.pending.sight.label)), 'A: Suche läuft bei Lyon');
  await pickThrough();
  const s2 = await page.evaluate(() => state.stages.map(s => ({ id: s.to.id, label: s.to.label, seg: s.seg, from: s.from.label })));
  ok(s2.length === 3, 'A: neue Tour ' + s2.map(s => s.label).join(' → '));
  // B) Besuch unterwegs Lille vor Paris
  await addVia('Lille');
  await page.evaluate(() => {
    const v = state.via.pop();
    v.kind = 'visit';
    state.via.unshift(v);
    renderVia();
    renderMap();
  });
  const dirN0 = dirBodies.length;
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('#segGo', { timeout: 15000 });
  await waitIdle();
  const kb = await page.$$eval('.keepinfo', e => e.length);
  ok(kb === 3, 'B: nur ein Besuch unterwegs dazu → alle 3 Abschnitte werden übernommen (Plätze bleiben)');
  await setAllOne();
  await page.click('#segGo');
  await page.waitForFunction(() => !state.busy && state.done, null, { timeout: 30000 });
  await waitIdle();
  const s3 = await page.evaluate(() => ({
    st: state.stages.map(s => ({ id: s.to.id, label: s.to.label, vias: s.vias || [], seg: s.seg })),
    done: state.done
  }));
  ok(
    s3.done && s3.st.length === 3 && s3.st.every((x, k) => x.id === s2[k].id),
    'B: alle Plätze automatisch übernommen: ' + s3.st.map(s => s.label).join(' → ')
  );
  ok(s3.st[0].vias.length === 1 && !s3.st[1].vias.length && s3.st.map(s => s.seg).join() === '0,1,2', 'B: Lille als Besuch in Etappe 1, Abschnitte 0,1,2');
  ok(dirBodies.length - dirN0 <= 4, `B: nur die Etappe mit dem neuen Besuch neu geroutet (${dirBodies.length - dirN0} Routen inkl. Abschnitte)`);
  console.log('Routen seit B:', dirBodies.length - dirN0);
  // C) Paris wird „Pause / freie Tage“ (Art geändert) → Abschnitt Paris wird neu geplant, alter Platz als „bisher gewählt“
  await page.evaluate(() => {
    state.via.find(x => /Paris/.test(x.label)).kind = 'rest';
    renderVia();
  });
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('#segGo', { timeout: 15000 });
  await waitIdle();
  ok((await page.$$eval('.keepinfo', e => e.length)) === 2, 'C: Art geändert → dieser Abschnitt wird neu geplant, die anderen 2 übernommen');
  await setAllOne();
  await page.click('#segGo');
  await page.waitForFunction(() => !state.busy && state.pending && state.pending.mode === 'anchor', null, { timeout: 30000 });
  const badge = await page.$$eval('#result .badge.prev', e => e.map(x => x.closest('li').querySelector('.name').textContent));
  ok(
    badge.some(b => b.includes(s1[0].label)),
    'C: alter Platz bei Paris als „bisher gewählt“: ' + badge.join(' | ')
  );
  await page.screenshot({ path: path.join(OUT, 'keep-badge.png') });
  await page.screenshot({ path: path.join(OUT, 'keep-done.png') });
  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
