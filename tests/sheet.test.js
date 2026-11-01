const { chromium } = require('playwright');
const fs = require('fs'),
  path = require('path'),
  http = require('http');
const ROOT = path.join(__dirname, '..'),
  OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let F = 0;
const ok = (c, m) => {
  console.log((c ? 'OK   ' : 'FAIL ') + m);
  if (!c) F++;
};
const srv = require('./lib/server')(ROOT, 8128);
(async () => {
  const b = await chromium.launch();
  for (const [w, h, zoom] of [
    [390, 740, 1],
    [320, 640, 1],
    [390, 740, 1.25]
  ]) {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: 'dark' });
    await ctx.addInitScript(() => {
      window.__allTabs = true;
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => {
      console.log('PAGEERROR', e.message);
      F++;
    });
    await p.route('**/*', r => {
      const u = r.request().url();
      if (u.includes('leaflet'))
        return r.fulfill({ body: fs.readFileSync(path.join(ROOT, 'node_modules/leaflet/dist', u.endsWith('.css') ? 'leaflet.css' : 'leaflet.js')) });
      if (u.includes('tile.')) return r.fulfill({ status: 204, body: '' });
      return r.continue();
    });
    await p.goto('http://localhost:8128/');
    if (zoom !== 1) await p.addStyleTag({ content: `html{font-size:${zoom * 15}px} body{font-size:${zoom * 15}px} h1{font-size:${zoom * 17}px!important}` });
    await p.waitForTimeout(400);
    const tag = `${w}x${h}${zoom !== 1 ? ' Schrift x' + zoom : ''}`;
    const hdr = await p.evaluate(() => {
      const t = document.querySelector('.tabrow').getBoundingClientRect(),
        a = document.querySelector('#toursBtnM').getBoundingClientRect(),
        s = document.querySelector('#settingsBtnM').getBoundingClientRect();
      return {
        th: t.height,
        sameRow: Math.abs(a.top - s.top) < 2 && a.width > 0 && a.bottom <= t.bottom + 1,
        top: getComputedStyle(document.querySelector('.top')).display
      };
    });
    ok(hdr.th < 50 && hdr.sameRow && hdr.top === 'none', `${tag}: Kopf am Handy = eine Reiterzeile mit Touren/⚙︎ (${Math.round(hdr.th)} px)`);
    const H = () => p.evaluate(() => document.querySelector('#panel').offsetHeight);
    ok(Math.abs((await H()) - h * 0.42) < 3, `${tag}: Start halb (${await H()} px von ${h})`);
    await p.screenshot({ path: path.join(OUT, `sheet-${w}-${zoom}.png`) });
    const hb = await p.evaluate(() => {
      const r = document.querySelector('#handle').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    // nach unten ziehen → min
    await p.mouse.move(hb.x, hb.y);
    await p.mouse.down();
    for (let i = 1; i <= 10; i++) await p.mouse.move(hb.x, hb.y + i * 14);
    await p.mouse.up();
    await p.waitForTimeout(350);
    ok(await p.evaluate(() => document.querySelector('#panel').classList.contains('min')), `${tag}: nach unten ziehen → klein (${await H()} px)`);
    // Kopfzeile hochziehen → halb/voll
    const t0 = await p.evaluate(() => uiTab);
    const hb2 = await p.evaluate(() => {
      const r = document.querySelector('[data-tabbtn="plan"]').getBoundingClientRect();
      return { x: r.x + 20, y: r.y + r.height / 2 };
    });
    await p.mouse.move(hb2.x, hb2.y);
    await p.mouse.down();
    for (let i = 1; i <= 15; i++) await p.mouse.move(hb2.x, hb2.y - i * 30);
    await p.mouse.up();
    await p.waitForTimeout(350);
    ok(await p.evaluate(() => document.querySelector('#panel').classList.contains('full')), `${tag}: am Reiter weit hochziehen → groß`);
    ok((await p.evaluate(() => uiTab)) === t0, `${tag}: Ziehen am Reiter wechselt den Reiter nicht`);
    // Tippen auf Griff → zyklisch (full → min)
    await p.click('#handle');
    await p.waitForTimeout(350);
    ok(await p.evaluate(() => document.querySelector('#panel').classList.contains('min')), `${tag}: Antippen wechselt weiter`);
    await p.screenshot({ path: path.join(OUT, `sheet-min-${w}-${zoom}.png`) });
    // ganz runter ziehen → ausgeblendet, ☰ holt es zurück
    const hb3 = await p.evaluate(() => {
      const r = document.querySelector('#handle').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await p.mouse.move(hb3.x, hb3.y);
    await p.mouse.down();
    for (let i = 1; i <= 8; i++) await p.mouse.move(hb3.x, hb3.y + i * 12);
    await p.mouse.up();
    await p.waitForTimeout(350);
    ok(await p.evaluate(() => document.querySelector('#panel').classList.contains('hide')), `${tag}: ganz runterziehen → ausgeblendet`);
    await p.screenshot({ path: path.join(OUT, `sheet-hide-${w}-${zoom}.png`) });
    await p.click('#fabMenu');
    await p.waitForTimeout(350);
    ok(await p.evaluate(() => document.querySelector('#panel').classList.contains('min')), `${tag}: ☰ blendet wieder ein (letzte Stufe)`);
    await p.click('#fabMenu');
    await p.waitForTimeout(350);
    ok(await p.evaluate(() => document.querySelector('#panel').classList.contains('hide')), `${tag}: ☰ blendet aus`);
    await p.click('#fabMenu');
    await p.waitForTimeout(350);
    // Buttons in Kopfzeile funktionieren weiter
    await p.click('#settingsBtnM');
    ok(await p.evaluate(() => document.querySelector('#settingsDlg').open), `${tag}: ⚙︎ öffnet trotz Ziehbereich`);
    ok(await p.evaluate(() => L.Popup.prototype.options.autoPanPaddingBottomRight[1] > 100), `${tag}: Popup-Abstand zum Sheet gesetzt`);
    await ctx.close();
  }
  await b.close();
  srv.close();
  console.log(F ? F + ' FEHLER' : 'ALLE OK');
})();
