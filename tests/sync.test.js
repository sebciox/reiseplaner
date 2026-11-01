const { chromium } = require('playwright');
const fs = require('fs'),
  path = require('path'),
  http = require('http'),
  crypto = require('crypto');
const ROOT = path.join(__dirname, '..'),
  OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let F = 0;
const ok = (c, m) => {
  console.log((c ? 'OK   ' : 'FAIL ') + m);
  if (!c) F++;
};
const srv = require('./lib/server')(ROOT, 8127);
// --- nachgebautes privates Repo ---
const REPO = 'sebciox/touren',
  TOKEN = 'github_pat_good';
const files = new Map();
let ghDown = false,
  commits = [];
const sha = c =>
  crypto
    .createHash('sha1')
    .update(c + Math.random())
    .digest('hex');
async function ghMock(r) {
  if (ghDown) return r.abort('internetdisconnected');
  const rq = r.request(),
    u = new URL(rq.url()),
    auth = rq.headers()['authorization'];
  const json = (st, b) => r.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  if (auth !== 'Bearer ' + TOKEN) return json(401, { message: 'Bad credentials' });
  const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(?:\/contents\/(.*))?$/);
  if (!m || m[1] !== REPO) return json(404, { message: 'Not Found' });
  const p = m[2];
  if (p === undefined) return json(200, { full_name: REPO, private: true });
  const meth = rq.method();
  if (meth === 'GET') {
    if (files.has(p))
      return json(200, {
        name: p.split('/').pop(),
        path: p,
        sha: files.get(p).sha,
        encoding: 'base64',
        content: files
          .get(p)
          .content.match(/.{1,60}/g)
          .join('\n')
      });
    const list = [...files.entries()]
      .filter(([k]) => k.startsWith(p + '/'))
      .map(([k, v]) => ({ name: k.slice(p.length + 1), path: k, sha: v.sha, type: 'file' }));
    return list.length ? json(200, list) : json(404, { message: 'Not Found' });
  }
  const b = JSON.parse(rq.postData() || '{}');
  if (meth === 'PUT') {
    if (files.has(p) && b.sha !== files.get(p).sha) return json(b.sha ? 409 : 422, { message: b.sha ? 'sha does not match' : '"sha" wasn\'t supplied.' });
    const s = sha(b.content);
    files.set(p, { sha: s, content: b.content });
    commits.push(b.message);
    return json(files.has(p) ? 200 : 201, { content: { sha: s, path: p } });
  }
  if (meth === 'DELETE') {
    if (!files.has(p)) return json(404, { message: 'Not Found' });
    if (b.sha !== files.get(p).sha) return json(409, { message: 'sha does not match' });
    files.delete(p);
    commits.push(b.message);
    return json(200, {});
  }
}
const readRepo = p => (files.has(p) ? JSON.parse(Buffer.from(files.get(p).content, 'base64').toString('utf8')) : null);
(async () => {
  const b = await chromium.launch();
  async function device(name, w) {
    const ctx = await b.newContext({ serviceWorkers: 'block', acceptDownloads: true, viewport: { width: w, height: 800 } });
    await ctx.addInitScript(() => {
      window.__allTabs = true;
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => {
      console.log(name, 'PAGEERROR', e.message);
      F++;
    });
    p.on('dialog', d => d.accept());
    await p.route('**/*', r => {
      const u = r.request().url();
      if (u.includes('leaflet'))
        return r.fulfill({ body: fs.readFileSync(path.join(ROOT, 'node_modules/leaflet/dist', u.endsWith('.css') ? 'leaflet.css' : 'leaflet.js')) });
      if (u.includes('tile.')) return r.fulfill({ status: 204, body: '' });
      if (u.includes('api.github.com')) return ghMock(r);
      if (u.includes('overpass')) return r.fulfill({ json: { elements: [] } });
      return r.continue();
    });
    await p.goto('http://localhost:8127/');
    await p.waitForTimeout(300);
    return p;
  }
  const settingsSave = async (p, fill) => {
    await p.click('#settingsBtn:visible, #settingsBtnM:visible');
    for (const [k, v] of Object.entries(fill)) await p.fill(k, v);
    await p.click('#settingsForm button[value=save]');
  };
  const idle = p => p.waitForFunction(() => !document.querySelector('#status .spin'), null, { timeout: 10000 });
  const status = p => p.textContent('#status');

  // Laptop: Einstellungen + Token
  const A = await device('Laptop', 1280);
  ok((await A.inputValue('#sRepo').catch(() => null)) !== undefined, 'Laptop geladen');
  await settingsSave(A, { '#sKey': 'eyJ_laptop_key', '#sSpeed': '90', '#sToken': TOKEN });
  await idle(A);
  await A.waitForTimeout(200);
  let st = readRepo('einstellungen.json');
  ok(
    st && st.settings.key === 'eyJ_laptop_key' && st.settings.speed === 90 && !JSON.stringify(st).includes('github_pat'),
    'Laptop: Einstellungen online gesichert (ohne Token): ' + (await status(A)).trim()
  );
  // Tour importieren → online
  await A.click('#toursBtn:visible, #toursBtnM:visible');
  await A.setInputFiles('#importIn', path.join(__dirname, 'fixtures', 'tour.etappen.json'));
  await A.waitForTimeout(3000);
  await idle(A);
  const tourId = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tour.etappen.json'))).tour.id;
  ok(!!readRepo(`touren/${tourId}.json`), `Laptop: importierte Tour online (touren/${tourId}.json)`);

  // Handy: nur Token eintragen
  const B = await device('Handy', 390);
  ok((await status(B)).includes('Willkommen'), 'Handy anfangs ohne Schlüssel');
  await settingsSave(B, { '#sToken': TOKEN });
  await idle(B);
  await B.waitForTimeout(200);
  const sb = await B.evaluate(() => ({ key: settings.key, speed: settings.speed, tours: loadTours().length }));
  ok(sb.key === 'eyJ_laptop_key' && sb.speed === 90 && sb.tours === 1, `Handy: ORS-Schlüssel, 90 km/h und 1 Tour übernommen (${(await status(B)).trim()})`);
  // Handy: Tour laden, speichern unter neuem Namen
  await B.click('#toursBtn:visible, #toursBtnM:visible');
  await B.waitForTimeout(500);
  ok((await B.textContent('#syncInfo')).includes('abgeglichen'), 'Touren-Dialog zeigt: ' + (await B.textContent('#syncInfo')).trim());
  B.removeAllListeners('dialog');
  B.on('dialog', d => (d.type() === 'prompt' ? d.accept('Spanien 2027') : d.accept()));
  await B.click('[data-ren]');
  await B.waitForTimeout(800);
  await idle(B);
  await B.click('[data-load]');
  await B.waitForTimeout(800);
  ok(readRepo(`touren/${tourId}.json`).tour.name === 'Spanien 2027', 'Handy: umbenannte Tour online gespeichert');
  // Laptop: Touren öffnen → aktualisiert
  await A.click('#toursBtn:visible, #toursBtnM:visible');
  await A.waitForTimeout(1200);
  ok((await A.textContent('#toursList')).includes('Spanien 2027'), 'Laptop: sieht neuen Namen');
  await A.click('#toursClose');
  // Handy: Einstellung ändern → Laptop übernimmt nach Neuladen
  await settingsSave(B, { '#sSpeed': '100' });
  await idle(B);
  await B.waitForTimeout(200);
  await A.reload();
  await A.waitForTimeout(1500);
  ok((await A.evaluate(() => settings.speed)) === 100, 'Laptop: nach Neuladen 100 km/h vom Handy übernommen');
  // Laptop offline: Tour löschen → später nachgeholt
  ghDown = true;
  await A.click('#toursBtn:visible, #toursBtnM:visible');
  await A.waitForTimeout(500);
  await A.click('[data-del]');
  await A.waitForTimeout(800);
  ok((await status(A)).includes('nicht erreichbar'), 'offline: Hinweis „' + (await status(A)).trim() + '“');
  ok(!!readRepo(`touren/${tourId}.json`), 'offline: online noch vorhanden');
  ghDown = false;
  await A.click('#syncBtn');
  await A.waitForTimeout(1200);
  ok(!readRepo(`touren/${tourId}.json`), 'wieder online: Löschung nachgeholt');
  // Handy: Tour verschwindet
  await B.click('#toursBtn:visible, #toursBtnM:visible');
  await B.waitForTimeout(1200);
  ok((await B.evaluate(() => loadTours().length)) === 0, 'Handy: gelöschte Tour verschwindet');
  await B.click('#toursClose');
  // Falscher Token
  const C = await device('Fremd', 1280);
  await settingsSave(C, { '#sToken': 'github_pat_falsch' });
  await C.waitForTimeout(800);
  ok((await status(C)).includes('Token ungültig'), 'falscher Token: ' + (await status(C)).trim());
  await settingsSave(C, { '#sToken': TOKEN, '#sRepo': 'sebciox/gibtsnicht' });
  await C.waitForTimeout(800);
  ok((await status(C)).includes('Kein Zugriff'), 'falsches Repo: ' + (await status(C)).trim());
  // Handy-Layout Einstellungen passen weiterhin
  await B.click('#settingsBtn:visible, #settingsBtnM:visible');
  await B.screenshot({ path: path.join(OUT, 'sync-settings.png') });
  console.log('     Commits:', commits.join(' | '));
  await b.close();
  srv.close();
  console.log(F ? F + ' FEHLER' : 'ALLE OK');
  process.exit(F ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
