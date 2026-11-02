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
  Malmö: [55.605, 13.0038],
  Skansen: [59.3271, 18.1036],
  Vasamuseet: [59.328, 18.0914],
  Vadstena: [58.4467, 14.8902],
  Hultsfred: [57.4886, 15.8442]
};
const A = PLACES['Witten'],
  B = PLACES['Sant Pere Pescador'];
let failures = 0;
const ok = (c, m) => {
  console.log((c ? 'OK   ' : 'FAIL ') + m);
  if (!c) failures++;
};

const srv = require('./lib/server')(ROOT, 8141);

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

  await page.addInitScript(() => {
    window.print = () => {
      window.__printed = (window.__printed || 0) + 1;
    };
  });
  await page.goto('http://localhost:8141/');
  await page.evaluate(() => localStorage.setItem('gp.settings', JSON.stringify({ key: 'eyJtest' })));
  await page.reload();
  let confirmNo = false; // Rückfrage „schon in der Reise – trotzdem noch einmal?“ ablehnen
  page.on('dialog', d => (confirmNo && d.type() === 'confirm' ? d.dismiss() : d.accept(d.type() === 'prompt' ? 'Schweden' : undefined)));
  await page.route('**/photon.komoot.io/api/**', r => {
    const q = new URL(r.request().url()).searchParams.get('q');
    const f = /strandcamping/i.test(q)
      ? [
          {
            geometry: { coordinates: [15.861, 57.495] },
            properties: {
              name: 'Hultsfred Strandcamping',
              postcode: '577 91',
              city: 'Hultsfred',
              state: 'Kalmar län',
              country: 'Schweden',
              osm_key: 'tourism',
              osm_value: 'camp_site'
            }
          }
        ]
      : [];
    return r.fulfill({ json: { features: f } });
  });
  ok((await page.title()) === 'Reiseplaner' && (await page.$eval('h1', e => e.textContent)) === 'Reiseplaner', 'App heißt Reiseplaner');
  // 1) mehrere Ziele schnell hintereinander per Enter (ohne auf Vorschläge zu warten)
  await page.fill('#startIn', 'Malmö');
  await page.fill('#endIn', 'Göteborg');
  await page.fill('#viaIn', 'Vadstena');
  await page.waitForTimeout(700);
  await page.press('#viaIn', 'Enter');
  await page.waitForFunction(() => state.via.length === 1);
  await page.fill('#viaIn', 'Stockholm');
  await page.press('#viaIn', 'Enter');
  await page.waitForFunction(() => state.via.length === 2, null, { timeout: 3000 }).catch(() => {});
  let labels = await page.evaluate(() => state.via.map(v => v.label));
  ok(labels.length === 2 && labels[1].startsWith('Stockholm'), 'Zweites Ziel per schnellem Enter: ' + labels.join(' | '));
  // 2) per Knopf
  await page.fill('#viaIn', 'Skansen');
  await page.click('#viaAddBtn');
  await page.waitForFunction(() => state.via.length === 3);
  // 3) Vorschlag antippen
  await page.fill('#viaIn', 'Vasamuseet');
  await page.waitForSelector('#viaSugg button');
  await page.click('#viaSugg button');
  await page.waitForFunction(() => state.via.length === 4);
  // 4) Formular-Absenden im Feld (Handy-Tastatur) fügt hinzu statt zu planen
  await page.fill('#viaIn', 'Växjö');
  await page.evaluate(() => {
    $('#viaIn').focus();
    $('#planForm').requestSubmit();
  });
  await page.waitForFunction(() => state.via.length === 5);
  ok(await page.evaluate(() => !state.overview), 'Kein Planungsstart durch Absenden im Zwischenziel-Feld');
  // 5) Doppelt: Rückfrage „trotzdem noch einmal (Rückweg)?“ – Nein = nicht hinzugefügt, Ja = zweites Mal
  confirmNo = true;
  await page.fill('#viaIn', 'Stockholm');
  await page.press('#viaIn', 'Enter');
  await page.waitForTimeout(400);
  confirmNo = false;
  labels = await page.evaluate(() => state.via.map(v => v.label));
  ok(labels.length === 5, 'Doppeltes Ziel nach Rückfrage „Nein“ nicht hinzugefügt: ' + labels.map(l => l.split(',')[0]).join(', '));
  await page.fill('#viaIn', 'Stockholm');
  await page.press('#viaIn', 'Enter');
  await page.waitForFunction(() => state.via.length === 6);
  ok(true, 'Doppeltes Ziel nach Rückfrage „Ja“ ein zweites Mal (z. B. Rückweg)');
  await page.evaluate(() => {
    state.via.pop();
    renderVia();
  });
  ok(await page.$eval('#viaIn', e => e.value === ''), 'Eingabefeld leer');
  // Campingplatz über Photon
  await page.fill('#viaIn', 'Hultsfred Strandcamping');
  await page.press('#viaIn', 'Enter');
  await page.waitForFunction(() => state.via.length === 6);
  let v = await page.evaluate(() => state.via[5]);
  ok(v.label.startsWith('Hultsfred Strandcamping') && v.kind === 'rest', 'Campingplatz erkannt: ' + v.label + ' / ' + v.kind);
  // Ungenauer Treffer → Auswahl statt still einfügen
  await page.fill('#viaIn', 'Hultsfred Badplats');
  await page.click('#viaAddBtn');
  await page.waitForTimeout(700);
  ok((await page.evaluate(() => state.via.length)) === 6, 'Ungenauer Treffer nicht still eingefügt');
  const head = await page.$eval('#viaSugg', e => e.textContent);
  ok(/nicht genau gefunden/.test(head), 'Auswahl angezeigt: ' + head.slice(0, 80));
  await page.click('#viaSugg button');
  await page.waitForFunction(() => state.via.length === 7);
  ok(await page.$eval('#viaSugg', e => e.innerHTML === ''), 'Auswahl danach geschlossen');
  // Datum
  await page.fill('#dateIn', '2027-07-03');
  await page.dispatchEvent('#dateIn', 'change');
  await page.fill('#retIn', '2027-07-20');
  await page.dispatchEvent('#retIn', 'change');
  await page.fill('#dateIn', '2027-07-10');
  await page.dispatchEvent('#dateIn', 'change');
  let r = await page.evaluate(() => [state.date, state.ret, $('#retIn').value, $('#retIn').min]);
  ok(r[1] === '2027-07-27' && r[2] === '2027-07-27' && r[3] === '2027-07-10', 'Rückkehr wandert mit (+7 Tage): ' + r.join(' '));
  await page.fill('#dateIn', '2027-06-30');
  await page.dispatchEvent('#dateIn', 'change');
  r = await page.evaluate(() => state.ret);
  ok(r === '2027-07-17', 'Rückkehr wandert zurück: ' + r);
  await page.fill('#retIn', '2027-06-01');
  await page.dispatchEvent('#retIn', 'change');
  r = await page.evaluate(() => [state.ret, $('#retIn').value]);
  ok(r[0] === '2027-06-30' && r[1] === '2027-06-30', 'Rückkehr vor Abfahrt → Abfahrtstag: ' + r);
  await page.fill('#retIn', '');
  await page.dispatchEvent('#retIn', 'change');
  await page.fill('#dateIn', '2027-08-01');
  await page.dispatchEvent('#dateIn', 'change');
  r = await page.evaluate(() => state.ret);
  ok(r === null, 'Ohne Rückkehr bleibt sie leer');
  // Kalender der Rückkehr öffnet bei der Abfahrt
  await page.focus('#retIn');
  r = await page.$eval('#retIn', e => e.value);
  ok(r === '2027-08-01', 'Rückkehr-Kalender startet bei Abfahrt: ' + r);
  await page.focus('#dateIn');
  r = await page.evaluate(() => [$('#retIn').value, state.ret]);
  ok(r[0] === '' && r[1] === null, 'ohne Wahl wieder leer');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'viadate.png') });
  ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && $('#scroll').scrollWidth <= $('#scroll').clientWidth + 1),
    'kein waagerechtes Scrollen'
  );
  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
