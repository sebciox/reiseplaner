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

const srv = require('./lib/server')(ROOT, 8152);

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

  await page.goto('http://localhost:8152/');
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
  const XLSXPATH = path.join(ROOT, 'node_modules/xlsx/dist/xlsx.full.min.js');
  await page.route('**/cdnjs.cloudflare.com/ajax/libs/xlsx/**', r => r.fulfill({ body: fs.readFileSync(XLSXPATH), contentType: 'text/javascript' }));
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
  // ---------- Reiseplan-Tabelle: bearbeiten, eigene Werte, Autospeichern, Entwurf ----------
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Tabellen-Tour' : undefined));
  await page.click('[data-act="save"]');
  await page.waitForFunction(() => loadTours().length === 1 && state.tourId);
  await page.click('#tripView [data-grp="0"]');
  await page.waitForSelector('#tripView tbody[data-grpb="0"].open tr.sight');
  const row = async sel => (await page.textContent(sel)).replace(/\s+/g, ' ');
  const edit = async (key, val) => {
    await page.click(`#tripView [data-ed="${key}"]`);
    const inp = await page.waitForSelector('#tripView .edin');
    await inp.fill(val);
    await inp.press('Enter');
    await page.waitForFunction(() => !document.querySelector('#tripView .edin'));
  };
  // Preis pro Nacht in Originalwährung
  await edit('c|0|ppn', '440 SEK');
  let c0 = await row('#tripView tr.camp');
  ok(
    (await page.evaluate(() => state.stages[0].my.ppn === '440 SEK')) &&
      /440 SEK \(≈ \d+ €\) \/ Nacht/.test(c0) &&
      /von dir/.test(c0) &&
      (await page.$('[data-rs="c|0|ppn"]')),
    'Preis/Nacht eingetragen: Originalwährung + Euro, „von dir“ mit ↺: ' + (c0.match(/440 SEK[^G]{0,40}/) || [''])[0]
  );
  ok(/gesamt ≈ \d+ € \(1 Nacht\)/.test(c0), 'Gesamtpreis = Nächte × Preis: ' + (c0.match(/gesamt[^)]*\)/) || [''])[0]);
  await page.waitForFunction(() => loadTours()[0].stages[0].my?.ppn === '440 SEK', null, { timeout: 4000 }).catch(() => {});
  ok(await page.evaluate(() => loadTours()[0].stages[0].my?.ppn === '440 SEK'), 'gespeicherte Tour: Änderung automatisch gesichert');
  ok(/✓ gespeichert/.test(await page.textContent('#saveChip')), 'Reisezeile: ' + (await page.textContent('#saveChip')));
  // Gesamtpreis überschreiben, bezahlt
  await edit('c|0|total', '326,61 €');
  await page.selectOption('#tripView select[data-sel="c|0|status"]', 'partial');
  await edit('c|0|paid', '100 €');
  c0 = await row('#tripView tr.camp');
  ok(
    /gesamt 326,61 €/.test(c0) && /bezahlt 100 €/.test(c0) && /offen 226,61 €/.test(c0),
    'angezahlt: gesamt, bezahlt, offen: ' + (c0.match(/gesamt.*offen [\d,]+ €/) || [''])[0]
  );
  ok(await page.evaluate(() => state.stages[0].memo?.res === true), 'Status ≠ offen → Etappe „reserviert“');
  await page.selectOption('#tripView select[data-sel="c|0|status"]', 'paid');
  c0 = await row('#tripView tr.camp');
  ok(!/offen \d/.test(c0) && (await page.evaluate(() => state.stages[0].my.status === 'paid')), 'bezahlt → nichts mehr offen');
  // Notiz, Buchungsnr., Name (✎ neben dem Link)
  await edit('c|0|note', 'Robert hat per Mail bestätigt');
  await edit('c|0|nr', 'ZMAC58');
  await page.click('#tripView button.edb[data-ed="c|0|name"]');
  await page.fill('#tripView .edin', 'Bauernhof Vellinge');
  await page.press('#tripView .edin', 'Enter');
  await page.waitForFunction(() => !document.querySelector('#tripView .edin'));
  c0 = await row('#tripView tr.camp');
  ok(
    /Bauernhof Vellinge/.test(await page.textContent('#tripView tr.camp .pname')) && /Robert hat per Mail bestätigt/.test(c0) && /ZMAC58/.test(c0),
    'Name, Notiz, Buchungsnr. bearbeitet'
  );
  ok(await page.evaluate(() => state.stages[0].memo.text === 'Robert hat per Mail bestätigt'), 'Notiz = Etappen-Notiz (auch in Reiter 2)');
  // Escape bricht ab
  await page.click('#tripView [data-ed="c|0|pitch"]');
  await page.fill('#tripView .edin', 'Ö11');
  await page.press('#tripView .edin', 'Escape');
  ok(await page.evaluate(() => !state.stages[0].my.pitch), 'Esc verwirft die Eingabe');
  // ↺ = gefundenen Wert zurück
  await page.click('[data-rs="c|0|ppn"]');
  ok(await page.evaluate(() => !state.stages[0].my.ppn), '↺ entfernt den eigenen Preis');
  // anderer Platz → eigene Angaben gelten nicht mehr (cid)
  ok(
    await page.evaluate(() => campMy({ ...state.stages[0], to: { ...state.stages[0].to, id: 'node/x' } }).nr === undefined),
    'eigene Angaben gehören zum Platz'
  );
  // Sehenswürdigkeit: Besuchstag, Betrag, Ticket-Status
  const sk = await page.evaluate(() => sightKey(state.via[0]));
  await page.fill('#tripView input.dayin', '2027-07-04');
  await page.dispatchEvent('#tripView input.dayin', 'change');
  ok(await page.evaluate(() => state.via[0].my.day === '2027-07-04'), 'Besuchstag gesetzt');
  await page.evaluate(() => {
    settings.adults = 2;
    settings.kids = 2;
    state.via[0].info = { ...(state.via[0].info || {}), v: INFO_V, web: 'https://paris.example/' };
    rzData['web:https://paris.example/'] = { v: 6, status: 'ok', price: { text: '29 €', adult: '29 €', child: '7 €', url: 'https://paris.example/t' } };
    renderTrip();
  });
  let s0 = await row('#tripView tr.sight');
  ok(/≈ 72 € für 2 Erw\. \+ 2 Kinder/.test(s0), 'Eintritt geschätzt mit Reisenden (2 × 29 + 2 × 7): ' + (s0.match(/≈ \d+ € für[^P]*/) || [''])[0]);
  await edit(`s|${sk}|amount`, '4 × 35 €');
  await page.selectOption(`#tripView select[data-sel="s|${sk}|status"]`, 'bought');
  s0 = await row('#tripView tr.sight');
  ok(/4 × 35 € \(= 140 €\)/.test(s0) && (await page.evaluate(() => state.via[0].my.status === 'bought')), 'Ticketpreis „4 × 35 €“ = 140 €, Tickets gekauft');
  await page.waitForTimeout(1300);
  ok(await page.evaluate(() => loadTours()[0].via[0].my?.amount === '4 × 35 €'), 'Sehenswürdigkeit: eigene Angaben in der Tour gespeichert');
  // Handy: Karten statt Tabelle
  await page.setViewportSize({ width: 390, height: 820 });
  await page.evaluate(() => setSheet('full'));
  await page.waitForTimeout(400);
  ok(
    await page.evaluate(
      () =>
        getComputedStyle($('#tripView .ptab thead')).display === 'none' &&
        getComputedStyle($('#tripView tr.camp')).display === 'grid' &&
        getComputedStyle($('#tripView tr.camp td[data-l="Adresse"]'), '::before').content.includes('Adresse') &&
        $('#scroll').scrollWidth <= $('#scroll').clientWidth + 1
    ),
    'Handy: Karten mit Beschriftung, kein waagerechtes Scrollen'
  );
  await page.screenshot({ path: path.join(OUT, 'tabelle-handy.png') });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'tabelle-laptop.png') });
  // eingeklappt: Preis und Status direkt bearbeitbar, offener Status hinterlegt
  await page.click('[data-tlall="0"]');
  ok(
    !!(await page.$('#tripView tbody[data-grpb="1"]:not(.open) tr.camp [data-ed="c|1|ppn"]')) &&
      !!(await page.$('#tripView tbody[data-grpb="1"]:not(.open) select[data-sel="c|1|status"].isopen')),
    'eingeklappte Zeile: Preis/Nacht bearbeitbar, Status-Auswahl, offen = hinterlegt'
  );
  await edit('c|1|ppn', '250 SEK');
  ok(await page.evaluate(() => state.stages[1].my?.ppn === '250 SEK'), 'Preis in der eingeklappten Zeile eingetragen');
  ok(!(await page.$('#tripView select[data-sel="c|0|status"].isopen')), 'bezahlter Platz: Status nicht hinterlegt');
  // ---------- Schritt 2: Fähre, eigene Zeilen, Kosten, offene Punkte, eigene Unterkunft ----------
  await page.evaluate(() => {
    state.stages[1].ex = { ...(state.stages[1].ex || {}), ferry: 150000 };
    tlOpen.add(-1);
    tlOpen.add(0);
    renderTrip();
  });
  ok(!!(await page.$('#tripView tbody[data-grpb="0"] tr.ferry')), 'Fähre auf der Weiterfahrt → eigene Zeile in der Gruppe');
  await edit('f|1|price', '1.250 SEK');
  await page.selectOption('#tripView select[data-sel="f|1|status"]', 'booked');
  await edit('f|1|nr', 'FERRY-1');
  ok(
    await page.evaluate(
      () => state.stages[1].ferry.price === '1.250 SEK' && state.stages[1].ferry.status === 'booked' && state.stages[1].ferry.nr === 'FERRY-1'
    ),
    'Fähre: Preis, Status, Buchungsnr. gespeichert'
  );
  await page.click('#tripView [data-xadd="cost"][data-at="0"]');
  await page.waitForSelector('#tripView .edin');
  await page.fill('#tripView .edin', 'Maut Öresundbrücke');
  await page.press('#tripView .edin', 'Enter');
  const xid = await page.evaluate(() => state.extras[0].id);
  await edit(`x|${xid}|amount`, '62 €');
  ok(
    await page.evaluate(() => state.extras.length === 1 && state.extras[0].kind === 'cost' && state.extras[0].amount === '62 €'),
    '+ Zeile → Kosten mit Bezeichnung und Betrag'
  );
  await page.click('#tripView [data-xadd="task"]');
  await page.waitForSelector('#tripView .edin');
  await page.fill('#tripView .edin', 'Vignette kaufen');
  await page.press('#tripView .edin', 'Enter');
  let ol = await row('#openList');
  ok(
    /gebucht: Fähre/.test(ol) && /Offen: Maut Öresundbrücke · [^≈]*62 €/.test(ol) && /Vignette kaufen/.test(ol) && /Noch nicht gebucht/.test(ol),
    'Offene Punkte: Fähre, Kosten, Aufgabe, nicht Gebuchtes: ' + ol.slice(0, 220)
  );
  ok(/Fähren/.test(ol) && /Sonstiges/.test(ol) && /Summe/.test(ol), 'Kostensumme nach Bereichen');
  const chip1 = await page.textContent('#tripBar [data-opento]');
  const tid = await page.evaluate(() => state.extras.find(e => e.kind === 'task').id);
  await page.check(`#tripView input[type=checkbox][data-sel="x|${tid}|done"]`);
  const chip2 = await page.textContent('#tripBar [data-opento]');
  ok(
    /^\d+ offen$/.test(chip1.trim()) && parseInt(chip2) === parseInt(chip1) - 1,
    `Chip in der Reisezeile: „${chip1.trim()}“ → Aufgabe erledigt → „${chip2.trim()}“`
  );
  await page.waitForTimeout(1300);
  ok(
    await page.evaluate(() => {
      const t = loadTours()[0];
      return t.extras?.length === 2 && t.stages[1].ferry?.nr === 'FERRY-1';
    }),
    'Fähre und eigene Zeilen in der Tour gespeichert'
  );
  // eigene Unterkunft statt Platz 1
  const n0 = await page.evaluate(() => state.stages.length);
  await page.click('#tripView [data-xadd="stay"][data-at="0"]');
  await page.fill('#tripView form.ownstay input[name=n]', 'Bauernhof Vellinge');
  const co = await page.evaluate(() => `${(state.stages[0].to.lat + 0.01).toFixed(5)}, ${(state.stages[0].to.lon + 0.01).toFixed(5)}`);
  await page.fill('#tripView form.ownstay input[name=q]', co);
  await page.click('#tripView form.ownstay button[type=submit]');
  await page.waitForFunction(() => !state.busy && String(state.stages[0].to.id).startsWith('eigen/'), null, { timeout: 15000 });
  ok(
    (await page.evaluate(n => state.stages.length === n, n0)) && /^Bauernhof Vellinge✎?$/.test((await page.textContent('#tripView tr.camp .pname')).trim()),
    'eigene Unterkunft statt Platz: Etappenziel, Route neu, ohne Google-/OSM-Namen'
  );
  ok(!!(await page.$('#tripView tbody[data-grpb="0"] tr.cost')), 'Kostenzeile bleibt beim ersetzten Aufenthalt');
  // eigene Unterkunft zusätzlich auf der ersten Fahrt
  await page.click('#tripView [data-grp="-1"]');
  await page.click('#tripView [data-xadd="stay"][data-at="-1"]');
  await page.fill('#tripView form.ownstay input[name=n]', 'Zwischenhof');
  const co2 = await page.evaluate(() => {
    const l = state.stages[0].line[Math.floor(state.stages[0].line.length / 2)];
    return `${l[0].toFixed(5)}, ${l[1].toFixed(5)}`;
  });
  await page.fill('#tripView form.ownstay input[name=q]', co2);
  await page.click('#tripView form.ownstay button[type=submit]');
  await page.waitForFunction(n => !state.busy && state.stages.length === n + 1, n0, { timeout: 15000 });
  ok(await page.evaluate(() => state.stages[0].to.tags.name === 'Zwischenhof'), 'eigene Unterkunft als zusätzlicher Stopp auf der Fahrt');
  ok(
    !(await page.$('#tripView tbody[data-grpb="0"] tr.cost')) && !!(await page.$('#tripView tbody[data-grpb="1"] tr.cost')),
    'Kostenzeile wandert mit ihrem Aufenthalt (jetzt Gruppe 2)'
  );
  await page.screenshot({ path: path.join(OUT, 'tabelle-schritt2.png'), fullPage: false });
  // Konflikt: offene Tour online auf anderem Gerät geändert
  await page.evaluate(() => {
    const rt = JSON.parse(JSON.stringify(loadTours()[0]));
    rt.stages[0].memo = { text: 'vom Handy', res: true };
    rt.savedAt = new Date(Date.now() + 1000).toISOString();
    afterSync({ conflict: { id: state.tourId, rt, sha: 'sha-handy' } });
  });
  await page.waitForSelector('#askDlg[open]');
  ok(
    /anderen Gerät/.test(await page.textContent('#askDlg')) && /anderes Gerät/.test(await page.textContent('#saveChip')),
    'Konflikt: Auswahl-Dialog + Hinweis in der Reisezeile'
  );
  await page.click('#askDlg [data-v="load"]');
  await page.waitForFunction(() => state.stages[0].memo?.text === 'vom Handy');
  ok(await page.evaluate(() => uiTab === 'trip' && syncMeta().known[state.tourId]?.sha === 'sha-handy'), 'Stand vom anderen Gerät geladen, Reiter bleibt');
  // Entwurf: nie gespeicherte Tour → beim nächsten Öffnen wiederherstellen
  await page.evaluate(() => {
    deleteTourLocal(state.tourId);
    state.tourId = null;
    state.stages[0].memo = { text: 'Entwurf-Notiz' };
    renderPanel();
  });
  await page.waitForFunction(() => !!localStorage.getItem('gp.draft'), null, { timeout: 4000 }).catch(() => {});
  ok(
    /nicht gespeichert/.test(await page.textContent('#saveChip')) && (await page.evaluate(() => !!localStorage.getItem('gp.draft'))),
    'neue Tour: „nicht gespeichert“ + Entwurf im Browser'
  );
  await page.reload();
  await page.waitForSelector('#askDlg[open]', { timeout: 5000 });
  ok(/nicht gespeichert/.test(await page.textContent('#askDlg')), 'nach dem Neuladen: Entwurf wird angeboten');
  await page.click('#askDlg [data-v="load"]');
  await page.waitForFunction(() => state.stages.length > 0);
  ok(
    await page.evaluate(() => !state.tourId && state.stages[0].memo?.text === 'Entwurf-Notiz' && state.via[0].my?.status === 'bought'),
    'Entwurf wiederhergestellt (noch nicht gespeichert)'
  );
  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
