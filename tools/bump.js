// Version hochzählen: Cache-Name im Service Worker und ?v=… an styles.css/js-Dateien in index.html (und in sw.js).
// Nach jeder Änderung an App-Dateien ausführen: npm run bump
const fs = require('fs'),
  path = require('path');
const root = path.join(__dirname, '..'),
  swF = path.join(root, 'sw.js'),
  ixF = path.join(root, 'index.html');
let sw = fs.readFileSync(swF, 'utf8'),
  ix = fs.readFileSync(ixF, 'utf8');
const cur = +sw.match(/gespann-etappen-v(\d+)/)[1],
  next = cur + 1;
sw = sw.replace(/gespann-etappen-v\d+/, `gespann-etappen-v${next}`).replace(/\?v=\d+/g, `?v=${next}`);
ix = ix.replace(/\?v=\d+/g, `?v=${next}`);
fs.writeFileSync(swF, sw);
fs.writeFileSync(ixF, ix);
console.log(`Version ${cur} → ${next}`);
