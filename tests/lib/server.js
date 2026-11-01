// Kleiner statischer Webserver für die Tests (liefert die App aus dem Repo-Verzeichnis, mit passenden Inhaltstypen)
const http = require('http'),
  fs = require('fs'),
  path = require('path');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json'
};
module.exports = (root, port) =>
  http
    .createServer((q, s) => {
      const rel = decodeURIComponent(q.url.split('?')[0]);
      const f = path.join(root, rel === '/' ? 'index.html' : rel);
      if (!f.startsWith(root)) {
        s.writeHead(403);
        s.end();
        return;
      }
      fs.readFile(f, (e, d) => {
        if (e) {
          s.writeHead(404);
          s.end();
          return;
        }
        s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
        s.end(d);
      });
    })
    .listen(port);
