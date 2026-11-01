// Führt alle Tests nacheinander aus (jeder Test startet eigenen Browser und Webserver) und meldet das Gesamtergebnis.
const { spawnSync } = require('child_process'),
  fs = require('fs'),
  path = require('path');
const only = process.argv.slice(2);
const files = fs
  .readdirSync(__dirname)
  .filter(f => f.endsWith('.test.js'))
  .filter(f => !only.length || only.some(o => f.startsWith(o)))
  .sort();
let failed = [];
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 6 * 60 * 1000 });
  const out = (r.stdout || '') + (r.stderr || ''),
    ok = r.status === 0;
  console.log(`${ok ? '✓' : '✗'} ${f} (${Math.round((Date.now() - t0) / 1000)} s)`);
  if (!ok) {
    failed.push(f);
    console.log(
      out
        .split('\n')
        .filter(l => /FAIL|Error|PAGEERROR|Timeout|FEHLER/.test(l))
        .slice(0, 15)
        .map(l => '    ' + l)
        .join('\n') || out.slice(-2000)
    );
  }
}
console.log(
  failed.length ? `\n${failed.length} von ${files.length} Testdateien fehlgeschlagen: ${failed.join(', ')}` : `\nAlle ${files.length} Testdateien OK`
);
process.exit(failed.length ? 1 : 0);
