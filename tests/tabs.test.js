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

  await page.goto('http://localhost:8147/');
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
  await page.route('**/cdn.jsdelivr.net/npm/docx@*/**', r =>
    r.fulfill({ body: fs.readFileSync(path.join(ROOT, 'node_modules/docx/dist/index.iife.js')), contentType: 'text/javascript' })
  );
  await page.route('**/places.googleapis.com/**', r => {
    const u = r.request().url();
    if (u.includes('searchNearby')) {
      const b = JSON.parse(r.request().postData());
      const c = b.locationRestriction.circle.center;
      return r.fulfill({
        json: {
          places: [
            {
              displayName: { text: 'Sjötorpets Camping' },
              location: { latitude: c.latitude + 0.001, longitude: c.longitude },
              googleMapsUri: 'https://maps.google.com/?cid=1'
            }
          ]
        }
      });
    }
    return r.fulfill({ json: { places: [] } });
  });
  const vis = sel =>
    page.evaluate(s => {
      const e = document.querySelector(s);
      return !!e && !e.closest('[hidden]') && e.offsetParent !== null;
    }, sel);
  const tab = () => page.evaluate(() => document.querySelector('[data-tabbtn].on')?.dataset.tabbtn);
  ok((await tab()) === 'goals' && (await vis('#planForm')) && !(await vis('#result')), 'Start: Reiter 1 Ziele');
  await page.evaluate(() => {
    settings.gkey = 'gtest';
    saveSettings();
  });
  await addVia('Paris');
  await page.fill('#dateIn', '2027-07-03');
  await page.dispatchEvent('#dateIn', 'change');
  await page.fill('#retIn', '2027-07-20');
  await page.dispatchEvent('#retIn', 'change');
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('#segGo', { timeout: 15000 });
  ok((await tab()) === 'plan' && !(await vis('#planForm')) && (await vis('#segGo')), 'Strecke berechnen → Reiter 2 Plätze');
  const chips = await page.$$eval('#tripBar .chip', e => e.map(x => x.textContent.trim()));
  ok(
    chips.length === 3 &&
      /^📅 3\.7\. – \d+\.7\. geschätzt$/.test(chips[0]) &&
      /Tage$/.test(chips[1]) &&
      /✓ \d+ Tage Puffer/.test(chips[2]) &&
      (await page.$('#tripBar .chip.good')),
    'Reisezeile als Kurzinfo: ' + chips.join(' | ')
  );
  ok(await page.evaluate(() => $('#tripBar .tripdet').hidden), 'Details zu');
  await page.click('#tripBar .tripchips');
  ok(
    await page.evaluate(() => !$('#tripBar .tripdet').hidden && /Reise:/.test($('#tripBar .tripdet').textContent)),
    'antippen → Details: ' + (await page.textContent('#tripBar .tripdet')).trim().slice(0, 80)
  );
  await page.click('#tripBar .tripchips');
  ok(await page.evaluate(() => $('#tripBar .tripdet').hidden), 'nochmal antippen → zu');
  ok(
    /✓ Ziele/.test(await page.textContent('[data-tabbtn="goals"]')) && /^2 Plätze/.test(await page.textContent('[data-tabbtn="plan"]')),
    'Häkchen: ✓ Ziele, 2 Plätze noch offen'
  );
  for (const k of [0, 1]) while ((await page.evaluate(k => state.segs[k].n, k)) > 1) await page.click(`[data-segn="${k}"][data-d="-1"]`);
  await page.click('#segGo');
  for (let i = 0; i < 8; i++) {
    await page.waitForFunction(
      () => !state.busy && (document.querySelector('#result [data-pick]') || document.querySelector('#result [data-endpick]') || state.done),
      null,
      { timeout: 30000 }
    );
    if (await page.evaluate(() => state.done && !document.querySelector('#result [data-endpick]'))) break;
    if (await page.$('#result [data-endpick]')) {
      await page.click('#result [data-endpick]');
      await page.waitForFunction(() => !state.busy);
      break;
    }
    await page.click('#result [data-pick]');
  }
  await page.waitForFunction(() => document.querySelector('[data-tabbtn].on')?.dataset.tabbtn === 'trip', null, { timeout: 5000 }).catch(() => {});
  ok((await tab()) === 'trip' && (await vis('#tripView')) && !(await vis('#result')), 'alle Plätze gewählt → Reiter 3 Reiseplan');
  ok(/✓ Plätze/.test(await page.textContent('[data-tabbtn="plan"]')), 'Häkchen: ✓ Plätze');
  // feste Aktionsleiste unten: sichtbar, ohne zu scrollen
  await page.click('[data-tlall="1"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    $('#scroll').scrollTop = 0;
  });
  await page.waitForTimeout(150);
  ok(
    await page.evaluate(() => {
      const f = $('#tripView .foot').getBoundingClientRect(),
        s = $('#scroll').getBoundingClientRect();
      return $('#scroll').scrollHeight > $('#scroll').clientHeight + 50 && Math.abs(f.bottom - s.bottom) < 2;
    }),
    'Aktionsleiste unten fest (Drucken/Word/Speichern sichtbar ohne Scrollen)'
  );
  ok(!(await vis('#tripView [data-act="gpx"]')), 'GPX/Tour-Datei hinter „⋯“');
  await page.click('#tripView [data-more]');
  ok((await vis('#tripView [data-act="gpx"]')) && (await vis('#tripView [data-act="file"]')), '„⋯“ zeigt GPX/Tour-Datei');
  await page.screenshot({ path: path.join(OUT, 'tabs-foot.png') });
  await page.click('#tripView [data-more]');
  await page.click('[data-tlall="0"]');
  await page.waitForTimeout(200);
  const camps = await page.$$eval('#tripView tr.camp', e => e.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
  const sg = await page.$$eval('#tripView .sgtog', e => e.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
  ok(
    camps.length >= 1 && !/★ 1/.test(camps[0]) && /Nacht/.test(camps[0]) && /▶ 1 Sehenswürdigkeit/.test(sg[0] || ''),
    'Tabelle zugeklappt: Platz-Zeile je Aufenthalt, darunter „▶ 1 Sehenswürdigkeit“: ' + camps[0].slice(0, 60) + ' | ' + sg[0]
  );
  ok((await page.$$eval('#tripView .ptab thead th', e => e.length)) === 7, 'Tabelle mit 7 Spalten');
  ok(!(await page.$('#tripView tr.sight')), 'eingeklappt: keine Unterzeilen');
  ok(
    await page.evaluate(() => {
      const m = $('#map').getBoundingClientRect(),
        p = $('#panel').getBoundingClientRect();
      return document.body.classList.contains('tripwide') && p.left === 0 && p.width >= innerWidth - 1 && m.bottom <= p.top + 1 && m.height > 150;
    }),
    'Laptop, Reiter 3: Karte oben, Reiseplan unten über die ganze Breite'
  );
  // Nächte in der Tabelle (Gruppe aufklappen)
  await page.click('#tripView [data-grp="0"]');
  await page.waitForSelector('#tripView tbody[data-grpb="0"].open tr.sight');
  ok(/★ Paris/.test(await page.textContent('#tripView tbody[data-grpb="0"] tr.sight')), 'aufgeklappt: ★ Paris als Unterzeile unter dem Platz');
  await page.click('[data-tlnight="0"][data-d="1"]');
  ok((await page.evaluate(() => state.stages[0].nights === 2)) && /2 Nächte/.test(await page.textContent('#tripView tr.camp')), 'Nächte + in der Tabelle');
  ok(await page.evaluate(() => !!$('#tripView tbody[data-grpb="0"].open')), 'aufgeklappt bleibt aufgeklappt');
  await page.waitForFunction(() => /Sjötorpets/.test($('#tripView').textContent), null, { timeout: 5000 }).catch(() => {});
  ok(/Sjötorpets Camping \(OSM: Lokal 0\)/.test(await page.textContent('#tripView tr.camp .pname')), 'abweichender Name bei Google angezeigt');
  ok(/nicht gespeichert/.test(await page.textContent('#saveChip')), 'Reisezeile: „nicht gespeichert“');
  // feste Reisezeile beim Scrollen
  await page.click('[data-tlall="1"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    $('#scroll').scrollTop = 99999;
  });
  await page.waitForTimeout(200);
  ok(
    await page.evaluate(() => {
      const r = $('#tripBar').getBoundingClientRect(),
        h = $('#panel .top').getBoundingClientRect(),
        t = $('#tabs').getBoundingClientRect(),
        s = $('#scroll').getBoundingClientRect(),
        p = $('#panel').getBoundingClientRect();
      return (
        $('#scroll').scrollTop > 100 &&
        h.top >= p.top &&
        t.top >= h.bottom - 1 &&
        r.bottom <= s.top + 1 &&
        /Puffer|zu lang/.test($('#tripBar').textContent) &&
        $('#panelHead').classList.contains('shadow')
      );
    }),
    'Kopf, Reiter und Reisezeile bleiben beim Scrollen fest'
  );
  await page.screenshot({ path: path.join(OUT, 'tabs-scrolled.png') });
  // Word (.docx): Querformat, dieselben 7 Spalten wie online
  const dlP = page.waitForEvent('download', { timeout: 30000 });
  await page.click('[data-act="docx"]');
  const dl = await dlP;
  const fp = path.join(OUT, 'reiseplan.docx');
  await dl.saveAs(fp);
  const W = require('./lib/docx')(fp);
  ok(
    /w:orient="landscape"/.test(W.xml) && (W.xml.match(/<w:gridCol /g) || []).length === 7 && /Paris/.test(W.text) && /Sjötorpets Camping/.test(W.text),
    'Word: Querformat, 7 Spalten, Plätze und Sehenswürdigkeiten'
  );
  // Speichern
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Paris-Tour' : undefined));
  await page.click('[data-act="save"]');
  await page.waitForTimeout(300);
  ok((await page.evaluate(() => loadTours().length === 1)) && !!(await page.$('[data-act="copy"]')), 'gespeichert, jetzt mit „Kopie speichern“');
  await page.click('[data-act="save"]');
  await page.waitForTimeout(300);
  ok(
    /aktualisiert/.test(await page.textContent('#toast')) && (await page.evaluate(() => loadTours().length === 1)),
    'erneut Speichern → „' + (await page.textContent('#toast')) + '“'
  );
  ok((await page.textContent('#tripView h3')).includes('Paris-Tour'), 'Reiseplan-Titel = Tourname');
  ok(/✓ gespeichert \d\d:\d\d/.test(await page.textContent('#saveChip')), 'Reisezeile: „' + (await page.textContent('#saveChip')) + '“');
  // „Platz ändern“ in der Tabelle → Reiter 2, Plätze im Umkreis nur für diesen Platz (+ „Platz fehlt?“)
  const nSt = await page.evaluate(() => state.stages.length);
  await page.click('[data-tledit="0"]');
  await page.waitForFunction(() => state.alt && state.alt.i === 0 && state.alt.list && !state.busy, null, { timeout: 15000 });
  ok(
    (await tab()) === 'plan' &&
      !!(await page.$('.alt form.addcamp[data-ctx="alt"]')) &&
      /Platz ändern/.test(await page.textContent('.alt .hd')) &&
      (await page.evaluate(n => state.stages.length === n, nSt)),
    '„Platz ändern“ → Reiter 2: anderer Platz im Umkreis + „Platz fehlt?“, keine Etappe verworfen'
  );
  ok(
    (await page.textContent('[data-edit="0"]').catch(() => '')).includes('Ab hier neu planen') || !(await page.$('[data-edit="0"]')),
    'Reiter 2: „Ab hier neu planen“ heißt jetzt so (statt „Platz ändern“)'
  );
  await page.click('[data-alt="0"]');
  await page.click('[data-tabbtn="goals"]');
  ok((await vis('#planForm')) && (await vis('#viaIn')), 'Reiter 1 jederzeit erreichbar');
  ok(
    await page.evaluate(() => !document.body.classList.contains('tripwide') && $('#panel').getBoundingClientRect().top === 0),
    'Reiter 1: wieder Seitenleiste links'
  );
  ok(await vis('#toPlan'), 'Reiter 1: „Weiter: 2 Plätze →“');
  await page.click('#toPlan');
  ok((await tab()) === 'plan' && (await vis('#result [data-goto="trip"]')), 'Weiter → Reiter 2, dort „Weiter: Reiseplan →“');
  await page.click('#result [data-goto="trip"]');
  ok((await tab()) === 'trip', '→ Reiter 3');
  await page.click('[data-tabbtn="goals"]');
  await page.click('[data-tabbtn="trip"]');
  await page.screenshot({ path: path.join(OUT, 'tabs-laptop.png') });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => setSheet('full'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'tabs-handy.png') });
  ok(
    await page.evaluate(() => getComputedStyle($('#panel .top')).display === 'none' && $('#toursBtnM').getBoundingClientRect().width > 0),
    'Handy: kein Logo-Kopf, Touren/⚙︎ neben den Reitern'
  );
  await page.click('#toursBtnM');
  ok(await page.evaluate(() => $('#toursDlg')?.open ?? document.querySelector('dialog[open]') != null), 'Handy: Touren-Knopf öffnet die Touren');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => $('#scroll').scrollWidth <= $('#scroll').clientWidth + 1), 'kein waagerechtes Scrollen (Handy)');
  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
