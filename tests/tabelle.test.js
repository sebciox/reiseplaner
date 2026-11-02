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
  // Preis pro Nacht in Originalwährung – keine Symbole, keine Marke „von dir“
  await edit('c|0|ppn', '440 SEK');
  let c0 = await row('#tripView tr.camp');
  ok(
    (await page.evaluate(() => state.stages[0].my.ppn === '440 SEK')) &&
      /440 SEK \(≈ \d+ €\) \/ Nacht/.test(c0) &&
      !/von dir|✎|↺/.test(c0) &&
      !(await page.$('#tripView .edb, #tripView [data-rs], #tripView .ownt')),
    'Preis/Nacht eingetragen: Originalwährung + Euro, ohne ✎/„von dir“/↺: ' + (c0.match(/440 SEK[^G]{0,40}/) || [''])[0]
  );
  ok(/gesamt ≈ \d+ € \(1 Nacht\)/.test(c0), 'Gesamtpreis = Nächte × Preis: ' + (c0.match(/gesamt[^)]*\)/) || [''])[0]);
  await page.waitForFunction(() => loadTours()[0].stages[0].my?.ppn === '440 SEK', null, { timeout: 4000 }).catch(() => {});
  ok(await page.evaluate(() => loadTours()[0].stages[0].my?.ppn === '440 SEK'), 'gespeicherte Tour: Änderung automatisch gesichert');
  ok(/✓ gespeichert/.test(await page.textContent('#saveChip')), 'Reisezeile: ' + (await page.textContent('#saveChip')));
  // Eingabefeld: Cursor am Ende, nichts markiert; Klick ins Feld schließt es nicht
  await page.click('#tripView [data-ed="c|0|ppn"]');
  const sel1 = await page.evaluate(() => {
    const i = $('#tripView .edin');
    return { s: i.selectionStart, e: i.selectionEnd, n: i.value.length };
  });
  await page.click('#tripView .edin');
  await page.click('#tripView .edin');
  ok(
    sel1.s === sel1.n && sel1.e === sel1.n && sel1.n > 0 && !!(await page.$('#tripView .edin')),
    'Bearbeiten: Cursor am Textende, nichts markiert, Klick ins Feld schließt es nicht'
  );
  await page.press('#tripView .edin', 'End');
  await page.keyboard.type(' ab 2 Nächte');
  await page.press('#tripView .edin', 'Enter');
  await page.waitForFunction(() => !document.querySelector('#tripView .edin'));
  ok(await page.evaluate(() => state.stages[0].my.ppn === '440 SEK ab 2 Nächte'), 'Text ergänzt statt überschrieben');
  await edit('c|0|ppn', '440 SEK');
  // gefundener Wert beim Bearbeiten: „gefunden: … übernehmen“
  await page.evaluate(() => {
    state.stages[0].to.addr = 'Teststraße 1, 12345 Musterstadt';
    renderTrip();
  });
  await edit('c|0|ort', 'Malmö / Vellinge');
  await page.click('#tripView [data-ed="c|0|ort"]');
  const fb = await page.textContent('#tripView .edfound').catch(() => '');
  await page.click('#tripView .edfound [data-usefound]');
  await page.waitForFunction(() => !document.querySelector('#tripView .edin'));
  ok(
    /gefunden: Musterstadt/.test(fb) && (await page.evaluate(() => !state.stages[0].my.ort && stayTown(0) === 'Musterstadt')),
    'eigener Wert: beim Bearbeiten „gefunden: Musterstadt übernehmen“ → zurück zum gefundenen Wert'
  );
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
  ok(
    (await page.$$eval('#tripView select[data-sel="c|0|status"] option', o => o.map(x => x.textContent).join('|'))) ===
      'offen|gebucht|angezahlt|bezahlt|gebucht, vor Ort zahlen',
    'Status: „vor Ort zahlen“ heißt jetzt „gebucht, vor Ort zahlen“'
  );
  await page.selectOption('#tripView select[data-sel="c|0|status"]', 'paid');
  c0 = await row('#tripView tr.camp');
  ok(!/offen \d/.test(c0) && (await page.evaluate(() => state.stages[0].my.status === 'paid')), 'bezahlt → nichts mehr offen');
  // Notiz = ein freies Feld; Name/Adresse nur Links; keine Buchungsnr./Stellplatz/Telefon-Felder
  await edit('c|0|note', 'Robert hat per Mail bestätigt\nZMAC58');
  c0 = await row('#tripView tr.camp');
  ok(
    /Robert hat per Mail bestätigt/.test(c0) &&
      (await page.evaluate(() => state.stages[0].memo.text === 'Robert hat per Mail bestätigt\nZMAC58')) &&
      !(await page.$('#tripView [data-ed="c|0|nr"], #tripView [data-ed="c|0|pitch"], #tripView [data-ed="c|0|phone"], #tripView [data-ed$="|nr"]')) &&
      !(await page.$('#tripView [data-ed="c|0|name"], #tripView [data-ed="c|0|addr"]')) &&
      !/Buchungsnr|Stellplatz|Ticketnr/.test(await row('#tripView .ptab')),
    'Notiz = freies Feld (mehrzeilig), keine Buchungsnr./Stellplatz/Telefon/Ticketnr., Name/Adresse nicht bearbeitbar'
  );
  ok((await page.$$eval('#tripView .ptab thead th', t => t.map(x => x.textContent.trim()).join('|'))).includes('|Notiz|'), 'Spalte heißt „Notiz“');
  // leere Notiz: Klick in die freie Fläche der Zelle öffnet das Feld; Esc verwirft
  await page.evaluate(() => {
    const td = document.querySelector('#tripView tr[data-row="c1"] td[data-l="Notiz"]');
    td.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForSelector('#tripView tr[data-row="c1"] .edin');
  await page.fill('#tripView .edin', 'verworfen');
  await page.press('#tripView .edin', 'Escape');
  ok(await page.evaluate(() => !state.stages[1].memo?.text), 'leere Notiz-Zelle antippen → Feld; Esc verwirft die Eingabe');
  ok(
    await page.evaluate(() => {
      const ph = [...document.querySelectorAll('#tripView tr.camp .ed .ph')].map(x => x.textContent);
      return ph.length > 0 && ph.every(t => !t.startsWith('+') && !/–$/.test(t)) && !document.querySelector('#tripView tr.camp td[data-l="Notiz"] .ph');
    }),
    'leere Felder: blasser Platzhalter ohne „+“/„–“, Notiz ohne Vorgabe'
  );
  // anderer Platz → eigene Angaben gelten nicht mehr (cid)
  ok(
    await page.evaluate(() => campMy({ ...state.stages[0], to: { ...state.stages[0].to, id: 'node/x' } }).total === undefined),
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
  await edit(`s|${sk}|note`, 'Tickets im Handy');
  ok(await page.evaluate(k => sightMy(findSightByKey(k)).note === 'Tickets im Handy', sk), 'Sehenswürdigkeit: Notiz als freies Feld');
  await page.waitForTimeout(1300);
  ok(await page.evaluate(() => loadTours()[0].via[0].my?.amount === '4 × 35 €'), 'Sehenswürdigkeit: eigene Angaben in der Tour gespeichert');
  // Laptop: Kopf bleibt stehen, Datum ohne Umbruch, Spaltenbreite ziehen
  ok(
    await page.evaluate(
      () =>
        getComputedStyle($('#tripView .ptab thead th')).position === 'sticky' &&
        getComputedStyle($('#tripView .ptab .dat')).whiteSpace === 'nowrap' &&
        $('#tripView tr.camp .dat').getClientRects().length === 1
    ),
    'Tabellenkopf bleibt stehen (sticky), Datum in einer Zeile'
  );
  await page.evaluate(() => {
    $('#scroll').scrollTop = 600;
  });
  await page.waitForTimeout(150);
  ok(
    await page.evaluate(() => {
      const th = $('#tripView .ptab thead th').getBoundingClientRect(),
        sc = $('#scroll').getBoundingClientRect();
      return Math.abs(th.top - sc.top) < 3;
    }),
    'nach dem Scrollen steht der Tabellenkopf oben'
  );
  await page.evaluate(() => {
    $('#scroll').scrollTop = 0;
  });
  const w0 = await page.evaluate(() => $('#tripView .ptab thead th').getBoundingClientRect().width);
  const hb = await (await page.$('#tripView [data-colrs="0"]')).boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2, { steps: 5 });
  await page.mouse.up();
  const w1 = await page.evaluate(() => $('#tripView .ptab thead th').getBoundingClientRect().width);
  ok(
    w1 > w0 + 40 && (await page.evaluate(() => (JSON.parse(localStorage.getItem('gp.ui.cols')) || []).length === 7)),
    `Spaltenbreite gezogen (${Math.round(w0)} → ${Math.round(w1)} px) und gemerkt`
  );
  await page.evaluate(() => renderTrip());
  ok(Math.abs((await page.evaluate(() => $('#tripView .ptab thead th').getBoundingClientRect().width)) - w1) < 3, 'Spaltenbreite bleibt nach dem Neuzeichnen');
  await page.dblclick('#tripView [data-colrs="0"]');
  ok(await page.evaluate(() => !localStorage.getItem('gp.ui.cols')), 'Doppelklick auf die Grenze: Breiten zurückgesetzt');
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
  // Aufklapp-Zeile „▶ n Sehenswürdigkeiten“, kein ★-Zähler am Namen; Platz-Zeile immer vollständig
  ok(
    /▼\s*1 Sehenswürdigkeit/.test(await page.textContent('#tripView tbody[data-grpb="0"] tr.sgrow')) && !(await page.$('#tripView .cnt')),
    'Aufklapp-Zeile unter dem Platz: „▼ 1 Sehenswürdigkeit“, kein ★-Zähler'
  );
  await page.click('[data-tlall="0"]');
  ok(
    !(await page.$('#tripView tr.sight')) &&
      !!(await page.$('#tripView tbody[data-grpb="1"]:not(.open) tr.camp [data-ed="c|1|ppn"]')) &&
      !!(await page.$('#tripView tbody[data-grpb="1"] tr.camp [data-ed="c|1|total"]')) &&
      !!(await page.$('#tripView tbody[data-grpb="1"]:not(.open) select[data-sel="c|1|status"].isopen')),
    'zugeklappt: Sehenswürdigkeiten weg, Platz-Zeile vollständig (Preis, gesamt, Status), offen = hinterlegt'
  );
  await edit('c|1|ppn', '250 SEK');
  ok(await page.evaluate(() => state.stages[1].my?.ppn === '250 SEK'), 'Preis in der zugeklappten Gruppe eingetragen');
  ok(!(await page.$('#tripView select[data-sel="c|0|status"].isopen')), 'bezahlter Platz: Status nicht hinterlegt');
  // aufgeklappte Gruppen werden je Tour gemerkt
  await page.click('#tripView tr.sgrow [data-grp="0"]');
  await page.waitForSelector('#tripView tbody[data-grpb="0"].open tr.sight');
  ok(
    await page.evaluate(() => (JSON.parse(localStorage.getItem('gp.ui.grp'))[state.tourId] || []).includes(0)),
    'aufgeklappte Gruppe gemerkt (gp.ui.grp je Tour)'
  );
  // Karte → Tabelle: Klick auf die Sehenswürdigkeit auf der Karte klappt auf und hebt die Zeile hervor
  await page.click('[data-tlall="0"]');
  await page.evaluate(k => {
    let mk = null;
    lyr.pins.eachLayer(l => {
      const ll = l.getLatLng && l.getLatLng();
      if (ll && Math.abs(ll.lat - state.via[0].lat) < 1e-6 && Math.abs(ll.lng - state.via[0].lon) < 1e-6) mk = l;
    });
    mk.fire('click');
  }, sk);
  await page.waitForSelector(`#tripView tbody[data-grpb="0"].open tr[data-row="s${sk}"].rowflash`, { timeout: 3000 });
  ok(true, 'Karte → Tabelle: Klick auf die Sehenswürdigkeit klappt die Gruppe auf und hebt die Zeile hervor');
  await page.evaluate(() => {
    let mk = null;
    lyr.pins.eachLayer(l => {
      const ll = l.getLatLng && l.getLatLng();
      if (ll && Math.abs(ll.lat - state.stages[1].to.lat) < 1e-6 && Math.abs(ll.lng - state.stages[1].to.lon) < 1e-6) mk = l;
    });
    mk.fire('click');
  });
  await page.waitForSelector('#tripView tr[data-row="c1"].rowflash', { timeout: 3000 });
  ok(true, 'Karte → Tabelle: Klick auf den Platz hebt seine Zeile hervor');
  // Tabelle → Karte: Klick auf eine freie Stelle der Zeile schwenkt die Karte hin
  await page.evaluate(() => {
    map.closePopup();
    map.setView([0, 0], 4, { animate: false });
    document.querySelector('#tripView tr[data-row="c1"] td[data-l="Datum"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(700);
  ok(
    await page.evaluate(() => map.getBounds().contains([state.stages[1].to.lat, state.stages[1].to.lon]) && map.getZoom() >= 10 && !!rowMark),
    'Tabelle → Karte: Karte schwenkt zum Platz und hebt ihn hervor'
  );
  // ---------- Fähre, Offene Punkte, Aufgaben (keine Kosten-Übersicht, kein „+ Zeile“) ----------
  await page.evaluate(() => {
    state.stages[1].ex = { ...(state.stages[1].ex || {}), ferry: 150000 };
    renderTrip();
  });
  ok(!!(await page.$('#tripView tbody[data-grpb="0"] tr.ferry')), 'Fähre auf der Weiterfahrt → eigene Zeile in der Gruppe');
  await edit('f|1|price', '1.250 SEK');
  await page.selectOption('#tripView select[data-sel="f|1|status"]', 'booked');
  await edit('f|1|note', 'Buchung FERRY-1');
  ok(
    (await page.evaluate(
      () => state.stages[1].ferry.price === '1.250 SEK' && state.stages[1].ferry.status === 'booked' && state.stages[1].ferry.note === 'Buchung FERRY-1'
    )) && !(await page.$('#tripView [data-ed="f|1|nr"]')),
    'Fähre: Preis, Status, Notiz gespeichert (keine Buchungsnr.)'
  );
  ok(
    !(await page.$('#tripView [data-xadd="cost"], #tripView [data-xadd="ferry"], #tripView [data-xadd="stay"], #tripView tr.addrow')),
    'kein „+ Zeile: Fähre · Kosten · Eigene Unterkunft“ mehr'
  );
  // ältere eigene Kosten-Zeile bleibt sichtbar und lässt sich löschen
  await page.evaluate(() => {
    state.extras = [{ id: 'xalt', kind: 'cost', at: String(state.stages[0].to.id), ai: 0, name: 'Maut alt', amount: '62 €' }];
    renderTrip();
  });
  ok(!!(await page.$('#tripView tbody[data-grpb="0"] tr.cost')), 'ältere Kosten-Zeile bleibt sichtbar');
  await page.click('#tripView [data-xdel="xalt"]');
  ok(await page.evaluate(() => !state.extras.length), 'ältere Kosten-Zeile mit ✕ gelöscht');
  await page.click('#tripView [data-xadd="task"]');
  await page.waitForSelector('#tripView .edin');
  await page.fill('#tripView .edin', 'Vignette kaufen');
  await page.press('#tripView .edin', 'Enter');
  let ol = await row('#openList');
  ok(
    /gebucht: Fähre/.test(ol) && /Vignette kaufen/.test(ol) && /Noch nicht gebucht/.test(ol) && !/Summe|Kosten/.test(await row('#tripView')),
    'Offene Punkte: Fähre, Aufgabe, nicht Gebuchtes – keine Kosten-Übersicht: ' + ol.slice(0, 160)
  );
  const chip1 = await page.textContent('#tripBar [data-opento]');
  const tid = await page.evaluate(() => state.extras.find(e => e.kind === 'task').id);
  await page.check(`#tripView input[type=checkbox][data-sel="x|${tid}|done"]`);
  const chip2 = await page.textContent('#tripBar [data-opento]');
  ok(
    /^\d+ offen$/.test(chip1.trim()) && parseInt(chip2) === parseInt(chip1) - 1,
    `Chip in der Reisezeile: „${chip1.trim()}“ → Aufgabe erledigt → „${chip2.trim()}“`
  );
  // Eintrag der offenen Punkte → springt zur Zeile
  await page.click('[data-tlall="0"]');
  await page.click('#openList [data-oprow="c1"]');
  await page.waitForSelector('#tripView tr[data-row="c1"].rowflash', { timeout: 3000 });
  ok(true, 'Offene Punkte: Eintrag antippen springt zur Zeile');
  await page.waitForTimeout(1300);
  ok(
    await page.evaluate(() => {
      const t = loadTours()[0];
      return t.extras?.length === 1 && t.stages[1].ferry?.note === 'Buchung FERRY-1';
    }),
    'Fähre und Aufgabe in der Tour gespeichert'
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
