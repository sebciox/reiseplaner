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

const srv = require('./lib/server')(ROOT, 8123);

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
    mxCount = 0;
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
      for (let f = 0.02; f < 1; f += 0.02)
        all.push({
          type: 'node',
          id: Math.round(f * 1000),
          lat: A[0] + (B[0] - A[0]) * f + 0.01,
          lon: A[1] + (B[1] - A[1]) * f,
          tags: { tourism: 'camp_site', name: 'Platz ' + Math.round(f * 100), caravans: f > 0.5 ? 'yes' : undefined, description: 'x'.repeat(200) }
        });
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

  await page.goto('http://localhost:8123/');
  // 1) Standardwerte im Dialog
  await page.click('#settingsBtn');
  ok(await page.isChecked('#sHighway'), 'Autobahn bevorzugen ist standardmäßig an');
  ok(!(await page.isChecked('#sToll')), 'Maut meiden ist standardmäßig aus');
  await page.fill('#sKey', 'eyJtest');
  await page.click('#settingsForm button[value=save]');
  await page.waitForFunction(() => !document.querySelector('#settingsDlg').open);
  await page.waitForTimeout(100);
  let st = await page.evaluate(() => JSON.parse(localStorage.getItem('gp.settings')));
  ok(st.highway === true && st.noToll === false, 'gespeichert: highway=true, noToll=false');
  await page.screenshot({ path: path.join(OUT, 'shot0.png') });

  // 2) Planen mit Autobahn-Modus
  await page.fill('#startIn', 'Witten');
  await page.fill('#endIn', 'Sant Pere Pescador');
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('[data-n]', { timeout: 15000 });
  const total = await page.textContent('.total .big');
  const ovDist = await page.evaluate(() => state.overview.dist);
  ok(total.trim() === Math.round(ovDist / 1000).toLocaleString('de-DE') + ' km', 'Gesamtstrecke angezeigt: ' + total.trim());
  const opts = await page.$$eval('[data-n]', bs =>
    bs.map(b => b.dataset.n + (b.classList.contains('rec') ? '*' : '') + ': ' + b.innerText.replace(/\s+/g, ' '))
  );
  console.log('     Optionen:\n       ' + opts.join('\n       '));
  const nRec = Math.ceil(ovDist / 450000);
  ok(
    opts.some(o => o.startsWith(nRec + '*')),
    'Empfehlung = ' + nRec + ' Etappen'
  );
  const nDir = dirBodies.length;
  await page.screenshot({ path: path.join(OUT, 'shotAsk.png') });
  // eigene Anzahl über das Eingabefeld: 4 Etappen
  await page.fill('#nIn', '4');
  ok((await page.textContent('#nHint')).includes(Math.round(ovDist / 4000).toLocaleString('de-DE') + ' km'), 'Hinweis zeigt km je Etappe bei 4');
  await page.click('#nForm button[type=submit]');
  await page.waitForSelector('[data-pick]', { timeout: 15000 });
  ok(dirBodies.length === nDir, 'Gesamtroute wird für Etappe 1 wiederverwendet (keine zweite Anfrage)');
  ok((await page.textContent('#result h3')).includes('Etappe 1 von 4'), 'Überschrift „Etappe 1 von 4“');
  const p1 = await page.evaluate(() => ({ len: state.pending.plan.len, cmin: state.pending.cmin, cmax: state.pending.cmax }));
  ok(
    Math.abs(p1.len - ovDist / 4) < 1 && p1.cmin <= p1.len / 1000 && p1.cmax >= p1.len / 1000,
    `Korridor ${p1.cmin}–${p1.cmax} km um ideal ${Math.round(p1.len / 1000)} km`
  );
  let b = dirBodies.at(-1);
  ok(
    !('maximum_speed' in b) && b.instructions === true && b.preference === 'fastest' && !b.options,
    'Autobahn an: ohne maximum_speed, mit Schritten, ohne avoid: ' + JSON.stringify({ ...b, coordinates: undefined })
  );
  // Etappen wählen bis fertig
  for (let i = 0; i < 8; i++) {
    const done = await page.$('[data-endpick]');
    if (done) break;
    await page.click('[data-pick]');
    await page.waitForFunction(() => !state.busy && (document.querySelector('[data-pick]') || document.querySelector('[data-endpick]')), null, {
      timeout: 15000
    });
    await page.waitForTimeout(300);
  }
  await page.waitForSelector('[data-endpick]', { timeout: 15000 });
  await page.click('[data-endpick]');
  await page.waitForSelector('.endsel');
  ok(!(await page.$('[data-endpick]')), 'Zielliste nach Auswahl eingeklappt: ' + (await page.textContent('.endsel')).replace(/\s+/g, ' ').trim());
  // Fahrzeit-Check: Etappen in state lesen, gegen Deckelung prüfen
  const stages = await page.evaluate(() => state.stages.map(s => ({ dist: s.dist, dur: s.dur })));
  const expDur = d => (d * 0.7) / (80 / 3.6) + (d * 0.3) / (60 / 3.6);
  ok(stages.length === 4, 'genau 4 Etappen: ' + stages.map(s => Math.round(s.dist / 1000)).join(' / ') + ' km');
  ok(
    stages.length >= 2 && stages.every(s => Math.abs(s.dur - expDur(s.dist)) < 1),
    `Fahrzeit gedeckelt auf 80 km/h (${stages.length} Etappen, z. B. ${Math.round(stages[0].dur)} s statt ${Math.round((stages[0].dist * 0.7) / (120 / 3.6) + (stages[0].dist * 0.3) / (60 / 3.6))} s)`
  );
  await page.screenshot({ path: path.join(OUT, 'shot1.png') });

  // Export → neu → Import
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#expBtn')]);
  const fp = path.join(OUT, 'tour.etappen.json');
  await dl.saveAs(fp);
  await page.click('#newBtn');
  ok(await page.evaluate(() => state.stages.length === 0), 'Neue Tour: leer');
  const opBeforeImport = T.op;
  await page.click('#toursBtn');
  await page.setInputFiles('#importIn', fp);
  await page.waitForFunction(() => state.stages.length > 0);
  await page.waitForTimeout(500);
  ok(T.op === opBeforeImport, `Import einer fertigen Tour: keine Campingplatz-Abfrage (${T.op - opBeforeImport})`);
  ok(
    (await page.evaluate(() => state.endCands.length > 0 && state.endSearched)) && !!(await page.$('.endsel')),
    'Plätze am Ziel aus der Tour-Datei geladen, Liste eingeklappt'
  );
  await page.click('#endListBtn');
  await page.waitForSelector('[data-endpick]');
  ok(T.op === opBeforeImport && (await page.textContent('#result')).includes('✓ Ziel'), '„Ändern“ klappt die gespeicherte Liste ohne Abfrage auf');
  // ältere Tour ohne gespeicherte Ziel-Plätze → Knopf statt automatischer Suche
  const old = JSON.parse(fs.readFileSync(fp));
  delete old.tour.endCands;
  old.tour.id = 4242;
  const fpOld = path.join(OUT, 'alt.etappen.json');
  fs.writeFileSync(fpOld, JSON.stringify(old));
  const op2 = T.op;
  await page.click('#toursBtn');
  await page.setInputFiles('#importIn', fpOld);
  await page.waitForSelector('#endListBtn');
  ok(T.op === op2, 'alte Tour: keine automatische Suche, Zielplatz + Knopf „' + (await page.textContent('#endListBtn')).trim() + '“');
  await page.click('#endListBtn');
  await page.waitForSelector('[data-endpick]');
  ok(T.op - op2 <= 1, 'Knopf zeigt die Plätze am Ziel (' + (T.op - op2 ? 'neue Abfrage' : 'aus dem Zwischenspeicher') + ')');
  await page.click('#toursBtn');
  await page.setInputFiles('#importIn', fp);
  await page.waitForFunction(() => state.tourId !== 4242);
  ok(await page.evaluate(n => state.stages.length === n && state.n === n, stages.length), 'Import stellt Etappen und Anzahl wieder her');

  // 3) Einstellungen umschalten: Autobahn aus, Maut meiden an
  await page.click('#newBtn');
  await page.click('#settingsBtn');
  ok((await page.inputValue('#sKey')) === 'eyJtest', 'Schlüssel bleibt erhalten');
  await page.uncheck('#sHighway');
  await page.check('#sToll');
  await page.click('#settingsForm button[value=save]');
  await page.waitForFunction(() => !document.querySelector('#settingsDlg').open);
  await page.waitForTimeout(100);
  st = await page.evaluate(() => JSON.parse(localStorage.getItem('gp.settings')));
  ok(st.highway === false && st.noToll === true, 'gespeichert: highway=false, noToll=true');
  await page.reload();
  await page.click('#settingsBtn');
  ok(!(await page.isChecked('#sHighway')) && (await page.isChecked('#sToll')), 'nach Neuladen korrekt im Dialog');
  await page.screenshot({ path: path.join(OUT, 'shot2.png') });
  await page.click('#settingsForm button[value=cancel]');
  await page.fill('#startIn', 'Witten');
  await page.fill('#endIn', 'Sant Pere Pescador');
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('[data-n]', { timeout: 15000 });
  await page.click('[data-n].rec');
  await page.waitForSelector('[data-pick]', { timeout: 15000 });
  // Anzahl ändern → zurück zur Frage, dann 2 Etappen
  await page.click('#nChange');
  await page.waitForSelector('[data-n]');
  ok(await page.evaluate(() => state.n === null && !state.pending), '„Anzahl ändern“ führt zurück zur Frage');
  await page.click('[data-n="2"]');
  await page.waitForSelector('[data-pick]', { timeout: 15000 });
  ok((await page.textContent('#result h3')).includes('von 2'), 'jetzt 2 Etappen');
  await page.click('[data-pick]');
  await page.waitForSelector('[data-endpick]', { timeout: 15000 });
  ok(await page.evaluate(() => state.done && state.stages.length === 2), 'nach 1 Platz direkt zum Ziel (2 Etappen)');
  b = dirBodies.at(-2);
  ok(
    b.maximum_speed === 80 && b.instructions === false && !b.preference && JSON.stringify(b.options) === '{"avoid_features":["tollways"]}',
    'Autobahn aus + Maut: ' + JSON.stringify({ ...b, coordinates: undefined })
  );
  const p = await page.evaluate(() => ({ d: state.overview.dist, t: state.overview.dur }));
  ok(Math.abs(p.t - ((p.d * 0.7) / (120 / 3.6) + (p.d * 0.3) / (60 / 3.6))) < 1, 'Autobahn aus: Fahrzeit = ORS-Dauer (ungedeckelt)');

  // ---------- 4) Zwischenspeicher, Wiederholversuche, 429, Zoom ----------
  const planN = async n => {
    await page.click('#planForm button[type=submit]');
    await page.waitForSelector('[data-n]', { timeout: 15000 });
    await page.click(`[data-n="${n}"]`);
    await page.waitForSelector('[data-pick]', { timeout: 90000 });
  };
  await page.evaluate(() => {
    localStorage.removeItem('gp.cache.op2');
    localStorage.removeItem('gp.cache.mx');
    cacheClear();
  });
  await page.evaluate(() => resetTour());
  let o0 = T.op,
    m0 = T.mx;
  await planN(3);
  ok(T.op - o0 === 1, `Etappe 1: genau 1 Overpass-Abfrage (${T.op - o0})`);
  const slim = await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('gp.cache.op2'));
    return { n: c.length, desc: JSON.stringify(c).includes('description'), size: localStorage.getItem('gp.cache.op2').length };
  });
  ok(slim.n === 1 && !slim.desc, `im Browser gespeichert, nur nötige Tags (${slim.size} Zeichen)`);
  await page.click('[data-pick]');
  await page.waitForSelector('[data-edit="0"]', { timeout: 15000 });
  await page.waitForSelector('[data-pick]', { timeout: 15000 });
  o0 = T.op;
  m0 = T.mx;
  await page.click('[data-edit="0"]');
  await page.waitForSelector('[data-pick]', { timeout: 15000 });
  ok(T.op === o0 && T.mx === m0, `„Platz ändern“: keine neue Overpass-/Matrix-Abfrage (${T.op - o0}/${T.mx - m0})`);
  // Neu laden → aus dem Browser-Speicher
  await page.reload();
  o0 = T.op;
  m0 = T.mx;
  await planN(3);
  ok(T.op === o0 && T.mx === m0, `nach Neuladen: Etappe 1 komplett aus dem Zwischenspeicher (${T.op - o0}/${T.mx - m0})`);
  // abgelaufener Eintrag (älter als 7 Tage) wird nicht benutzt
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('gp.cache.op2'));
    c.forEach(e => (e.t -= 8 * 864e5));
    localStorage.setItem('gp.cache.op2', JSON.stringify(c));
  });
  ok(await page.evaluate(() => cacheLoad('gp.cache.op2').length === 0), 'Einträge älter als 7 Tage verfallen');

  // 504 dreimal → Versuch 2 von 4 → Erfolg
  await page.evaluate(() => cacheClear());
  await page.evaluate(() => resetTour());
  T.opFail.n = 3;
  T.opFail.status = 504;
  o0 = T.op;
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('[data-n]');
  await page.click('[data-n="3"]');
  await page.waitForFunction(() => /Versuch 2 von 4 in \d s/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
  ok(true, 'Anzeige: ' + (await page.textContent('#status')).trim());
  await page.waitForSelector('[data-pick]', { timeout: 30000 });
  ok(T.op - o0 === 4, `nach 3× 504 im 2. Versuch erfolgreich (${T.op - o0} Anfragen)`);

  // dauerhaft 429 → eigene Meldung
  await page.evaluate(() => cacheClear());
  await page.evaluate(() => resetTour());
  T.opFail.n = 100;
  T.opFail.status = 429;
  const t0 = Date.now();
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('[data-n]');
  await page.click('[data-n="3"]');
  await page.waitForFunction(() => /Zu viele Abfragen – Versuch/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
  await page.waitForSelector('#status.error', { timeout: 60000 });
  const msg = (await page.textContent('#status')).trim();
  ok(msg.includes('429'), `429-Meldung nach ${Math.round((Date.now() - t0) / 1000)} s: ${msg}`);
  ok(await page.isVisible('#contBtn'), '„Erneut versuchen“ sichtbar');
  T.opFail.n = 0;
  o0 = T.op;
  await page.click('#contBtn');
  await page.waitForSelector('[data-pick]', { timeout: 15000 });
  ok(T.op - o0 === 1, 'Erneut versuchen klappt');

  // Zoom-Abfragen: neue Abfrage bricht die ältere ab; Plätze erscheinen
  await page.waitForTimeout(1500);
  T.opDelay = 2500;
  o0 = T.op;
  let aborted = 0;
  page.on('requestfailed', rq => {
    if (rq.url().includes('overpass')) aborted++;
  });
  await page.evaluate(() => map.setView([46.0, 4.0], 11, { animate: false }));
  await page.waitForTimeout(1200);
  await page.evaluate(([la, lo]) => map.setView([la, lo], 11, { animate: false }), [A[0] + (B[0] - A[0]) * 0.5 + 0.01, A[1] + (B[1] - A[1]) * 0.5]);
  await page.waitForTimeout(4500);
  const z = await page.evaluate(() => ({ key: areaKey, n: lyr.area.getLayers().length }));
  ok(T.op - o0 === 2 && aborted === 1, `ältere Zoom-Abfrage abgebrochen (${T.op - o0} gesendet, ${aborted} abgebrochen)`);
  ok(z.key !== '' && z.n >= 0, `Zoom-Plätze geladen (${z.n} zusätzliche Marker)`);
  T.opDelay = 0;

  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
