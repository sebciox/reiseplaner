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

const srv = require('./lib/server')(ROOT, 8135);

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
      const [[lo1, la1], [lo2, la2]] = b.coordinates;
      const N = 200;
      const coords = Array.from({ length: N + 1 }, (_, i) => [lo1 + ((lo2 - lo1) * i) / N, la1 + ((la2 - la1) * i) / N]);
      const dist = hav([la1, lo1], [la2, lo2]) * 1.0;
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
      return r.fulfill({ json: { elements: all.filter(e => e.lat >= S && e.lat <= N && e.lon >= W && e.lon <= E) } });
    }
    return r.continue();
  });

  await page.goto('http://localhost:8135/');
  await page.evaluate(() => localStorage.setItem('gp.settings', JSON.stringify({ key: 'eyJtest' })));
  await page.reload();
  const answers = []; // Antworten für prompt/confirm der Reihe nach
  page.on('dialog', d => {
    const a = answers.shift();
    if (a === false) d.dismiss();
    else d.accept(typeof a === 'string' ? a : d.type() === 'prompt' ? d.defaultValue() : undefined);
  });
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('[data-n]');
  await page.click('[data-n="3"]');
  await page.waitForSelector('[data-pick]');
  // 6) Umweg-Text
  ok((await page.textContent('#result .cands')).includes('von der Route bis zum Platz'), 'Liste: „… km / … min von der Route bis zum Platz“');
  await (await page.$('.ideal')).screenshot({ path: path.join(OUT, 'f3-ideal.png') });
  // 1) Kopier-Symbol
  ok(!!(await page.$('.ideal .icobtn svg')) && !(await page.textContent('.ideal')).includes('Kopieren'), 'Idealpunkt: Kopier-Symbol statt „Kopieren“');
  await page.click('.ideal .icobtn');
  await page.waitForFunction(() => document.querySelector('.ideal .icobtn').innerHTML.includes('M5 12.5'), null, { timeout: 3000 }).catch(() => {});
  ok((await page.innerHTML('.ideal .icobtn')).includes('M5 12.5'), 'nach Antippen: ✓');
  await page.waitForTimeout(1700);
  ok((await page.innerHTML('.ideal .icobtn')).includes('rect'), 'danach wieder Kopier-Symbol');
  // Popup eines Vorschlags: Umweg-Text + Google-Eintrag
  await page.evaluate(() => state.pending.cands[0]._m.openPopup());
  await page.waitForSelector('.leaflet-popup .ci');
  let pop = await page.textContent('.leaflet-popup .ci');
  const gl = await page.getAttribute('.leaflet-popup a:has-text("Google-Eintrag")', 'href');
  ok(
    pop.includes('von der Route bis zum Platz') && !pop.includes('Google Maps') && /maps\/search\/[^/]+\/@[\d.]+,[\d.]+,15z/.test(gl),
    'Popup: Umweg-Text, „Google-Eintrag“ → ' + gl
  );
  await page.evaluate(() => map.closePopup());
  // Tour fertig planen
  for (let i = 0; i < 4; i++) {
    if (await page.$('[data-endpick]')) break;
    await page.waitForSelector('[data-pick]');
    await page.click('[data-pick]');
    await page.waitForFunction(() => !state.busy && (document.querySelector('[data-pick]') || document.querySelector('[data-endpick]')));
    await page.waitForTimeout(200);
  }
  await page.click('[data-endpick]');
  await page.waitForSelector('.endsel');
  await page.waitForFunction(() => !state.busy);
  // 3) Zoom-Plätze: kein „außerhalb des Suchkorridors“, keine Dopplungen
  const st1 = await page.evaluate(() => ({ lat: state.stages[1].to.lat, lon: state.stages[1].to.lon, id: state.stages[1].to.id }));
  await page.evaluate(([la, lo]) => map.setView([la, lo], 12, { animate: false }), [st1.lat, st1.lon]);
  await page.waitForFunction(() => lyr.area.getLayers().length > 0, null, { timeout: 10000 });
  const dup = await page.evaluate(() => {
    const shown = new Set(state.stages.map(s => s.to.id));
    return lyr.area.getLayers().filter(m => {
      const ll = m.getLatLng();
      return state.stages.some(s => Math.abs(s.to.lat - ll.lat) < 1e-6 && Math.abs(s.to.lon - ll.lng) < 1e-6);
    }).length;
  });
  ok(dup === 0, 'Zoom-Anzeige: Etappenziele nicht doppelt');
  await page.evaluate(() => lyr.area.getLayers()[0].openPopup());
  await page.waitForSelector('.leaflet-popup .ci');
  await page
    .waitForFunction(() => /Ziel Etappe \d\)/.test(document.querySelector('.leaflet-popup .pdist')?.textContent || ''), null, { timeout: 5000 })
    .catch(() => {});
  pop = (await page.textContent('.leaflet-popup .ci')).replace(/\s+/g, ' ');
  ok(
    !pop.includes('außerhalb des Suchkorridors') && /von .+ \(Ziel Etappe \d\)/.test(pop),
    'Popup nach der Planung: ' + (pop.match(/[\d,]+ km \/ .+?Etappe \d\)/) || [''])[0]
  );
  // 2) Als Ziel übernehmen
  const btn = await page.textContent('.leaflet-popup [data-stagepick]');
  const target = +(await page.getAttribute('.leaflet-popup [data-stagepick]', 'data-stage'));
  const newId = await page.getAttribute('.leaflet-popup [data-stagepick]', 'data-stagepick');
  const before = await page.evaluate(() => state.stages.map(s => s.to.id));
  await page.click('.leaflet-popup [data-stagepick]');
  await page.waitForFunction(() => !state.busy);
  const after = await page.evaluate(() => state.stages.map(s => s.to.id));
  ok(
    btn.trim() === `Als Ziel von Etappe ${target + 1} übernehmen` &&
      after[target] === newId &&
      after.filter((x, i) => i !== target).every((x, i) => x === before.filter((_, j) => j !== target)[i]),
    `„${btn.trim()}“ → Etappe ${target + 1} hat neues Ziel, andere Ziele unverändert`
  );
  // Ausweichplatz offen → Knopf gilt dieser Etappe, Ausweich-Plätze nicht doppelt
  await page.click('[data-alt="0"]');
  await page.waitForSelector('[data-altpick]');
  await page.evaluate(() => map.setView([state.stages[0].to.lat, state.stages[0].to.lon], 12, { animate: false }));
  await page.waitForTimeout(1200);
  const dup2 = await page.evaluate(() => {
    const ids = new Set(state.alt.list.map(c => c.id));
    return lyr.area.getLayers().filter(m => state.alt.list.some(c => Math.abs(c.lat - m.getLatLng().lat) < 1e-6)).length;
  });
  ok(dup2 === 0, 'Zoom-Anzeige: Ausweichplätze nicht doppelt (vollständiges Popup erreichbar)');
  if (await page.evaluate(() => lyr.area.getLayers().length)) {
    await page.evaluate(() => lyr.area.getLayers()[0].openPopup());
    await page.waitForSelector('.leaflet-popup [data-stagepick]');
    ok((await page.textContent('.leaflet-popup [data-stagepick]')).includes('Etappe 1'), 'mit offenem Ausweichplatz (Etappe 1) → Knopf für Etappe 1');
    await page.evaluate(() => map.closePopup());
  }
  await page.click('[data-alt="0"]');
  // 4) Tourname
  answers.push('Testtour');
  await page.click('#saveBtn');
  await page.waitForTimeout(300);
  const id1 = await page.evaluate(() => state.tourId);
  await page.evaluate(() => resetTour());
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('[data-n]');
  await page.click('[data-n="2"]');
  await page.waitForSelector('[data-pick]');
  await page.click('[data-pick]');
  await page.waitForSelector('[data-endpick]');
  answers.push(' testtour ', true);
  await page.click('#saveBtn');
  await page.waitForTimeout(300);
  let tours = await page.evaluate(() => loadTours().map(t => ({ id: t.id, name: t.name, n: t.stages.length })));
  ok(
    tours.length === 1 && tours[0].id === id1 && tours[0].n === 2,
    'gleicher Name (Groß/Klein, Leerzeichen egal) → Warnung → überschrieben: ' + JSON.stringify(tours)
  );
  await page.evaluate(() => resetTour());
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('[data-n]');
  await page.click('[data-n="2"]');
  await page.waitForSelector('[data-pick]');
  await page.click('[data-pick]');
  await page.waitForSelector('[data-endpick]');
  answers.push('Testtour', false, undefined);
  await page.click('#saveBtn');
  await page.waitForTimeout(300);
  tours = await page.evaluate(() => loadTours().map(t => t.name));
  ok(
    tours.length === 2 && tours.includes('testtour') && tours.includes('Testtour (2)'),
    'Warnung „Abbrechen“ → Vorschlag „Testtour (2)“: ' + JSON.stringify(tours)
  );
  // schon gespeicherte Tour: „Speichern“ aktualisiert ohne Rückfrage, nur Hinweis
  const nAns = answers.length;
  await page.evaluate(() => {
    state.stages[0].nights = 3;
  });
  await page.click('#saveBtn');
  await page.waitForTimeout(300);
  tours = await page.evaluate(() => loadTours().map(t => ({ name: t.name, n0: t.stages[0].nights })));
  ok(
    tours.length === 2 && answers.length === nAns && tours.some(t => t.name === 'Testtour (2)' && t.n0 === 3),
    'Speichern einer gespeicherten Tour: ohne Rückfrage aktualisiert'
  );
  ok(/aktualisiert/.test(await page.textContent('#toast')), 'Hinweis „' + (await page.textContent('#toast')) + '“');
  // „Kopie speichern“ → neuer Eintrag mit eigenem Namen
  answers.push('Testtour Variante');
  await page.evaluate(() => saveTour(true));
  await page.waitForTimeout(300);
  tours = await page.evaluate(() => loadTours().map(t => t.name));
  ok(tours.length === 3 && tours.includes('Testtour Variante') && tours.includes('Testtour (2)'), 'Kopie speichern: ' + JSON.stringify(tours));
  await page.click('#toursBtn');
  await page.waitForTimeout(300);
  const li = await page.textContent('#toursList li .muted');
  ok(/\d{1,2}\.\d{1,2}\.\d{4}, \d{2}:\d{2}/.test(li), 'Tourenliste mit Uhrzeit: ' + li.trim());
  await page.screenshot({ path: path.join(OUT, 'f3-tours.png') });
  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
