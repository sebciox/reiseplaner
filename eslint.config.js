// ESLint: findet typische Fehler (z. B. vertippte Namen, doppelte Schlüssel, unerreichbarer Code).
// Die App-Dateien in js/ sind klassische Skripte mit gemeinsamem globalem Gültigkeitsbereich – deshalb werden alle
// Namen, die eine Datei auf oberster Ebene anlegt, für alle Dateien als bekannte globale Namen eingetragen.
const js = require('@eslint/js'),
  globals = require('globals'),
  fs = require('fs'),
  path = require('path');

const appGlobals = {};
for (const f of fs.readdirSync(path.join(__dirname, 'js')).filter(f => f.endsWith('.js'))) {
  const lines = fs.readFileSync(path.join(__dirname, 'js', f), 'utf8').split('\n');
  let inDecl = false;
  for (const line of lines) {
    let m;
    if ((m = line.match(/^(?:async\s+)?function\s*\*?\s*([\w$]+)/))) appGlobals[m[1]] = 'writable';
    if ((m = line.match(/^(?:const|let|var)\s+([\w$]+)/))) {
      appGlobals[m[1]] = 'writable';
      inDecl = true;
    }
    // weitere Namen derselben Deklaration: „, b = …“ in der Zeile oder „  b = …“ (eingerückt) in Folgezeilen
    if (inDecl) {
      for (const n of line.matchAll(/,\s*([\w$]+)\s*=(?!=)/g)) appGlobals[n[1]] = 'writable';
      if ((m = line.match(/^ {2}([\w$]+)\s*=(?!=)/))) appGlobals[m[1]] = 'writable';
      if (/;\s*(\/\/.*)?$/.test(line) && !/^\s{4,}/.test(line)) inDecl = false;
    }
    for (const n of line.matchAll(/window\.([\w$]+)\s*=(?!=)/g)) appGlobals[n[1]] = 'writable'; // window.x = … ist ebenfalls global
  }
}

module.exports = [
  { ignores: ['node_modules/', 'tests/out/'] },
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, L: 'readonly', XLSX: 'readonly', ...appGlobals } },
    rules: {
      'no-redeclare': ['error', { builtinGlobals: false }],
      'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
      'no-misleading-character-class': 'off'
    }
  },
  { files: ['sw.js'], languageOptions: { sourceType: 'script', globals: globals.serviceworker } },
  {
    // Tests: Node (CommonJS); Code in page.evaluate läuft im Browser und nutzt die globalen Namen der App
    files: ['tests/**/*.js', 'tools/**/*.js', 'eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-async-promise-executor': 'off',
      'no-useless-assignment': 'off'
    }
  }
];
