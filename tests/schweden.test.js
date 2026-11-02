// Nachbau von Sebastians Reise-PDF „Schweden Rundreise 2026“ (tests/fixtures/schweden-2026.json):
// Die Reise wird wie von Hand geplant (Zwischenziele mit Nächten und Sehenswürdigkeiten, Rundreise, Plätze wählen,
// fehlende Plätze per Koordinaten) und danach jede Angabe der PDF in die Reiseplan-Tabelle eingetragen.
// ok()  = muss gehen (sonst Testfehler)
// can() = Fähigkeit der App gegenüber der PDF – fehlt sie, wird sie als „LÜCKE“ gemeldet (kein Testfehler),
//         am Ende steht eine Liste, was die App (noch) nicht so abbilden kann.
const { chromium } = require('playwright');
const fs = require('fs'),
  path = require('path');
const ROOT = path.join(__dirname, '..'),
  OUT = path.join(__dirname, 'out'),
  LF = path.join(ROOT, 'node_modules/leaflet/dist');
fs.mkdirSync(OUT, { recursive: true });
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/schweden-2026.json'), 'utf8'));
const hav = (a, b) => {
  const R = 6371000,
    r = Math.PI / 180,
    dLa = (b[0] - a[0]) * r,
    dLo = (b[1] - a[1]) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
let failures = 0;
const gaps = [],
  okCaps = [];
let passed = 0;
const ok = (c, m) => {
  console.log((c ? 'OK    ' : 'FAIL  ') + m);
  if (!c) failures++;
  else passed++;
};
const can = (c, m, hint) => {
  console.log((c ? 'OK    ' : 'LÜCKE ') + m + (!c && hint ? ` – ${hint}` : ''));
  (c ? okCaps : gaps).push(m + (!c && hint ? ` – ${hint}` : ''));
};
// alle Orte für die Ortssuche (Start + Zwischenziele + Sehenswürdigkeiten)
const PLACES = [F.start, ...F.ziele, ...F.ziele.flatMap(z => z.sights)];
const findPlace = t => {
  t = String(t || '').toLowerCase();
  return PLACES.find(p => p.name.toLowerCase() === t) || PLACES.find(p => t.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(t));
};
const srv = require('./lib/server')(ROOT, 8153);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true, locale: 'de-DE', viewport: { width: 1400, height: 950 } });
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
    if (u.includes('/geocode/')) {
      const p = findPlace(new URL(u).searchParams.get('text'));
      return r.fulfill({ json: { features: p ? [{ geometry: { coordinates: [p.lon, p.lat] }, properties: { label: p.name + (p === F.start ? ', Deutschland' : ', Schweden') } }] : [] } });
    }
    if (u.includes('photon.komoot.io/api')) return r.fulfill({ json: { features: [] } });
    if (u.includes('/v2/directions/')) {
      // gerade Linie; Fähre = Teil zwischen 54,0° und 55,35° Breite (Ostsee Travemünde ↔ Malmö)
      const b = JSON.parse(r.request().postData());
      const P = b.coordinates;
      let coords = [],
        dist = 0,
        ferry = 0;
      for (let k = 1; k < P.length; k++) {
        const [lo1, la1] = P[k - 1],
          [lo2, la2] = P[k];
        const N = 60;
        for (let i = k === 1 ? 0 : 1; i <= N; i++) coords.push([lo1 + ((lo2 - lo1) * i) / N, la1 + ((la2 - la1) * i) / N]);
        const d = hav([la1, lo1], [la2, lo2]) * 1.2;
        dist += d;
        const lo = Math.max(Math.min(la1, la2), 54.0),
          hi = Math.min(Math.max(la1, la2), 55.35);
        if (hi > lo && Math.abs(la2 - la1) > 1e-6) ferry += (d * (hi - lo)) / Math.abs(la2 - la1);
      }
      const dur = dist / (85 / 3.6);
      const props = {
        summary: { distance: dist, duration: dur },
        segments: [{ distance: dist, duration: dur, steps: [{ distance: dist, duration: dur }] }],
        extras: {
          waycategory: {
            summary: [{ value: 0, distance: dist - ferry }, ...(ferry ? [{ value: 4, distance: ferry }] : [])]
          },
          tollways: { summary: [] }
        }
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
      // die Plätze der PDF + je ein anderer Platz daneben (damit wirklich gewählt werden muss)
      const all = F.camps.flatMap(c => [
        { type: 'node', id: c.id, lat: c.lat, lon: c.lon, tags: { tourism: 'camp_site', name: c.osm } },
        { type: 'node', id: c.id + 5000, lat: c.lat + 0.02, lon: c.lon - 0.03, tags: { tourism: 'camp_site', name: 'Anderer Platz ' + c.id } }
      ]);
      return r.fulfill({ json: { elements: all.filter(e => e.lat >= S && e.lat <= N && e.lon >= W && e.lon <= E) } });
    }
    if (u.includes('cdn.jsdelivr.net/npm/docx@'))
      return r.fulfill({ body: fs.readFileSync(path.join(ROOT, 'node_modules/docx/dist/index.iife.js')), contentType: 'text/javascript' });
    if (u.includes('api.frankfurter.app')) return r.fulfill({ json: { rates: { SEK: 11.0, NOK: 11.7, DKK: 7.46 } } });
    return r.continue();
  });
  await page.addInitScript(() => {
    window.print = () => (window.__printed = (window.__printed || 0) + 1);
  });
  await page.goto('http://localhost:8153/');
  await page.evaluate(() => localStorage.setItem('gp.settings', JSON.stringify({ key: 'eyJtest', adults: 2, kids: 2 })));
  await page.reload();
  let promptAnswer = 'Schweden Rundreise 2026';
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? promptAnswer : undefined));
  const t0 = Date.now();

  /* ---------- 1. Planen wie von Hand ---------- */
  const addVia = async t => {
    const n0 = await page.evaluate(() => state.via.length);
    await page.fill('#viaIn', t);
    await page.waitForTimeout(500);
    await page.press('#viaIn', 'Enter');
    await page.waitForFunction(n => state.via.length === n, n0 + 1);
  };
  await page.fill('#startIn', F.start.name);
  await page.check('#roundIn');
  for (const [k, z] of F.ziele.entries()) {
    await addVia(z.name);
    await page.fill(`[data-vnights="${k}"]`, String(z.nights));
    await page.dispatchEvent(`[data-vnights="${k}"]`, 'change');
    for (const s of z.sights) {
      const n0 = await page.evaluate(k => (state.via[k].sights || []).length, k);
      await page.fill(`[data-vsadd="${k}"]`, s.name);
      await page.waitForTimeout(300);
      await page.press(`[data-vsadd="${k}"]`, 'Enter');
      await page.waitForFunction(([k, n]) => (state.via[k].sights || []).length === n, [k, n0 + 1]);
    }
  }
  await page.fill('#dateIn', F.date);
  await page.dispatchEvent('#dateIn', 'change');
  ok(
    await page.evaluate(n => state.via.length === n && state.via[1].sights.length === 5 && state.round, F.ziele.length),
    `Eingabe: ${F.ziele.length} Ziele mit Nächten, Basislager Astrid Lindgrens Värld mit 5 weiteren Sehenswürdigkeiten, Rundreise`
  );
  await page.click('#planForm button[type=submit]');
  await page.waitForSelector('#segGo', { timeout: 20000 });
  // Etappen je Abschnitt: hin 3 (Travemünde, Vellinge, Karlshamn), zurück 3 (Vellinge, Travemünde, Witten), sonst 1
  const nSeg = await page.evaluate(() => state.segs.length);
  for (let k = 0; k < nSeg; k++) {
    const want = k === 0 || k === nSeg - 1 ? 3 : 1;
    for (let g = 0; g < 8; g++) {
      const n = await page.evaluate(k => state.segs[k].n, k);
      if (n === want) break;
      await page.click(`[data-segn="${k}"][data-d="${n > want ? -1 : 1}"]`);
    }
  }
  ok(await page.evaluate(() => state.segs.map(g => g.n).join() === '3,1,1,1,1,1,1,3'), 'Abschnitte: 3 · 1 · 1 · 1 · 1 · 1 · 1 · 3 Etappen');
  await page.click('#segGo');
  const order = F.plan.map(p => p.camp);
  const added = [];
  for (let st = 0; st < order.length; st++) {
    await page.waitForFunction(() => !state.busy && (document.querySelector('#result [data-pick]') || document.querySelector('#result form.addcamp')), null, {
      timeout: 30000
    });
    const want = order[st];
    if (typeof want === 'number') {
      const camp = F.camps.find(c => c.id === want);
      if (await page.$(`#result [data-pick="node/${want}"]`)) await page.click(`#result [data-pick="node/${want}"]`);
      else {
        // nicht im Umkreis → „Platz fehlt?“ mit Koordinaten (wie von Hand)
        added.push(camp.osm);
        promptAnswer = camp.osm;
        await page.fill('#result form.addcamp input[name=q]', `${camp.lat}, ${camp.lon}`);
        await page.press('#result form.addcamp input[name=q]', 'Enter');
        const id = `eigen/${camp.lat.toFixed(5)},${camp.lon.toFixed(5)}`;
        await page.waitForSelector(`#result [data-pick="${id}"]`, { timeout: 15000 });
        await page.click(`#result [data-pick="${id}"]`);
      }
    } else {
      const t = F.transit[want];
      promptAnswer = t.name;
      await page.fill('#result form.addcamp input[name=q]', `${t.lat}, ${t.lon}`);
      await page.press('#result form.addcamp input[name=q]', 'Enter');
      const id = `eigen/${t.lat.toFixed(5)},${t.lon.toFixed(5)}`;
      await page.waitForSelector(`#result [data-pick="${id}"]`, { timeout: 15000 });
      await page.click(`#result [data-pick="${id}"]`);
    }
    await page.waitForFunction(n => !state.busy && state.stages.length >= n, st + 1, { timeout: 30000 });
  }
  await page.waitForFunction(() => !state.busy && state.done, null, { timeout: 30000 });
  promptAnswer = 'Schweden Rundreise 2026';
  ok(
    await page.evaluate(n => state.stages.length === n + 1 && state.stages[n].to.kind !== 'camp', order.length),
    `Planung: ${order.length} Übernachtungen + Heimfahrt nach Witten`
  );
  if (added.length) console.log('       (per „Platz fehlt?“ ergänzt, weil nicht im Umkreis: ' + added.join(', ') + ')');
  const dates = await page.evaluate(() => stageDates().map(d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`));
  ok(
    F.plan.every((p, i) => dates[i] === p.von) && dates[order.length] === '15.08.',
    'Daten wie in der PDF: ' + F.plan.map((p, i) => `${dates[i]}=${p.von}`).join(' ')
  );
  const ferryStages = await page.evaluate(() => state.stages.map((s, i) => (s.ex?.ferry > 500 ? i : -1)).filter(i => i >= 0));
  ok(ferryStages.join() === '1,10', 'Fähre Travemünde ↔ Malmö auf Etappe 2 und 11 erkannt');
  await page.waitForFunction(() => uiTab === 'trip', null, { timeout: 5000 });
  await page.click('[data-act="save"]');
  await page.waitForFunction(() => !!state.tourId);
  await page.click('[data-tlall="1"]');
  await page.waitForTimeout(400);

  /* ---------- 2. Angaben der PDF eintragen ---------- */
  const edit = async (key, val) => {
    const sel = `#tripView [data-ed="${key}"]`;
    if (!(await page.$(sel))) return false;
    await page.click(sel);
    const inp = await page.waitForSelector('#tripView .edin');
    await inp.fill(val);
    await inp.press('Enter');
    await page.waitForFunction(() => !document.querySelector('#tripView .edin'));
    return true;
  };
  const status = async (key, v) => {
    const sel = `#tripView select[data-sel="${key}"]`;
    if (!(await page.$(sel))) return false;
    await page.selectOption(sel, v);
    return true;
  };
  const sightUid = name =>
    page.evaluate(n => {
      const all = [...state.via, ...state.via.flatMap(v => v.sights || [])];
      const x = all.find(v => shortLabel(v.label) === n);
      return x ? sightKey(x) : null;
    }, name);
  let entered = 0,
    missing = [];
  for (const [i, p] of F.plan.entries()) {
    const shown = await page.evaluate(i => nameText(state.stages[i].to) || state.stages[i].to.label, i);
    if (shown !== p.name) (await edit(`c|${i}|name`, p.name)) ? entered++ : missing.push(`${p.name}: Name`);
    const town = await page.evaluate(i => stayTown(i), i);
    if (p.ort && town !== p.ort) (await edit(`c|${i}|ort`, p.ort)) ? entered++ : missing.push(`${p.name}: Ort`);
    for (const f of ['addr', 'phone', 'hours', 'arr', 'ppn', 'total', 'paid', 'nr', 'pitch', 'note'])
      if (p[f]) (await edit(`c|${i}|${f}`, p[f])) ? entered++ : missing.push(`${p.name}: ${f}`);
    if (p.status) (await status(`c|${i}|status`, p.status)) ? entered++ : missing.push(`${p.name}: Status`);
    for (const s of p.sights || []) {
      const k = await sightUid(s.name);
      if (!k) {
        missing.push(`${p.name}: Sehenswürdigkeit ${s.name} fehlt`);
        continue;
      }
      if (!(await page.$(`#tripView tbody[data-grpb="${i}"] tr.sight[data-row="s${k}"]`))) missing.push(`${s.name}: nicht unter ${p.name}`);
      if (s.addr) (await edit(`s|${k}|addr`, s.addr)) ? entered++ : missing.push(`${s.name}: Adresse`);
      if (s.hours) (await edit(`s|${k}|hours`, s.hours)) ? entered++ : missing.push(`${s.name}: Öffnungszeiten`);
      if (s.day) {
        const d = `#tripView input.dayin[data-sel="s|${k}|day"]`;
        if (await page.$(d)) {
          await page.fill(d, s.day);
          await page.dispatchEvent(d, 'change');
          entered++;
        } else missing.push(`${s.name}: Besuchstag`);
      }
    }
  }
  // Fähren
  for (const [k, f] of F.ferries.entries()) {
    const j = ferryStages[k];
    for (const x of ['name', 'dep', 'arr', 'dur', 'note']) if (f[x]) (await edit(`f|${j}|${x}`, f[x])) ? entered++ : missing.push(`${f.name}: ${x}`);
    (await status(`f|${j}|status`, 'paid')) ? entered++ : missing.push(`${f.name}: Status`);
  }
  ok(!missing.length, `${entered} Angaben der PDF eingetragen` + (missing.length ? ' – fehlgeschlagen: ' + missing.join('; ') : ''));
  await page.waitForTimeout(1500); // Autospeichern

  /* ---------- 3. Neu laden und prüfen: steht alles so in der Tabelle wie in der PDF? ---------- */
  await page.reload();
  await page.evaluate(() => loadTour(loadTours()[0].id));
  await page.waitForFunction(() => uiTab === 'trip' && !!document.querySelector('#tripView .ptab'));
  await page.click('[data-tlall="1"]');
  await page.waitForTimeout(400);
  const grpText = i => page.evaluate(i => (document.querySelector(`#tripView tbody[data-grpb="${i}"]`)?.innerText || '').replace(/\s+/g, ' '), i);
  const money = t =>
    t.includes('SEK') ? Number(t.replace(/\D/g, '')).toLocaleString('de-DE') + ' SEK' : t.replace(/\s*€/, ' €').replace(/^(\d+) €$/, (m, a) => `${a} €`);
  let bad = [];
  for (const [i, p] of F.plan.entries()) {
    const g = await grpText(i);
    const want = [p.name, p.addr, p.phone, p.hours, p.arr, p.nr, p.pitch, p.note, p.ppn && money(p.ppn), p.total && money(p.total), p.paid].filter(Boolean);
    const miss = want.filter(w => !g.includes(w));
    if (p.status) {
      const sel = await page.evaluate(i => document.querySelector(`#tripView select[data-sel="c|${i}|status"]`)?.value, i);
      if (sel !== p.status) miss.push('Status ' + p.status);
    }
    for (const s of p.sights || []) for (const w of [s.name, s.addr, s.hours].filter(Boolean)) if (!g.includes(w)) miss.push(w);
    if (miss.length) bad.push(`${p.von} ${p.name}: ${miss.join(', ')}`);
  }
  ok(
    !bad.length,
    'nach dem Neuladen steht jede Unterkunft mit Adresse, Telefon, Zeiten, Preis, Status, Buchung, Notiz und Sehenswürdigkeiten in der Tabelle' +
      (bad.length ? ': ' + bad.join(' | ') : '')
  );
  const days = await page.evaluate(() => [...document.querySelectorAll('#tripView input.dayin[data-sel^="s|"]')].map(x => x.value).filter(Boolean));
  ok(days.length === 5, 'Besuchstage (Vasa 4.8., Eksjö 7./8.8., Elchpark 11.8., IKEA 12.8.): ' + days.join(', '));
  const fz = await page.evaluate(() => [...document.querySelectorAll('#tripView tr.ferry')].map(r => r.innerText.replace(/\s+/g, ' ')));
  ok(
    fz.length === 2 && /Travemünde – Malmö/.test(fz[0]) && /Check-in ab 09:00/.test(fz[0]) && /19:15/.test(fz[1]),
    'Fähren mit Abfahrt/Ankunft: ' + fz.map(x => x.slice(0, 70)).join(' | ')
  );
  // Reihenfolge der Sehenswürdigkeiten: mit Besuchstag zuerst
  const bred = await page.evaluate(() => [...document.querySelectorAll('#tripView tbody[data-grpb="5"] tr.sight .pname')].map(x => x.innerText.trim()));
  ok(/Vasa/.test(bred[0] || ''), 'Stockholm: Vasa-Museum (Di. 04.08.) vor Gamla Stan');
  // Entfernungen Platz → Sehenswürdigkeit (PDF: „~25 km, 25 Min.“)
  const dist = await page.evaluate(() =>
    [...document.querySelectorAll('#tripView tbody[data-grpb="3"] tr.sight td[data-l="Entfernung vom Platz"]')].map(x => x.innerText.replace(/\s+/g, ' '))
  );
  ok(dist.length === 6 && dist.every(x => /km/.test(x) && /min/.test(x)), 'Hultsfred: Entfernung + Fahrzeit zu allen 6 Sehenswürdigkeiten');
  // Weiterfahrt (PDF letzte Spalte)
  const wt = await page.evaluate(() =>
    document.querySelector('#tripView tbody[data-grpb="3"] tr.camp td[data-l="Weiter / Entfernung"]').innerText.replace(/\s+/g, ' ')
  );
  ok(/km/.test(wt) && /h|min/.test(wt), 'Weiterfahrt mit km und Fahrzeit: ' + wt);
  // Navigation (PDF: Maps-Link)
  ok(
    await page.evaluate(() => /google\.com\/maps\/dir/.test(document.querySelector('#tripView tbody[data-grpb="3"] tr.camp td[data-l="Adresse"] a').href)),
    'Adresse = Google-Maps-Navigation'
  );
  // offene Punkte: vor Ort zahlen (Bredäng, Sjötorpet), Vellinge gebucht
  const ol = (await page.textContent('#openList')).replace(/\s+/g, ' ');
  ok(/vor Ort zahlen: Bredäng/i.test(ol) && /vor Ort zahlen: Sjötorpet/i.test(ol), 'Offene Punkte: Bredäng und Sjötorpet vor Ort zahlen');
  await page.setViewportSize({ width: 1400, height: 6500 });
  await page.evaluate(() => {
    $('#resizer') && document.documentElement.style.setProperty('--mh', '260px');
    map.invalidateSize();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'schweden-tabelle.png') });
  await page.setViewportSize({ width: 1400, height: 950 });

  /* ---------- 4. Was die PDF zeigt, die App aber (noch) nicht so ---------- */
  // früher Lücken, jetzt Pflicht: Ort unter dem Datum, „nach <Ort>“, Fährdauer, keine alten Suchhinweise
  const orte = await page.evaluate(
    n => [...Array(n).keys()].map(i => document.querySelector(`#tripView tbody[data-grpb="${i}"] tr.camp td[data-l="Datum"]`)?.innerText || ''),
    F.plan.length
  );
  const ortBad = F.plan.filter((p, i) => !orte[i].includes(p.ort)).map(p => p.ort);
  ok(
    !ortBad.length,
    'Spalte Datum mit Ort wie in der PDF (Travemünde, Malmö / Vellinge, Karlshamn …)' + (ortBad.length ? ' – fehlt: ' + ortBad.join(', ') : '')
  );
  ok(/nach Söderköping/.test(wt), 'Weiterfahrt nennt den Ort: ' + wt);
  ok(
    await page.evaluate(() =>
      [...document.querySelectorAll('#tripView tr.ferry')].every(r => /Überfahrt ca\. 9 Std\./.test(r.querySelector('td[data-l="Überfahrt"]')?.innerText || ''))
    ),
    'Fähre: Dauer der Überfahrt „ca. 9 Std.“'
  );
  const tab = (await page.textContent('#tripView .ptab')).replace(/\s+/g, ' ');
  ok(!/Keine Campingplätze gefunden|Zoom auf der Karte rein/.test(tab), 'Reiseplan ohne alte Suchhinweise aus der Planung');
  // Drucken/PDF: dieselbe Tabelle (7 Spalten, alles aufgeklappt) + Offene Punkte
  await page.evaluate(() => printTour());
  await page.waitForFunction(() => window.__printed > 0, null, { timeout: 15000 });
  const pr = (await page.evaluate(() => $('#print').innerText)).replace(/\s+/g, ' ');
  const prCols = await page.evaluate(() => [...document.querySelectorAll('#print .ptab thead th')].map(t => t.textContent.trim()).join(' | '));
  ok(
    prCols === 'Datum | Name | Adresse | Zeiten | Preis / Status | Notiz / Buchung | Weiter / Entfernung' &&
      /ZMAC58/.test(pr) &&
      /326,61/.test(pr) &&
      /Vasa-Museum/.test(pr) &&
      /Fähre Travemünde – Malmö/.test(pr) &&
      /Offene Punkte/.test(pr) &&
      /Reisende: 2 Erw\. \+ 2 Kinder/.test(pr) &&
      !(await page.$('#print input, #print select, #print button')),
    'Drucken/PDF: Kopf, 7 Spalten wie online, alle Angaben, Offene Punkte, keine Eingabefelder'
  );
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: path.join(OUT, 'schweden.pdf'), preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  // Word (.docx)
  const dlP = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#tripView [data-act="docx"]');
  const dl = await dlP;
  const docxPath = path.join(OUT, 'schweden.docx');
  await dl.saveAs(docxPath);
  const W = require('./lib/docx')(docxPath);
  const cols = (W.xml.match(/<w:gridCol /g) || []).length;
  ok(/w:orient="landscape"/.test(W.xml) && cols === 7 && /Weiter \/ Entfernung/.test(W.text), `Word: Querformat, Tabelle mit ${cols} Spalten wie online`);
  const wBad = [
    'ZMAC58',
    '16924901',
    '326,61',
    '1.170 SEK',
    'Vasa-Museum',
    'Hof Näs',
    'Fähre Travemünde – Malmö',
    'Überfahrt ca. 9 Std.',
    'Robert (Roban)',
    'Offene Punkte',
    'vor Ort zahlen'
  ].filter(w => !W.text.includes(w));
  ok(!wBad.length, 'Word: alle Angaben der PDF enthalten' + (wBad.length ? ' – fehlt: ' + wBad.join(', ') : ''));
  ok(/google\.com\/maps\/dir/.test(W.rels) && W.files.some(f => /word\/media\/.+\.png$/.test(f)), 'Word: Navigation als Link, Übersichtskarte als Bild');
  // fertige Tour als Datei (z. B. als Beispiel-Tour für den Online-Speicher, siehe CLAUDE.md)
  const tourJson = await page.evaluate(() => JSON.stringify(tourFile(loadTours().find(t => t.name === 'Schweden Rundreise 2026')), null, 1));
  fs.writeFileSync(path.join(OUT, 'schweden.etappen.json'), tourJson);
  ok(JSON.parse(tourJson).tour.stages.length === 12, 'Tour-Datei tests/out/schweden.etappen.json geschrieben');
  console.log('INFO  Duschcode/WLAN aus der PDF: bewusst nicht vorgesehen (Sebastian: nicht speichern)');

  console.log(
    `\nNachbau Schweden-PDF (${Math.round((Date.now() - t0) / 1000)} s): ${passed + okCaps.length} Prüfungen erfüllt, ${gaps.length} Lücken, ${failures} Fehler.`
  );
  if (gaps.length) console.log('Lücken:\n' + gaps.map(g => '  – ' + g).join('\n'));
  await browser.close();
  srv.close();
  console.log(failures ? `${failures} FEHLER` : 'ALLE TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
