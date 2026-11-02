// Pinnwand: Ideen sammeln (ohne an Übernachtungen zu denken) → App schlägt Basislager vor (nahe Ideen zusammen, nahe an
// einem bestehenden Basislager → dorthin) → Zuordnung ändern → Übernehmen = Zwischenziele; Basislager auflösen legt die
// Orte zurück auf die Pinnwand; Pinnwand wird mit der Tour gespeichert.
const { chromium } = require('playwright');
const fs = require('fs'),
  path = require('path');
const ROOT = path.join(__dirname, '..'),
  OUT = path.join(__dirname, 'out'),
  LF = path.join(ROOT, 'node_modules/leaflet/dist');
fs.mkdirSync(OUT, { recursive: true });
const PLACES = {
  Witten: [51.4436, 7.3532],
  'Astrid Lindgrens Värld': [57.6806, 15.8414],
  'Filmbyn Småland': [57.6189, 15.5636],
  'Altstadt Eksjö': [57.6664, 14.972],
  'Kleva Gruva': [57.3533, 15.0858],
  Liseberg: [57.6953, 11.9919]
};
let failures = 0;
const ok = (c, m) => {
  console.log((c ? 'OK   ' : 'FAIL ') + m);
  if (!c) failures++;
};
const srv = require('./lib/server')(ROOT, 8155);

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
    if (u.includes('/geocode/reverse') || u.includes('photon.komoot.io/reverse')) return r.fulfill({ json: { features: [] } });
    if (u.includes('photon.komoot.io')) {
      const t = (new URL(u).searchParams.get('q') || '').toLowerCase();
      const k = Object.keys(PLACES).find(k => t.includes(k.toLowerCase()) || k.toLowerCase().includes(t));
      const p = k && PLACES[k];
      return r.fulfill({ json: { features: p ? [{ geometry: { coordinates: [p[1], p[0]] }, properties: { name: k, country: 'Schweden' } }] : [] } });
    }
    if (u.includes('/geocode/')) {
      const t = (new URL(u).searchParams.get('text') || '').toLowerCase();
      const k = Object.keys(PLACES).find(k => t.includes(k.toLowerCase()) || k.toLowerCase().includes(t));
      const p = k && PLACES[k];
      return r.fulfill({ json: { features: p ? [{ geometry: { coordinates: [p[1], p[0]] }, properties: { label: `${k}, Schweden` } }] : [] } });
    }
    if (u.includes('overpass')) return r.fulfill({ json: { elements: [] } });
    if (u.startsWith('http://localhost')) return r.continue();
    return r.fulfill({ status: 503, body: '' });
  });
  await page.goto('http://localhost:8155/');
  await page.evaluate(() => localStorage.setItem('gp.settings', JSON.stringify({ key: 'eyJtest' })));
  await page.reload();
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Pinnwand-Tour' : undefined));

  // Ausgangslage: Rundreise ab Witten, ein Basislager „Astrid Lindgrens Värld“ schon als Zwischenziel
  await page.fill('#startIn', 'Witten');
  await page.check('#roundIn');
  await page.fill('#viaIn', 'Astrid Lindgrens Värld');
  await page.waitForTimeout(500);
  await page.press('#viaIn', 'Enter');
  await page.waitForFunction(() => state.via.length === 1);
  ok(
    (await page.isVisible('#pinTog')) && !(await page.isVisible('#pinIn')) && /Reiseverlauf/.test(await page.textContent('label[for=viaIn]')),
    'Reiter 1: Ideen-Ablage eingeklappt, solange leer; darunter „Reiseverlauf“'
  );
  await page.click('#pinTog');
  ok(await page.isVisible('#pinIn'), 'antippen öffnet die Ideen-Ablage');
  ok(await page.evaluate(() => $('#pinSuggest').hidden), 'ohne Ideen kein „Basislager vorschlagen“');

  // Ideen sammeln (Enter im Feld)
  for (const t of ['Filmbyn Småland', 'Altstadt Eksjö', 'Kleva Gruva', 'Liseberg']) {
    await page.fill('#pinIn', t);
    await page.press('#pinIn', 'Enter');
    await page.waitForFunction(n => state.ideas.length === n, ['Filmbyn Småland', 'Altstadt Eksjö', 'Kleva Gruva', 'Liseberg'].indexOf(t) + 1);
  }
  ok(
    (await page.$$eval('#pinList li', e => e.length)) === 4 && /\(4\)/.test(await page.textContent('#pinCount')),
    'vier Ideen auf der Pinnwand: ' + (await page.textContent('#pinCount'))
  );
  ok(await page.evaluate(() => state.via.length === 1 && !state.stages.length), 'Ideen ändern weder Zwischenziele noch Planung');
  ok(/von Astrid Lindgrens Värld/.test(await page.textContent('#pinList')), 'Hinweis: Idee liegt nahe an einem Basislager');
  ok((await page.$$('.leaflet-marker-icon .pin.idea')).length === 4, 'Ideen als eigene Punkte auf der Karte');
  // doppelte Idee wird abgewiesen
  await page.fill('#pinIn', 'Kleva Gruva');
  await page.press('#pinIn', 'Enter');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => state.ideas.length === 4), 'doppelte Idee wird abgewiesen');

  // Vorschlag
  await page.click('#pinSuggest');
  const prop = await page.evaluate(() =>
    pinProp.groups.map(g => ({ base: !!g.base, nights: g.nights, ideas: groupIdeas(g.key).map(x => shortLabel(x.label)) }))
  );
  console.log('     Vorschlag:', JSON.stringify(prop));
  ok(
    prop.length === 3 &&
      prop.some(g => g.base && g.ideas.join() === 'Filmbyn Småland') &&
      prop.some(g => !g.base && g.ideas.length === 2 && g.ideas.includes('Altstadt Eksjö') && g.ideas.includes('Kleva Gruva') && g.nights === 3) &&
      prop.some(g => !g.base && g.ideas.join() === 'Liseberg' && g.nights === 2),
    'Vorschlag: Filmbyn → bestehendes Basislager, Eksjö + Kleva Gruva → neues Basislager (3 Nächte), Liseberg eigenes (2 Nächte)'
  );
  ok(
    /Neues Basislager A bei/.test(await page.textContent('#pinProp')) && (await page.$('.leaflet-marker-icon .pin.idea')),
    'Vorschlag mit Buchstaben, Karte zeigt sie'
  );
  // Liseberg lieber als Besuch unterwegs, eine Nacht mehr in Eksjö
  const lis = await page.evaluate(() => state.ideas.find(x => /Liseberg/.test(x.label)).uid);
  await page.selectOption(`[data-pinpick="${lis}"]`, 'visit');
  const ek = await page.evaluate(() => pinProp.groups.find(g => !g.base && groupIdeas(g.key).length === 2).key);
  await page.click(`[data-pinn="${ek}"][data-d="1"]`);
  ok(/Unterwegs \/ Pinnwand/.test(await page.textContent('#pinProp')), 'Liseberg unter „Unterwegs / Pinnwand“');
  await page.click('#pinApply');
  const via = await page.evaluate(() =>
    state.via.map(v => ({ l: shortLabel(v.label), k: v.kind, n: v.nights, s: (v.sights || []).map(x => shortLabel(x.label)) }))
  );
  console.log('     Zwischenziele:', JSON.stringify(via));
  ok(
    via.length === 3 &&
      via.some(v => v.l === 'Astrid Lindgrens Värld' && v.s.join() === 'Filmbyn Småland') &&
      via.some(v => v.k === 'stay' && v.n === 4 && v.s.length === 1 && ['Altstadt Eksjö', 'Kleva Gruva'].includes(v.l)) &&
      via.some(v => v.k === 'visit' && v.l === 'Liseberg'),
    'Übernommen: Filmbyn bei Värld, neues Basislager Eksjö-Gegend (4 Nächte), Liseberg als Besuch unterwegs'
  );
  ok(await page.evaluate(() => !state.ideas.length && $('#pinSuggest').hidden && !$('#pinProp').innerHTML), 'Pinnwand danach leer');
  // Reihenfolge: neues Basislager an der Stelle mit dem kleinsten Umweg (Rundreise Witten → … → Witten)
  ok(await page.evaluate(() => state.via.every(v => v.lat != null)), 'Zwischenziele mit Koordinaten');

  // Sehenswürdigkeit aus einem Basislager entfernen → zurück auf die Pinnwand
  const vi = await page.evaluate(() => state.via.findIndex(v => /Astrid/.test(v.label)));
  await page.click(`[data-vsdel="${vi}:0"]`);
  ok(
    await page.evaluate(() => state.ideas.length === 1 && /Filmbyn/.test(state.ideas[0].label) && !state.via.find(v => /Astrid/.test(v.label)).sights.length),
    'Chip ✕ legt „Filmbyn“ zurück auf die Pinnwand'
  );
  // Basislager auflösen → Hauptort + Sehenswürdigkeiten zurück auf die Pinnwand
  const ni = await page.evaluate(() => state.via.findIndex(v => v.kind === 'stay' && v.sights && v.sights.length === 1));
  await page.click(`[data-vdel="${ni}"]`);
  ok(
    await page.evaluate(() => state.ideas.length === 3 && state.via.length === 2),
    'Basislager ✕ legt Hauptort und Sehenswürdigkeit zurück auf die Pinnwand (nichts geht verloren)'
  );
  // ✕ auf der Pinnwand entfernt ganz
  await page.click('#pinList [data-pindel]');
  ok(await page.evaluate(() => state.ideas.length === 2), '✕ auf der Pinnwand entfernt die Idee');

  // Pinnwand gehört zur Tour: Tour-Datei enthält sie, Laden stellt sie wieder her
  const t = await page.evaluate(() => {
    state.start = state.end = { label: 'Witten, Deutschland', lat: 51.4436, lon: 7.3532 };
    return buildTour('Pinnwand-Tour', 4711);
  });
  ok(Array.isArray(t.ideas) && t.ideas.length === 2, 'Tour-Datei enthält die Pinnwand');
  await page.evaluate(() => resetTour());
  ok(await page.evaluate(() => !state.ideas.length && !$('#pinList').children.length), 'Neue Tour: Pinnwand leer');
  await page.evaluate(t => loadTour(null, { ...t, stages: [] }, true), t);
  ok(await page.evaluate(() => state.ideas.length === 2 && $('#pinList').children.length === 2), 'Tour laden: Pinnwand wiederhergestellt');

  // Idee auf eine Station ziehen: auf ★-Ziel = Sehenswürdigkeit dort
  const drag = async (from, to) => {
    const a = await page.locator(from).first().boundingBox(),
      b = await page.locator(to).boundingBox();
    await page.mouse.move(a.x + 15, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 40, a.y + 30, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  const st = await page.evaluate(() => state.via.findIndex(v => v.kind === 'stay'));
  const nIdeas = await page.evaluate(() => state.ideas.length);
  await drag('#pinList li[data-pindrag]', `#viaList li[data-vi="${st}"]`);
  ok(
    await page.evaluate(([st, n]) => state.ideas.length === n - 1 && state.via[st].sights.length === 1, [st, nIdeas]),
    'Idee auf ★-Station gezogen → Sehenswürdigkeit dort'
  );
  // auf einen Besuch unterwegs = neuer Besuch danach
  const vis = await page.evaluate(() => state.via.findIndex(v => v.kind === 'visit'));
  const nv = await page.evaluate(() => state.via.length);
  await drag('#pinList li[data-pindrag]', `#viaList li[data-vi="${vis}"]`);
  ok(
    await page.evaluate(([vis, nv]) => state.via.length === nv + 1 && state.via[vis + 1].kind === 'visit' && !state.ideas.length, [vis, nv]),
    'Idee auf Besuch gezogen → neuer Besuch unterwegs danach; Ablage leer'
  );

  // Gleiche Orte auf Hin- und Rückweg: Fähre + Pause-Platz am Anfang, „Hinweg als Rückweg“
  await page.evaluate(() => {
    state.via.unshift(
      {
        uid: 'vF',
        label: 'Travemünde Skandinavienkai, Deutschland',
        lat: 53.944,
        lon: 10.86,
        kind: 'ferry',
        pin: true,
        hours: 9,
        to: { lat: 55.61, lon: 12.99, label: 'Malmö Hamn, Schweden' }
      },
      { uid: 'vR', label: 'Bauernhof Vellinge, Schweden', lat: 55.493, lon: 13.002, kind: 'rest', nights: 1 }
    );
    renderVia();
  });
  ok(await page.isVisible('#viaBack'), 'Rundreise: Knopf „Hinweg als Rückweg …“');
  const n0 = await page.evaluate(() => state.via.length);
  await page.click('#viaBack');
  await page.waitForSelector('#askDlg[open]');
  const btns = await page.$$eval('#askBtns button', b => b.map(x => x.textContent + (x.classList.contains('primary') ? ' *' : '')));
  ok(
    btns.some(t => /1–2 \(bis Bauernhof Vellinge\) \*/.test(t)),
    'Vorschlag: Anreise bis vor das erste ★-Ziel: ' + btns.join(' | ')
  );
  await page.click('#askBtns button.primary');
  const back = await page.evaluate(
    n0 => state.via.slice(n0).map(v => ({ k: v.kind, l: shortLabel(v.label), to: v.to && shortLabel(v.to.label), pin: v.pin, uid: v.uid })),
    n0
  );
  console.log('     Rückweg:', JSON.stringify(back));
  ok(
    back.length === 2 &&
      back[0].k === 'rest' &&
      back[0].l === 'Bauernhof Vellinge' &&
      back[1].k === 'ferry' &&
      back[1].l === 'Malmö Hamn' &&
      back[1].to === 'Travemünde Skandinavienkai' &&
      back.every(v => v.pin && !['vF', 'vR'].includes(v.uid)),
    'Rückweg: Vellinge, dann Fähre Malmö → Travemünde (Gegenrichtung), neue uid, 📌'
  );
  // Duplizieren: Kopie direkt darunter
  const nd = await page.evaluate(() => state.via.length);
  await page.click('[data-vdup="1"]');
  ok(
    await page.evaluate(nd => state.via.length === nd + 1 && state.via[2].label === state.via[1].label && state.via[2].uid !== state.via[1].uid, nd),
    'Duplizieren: Kopie direkt darunter (eigene uid)'
  );
  // gleichen Ort noch einmal eingeben → Rückfrage statt Abweisung (Dialog wird bestätigt)
  const na = await page.evaluate(() => state.via.length);
  await page.fill('#viaIn', 'Liseberg');
  await page.waitForTimeout(500);
  await page.press('#viaIn', 'Enter');
  ok(
    await page
      .waitForFunction(na => state.via.length === na + 1, na, { timeout: 8000 })
      .then(
        () => true,
        () => false
      ),
    'gleicher Ort noch einmal: nach Rückfrage hinzugefügt'
  );
  await page.screenshot({ path: path.join(OUT, 'pinnwand.png') });
  await browser.close();
  srv.close();
  console.log(failures ? `\n${failures} Fehler` : '\nALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})();
