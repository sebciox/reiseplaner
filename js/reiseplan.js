/* Reiseplaner – Übersicht, Reiseplan-Zeitleiste, Druck/PDF, Offline-Karte.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
/* ---------- Übersicht (Harmonika) ---------- */
function tourTitle() {
  const t = state.tourId && loadTours().find(x => x.id === state.tourId);
  return t ? t.name : state.start && (state.end || state.round) ? defaultName() : 'Tour';
}
function totalsText() {
  const km = state.stages.reduce((a, s) => a + s.dist, 0),
    t = state.stages.reduce((a, s) => a + s.dur, 0);
  const ds = stageDates(),
    n = state.stages.length;
  return `${n} ${n === 1 ? 'Etappe' : 'Etappen'} · ${fkm(km)} · ${fdur(t)} Fahrzeit${ds ? ` · ${fdate(ds[0])} – ${fdate(ds[ds.length - 1])}` : ''}${state.done ? '' : ' · noch nicht fertig geplant'}`;
}
const CARAVAN =
  '<svg class="cv" viewBox="0 0 72 40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M37 30 H58 V20 C57 12 51 6 43 6 H14 a6 6 0 0 0 -6 6 V30 H25 A6 6 0 0 1 37 30"/><path d="M8 23 H14 M23 23 H58"/><rect x="14" y="11" width="9" height="16" rx="2.5"/><path d="M35 11 H50 C52.5 11 54 13 54.5 18 H35 Z"/><path d="M58 28 H70"/><circle cx="31" cy="31" r="4"/></svg>';
/* ---------- Reiseplan: Zeitleiste (Fahrt → Campingplatz mit untergeordneten Sehenswürdigkeiten) ---------- */
const tlOpen = new Set();
const addDays = (d, n) => {
  if (!d) return null;
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
function stopSights(c) {
  return c.sights && c.sights.length ? c.sights : c.near ? [c.near] : [];
}
function stopBodyHtml(s, i) {
  const c = s.to,
    camp = c.kind === 'camp',
    phone = camp && phoneOf(c);
  // nur Pausen-Ziel (Campingplatz statt Sehenswürdigkeit): Entfernung zum Ort; Sehenswürdigkeiten stehen als eigene Einträge darunter
  const near = !(c.sights && c.sights.length) && c.near;
  return `${near ? `<div><span class="k">Zum Ort</span> ${esc(shortLabel(near.label))}${near.d != null ? ` · ${fkm1(near.d)}${near.t ? ' / ' + fdur(near.t) : ''}` : near.air != null ? ` · ${fkm1(near.air)} Luftlinie` : ''}</div>` : ''}
    ${
      camp
        ? `${priceHtml(c)}${settings.gkey && gRate.has(c.id) ? `<div><span class="k">Google</span>${rateHtml(c)}</div>${gHoursHtml(gRate.get(c.id)?.oh, gRate.get(c.id)?.open)}` : ''}
    ${gNameHtml(c)}
    ${rzHtml(c, true) || '<div><span class="k">Rezeption</span> –</div>'}
    <div><span class="k">Adresse</span> ${esc((gRate.get(c.id)?.near && gRate.get(c.id).addr) || (c.addr && c.addr !== 'unbekannt' ? c.addr : '–'))}</div>
    <div><span class="k">Koordinaten</span> ${coordHtml(c)}</div>
    ${phone ? `<div><span class="k">Telefon</span> <a href="tel:${esc(phone.replace(/[^+\d]/g, ''))}">${esc(phone)}</a></div>` : ''}
    ${s.memo?.text || s.memo?.res ? `<div><span class="k">Notiz</span> ${s.memo.res ? 'reserviert ✓ ' : ''}${esc(s.memo.text || '')}</div>` : ''}
    <div class="links">${campLinks(c)}</div>`
        : ''
    }`;
}
const tlsOpen = new Set();
function sightItemHtml(x, from, pre, post) {
  const s = sightSrc(x),
    k = sightKey(s),
    open = tlsOpen.has(k);
  return `<details data-tls="${esc(k)}"${open ? ' open' : ''}><summary><span class="sname">${pre}${esc(shortLabel(x.label))}</span>${post}</summary>${open ? sightBodyHtml(x, from) : ''}</details>`;
}
function timelineHtml(ia) {
  const ds = stageDates(),
    cur = currentStage(),
    st = state.stages,
    last = st.length - 1;
  const home = state.segs && state.segs[state.segs.length - 1].kind === 'home';
  let h = `<div class="tlhead"><h3 style="margin:6px 0">${esc(tourTitle())}</h3>${ia ? `<span class="muted"><button class="linkbtn" type="button" data-tlall="1">alle auf</button> · <button class="linkbtn" type="button" data-tlall="0">alle zu</button></span>` : ''}</div>
    <div class="muted">${esc(totalsText())}</div><ol class="tl">
    <li class="tl-pt"><b>Start: ${esc(shortLabel(state.start.label))}</b>${ds ? ` <span class="muted">· ${fdate(ds[0])}</span>` : ''}</li>`;
  st.forEach((s, i) => {
    const vs = visitsOf(s),
      c = s.to;
    h += `<li class="tl-drive"><b>${CARAVAN}${ds ? fdate(ds[i]) + ' · ' : ''}Fahrt nach ${esc(shortLabel(c.label))}</b>
      <div class="muted">${fkm(s.dist)} · ${fdur(s.dur)}${vs.length ? ` · Tag gesamt ≈ ${fdur(s.dur + vs.reduce((a, v) => a + (+v.hours || 2) * 3600, 0))}` : ''}${s.ex && s.ex.ferry > 500 ? ' · ⛴ Fähre' : ''}</div>
      ${
        vs.length
          ? ia
            ? `<div class="tl-sightlist">${vs.map(v => sightItemHtml(v, null, '◆ unterwegs: ', ` (≈ ${fhours(v.hours)})`)).join('')}</div>`
            : vs.map(v => `<div class="tl-visit">◆ unterwegs: ${esc(shortLabel(v.label))} (≈ ${fhours(v.hours)})</div>`).join('')
          : ''
      }</li>`;
    if (i === last && c.kind !== 'camp') {
      h += `<li class="tl-pt"><b>${home ? 'Zurück in' : 'Ziel:'} ${esc(shortLabel(c.label))}</b></li>`;
      return;
    }
    const n = Math.max(1, +s.nights || 1),
      sg = stopSights(c),
      isLast = i === last;
    const when = ds ? (isLast ? `ab ${fdate(ds[i])}` : `${fdate(ds[i])} – ${fdate(addDays(ds[i], n))}`) : '';
    const stay = isLast ? 'Endpunkt' : `${n} ${n === 1 ? 'Nacht' : 'Nächte'}${n > 1 ? ` · ${n - 1} ${n === 2 ? 'Tag' : 'Tage'} vor Ort` : ''}`;
    const open = !ia || tlOpen.has(i) || (i === cur && !tlOpen.has(-1));
    const sum = `<div class="tl-name">⛺ ${c.kind === 'camp' ? nameHtml(c) : esc(c.label)}${s.memo?.res ? ' <span class="badge res">reserviert ✓</span>' : ''}${i === cur ? ' <span class="badge best">heute/nächste</span>' : ''}</div>
      <div class="muted">${when ? when + ' · ' : ''}${stay}</div>
      ${sg.length && !ia ? `<div class="tl-sights">${sg.map(x => '★ ' + esc(shortLabel(x.label))).join(' · ')}</div>` : ''}`;
    const sights =
      ia && c.sights && c.sights.length
        ? `<div class="tl-sightlist">${c.sights
            .map(x =>
              sightItemHtml(x, c, '★ ', x.d != null ? ` <span class="muted">· ${x.est ? '≈' : ''}${fkm1(x.d)}${x.t ? ' / ' + fdur(x.t) : ''}</span>` : '')
            )
            .join('')}</div>`
        : '';
    const body = `<div class="tl-body">${stopBodyHtml(s, i)}
      ${ia && !isLast ? `<div class="nstep">Nächte hier <button type="button" data-tlnight="${i}" data-d="-1" aria-label="eine Nacht weniger" ${n <= 1 ? 'disabled' : ''}>−</button><b>${n}</b><button type="button" data-tlnight="${i}" data-d="1" aria-label="eine Nacht mehr">+</button></div>` : ''}
      ${
        ia
          ? `<div class="sbtns">
        <button class="btn small" type="button" data-share="${i}">Teilen</button>
        <button class="btn small" type="button" data-tledit="${i}">Bearbeiten</button></div>`
          : ''
      }</div>`;
    h += `<li class="tl-stop${i === cur ? ' cur' : ''}">${ia ? `<details data-tl="${i}"${open ? ' open' : ''}><summary>${sum}</summary>${body}</details>${sights}` : `<details open><summary>${sum}</summary>${body}</details>`}</li>`;
  });
  return h + '</ol>';
}
// feste Aktionsleiste unten: Hauptaktionen sichtbar, weitere hinter „⋯“ (im Testmodus alles offen und nicht fest)
const footHtml = (main, extra) =>
  `<div class="actions foot${window.__allTabs ? ' open static' : ''}"><div class="foot-main">${main}</div>${extra ? `<button class="btn ghost more" type="button" data-more aria-expanded="${!!window.__allTabs}" aria-label="Weitere Aktionen" title="Weitere Aktionen">⋯</button><div class="foot-extra">${extra}</div>` : ''}</div>`;
const grpLoaded = new Set(); // Gruppen, deren Infos (Google, Sehenswürdigkeiten) schon geladen wurden
function renderTrip() {
  const el = $('#tripView');
  if (!el) return;
  if (!state.stages.length) {
    el.innerHTML = `<div class="muted" style="margin:10px 0">Noch kein Reiseplan. Erst unter <button class="linkbtn" type="button" data-goto="goals">1 Ziele</button> die Strecke berechnen, dann unter <button class="linkbtn" type="button" data-goto="plan">2 Plätze</button> die Campingplätze wählen.</div>`;
  } else {
    const saved = state.tourId && loadTours().some(t => t.id === state.tourId);
    el.innerHTML =
      `<div class="tlhead"><h3 style="margin:6px 0">${esc(tourTitle())}</h3><span class="muted"><button class="linkbtn" type="button" data-tlall="1">alle auf</button> · <button class="linkbtn" type="button" data-tlall="0">alle zu</button></span></div>
      <div class="muted">${esc(totalsText())}</div>` +
      `<div class="ptwrap">${planTableHtml()}</div>` +
      (!state.done
        ? `<div class="note" style="margin-top:8px">Noch nicht alle Plätze gewählt – weiter unter <button class="linkbtn" type="button" data-goto="plan">2 Plätze</button>.</div>`
        : '') +
      `<div class="muted" style="margin-top:10px">${saved ? 'Änderungen werden automatisch gespeichert. ' : 'Tour noch nicht gespeichert – Änderungen gehen beim Schließen verloren. '}<button class="linkbtn" type="button" data-act="offline">Etappenziele für unterwegs laden</button> (Karte offline)</div>` +
      footHtml(
        `<button class="btn primary" type="button" data-act="print">Drucken / PDF</button>
        <button class="btn" type="button" data-act="docx">Word</button>
        <button class="btn" type="button" data-act="save" ${state.busy ? 'disabled' : ''}>Speichern</button>`,
        `<button class="btn" type="button" data-act="gpx">GPX</button>
        <button class="btn" type="button" data-act="file">Tour-Datei</button>
        ${saved ? '<button class="btn" type="button" data-act="copy">Kopie speichern</button>' : ''}`
      );
  }
  el.querySelectorAll('[data-goto]').forEach(b => (b.onclick = () => setTab(b.dataset.goto)));
  // Chip „n offen · … €“ in der Reisezeile mitziehen
  const oc = $('#tripBar [data-opento]');
  if (oc) oc.outerHTML = openChipHtml();
  // aufgeklappte Gruppen: Infos einmal nachladen (z. B. die aktuelle Etappe beim ersten Öffnen)
  el.querySelectorAll('tbody.grp.open[data-grpb]').forEach(b => {
    const i = +b.dataset.grpb;
    if (i >= 0 && !grpLoaded.has(i)) {
      grpLoaded.add(i);
      setTimeout(() => openedGroup(i), 0);
    }
  });
  // Google-Namen/-Infos aller Plätze des Reiseplans einmal laden (lädt nur, was noch fehlt)
  if (settings.gkey && !gErr && !gBusy) setTimeout(() => loadRatings(state.stages.map(s => s.to).filter(c => c.kind === 'camp')), 0);
  // Recherche für die Plätze und Sehenswürdigkeiten des Reiseplans anstoßen (nur was noch fehlt)
  setTimeout(() => {
    requestPrices(state.stages.map(s => s.to).filter(c => c.kind === 'camp'));
    requestSights(state.via.filter(v => v.kind !== 'rest').flatMap(v => [v, ...(v.sights || [])]));
  }, 0);
  el.querySelectorAll('form[data-sweb]').forEach(
    f =>
      (f.onsubmit = e => {
        e.preventDefault();
        const k = f.dataset.sweb,
          w = normWeb(f.w.value);
        const x = findSightByKey(k);
        if (!x || !w) {
          flash('Bitte eine gültige Website eintragen.');
          return;
        }
        const src = sightSrc(x);
        src.info = { ...(src.info || {}), web: w, webManual: true };
        touch();
        renderTrip();
        flash('Website gemerkt – Öffnungszeiten und Preise werden in 2–5 Min. gesucht.');
      })
  );
  if (state.via.some(v => v.kind !== 'rest' && [v, ...(v.sights || [])].some(y => !y.info || y.info.v !== INFO_V))) setTimeout(enrichAll, 0);
  el.querySelectorAll('[data-tlall]').forEach(
    b =>
      (b.onclick = () => {
        tlOpen.clear();
        tlOpen.add(-1);
        if (b.dataset.tlall === '1') {
          tlOpen.add(-3);
          state.stages.forEach((_, i) => tlOpen.add(i));
        }
        renderTrip();
        if (b.dataset.tlall === '1') ensureAddrs().then(ch => ch && renderTrip());
      })
  );
  el.querySelectorAll('[data-tlnight]').forEach(
    b =>
      (b.onclick = () => {
        const s = state.stages[+b.dataset.tlnight];
        s.nights = Math.max(1, Math.min(30, (+s.nights || 1) + +b.dataset.d));
        touch();
        renderPanel();
      })
  );
  el.querySelectorAll('[data-tledit]').forEach(
    b =>
      (b.onclick = () => {
        const i = +b.dataset.tledit;
        state.openDet.add(i);
        setTab('plan');
        renderPanel();
        ensureOneAddr(i);
        setTimeout(() => document.querySelector(`[data-stagecard="${i}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
      })
  );
  el.querySelectorAll('[data-copy]').forEach(b => (b.onclick = () => copyText(b.dataset.copy, b)));
  el.querySelectorAll('[data-share]').forEach(b => (b.onclick = () => shareStage(+b.dataset.share)));
  const act = {
    print: () => printTour(),
    docx: () => exportDocx(),
    gpx: () => exportGpx(),
    file: () => exportTour(),
    save: () => saveTour(),
    copy: () => saveTour(true),
    offline: () => prefetchStops()
  };
  el.querySelectorAll('[data-act]').forEach(b => (b.onclick = () => act[b.dataset.act]()));
}

let sumTab = 'stages';
function renderSummary() {
  if (sumTab === 'days') {
    $('#sumBody').innerHTML =
      `${tripHtml().includes('warn') ? tripHtml() : ''}<div class="sumtabs"><button type="button" data-tab="stages">Etappen</button><button type="button" data-tab="days" class="on">Tagesplan</button></div>` +
      timelineHtml(false);
    bindSummary();
    return;
  }
  const ds = stageDates(),
    cur = currentStage();
  let h = `${tripHtml().includes('warn') ? tripHtml() : ''}<div class="sumtabs"><button type="button" data-tab="stages" class="on">Etappen</button><button type="button" data-tab="days">Tagesplan</button></div>
    <div class="sumhead"><b>${esc(tourTitle())}</b><div class="muted">${esc(totalsText())}</div>
    ${cur >= 0 ? '<div class="muted">Tour läuft – die nächste Etappe ist aufgeklappt.</div>' : ''}</div>`;
  state.stages.forEach((s, i) => {
    const c = s.to,
      camp = c.kind === 'camp',
      web = camp && webOf(c),
      phone = camp && phoneOf(c);
    h += `<details ${cur < 0 || cur === i ? 'open' : ''}><summary><span class="sn">${i + 1}</span>
      <span class="st"><b>${esc(shortLabel(c.label))}${s.memo?.res ? ' ✓' : ''}${i === cur ? '<span class="now">nächstes Ziel</span>' : ''}</b>
      <span class="muted">${ds ? fdate(ds[i]) + ' · ' : ''}${fkm(s.dist)} · ${fdur(s.dur)}</span></span></summary>
      <div class="bd">
        <div><span class="k">Strecke</span> ${esc(shortLabel(s.from.label))} → ${esc(shortLabel(c.label))}</div>
        ${
          s.vias && s.vias.length
            ? `<div><span class="k">Unterwegs</span> ${visitsOf(s)
                .map(v => esc(v.label))
                .join(', ')}</div>`
            : ''
        }
        ${c.near ? `<div><span class="k">Sehenswürdigkeit</span> ★ ${esc(c.near.label)} · ${c.near.d != null ? fkm1(c.near.d) + ' / ' + fdur(c.near.t) : fkm1(c.near.air || 0) + ' Luftlinie'}</div>` : ''}
        ${
          camp
            ? `<div><span class="k">Campingplatz</span> ${nameHtml(c)}</div>${priceHtml(c, true)}
        <div><span class="k">Adresse</span> ${esc(c.addr && c.addr !== 'unbekannt' ? c.addr : '–')}</div>
        <div><span class="k">Koordinaten</span> ${coordHtml(c)}</div>
        ${rzHtml(c, true) || ''}
        ${c.tags?.opening_hours ? `<div><span class="k">Geöffnet (OSM)</span> ${esc(c.tags.opening_hours)}</div>` : ''}
        ${web ? `<div><span class="k">Website</span> <a href="${esc(safeUrl(web))}" target="_blank" rel="noopener">${esc(shortUrl(web))}</a></div>` : ''}
        ${phone ? `<div><span class="k">Telefon</span> <a href="tel:${esc(phone.replace(/[^+\d]/g, ''))}">${esc(phone)}</a></div>` : ''}
        ${(s.nights || 1) > 1 && i < state.stages.length - 1 ? `<div><span class="k">Aufenthalt</span> ${s.nights} Nächte</div>` : ''}
        ${s.memo?.text || s.memo?.res ? `<div><span class="k">Notiz</span> ${s.memo.res ? 'reserviert ✓ ' : ''}${esc(s.memo.text || '')}</div>` : ''}`
            : ''
        }
        ${landHtml(s) ? `<div><span class="k">Unterwegs</span> ${landHtml(s)}</div>` : ''}
        <div class="sbtns"><a class="btn small" href="${navUrl(c)}" target="_blank" rel="noopener">Navigation starten</a>
          <button class="btn small" type="button" data-share="${i}">Teilen</button></div>
      </div></details>`;
  });
  h += `<div class="muted" style="margin-top:6px">Offline: Angesehene Kartenausschnitte bleiben gespeichert.
    <button class="linkbtn" type="button" id="offBtn">Etappenziele jetzt für unterwegs laden</button></div>`;
  $('#sumBody').innerHTML = h;
  bindSummary();
}
function bindSummary() {
  const B = $('#sumBody');
  B.querySelectorAll('[data-copy]').forEach(b => (b.onclick = () => copyText(b.dataset.copy, b)));
  B.querySelectorAll('[data-share]').forEach(b => (b.onclick = () => shareStage(+b.dataset.share)));
  B.querySelectorAll('[data-tab]').forEach(
    b =>
      (b.onclick = () => {
        sumTab = b.dataset.tab;
        renderSummary();
      })
  );
  const ob = $('#offBtn');
  if (ob)
    ob.onclick = () => {
      $('#sumDlg').close();
      prefetchStops();
    };
}
async function openSummary() {
  if (!state.stages.length) return;
  renderSummary();
  $('#sumDlg').showModal();
  if (await ensureAddrs()) renderSummary();
  ensureCountries(state.stages.map((_, i) => i));
}
$('#sumBtn').onclick = $('#fabSum').onclick = () => {
  if (window.__allTabs) return openSummary();
  setTab('trip');
  if (isMobile()) setSheet('full');
  ensureAddrs().then(ch => ch && renderTrip());
  ensureCountries(state.stages.map((_, i) => i));
};
$('#fbOff').onclick = () => {
  useFallback = false;
  renderFallbackNote();
};
$('#sumX').onclick = $('#sumClose').onclick = () => $('#sumDlg').close();

/* Drucken / PDF und Word: siehe ausgabe.js */
$('#printBtn').onclick = () => {
  $('#sumDlg').close();
  printTour();
};

/* Offline-Karte: Kartenausschnitte rund um die Etappenziele einmal ansehen → der Service Worker speichert sie.
   (Bewusst nur wenige Ausschnitte: Die OSM-Kachelregeln verbieten das massenhafte Vorabladen.) */
async function prefetchStops() {
  if (state.busy || !state.stages.length) return;
  state.busy = true;
  renderPanel();
  const stops = state.stages.map(s => s.to),
    zooms = [10, 13, 15];
  try {
    for (let k = 0; k < stops.length; k++) {
      for (const z of zooms) {
        setStatus(`Karte für unterwegs: Ziel ${k + 1} von ${stops.length} (Zoom ${z}) …`, 'busy');
        map.setView([stops[k].lat, stops[k].lon], z, { animate: false });
        await new Promise(res => {
          let done = false;
          const f = () => {
            if (!done) {
              done = true;
              res();
            }
          };
          activeTiles().once('load', f);
          setTimeout(f, 5000);
        });
      }
    }
    flash('Karten rund um die Etappenziele sind für unterwegs gespeichert.');
  } finally {
    state.busy = false;
    renderPanel();
    fitAll();
  }
}
