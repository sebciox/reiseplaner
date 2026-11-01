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
const srv = require('./lib/server')(ROOT, 8133);
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
  async function device(name, w, url) {
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
    await p.goto(url || 'http://localhost:8133/');
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
  // Laptop: verbunden, mit ORS- und Google-Schlüssel
  const A = await device('Laptop', 1280);
  await settingsSave(A, { '#sKey': 'eyJ_laptop_key', '#sGkey': 'AIza_test', '#sToken': TOKEN });
  await idle(A);
  await A.waitForTimeout(300);
  ok(readRepo('einstellungen.json')?.settings?.gkey === 'AIza_test', 'Laptop: Schlüssel online gesichert');
  await A.click('#settingsBtn:visible, #settingsBtnM:visible');
  ok(await A.isVisible('#setupLinkBtn'), 'Knopf „Link für anderen Browser kopieren“ sichtbar (verbunden)');
  await A.evaluate(() => {
    window.__copied = null;
    navigator.clipboard.writeText = t => {
      window.__copied = t;
      return Promise.resolve();
    };
  });
  await A.click('#setupLinkBtn');
  await A.waitForTimeout(200);
  const link = await A.evaluate(() => window.__copied);
  ok(
    link && link.startsWith('http://localhost:8133/#einrichten=') && !link.includes(TOKEN),
    'Link erzeugt (Token kodiert, nicht im Klartext): ' + (link || '').slice(0, 60) + '…'
  );
  await A.keyboard.press('Escape');
  // Firefox-Ersatz: frischer Browser ohne Einstellungen öffnet den Link
  const B = await device('Firefox', 1280, link);
  await B.waitForFunction(() => settings.key === 'eyJ_laptop_key' && settings.gkey === 'AIza_test', null, { timeout: 10000 }).catch(() => {});
  const sb = await B.evaluate(() => ({ key: settings.key, gkey: settings.gkey, repo: settings.ghRepo, tok: !!settings.ghToken, hash: location.hash }));
  ok(
    sb.key === 'eyJ_laptop_key' && sb.gkey === 'AIza_test' && sb.repo === REPO && sb.tok,
    'neuer Browser: Schlüssel + Einstellungen übernommen ' + JSON.stringify({ ...sb, tok: sb.tok })
  );
  ok(sb.hash === '', 'Token sofort aus der Adresszeile entfernt');
  await idle(B).catch(() => {});
  ok(
    /eingerichtet/.test((await B.textContent('#toast').catch(() => '')) + (await status(B))),
    'Hinweis „Online-Speicher eingerichtet“: ' + (await B.textContent('#toast').catch(() => '')).trim()
  );
  // kaputter Link
  const C = await device('Kaputt', 1280, 'http://localhost:8133/#einrichten=abc');
  await C.waitForTimeout(300);
  ok(await C.evaluate(() => !settings.ghToken && location.hash === ''), 'ungültiger Link: nichts übernommen, Adresszeile bereinigt');
  // nicht verbunden: kein Knopf
  await C.click('#settingsBtn:visible, #settingsBtnM:visible');
  ok(!(await C.isVisible('#setupLinkBtn')), 'ohne Online-Speicher kein Link-Knopf');
  await b.close();
  srv.close();
  console.log(F ? F + ' FEHLER' : 'ALLE OK');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
