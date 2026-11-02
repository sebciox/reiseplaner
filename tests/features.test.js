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

const srv = require('./lib/server')(ROOT, 8133);

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

  await page.addInitScript(() => {
    window.__printed = 0;
    window.print = () => {
      window.__printed++;
    };
  });
  await page.goto('http://localhost:8133/');
  await page.evaluate(() => localStorage.setItem('gp.settings', JSON.stringify({ key: 'eyJtest' })));
  await page.reload();
  page.on('dialog', d => (d.type() === 'prompt' ? d.accept('Testtour') : d.accept()));
  // Planen: 3 Etappen, Plätze wählen, Zielplatz
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('[data-n]');
  await page.click('[data-n="3"]');
  for (let i = 0; i < 4; i++) {
    if (await page.$('[data-endpick]')) break;
    await page.waitForSelector('[data-pick]');
    await page.click('[data-pick]');
    await page.waitForFunction(() => !state.busy && (document.querySelector('[data-pick]') || document.querySelector('[data-endpick]')));
    await page.waitForTimeout(200);
  }
  await page.click('[data-endpick]');
  await page.waitForSelector('.endsel');
  ok(!(await page.isHidden('#sumBtn')), 'Desktop: Knopf „Übersicht“ sichtbar');
  // Datum + Nächte
  await page.fill('#dateIn', '2027-06-11');
  await page.dispatchEvent('#dateIn', 'change');
  let nums = await page.$$eval('.stage .num', e => e.map(x => x.textContent.trim()));
  ok(nums[0].includes('Fr., 11.6.') && nums[1].includes('Sa., 12.6.'), 'Datum je Etappe: ' + nums.join(' | '));
  await page.click('[data-det="0"]');
  await page.waitForFunction(() => !document.querySelector('.det')?.textContent.includes('wird ermittelt'));
  ok((await page.textContent('.det')).includes('Route de Test 1, 21000 Dijon'), 'Details: Adresse per Rückwärtssuche ergänzt');
  await page.fill('[data-nights="0"]', '2');
  await page.dispatchEvent('[data-nights="0"]', 'change');
  nums = await page.$$eval('.stage .num', e => e.map(x => x.textContent.trim()));
  ok(nums[1].includes('So., 13.6.'), '2 Nächte am 1. Stopp → Etappe 2 am ' + nums[1]);
  // Notiz + reserviert (vor dem Speichern)
  await page.fill('[data-memo="0"]', 'Ankunft bis 18 Uhr');
  await page.dispatchEvent('[data-memo="0"]', 'change');
  await page.check('[data-res="0"]');
  ok((await page.textContent('.stage')).includes('reserviert ✓'), 'Status „reserviert ✓“ an der Etappe');
  ok((await page.getAttribute('.stage .sbtns a', 'href')).startsWith('https://www.google.com/maps/dir/?api=1&destination='), 'Navigation-Link (Google Maps)');
  // Rezeption (aus rezeption.json des Helfers)
  ok(
    (await page.textContent('.det .rz')).includes(await page.evaluate(() => (webOf(state.stages[0].to) ? 'Rezeptionszeiten' : 'Keine Website'))),
    'Details ohne Helfer-Ergebnis: ' + (await page.textContent('.det .rz')).trim()
  );
  const wi = await page.evaluate(() => state.stages.findIndex(s => s.to.kind === 'camp' && webOf(s.to)));
  const c0 = await page.evaluate(i => ({ id: state.stages[i].to.id, web: webOf(state.stages[i].to) }), wi);
  await page.evaluate(
    ([id, web]) => {
      rzData = {
        [id]: {
          status: 'ok',
          website: web,
          hours: '08:00–12:00, 14:00–20:00',
          snippet: 'Die Rezeption ist täglich von 08:00 – 12:00 und 14:00 bis 20:00 Uhr geöffnet.',
          url: web + '/infos',
          checkedAt: new Date().toISOString()
        }
      };
      renderPanel();
    },
    [c0.id, c0.web]
  );
  await page.click(`[data-det="${wi}"]`).catch(() => {});
  if (wi === 0) await page.click('[data-det="0"]');
  await page.waitForTimeout(300);
  const rzt = await page.$$eval('.det .rz', e => e.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  ok(
    rzt.some(t => t.includes('Rezeption: 08:00–12:00, 14:00–20:00') && t.includes('Quelle')),
    'Details: Rezeptionszeiten mit Quellen-Link: ' + rzt.find(t => t.includes('Quelle'))
  );
  // Speichern → danach Notiz automatisch gesichert
  await page.click('#saveBtn');
  await page.waitForTimeout(300);
  await page.fill('[data-memo="0"]', 'Ankunft bis 19 Uhr');
  await page.dispatchEvent('[data-memo="0"]', 'change');
  await page.waitForTimeout(1200);
  const saved = await page.evaluate(() => loadTours()[0]);
  ok(
    saved.stages[0].memo.text === 'Ankunft bis 19 Uhr' &&
      saved.stages[0].memo.res &&
      saved.date === '2027-06-11' &&
      saved.stages[0].nights === 2 &&
      saved.stages[0].to.addr,
    'Automatisch gesichert: Notiz, Status, Datum, Nächte, Adresse'
  );
  // Ausweichplatz
  const before = await page.evaluate(() => state.stages.map(s => ({ to: s.to.id, from: s.from.label, d: Math.round(s.dist) })));
  await page.click('[data-alt="0"]');
  await page.waitForSelector('[data-altpick]');
  const alts = await page.$$eval('.alt .cand .name', e => e.map(x => x.textContent.trim()));
  ok(
    alts.length >= 2 && !alts.includes(await page.evaluate(() => state.stages[0].to.label)),
    'Ausweichplätze im Umkreis 10 km (ohne den bisherigen): ' + alts.join(', ')
  );
  ok(
    !(await page.$('.alt .chip[data-filter]')) && !/Wohnwagen erlaubt|🔌/.test(await page.textContent('.alt')),
    'Ausweichplätze: keine Filter-Chips, keine Ausstattung/Wohnwagen-Angabe'
  );
  // „Platz fehlt?“ auch hier: eigener Platz (Koordinaten) kommt oben in die Liste
  await page.evaluate(() => {
    const t = state.stages[0].to;
    return addCustomCamp('alt', { lat: t.lat + 0.01, lon: t.lon + 0.01, name: 'Hof Test' });
  });
  ok(
    (await page.evaluate(() => state.alt.list[0].tags.name === 'Hof Test' && state.alt.list[0].added)) && !!(await page.$('.alt form.addcamp[data-ctx="alt"]')),
    'Platz ändern: „Platz fehlt?“ ergänzt eigenen Platz oben in der Liste'
  );
  await page.selectOption('#altR', '30');
  await page.waitForSelector('[data-altpick]');
  ok(await page.evaluate(() => state.alt.r === 30 && settings.altRadius === 30), 'Umkreis 30 km gewählt und gemerkt');
  const op0 = T.op;
  await page.click('[data-altpick]');
  await page.waitForFunction(() => !state.alt && !state.busy);
  const after = await page.evaluate(() => state.stages.map(s => ({ to: s.to.id, from: s.from.label, d: Math.round(s.dist) })));
  ok(
    after[0].to !== before[0].to && after[1].from !== before[1].from && after[1].to === before[1].to && JSON.stringify(after[2]) === JSON.stringify(before[2]),
    `Übernommen: Etappe 1 + 2 neu, Etappe 3 unverändert (${before.map(x => x.d).join('/')} → ${after.map(x => x.d).join('/')})`
  );
  await page.waitForTimeout(1200);
  ok((await page.evaluate(() => loadTours()[0].stages[0].to.id)) === after[0].to, 'Ausweichplatz automatisch in der Tour gespeichert');
  // Übersicht (Harmonika)
  await page.click('#sumBtn');
  await page.waitForSelector('#sumDlg[open]');
  let open = await page.$$eval('#sumBody details', e => e.map(d => d.open));
  ok(open.length === 3 && open.every(Boolean), 'Übersicht außerhalb des Reisezeitraums: alle aufgeklappt');
  await page.screenshot({ path: path.join(OUT, 'feat-summary.png') });
  await page.click('#sumClose');
  const today = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  await page.fill('#dateIn', today);
  await page.dispatchEvent('#dateIn', 'change');
  await page.click('#sumBtn');
  await page.waitForSelector('#sumDlg[open]');
  open = await page.$$eval('#sumBody details', e => e.map(d => d.open));
  ok(
    JSON.stringify(open) === '[false,true,false]' && (await page.textContent('#sumBody')).includes('nächstes Ziel'),
    'Während der Tour: nur die nächste Etappe offen ' + JSON.stringify(open)
  );
  // Drucken
  await page.click('#printBtn');
  await page.waitForFunction(() => window.__printed > 0, null, { timeout: 15000 });
  const pr = await page.evaluate(() => ({
    rows: document.querySelectorAll('#print tbody tr').length,
    txt: document.querySelector('#print').textContent,
    links: [...document.querySelectorAll('#print a')].length,
    map: !!document.querySelector('#print .pmap.leaflet-container')
  }));
  ok(
    (pr.rows === 3 && pr.map && pr.links >= 5 && pr.txt.includes('Rezeption') && pr.txt.includes('Lacville')) || pr.txt.includes('Dijon'),
    `Druckansicht: ${pr.rows} Zeilen, Karte, ${pr.links} Links, Adressen`
  );
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: path.join(OUT, 'tour.pdf'), landscape: true, format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  ok(fs.statSync(path.join(OUT, 'tour.pdf')).size > 5000, 'PDF erzeugt (A4 quer)');
  // Handy: ☰ und 📋
  await page.setViewportSize({ width: 390, height: 740 });
  await page.waitForTimeout(300);
  ok((await page.isVisible('#fabMenu')) && (await page.isVisible('#fabSum')) && (await page.isHidden('#sumBtn')), 'Handy: ☰ und 📋 sichtbar, Kopf-Knopf weg');
  await page.click('#fabMenu');
  await page.waitForTimeout(350);
  ok(await page.evaluate(() => document.querySelector('#panel').classList.contains('hide')), 'Handy: ☰ blendet Menü aus');
  await page.screenshot({ path: path.join(OUT, 'feat-hidden.png') });
  await page.click('#fabSum');
  await page.waitForSelector('#sumDlg[open]');
  await page.waitForTimeout(300);
  const dlg = await page.evaluate(() => {
    const r = document.querySelector('#sumDlg').getBoundingClientRect();
    return [r.width, r.height];
  });
  ok(dlg[0] >= 389 && dlg[1] >= 700, 'Handy: Übersicht als Vollbild ' + dlg.map(Math.round).join('×'));
  await page.screenshot({ path: path.join(OUT, 'feat-summary-mobile.png') });
  await page.click('#sumClose');
  await page.click('#fabMenu');
  await page.waitForTimeout(350);
  ok(await page.evaluate(() => !document.querySelector('#panel').classList.contains('hide')), 'Handy: ☰ blendet Menü wieder ein');
  await page.click('[data-det="1"]').catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'feat-mobile-details.png'), fullPage: false });
  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
