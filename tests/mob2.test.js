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
const srv = require('./lib/server')(ROOT, 8126);
(async () => {
  const b = await chromium.launch();
  for (const [name, vp] of [
    ['360x560', { width: 360, height: 560 }],
    ['390x740', { width: 390, height: 740 }],
    ['laptop', { width: 1280, height: 800 }]
  ]) {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: name !== 'laptop', hasTouch: true, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => {
      window.__allTabs = true;
    });
    const p = await ctx.newPage();
    await p.route('**/*', r => {
      const u = r.request().url();
      if (u.includes('leaflet'))
        return r.fulfill({ body: fs.readFileSync(path.join(ROOT, 'node_modules/leaflet/dist', u.endsWith('.css') ? 'leaflet.css' : 'leaflet.js')) });
      if (u.includes('tile.')) return r.fulfill({ status: 204, body: '' });
      return r.continue();
    });
    await p.goto('http://localhost:8126/');
    await p.waitForTimeout(300);
    const open = async () => {
      await p.tap('#settingsBtn:visible, #settingsBtnM:visible');
      await p.waitForTimeout(200);
    };
    const isOpen = () => p.evaluate(() => document.querySelector('#settingsDlg').open);
    await open();
    const g = await p.evaluate(() => {
      const d = document.querySelector('#settingsDlg').getBoundingClientRect(),
        s = document.querySelector('#settingsForm button[value=save]').getBoundingClientRect(),
        x = document.querySelector('.dlg-x').getBoundingClientRect();
      return { d: [d.top, d.bottom], s: s.bottom, x: x.top, vh: innerHeight };
    });
    ok(g.d[0] >= 0 && g.d[1] <= g.vh && g.s <= g.vh && g.x >= 0, `${name}: Dialog passt, Speichern + ✕ sichtbar ohne Scrollen ${JSON.stringify(g)}`);
    await p.screenshot({ path: path.join(OUT, `mob2-${name}.png`) });
    await p.tap('.dlg-x');
    await p.waitForTimeout(150);
    ok(!(await isOpen()), `${name}: ✕ schließt`);
    await open();
    await p.mouse.click(5, 5);
    await p.waitForTimeout(150);
    ok(!(await isOpen()), `${name}: Tippen daneben schließt`);
    await open();
    await p.fill('#sKey', 'eyJx');
    await p.fill('#sSpeed', '82');
    await p.fill('#sMin', '333');
    await p.tap('#settingsForm button[value=save]');
    await p.waitForTimeout(150);
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('gp.settings')));
    ok(!(await isOpen()) && st.speed === 82 && st.cmin === 333, `${name}: Speichern mit „krummen“ Werten (82 km/h, 333 km) klappt`);
    await open();
    await p.fill('#sSpeed', '100');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    ok(!(await isOpen()) && (await p.evaluate(() => JSON.parse(localStorage.getItem('gp.settings')).speed)) === 82, `${name}: Esc schließt ohne zu speichern`);
    await ctx.close();
  }
  await b.close();
  srv.close();
  console.log(F ? F + ' FEHLER' : 'ALLE OK');
})();
