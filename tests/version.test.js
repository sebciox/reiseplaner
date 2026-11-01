// Prüft ohne Browser: Versionsnummern und Dateiliste von index.html und Service Worker passen zusammen.
const fs = require('fs'),
  path = require('path');
const root = path.join(__dirname, '..');
const ix = fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
  sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
let F = 0;
const ok = (c, m) => {
  console.log((c ? 'OK   ' : 'FAIL ') + m);
  if (!c) F++;
};
const cache = +sw.match(/gespann-etappen-v(\d+)/)[1];
const refs = [...ix.matchAll(/(?:src|href)="((?:js\/[\w-]+\.js|styles\.css)\?v=(\d+))"/g)];
ok(refs.length >= 2, `index.html bindet styles.css und js/*.js ein (${refs.length})`);
ok(
  refs.every(m => +m[2] === cache),
  `?v= in index.html = Cache-Version ${cache}`
);
ok(
  refs.every(m => sw.includes(`'${m[1]}'`)),
  'Service Worker hält alle App-Dateien offline vor'
);
const jsFiles = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'));
ok(
  jsFiles.every(f => ix.includes(`js/${f}?v=`)),
  'jede Datei in js/ ist in index.html eingebunden'
);
ok(!/<script>(?!\s*<\/script>)/.test(ix), 'kein Inline-Skript mehr in index.html');
console.log(F ? F + ' FEHLER' : 'ALLE OK');
process.exit(F ? 1 : 0);
