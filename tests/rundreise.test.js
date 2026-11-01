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

const srv = require('./lib/server')(ROOT, 8136);

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

  await page.goto('http://localhost:8136/');
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
  // Reihenfolge optimieren: Lyon, Paris → Paris, Lyon
  await addVia('Lyon');
  await addVia('Paris');
  ok(await page.isVisible('#viaOpt'), 'ab 2 Zwischenzielen: „Reihenfolge optimieren“');
  await page.click('#viaOpt');
  await page.waitForTimeout(800);
  ok(
    JSON.stringify(await page.evaluate(() => state.via.map(v => v.label.split(',')[0]))) === '["Paris","Lyon"]',
    'optimiert: Paris vor Lyon (Witten → … → Sant Pere)'
  );
  await page.selectOption('[data-vkind="1"]', 'visit');
  await page.fill('[data-vnights="0"]', '2');
  await page.dispatchEvent('[data-vnights="0"]', 'change');
  ok(
    (await page.textContent('#viaList')).includes('Besuch unterwegs') && (await page.evaluate(() => state.via[0].nights === 2)),
    'Paris: Übernachten 2 Nächte · Lyon: Besuch unterwegs'
  );
  await page.screenshot({ path: path.join(OUT, 'rr-input.png') });
  // Abschnitte
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('#segGo', { timeout: 15000 });
  const segTxt = (await page.textContent('.segs')).replace(/\s+/g, ' ');
  ok(
    segTxt.includes('Witten → ★ Paris') &&
      segTxt.includes('Paris → Sant Pere Pescador') &&
      segTxt.includes('unterwegs: Lyon') &&
      segTxt.includes('2 Nächte dort'),
    'Abschnitte: ' + segTxt.slice(0, 160)
  );
  const nBefore = await page.evaluate(() => state.segs.map(g => g.n));
  await page.click('[data-segn="1"][data-d="1"]');
  ok(await page.evaluate(n => state.segs[1].n === n[1] + 1, nBefore), 'Etappen je Abschnitt anpassbar (+)');
  await page.click('[data-segn="1"][data-d="-1"]');
  await page.screenshot({ path: path.join(OUT, 'rr-segs.png') });
  await page.click('#segGo');
  const toAnchor = async () => {
    for (let i = 0; i < 5; i++) {
      await page.waitForFunction(() => !state.busy && (document.querySelector('#ancR') || document.querySelector('[data-pick]')), null, { timeout: 20000 });
      if (await page.$('#ancR')) return;
      ok((await page.textContent('#result')).includes('Transit-Stopp'), 'vor der Sehenswürdigkeit: Transit-Stopp');
      await page.click('[data-pick]');
    }
  };
  await toAnchor();
  const h3 = await page.textContent('#result h3:last-of-type');
  const si = await page.$$eval('#result .cands .sightinfo', e => e.map(x => x.textContent.trim()));
  ok(
    /Campingplatz bei Paris/.test(await page.textContent('#result')) &&
      si.length > 0 &&
      si[0].includes('zur Sehenswürdigkeit') &&
      !si[0].includes('ohne Wohnwagen'),
    'Platz an der Sehenswürdigkeit: ' + si[0]
  );
  const dists = await page.evaluate(() => state.pending.cands.map(c => c.sight && c.sight.d));
  ok(
    dists.every((d, i) => i === 0 || d >= dists[i - 1]),
    'sortiert nach Entfernung zur Sehenswürdigkeit'
  );
  await page.screenshot({ path: path.join(OUT, 'rr-anchor.png') });
  await page.selectOption('#ancR', '10');
  await page.waitForFunction(() => state.pending && state.pending.radius === 10 && !state.busy);
  ok(true, 'Umkreis auf 10 km geändert');
  await page.click('[data-pick]');
  // Abschnitt 2: Transit mit Lyon unterwegs
  await page.waitForFunction(() => document.querySelector('[data-pick]') || document.querySelector('[data-endpick]'), null, { timeout: 20000 });
  const st0 = await page.evaluate(() => {
    const s = state.stages.find(x => x.to.near);
    return { near: s.to.near, nights: s.nights, seg: s.seg, i: state.stages.indexOf(s) };
  });
  ok(
    st0.near && st0.near.label.startsWith('Paris') && st0.nights === 2,
    'Etappe 1 endet bei Paris: ' + JSON.stringify({ near: st0.near.label, d: Math.round(st0.near.d), nights: st0.nights })
  );
  if (await page.$('[data-pick]')) {
    ok(
      (await page.textContent('#result')).includes('Transit-Stopp') && (await page.textContent('#result')).includes('unterwegs: Lyon'),
      'Transit-Etappe mit Lyon unterwegs'
    );
    await page.click('[data-pick]');
    await page.waitForSelector('[data-endpick]', { timeout: 20000 });
  }
  await page.click('[data-endpick]');
  await page.waitForSelector('.endsel');
  const sts = await page.evaluate(() => state.stages.map(s => ({ seg: s.seg, vias: s.vias, to: s.to.label })));
  ok(
    sts.some(s => (s.vias || []).length === 1) && sts[sts.length - 1].seg === 1,
    'Lyon genau einer Etappe zugeordnet: ' + JSON.stringify(sts.map(s => [s.seg, (s.vias || []).length]))
  );
  const withLyon = dirBodies.filter(b => b.coordinates.length === 3).length;
  ok(withLyon > 0, `Routing mit Zwischenpunkt Lyon (${withLyon} Anfragen mit 3 Punkten)`);
  ok(
    (await page.textContent('#result')).includes('★ Paris') && (await page.textContent('#result')).includes('unterwegs: Lyon'),
    'Etappenkarten zeigen ★ Paris und „unterwegs: Lyon“'
  );
  await page.fill('#dateIn', '2027-06-01');
  await page.dispatchEvent('#dateIn', 'change');
  const nums = await page.$$eval('.stage .num', e => e.map(x => x.textContent.trim()));
  ok(nums[st0.i + 1].includes(st0.i === 0 ? '3.6.' : '4.6.'), '2 Nächte in Paris → nächste Etappe am ' + nums[st0.i + 1]);
  await page.screenshot({ path: path.join(OUT, 'rr-done.png'), fullPage: false });
  // Speichern + Laden
  await page.click('#saveBtn');
  await page.waitForTimeout(300);
  await page.evaluate(() => resetTour());
  ok((await page.evaluate(() => state.via.length === 0)) && (await page.textContent('#viaList')).trim() === '', 'Neue Tour: Zwischenziele leer');
  await page.click('#toursBtn');
  await page.waitForSelector('[data-load]');
  await page.click('[data-load]');
  await page.waitForTimeout(500);
  ok(
    (await page.evaluate(() => state.via.length === 2 && state.segs.length === 2 && state.stages.length >= 2)) &&
      (await page.textContent('#viaList')).includes('Paris'),
    'Tour geladen: Zwischenziele + Abschnitte wiederhergestellt'
  );
  // Rundreise
  await page.evaluate(() => resetTour());
  await addVia('Paris');
  await page.check('#roundIn');
  ok(await page.isDisabled('#endIn'), 'Rundreise: Ziel-Feld gesperrt');
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('#segGo', { timeout: 15000 });
  ok((await page.textContent('.segs')).includes('zurück nach Witten'), 'Abschnitt „zurück nach Witten“');
  await page.click('#segGo');
  await toAnchor();
  await page.click('[data-pick]');
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(300);
    if (await page.evaluate(() => state.done)) break;
    await page.waitForSelector('[data-pick]', { timeout: 20000 });
    await page.click('[data-pick]');
  }
  await page.waitForFunction(() => state.done && !state.busy);
  const fin = await page.evaluate(() => ({
    l: state.stages[state.stages.length - 1].to.label,
    es: state.endSearched,
    ec: state.endCands.length,
    n: state.stages.length,
    segs: state.segs.map(g => [g.kind, g.n])
  }));
  ok(
    fin.l.startsWith('Witten') && !fin.es && fin.ec === 0 && !(await page.$('#endSearchBtn')),
    'Rundreise endet in Witten, keine Campingplatz-Liste am Ziel ' + JSON.stringify(fin)
  );
  ok((await page.evaluate(() => defaultName())) === 'Rundreise ab Witten', 'Name: „Rundreise ab Witten“');
  // ---- freie Tage + Rückkehrdatum ----
  await page.evaluate(() => resetTour());
  await addVia('Paris');
  await page.selectOption('[data-vkind="0"]', 'rest');
  ok((await page.textContent('#viaList')).includes('Pause / freie Tage'), 'Zwischenziel-Art „Pause / freie Tage (nur Campingplatz)“');
  await page.fill('[data-vnights="0"]', '3');
  await page.dispatchEvent('[data-vnights="0"]', 'change');
  await page.fill('#dateIn', '2027-07-01');
  await page.dispatchEvent('#dateIn', 'change');
  await page.fill('#retIn', '2027-07-04');
  await page.dispatchEvent('#retIn', 'change');
  ok((await page.textContent('#retLbl')).includes('Ankunft spätestens'), 'Beschriftung „Ankunft spätestens“ (keine Rundreise)');
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('#segGo', { timeout: 15000 });
  let trip = (await page.textContent('#tripBar .trip')).replace(/\s+/g, ' ');
  ok(trip.includes('⚠') && trip.includes('zu lang'), 'Warnung in der Abschnitts-Übersicht: ' + trip.slice(0, 120));
  ok((await page.textContent('.segs')).includes('⛺ Paris'), 'Abschnitt mit ⛺ Pause');
  await page.fill('#retIn', '2027-07-20');
  await page.dispatchEvent('#retIn', 'change');
  trip = (await page.textContent('#tripBar .trip')).replace(/\s+/g, ' ');
  ok(!trip.includes('⚠') && trip.includes('Puffer'), 'mit späterem Datum: ' + trip.slice(0, 120));
  await page.click('#segGo');
  await toAnchor();
  ok(
    (await page.textContent('#result')).includes('⛺ Pause') &&
      (await page.textContent('#result')).includes('2 freie Tage') &&
      (await page.textContent('#result .cands')).includes('zum Ort'),
    'Platzwahl bei Pause: „⛺ Pause … 2 freie Tage“, Entfernung „zum Ort“'
  );
  await page.click('[data-pick]');
  await page
    .waitForFunction(() => !state.busy && (document.querySelector('[data-pick]') || document.querySelector('[data-endpick]')), null, { timeout: 20000 })
    .catch(() => {});
  // Nächte an einem Transit-Stopp über den Stepper erhöhen
  const iT = await page.evaluate(() => state.stages.findIndex(s => !s.to.near));
  const before = await page.evaluate(() => tripEnd().toISOString().slice(0, 10));
  await page.click(`[data-nstep="${iT}"][data-d="1"]`);
  const after = await page.evaluate(() => tripEnd().toISOString().slice(0, 10));
  ok(
    (await page.evaluate(i => state.stages[i].nights === 2, iT)) && after > before && (await page.textContent('#result')).includes('1 freier Tag'),
    `freier Tag am Transit-Stopp: Reiseende ${before} → ${after}`
  );
  await page.fill(
    '#retIn',
    after.replace(/-(\d\d)$/, (m, d) => '-' + String(+d - 1).padStart(2, '0'))
  );
  await page.dispatchEvent('#retIn', 'change');
  ok((await page.textContent('#tripBar .trip')).includes('1 Tag zu lang'), 'ein Tag zu viel → Warnung „1 Tag zu lang“');
  await page.screenshot({ path: path.join(OUT, 'rr-warn.png') });

  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
