// Führt alle Tests nacheinander aus (jeder Test startet eigenen Browser und Webserver) und meldet das Gesamtergebnis.
// Aufruf: node tests/run-all.js [Dateianfang …]   z. B. node tests/run-all.js sights tabs
// Schlägt eine Datei fehl, wird sie einmal wiederholt: besteht sie dann, gilt sie als bestanden, wird aber als
// „wacklig“ gemeldet (Hinweis auf einen Wettlauf im Test, der behoben werden sollte).
const { spawnSync } = require('child_process'),
  fs = require('fs'),
  path = require('path');
const only = process.argv.slice(2);
const files = fs
  .readdirSync(__dirname)
  .filter(f => f.endsWith('.test.js'))
  .filter(f => !only.length || only.some(o => f.startsWith(o)))
  .sort();

const runOnce = f => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 6 * 60 * 1000 });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || ''), s: Math.round((Date.now() - t0) / 1000) };
};
// Meldung + Zeile im Test (Stack), damit Fehler auf GitHub ohne Nachstellen zu finden sind
const details = out =>
  out
    .split('\n')
    .filter(l => /FAIL|Error|PAGEERROR|Timeout|FEHLER|\.test\.js:\d+/.test(l))
    .slice(0, 20)
    .map(l => '    ' + l.trim())
    .join('\n') || out.slice(-2000);

const failed = [],
  flaky = [];
for (const f of files) {
  let r = runOnce(f);
  if (r.ok) {
    console.log(`✓ ${f} (${r.s} s)`);
    continue;
  }
  console.log(`… ${f} fehlgeschlagen (${r.s} s), zweiter Versuch:\n${details(r.out)}`);
  r = runOnce(f);
  if (r.ok) {
    flaky.push(f);
    console.log(`✓ ${f} (${r.s} s) – erst im zweiten Versuch, wacklig`);
  } else {
    failed.push(f);
    console.log(`✗ ${f} (${r.s} s)\n${details(r.out)}`);
  }
}
if (flaky.length) console.log(`\nWacklig (nur im zweiten Versuch bestanden): ${flaky.join(', ')}`);
console.log(
  failed.length ? `\n${failed.length} von ${files.length} Testdateien fehlgeschlagen: ${failed.join(', ')}` : `\nAlle ${files.length} Testdateien OK`
);
process.exit(failed.length ? 1 : 0);
