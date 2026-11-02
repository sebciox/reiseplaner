/* Reiseplaner – Ausgabe als PDF (Drucken) und Word (.docx), beide A4 quer, mit **denselben 7 Spalten** wie die Tabelle im
   Reiter 3: Die Tabelle wird im Ausgabemodus (`XP`, siehe tabelle.js) einmal als HTML gebaut – voll aufgeklappt, ohne
   Eingabefelder – und daraus entsteht der Druck (HTML) bzw. Word (Zeile für Zeile, Links bleiben Links).
   Kopf: Titel, Zeitraum, Reisende, Strecke · Übersichtskarte · Tabelle · am Ende „Offene Punkte“ (damit man daran denkt).
   Google-Angaben stehen live mit „lt. Google, Stand …“ darin (Sebastians Wahl, nur privat).
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
const DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@9.11.0/dist/index.iife.js';
function exportTableHtml() {
  XP = true;
  try {
    return planTableHtml();
  } finally {
    XP = false;
  }
}
function exportHead() {
  const ds = stageDates(),
    st = state.stages;
  const end = ds && st.length ? addDays(ds[st.length - 1], st[st.length - 1].to.kind === 'camp' ? nightsOf(st[st.length - 1]) : 0) : null;
  const ad = +settings.adults || 0,
    ki = +settings.kids || 0;
  return {
    title: tourTitle(),
    lines: [
      ds ? `Zeitraum: ${fdate(ds[0])} – ${fdate(end || ds[ds.length - 1])}` : '',
      ad + ki ? `Reisende: ${persons(ad, ki)}` : '',
      `Strecke: ${totalsText()}`,
      `Stand: ${new Date().toLocaleDateString('de-DE')}`
    ].filter(Boolean)
  };
}
// offene Punkte für die Ausgabe (erledigte Aufgaben fallen weg)
function exportOpenItems() {
  const t = tripMoney();
  return [
    ...t.items.map(x => [x.text, x.date, x.eur ? fEurA(x.eur, x.approx) : ''].filter(Boolean).join(' · ')),
    ...t.tasks.filter(e => !e.done && e.text).map(e => `Aufgabe: ${e.text}${e.due ? ' · bis ' + xpDay(e.due) : ''}`)
  ];
}
const exportFoot = () =>
  `Kartendaten © OpenStreetMap-Mitwirkende · Routing openrouteservice.org · Angaben „lt. Google“ live abgefragt · erstellt mit Reiseplaner am ${new Date().toLocaleDateString('de-DE')}. Angaben ohne Gewähr.`;

/* ---------- Übersichtskarte (für Druck und Word) ---------- */
let printMap = null;
async function buildPrintMap(el) {
  if (printMap) {
    printMap.remove();
    printMap = null;
  }
  printMap = L.map(el, { zoomControl: false, attributionControl: false, fadeAnimation: false, zoomAnimation: false, inertia: false });
  const tl = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, crossOrigin: 'anonymous' }).addTo(printMap);
  const pts = [];
  state.stages.forEach((s, i) => {
    L.polyline(s.line, { color: COL.brand, weight: 4 }).addTo(printMap);
    pts.push(...s.line);
    const last = i === state.stages.length - 1;
    L.marker([s.to.lat, s.to.lon], { icon: pinIcon(last ? 'Z' : String(i + 1), last ? 'end' : '') }).addTo(printMap);
  });
  L.marker([state.start.lat, state.start.lon], { icon: pinIcon('S') }).addTo(printMap);
  printMap.fitBounds(L.latLngBounds(pts), { padding: [20, 20] });
  await new Promise(res => {
    tl.once('load', res);
    setTimeout(res, 6000);
  });
  return printMap;
}
// Karte als PNG für Word: Kacheln + Route + Punkte auf eine Leinwand (Kacheln nur, wenn der Server CORS erlaubt)
async function mapPng(w, h) {
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;left:-20000px;top:0;width:${w}px;height:${h}px`;
  document.body.appendChild(box);
  try {
    const m = await buildPrintMap(box);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = '#e8ece6';
    g.fillRect(0, 0, w, h);
    const r0 = box.getBoundingClientRect();
    let tiles = 0;
    box.querySelectorAll('img.leaflet-tile').forEach(img => {
      if (!img.complete || !img.naturalWidth) return;
      const r = img.getBoundingClientRect();
      g.drawImage(img, r.left - r0.left, r.top - r0.top, r.width, r.height);
      tiles++;
    });
    try {
      cv.toDataURL(); // „verunreinigt“ (Kacheln ohne CORS)? → ohne Kacheln neu zeichnen
    } catch (e) {
      g.fillStyle = '#e8ece6';
      g.fillRect(0, 0, w, h);
      tiles = 0;
    }
    g.lineWidth = 4;
    g.strokeStyle = COL.brand;
    g.lineJoin = g.lineCap = 'round';
    state.stages.forEach(s => {
      g.beginPath();
      s.line.forEach((p, k) => {
        const q = m.latLngToContainerPoint(p);
        k ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y);
      });
      g.stroke();
    });
    const dot = (p, label, col) => {
      const q = m.latLngToContainerPoint([p.lat, p.lon]);
      g.fillStyle = col;
      g.beginPath();
      g.arc(q.x, q.y, 9, 0, 7);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 11px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, q.x, q.y + 0.5);
    };
    dot(state.start, 'S', '#6a9a74');
    state.stages.forEach((s, i) => dot(s.to, i === state.stages.length - 1 ? 'Z' : String(i + 1), i === state.stages.length - 1 ? '#b3412e' : '#6a9a74'));
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    return blob ? { data: new Uint8Array(await blob.arrayBuffer()), tiles } : null;
  } catch (e) {
    console.warn(e);
    return null;
  } finally {
    if (printMap) {
      printMap.remove();
      printMap = null;
    }
    box.remove();
  }
}

/* ---------- Drucken / PDF ---------- */
async function printTour() {
  if (!state.stages.length) return;
  setStatus('Druckansicht wird vorbereitet …', 'busy');
  await ensureAddrs();
  const el = $('#print'),
    hd = exportHead(),
    op = exportOpenItems();
  el.innerHTML = `<h1>${esc(hd.title)}</h1><div class="sub">${hd.lines.map(esc).join(' · ')}</div><div class="pmap"></div>
    <div class="ptprint">${exportTableHtml()}</div>
    ${op.length ? `<h2>Offene Punkte</h2><ul class="oplist">${op.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <div class="foot">${esc(exportFoot())}</div>`;
  await buildPrintMap(el.querySelector('.pmap'));
  setStatus('');
  window.print();
}

/* ---------- Word (.docx) ---------- */
let docxP = null;
function loadDocx() {
  if (window.docx) return Promise.resolve(window.docx);
  docxP =
    docxP ||
    new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = DOCX_URL;
      s.onload = () => (window.docx ? res(window.docx) : rej(new Error('Word-Baustein nicht geladen')));
      s.onerror = () => {
        docxP = null;
        rej(new Error('Word-Baustein konnte nicht geladen werden (offline?)'));
      };
      document.head.appendChild(s);
    });
  return docxP;
}
// Zelle (HTML aus dem Ausgabemodus) → Absätze mit Text, Fett, Grau und Links
function docxCell(D, el, size) {
  const paras = [];
  let runs = [];
  const flush = () => {
    while (runs.length && runs[0]._t !== undefined && !runs[0]._t.trim()) runs.shift();
    if (runs.length) paras.push(new D.Paragraph({ children: runs.map(r => r.run), spacing: { after: 20 } }));
    runs = [];
  };
  const txt = (t, f) => {
    t = t.replace(/\s+/g, ' ');
    if (!t || (!t.trim() && !runs.length)) return;
    runs.push({ _t: t, run: new D.TextRun({ text: t, size, bold: f.b, color: f.m ? '6B7570' : undefined }) });
  };
  const walk = (node, f) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) txt(n.textContent, f);
      else if (n.nodeType === 1) {
        const tag = n.tagName,
          block = /^(DIV|P|LI|UL|DETAILS|SUMMARY|FORM)$/.test(tag);
        if (tag === 'BR') {
          flush();
          continue;
        }
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT') continue;
        const f2 = { b: f.b || tag === 'B' || tag === 'STRONG', m: f.m || n.classList.contains('muted') || n.classList.contains('osmname') };
        if (block) flush();
        if (tag === 'A' && n.getAttribute('href')) {
          const t = n.textContent.replace(/\s+/g, ' ').trim();
          if (t)
            runs.push({
              run: new D.ExternalHyperlink({ link: n.href, children: [new D.TextRun({ text: t, size, bold: f2.b, style: 'Hyperlink' })] })
            });
          continue;
        }
        walk(n, f2);
        if (block) flush();
      }
    }
  };
  walk(el, {});
  flush();
  return paras.length ? paras : [new D.Paragraph({ children: [] })];
}
async function exportDocx() {
  if (!state.stages.length) return;
  setStatus('Word-Datei wird erstellt …', 'busy');
  try {
    await ensureAddrs();
    const D = await loadDocx();
    const hd = exportHead(),
      op = exportOpenItems();
    const box = document.createElement('div');
    box.innerHTML = exportTableHtml();
    const tab = box.querySelector('table');
    // A4 quer: 16838 × 11906 Twips, Ränder 1,27 cm → 15398 Twips Breite für die 7 Spalten
    const W = [1450, 2950, 2500, 2250, 2450, 2350, 1448];
    const fill = { camp: 'EEF4EF', pt: 'F4F6F4', ferry: 'FDF6EC', cost: 'FDF6EC' };
    const cellOf = (el, k, shade, head) =>
      new D.TableCell({
        width: { size: W[k], type: D.WidthType.DXA },
        shading: shade ? { type: D.ShadingType.CLEAR, color: 'auto', fill: shade } : undefined,
        margins: { top: 50, bottom: 50, left: 80, right: 80 },
        children: head ? [new D.Paragraph({ children: [new D.TextRun({ text: el.textContent.trim(), bold: true, size: 16 })] })] : docxCell(D, el, 16)
      });
    const rows = [new D.TableRow({ tableHeader: true, children: [...tab.querySelectorAll('thead th')].map((th, k) => cellOf(th, k, '9CBCA2', true)) })];
    tab.querySelectorAll('tbody tr').forEach(tr => {
      const tds = [...tr.children];
      if (tds.length !== 7) return;
      const kind = Object.keys(fill).find(k => tr.classList.contains(k));
      rows.push(new D.TableRow({ cantSplit: true, children: tds.map((t, k) => cellOf(t, k, fill[kind])) }));
    });
    const map = await mapPng(1100, 440);
    const children = [
      new D.Paragraph({ children: [new D.TextRun({ text: hd.title, bold: true, size: 32 })], spacing: { after: 80 } }),
      new D.Paragraph({ children: [new D.TextRun({ text: hd.lines.join(' · '), size: 18, color: '444444' })], spacing: { after: 160 } }),
      ...(map
        ? [
            new D.Paragraph({
              children: [new D.ImageRun({ type: 'png', data: map.data, transformation: { width: 900, height: 360 } })],
              spacing: { after: 160 }
            })
          ]
        : []),
      new D.Table({ width: { size: 15398, type: D.WidthType.DXA }, columnWidths: W, rows }),
      ...(op.length
        ? [
            new D.Paragraph({ children: [new D.TextRun({ text: 'Offene Punkte', bold: true, size: 24 })], spacing: { before: 240, after: 80 } }),
            ...op.map(x => new D.Paragraph({ children: [new D.TextRun({ text: x, size: 18 })], bullet: { level: 0 } }))
          ]
        : []),
      new D.Paragraph({ children: [new D.TextRun({ text: exportFoot(), size: 14, color: '666666' })], spacing: { before: 200 } })
    ];
    const doc = new D.Document({
      creator: 'Reiseplaner',
      title: hd.title,
      styles: { default: { document: { run: { font: 'Calibri' } } } },
      sections: [
        {
          properties: {
            page: { size: { orientation: D.PageOrientation.LANDSCAPE, width: 11906, height: 16838 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } }
          },
          children
        }
      ]
    });
    const blob = await D.Packer.toBlob(doc);
    download(blob, fileBase(hd.title) + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    setStatus('');
    flash(map && !map.tiles ? 'Word-Datei erstellt (Karte ohne Hintergrund – Kartenkacheln ließen sich nicht übernehmen).' : 'Word-Datei erstellt.');
  } catch (e) {
    console.warn(e);
    setStatus('Word-Datei: ' + e.message, 'error');
  }
}
