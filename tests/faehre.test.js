// Fähre als Zwischenziel: Route = Straße bis zum Abfahrtshafen + Überfahrt + Straße ab dem Ankunftshafen (der Routendienst
// nähme sonst den Landweg). Die Überfahrt zählt nicht als Fahrstrecke, die Fähr-Zeile im Reiseplan wird vorbelegt.
const { chromium } = require('playwright');
const fs = require('fs'),
  path = require('path');
const ROOT = path.join(__dirname, '..'),
  OUT = path.join(__dirname, 'out'),
  LF = path.join(ROOT, 'node_modules/leaflet/dist');
fs.mkdirSync(OUT, { recursive: true });
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
  'Travemünde Skandinavienkai': [53.944, 10.86],
  'Malmö Hamn': [55.61, 12.99],
  Karlshamn: [56.17, 14.868]
};
const CAMPS = [
  { id: 1, name: 'Platz Mitte', lat: 52.62, lon: 9.0 },
  { id: 2, name: 'Camping Ivendorf', lat: 53.9442, lon: 10.855 },
  { id: 3, name: 'Bauernhof Vellinge', lat: 55.493, lon: 13.002 }
];
let failures = 0,
  dirCalls = [];
const ok = (c, m) => {
  console.log((c ? 'OK   ' : 'FAIL ') + m);
  if (!c) failures++;
};
const srv = require('./lib/server')(ROOT, 8154);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', locale: 'de-DE', viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => {
    console.log('PAGEERROR', e.message);
    failures++;
  });
  await page.route('**/*', async r => {
    const u = r.request().url();
    if (u.includes('cdnjs.cloudflare.com') && u.includes('leaflet')) {
      const f = u.endsWith('.css') ? 'leaflet.css' : u.includes('images/') ? 'images/' + u.split('/').pop() : 'leaflet.js';
      return r.fulfill({
        body: fs.readFileSync(path.join(LF, f)),
        contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.png') ? 'image/png' : 'text/javascript'
      });
    }
    if (u.includes('tile.openstreetmap.org') || u.includes('arcgisonline')) return r.fulfill({ status: 204, body: '' });
    if (u.includes('/geocode/reverse') || u.includes('photon.komoot.io')) return r.fulfill({ json: { features: [] } });
    if (u.includes('/geocode/')) {
      const t = (new URL(u).searchParams.get('text') || '').toLowerCase();
      const k = Object.keys(PLACES).find(k => t.includes(k.toLowerCase()) || k.toLowerCase().includes(t));
      const p = k && PLACES[k];
      const land = k === 'Witten' || k === 'Travemünde Skandinavienkai' ? 'Deutschland' : 'Schweden';
      return r.fulfill({ json: { features: p ? [{ geometry: { coordinates: [p[1], p[0]] }, properties: { label: `${k}, ${land}` } }] : [] } });
    }
    if (u.includes('/v2/directions/')) {
      // gerade Linie über Land (keine Fähre – wie der echte Routendienst, der den Landweg nähme)
      const P = JSON.parse(r.request().postData()).coordinates;
      dirCalls.push(P);
      let coords = [],
        dist = 0;
      for (let k = 1; k < P.length; k++) {
        const [lo1, la1] = P[k - 1],
          [lo2, la2] = P[k];
        for (let i = k === 1 ? 0 : 1; i <= 40; i++) coords.push([lo1 + ((lo2 - lo1) * i) / 40, la1 + ((la2 - la1) * i) / 40]);
        dist += hav([la1, lo1], [la2, lo2]) * 1.2;
      }
      const dur = dist / (85 / 3.6);
      const props = {
        summary: { distance: dist, duration: dur },
        segments: [{ distance: dist, duration: dur, steps: [{ distance: dist, duration: dur }] }],
        extras: { waycategory: { summary: [{ value: 0, distance: dist }] }, tollways: { summary: [] } }
      };
      return r.fulfill({
        json: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props }] }
      });
    }
    if (u.includes('/v2/matrix/')) {
      const b = JSON.parse(r.request().postData());
      const L = b.locations.map(l => [l[1], l[0]]);
      const distances = b.sources.map(s => b.destinations.map(d => hav(L[s], L[d]) * 1.25));
      return r.fulfill({ json: { distances, durations: distances.map(row => row.map(x => x / 16)) } });
    }
    if (u.includes('overpass')) {
      const q = decodeURIComponent(r.request().postData().slice(5));
      const m = q.match(/\(([\d.\-]+),([\d.\-]+),([\d.\-]+),([\d.\-]+)\)/);
      if (!m) return r.fulfill({ json: { elements: [] } });
      const [S, W, N, E] = m.slice(1).map(Number);
      const els = CAMPS.map(c => ({ type: 'node', id: c.id, lat: c.lat, lon: c.lon, tags: { tourism: 'camp_site', name: c.name } }));
      return r.fulfill({ json: { elements: els.filter(e => e.lat >= S && e.lat <= N && e.lon >= W && e.lon <= E) } });
    }
    if (u.includes('api.frankfurter.app')) return r.fulfill({ json: { rates: { SEK: 11.0 } } });
    return r.continue();
  });
  await page.goto('http://localhost:8154/');
  await page.evaluate(() => localStorage.setItem('gp.settings', JSON.stringify({ key: 'eyJtest' })));
  await page.reload();
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Fähren-Tour' : undefined));

  // Eingabe: Start, Ziel, Zwischenziel „Travemünde“ als Fähre nach Malmö
  await page.fill('#startIn', 'Witten');
  await page.fill('#endIn', 'Karlshamn');
  await page.fill('#viaIn', 'Travemünde Skandinavienkai');
  await page.waitForTimeout(500);
  await page.press('#viaIn', 'Enter');
  await page.waitForFunction(() => state.via.length === 1);
  await page.selectOption('[data-vkind="0"]', 'ferry');
  ok(
    await page.evaluate(() => state.via[0].kind === 'ferry' && state.via[0].pin && !!document.querySelector('[data-vfto="0"]')),
    'Zwischenziel-Art „⛴ Fähre ab hier“: Feld für den Ankunftshafen, bleibt beim Optimieren an seinem Platz'
  );
  await page.click('#planForm button[type=submit]');
  await page.waitForTimeout(400);
  ok(
    (await page.evaluate(() => !state.segs && !state.overview)) && /Ankunftshafen/.test(await page.textContent('#status')),
    'ohne Ankunftshafen: Hinweis statt Berechnung'
  );
  await page.fill('[data-vfto="0"]', 'Malmö Hamn');
  await page.press('[data-vfto="0"]', 'Enter');
  await page.waitForFunction(() => state.via[0].to && /Malmö/.test(state.via[0].to.label));
  await page.fill('[data-vhours="0"]', '9');
  await page.dispatchEvent('[data-vhours="0"]', 'change');
  ok(await page.evaluate(() => state.via[0].hours === 9), 'Ankunftshafen Malmö Hamn, Überfahrt 9 h');

  // Strecke: Straße bis Travemünde + Überfahrt + Straße ab Malmö
  dirCalls = [];
  await page.click('#planForm button[type=submit]');
  await page.waitForFunction(() => state.segs && !state.busy, null, { timeout: 20000 });
  const ov = await page.evaluate(() => {
    const l = state.overview.line,
      f = l.findIndex(p => p[2]);
    const all = l.reduce((a, p, i) => (i ? a + hav(l[i - 1], p) : 0), 0);
    return { f, n: l.length, cum: cumul(l).at(-1), all, sea: hav(l[f - 1], l[f]), dist: state.overview.dist, ex: state.segs[0]._r.ex };
  });
  ok(
    dirCalls.length === 2 &&
      Math.abs(dirCalls[0].at(-1)[1] - 53.944) < 1e-3 &&
      Math.abs(dirCalls[1][0][1] - 55.61) < 1e-3 &&
      ov.f > 0 &&
      Math.abs(ov.cum + ov.sea - ov.all) < 10,
    `Route in zwei Teilen über die Häfen, Überfahrt in der Linie markiert und nicht als Fahrstrecke gezählt (${Math.round(ov.cum / 1000)} km Straße + ${Math.round(ov.sea / 1000)} km Fähre)`
  );
  ok(ov.ex.ferryH === 9 && ov.ex.ferry > 100000 && !!ov.ex.ferryUid, 'Route: Fähre erkannt (Länge, 9 h, Zwischenziel)');
  ok(
    await page.evaluate(() => {
      let n = 0;
      lyr.route.eachLayer(l => l.options.dashArray === '2 8' && n++);
      return n === 1;
    }),
    'Karte: Überfahrt gestrichelt'
  );
  // 3 Etappen: Platz Mitte, Ivendorf (am Abfahrtshafen), dann über die Fähre nach Karlshamn
  for (let g = 0; g < 6; g++) {
    const n = await page.evaluate(() => state.segs[0].n);
    if (n === 3) break;
    await page.click(`[data-segn="0"][data-d="${n > 3 ? -1 : 1}"]`);
  }
  await page.click('#segGo');
  for (const id of ['node/1', 'node/2']) {
    await page.waitForFunction(i => !state.busy && document.querySelector(`#result [data-pick="${i}"]`), id, { timeout: 20000 });
    await page.click(`#result [data-pick="${id}"]`);
  }
  await page.waitForFunction(() => !state.busy && state.stages.length === 3, null, { timeout: 20000 });
  const st = await page.evaluate(() => state.stages.map(s => ({ vias: s.vias || [], ferry: s.ex?.ferry || 0, h: s.ex?.ferryH || 0, dist: s.dist })));
  ok(
    !st[1].vias.length && st[2].vias.length === 1 && st[2].ferry > 100000 && st[2].h === 9 && !st[1].ferry,
    'Platz am Abfahrtshafen (Ivendorf): Fähre gehört zur nächsten Etappe (Ivendorf → Fähre → Karlshamn)'
  );
  // Reiseplan: Fähr-Zeile vorbelegt
  await page.evaluate(() => setTab('trip'));
  await page.waitForSelector('#tripView tr.ferry');
  const fr = (await page.textContent('#tripView tr.ferry')).replace(/\s+/g, ' ');
  ok(
    /Fähre Travemünde Skandinavienkai – Malmö Hamn/.test(fr) && /Überfahrt ca\. 9 h/.test(fr) && /→ Malmö Hamn/.test(fr),
    'Reiseplan: Fähr-Zeile mit Name, Häfen und Dauer aus dem Zwischenziel: ' + fr.slice(0, 120)
  );
  ok(
    (await page.$$eval('#tripView tbody[data-grpb="1"] tr.ferry', x => x.length)) === 1 && !(await page.$('#tripView .sgtog')),
    'Fähr-Zeile in der Gruppe von Ivendorf, kein „Besuch unterwegs“ für die Fähre'
  );
  // Speichern → neu laden: Kennzeichen der Überfahrt bleibt in der Linie
  await page.click('#tripView [data-act="save"]');
  await page.waitForFunction(() => !!state.tourId);
  await page.reload();
  await page.evaluate(() => loadTour(loadTours()[0].id));
  ok(
    await page.evaluate(() => state.stages[2].line.some(p => p[2] === 1) && cumul(state.stages[2].line).at(-1) < state.stages[2].dist),
    'gespeichert und neu geladen: Überfahrt bleibt markiert'
  );
  // Strecken neu berechnen behält die Fähre
  dirCalls = [];
  await page.evaluate(() => rerouteAll());
  ok(
    (await page.evaluate(() => state.stages[2].ex.ferryH === 9 && state.stages[2].line.some(p => p[2]))) && dirCalls.length === 4,
    'Strecken neu berechnen: Fähre bleibt (Etappe 3 in zwei Teilen geroutet)'
  );
  // Fähre nachträglich in eine fertig geplante Tour: erneutes „Strecke berechnen“ behält alle Plätze, verteilt die Fähre
  // auf die passende Etappe und routet nur diese neu
  await page.evaluate(async () => {
    const f = state.via[0];
    window.__f = f;
    state.via = [];
    state.stages.forEach(s => (s.vias = []));
    state.segs.forEach(g => (g.visits = []));
    await rerouteAll();
    state.via = [f];
    renderVia();
    setTab('goals');
  });
  const ids0 = await page.evaluate(() => state.stages.map(s => s.to.id).join());
  ok(await page.evaluate(() => !state.stages.some(s => s.ex?.ferryH)), 'Ausgangslage: geplante Tour ohne Fähre');
  await page.click('#planForm button[type=submit]');
  await page.waitForFunction(() => !state.busy && state.segs && (document.querySelector('#segGo') || state.done), null, { timeout: 20000 });
  if (await page.$('#segGo')) await page.click('#segGo');
  await page.waitForFunction(() => !state.busy && state.done && state.stages.length === 3, null, { timeout: 20000 });
  ok(
    (await page.evaluate(() => state.stages.map(s => s.to.id).join())) === ids0 &&
      (await page.evaluate(() => state.stages[2].ex?.ferryH === 9 && (state.stages[2].vias || []).length === 1 && !(state.stages[1].vias || []).length)),
    'Fähre nachträglich eingefügt: alle Plätze bleiben, Fähre auf Etappe Ivendorf → Karlshamn, nur diese neu geroutet'
  );
  await page.screenshot({ path: path.join(OUT, 'faehre.png') });
  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
