/* Reiseplaner – Seitenleiste: Panel, Reiter, Bottom-Sheet.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
/* ---------- Panel ---------- */
function detailsHtml(s, i) {
  const c = s.to,
    t = c.tags || {},
    phone = phoneOf(c),
    last = i === state.stages.length - 1;
  return `<div class="det">
    ${rzHtml(c)}
    ${priceHtml(c)}
    ${settings.gkey && gRate.has(c.id) ? `<div><span class="k">Google</span>${rateHtml(c)}</div>` : ''}
    ${gRate.get(c.id) ? gHoursHtml(gRate.get(c.id).oh, gRate.get(c.id).open) : ''}
    ${gNameHtml(c)}
    <div><span class="k">Adresse</span> ${c.addr ? esc(c.addr) : '<span class="muted">wird ermittelt …</span>'}</div>
    <div><span class="k">Koordinaten</span> ${coordHtml(c)}</div>
    ${landHtml(s) ? `<div><span class="k">Strecke</span> ${landHtml(s)}</div>` : ''}
    ${t.opening_hours ? `<div><span class="k">Geöffnet (OSM)</span> ${esc(t.opening_hours)}</div>` : ''}
    ${phone ? `<div><span class="k">Telefon</span> <a href="tel:${esc(phone.replace(/[^+\d]/g, ''))}">${esc(phone)}</a></div>` : ''}
    <div class="links">${campLinks(c)}</div>
    <div class="memo">
      <input type="text" data-memo="${i}" placeholder="Notiz (z. B. Preis, Ankunft bis …)" value="${esc(s.memo?.text || '')}">
      <label class="check"><input type="checkbox" data-res="${i}" ${s.memo?.res ? 'checked' : ''}><span>reserviert</span></label>
      ${last ? '' : `<label class="nights">Nächte <input type="number" min="1" max="30" data-nights="${i}" value="${Math.max(1, +s.nights || 1)}"></label>`}
    </div>
    ${state.tourId ? '' : '<div class="muted">Notizen werden mit „Speichern“ in der Tour gesichert.</div>'}
  </div>`;
}
function altHtml(i) {
  const a = state.alt,
    busy = state.busy;
  let h = `<div class="alt"><div class="hd"><b>Platz ändern</b> – anderer Platz im Umkreis von
    <select id="altR">${[5, 10, 20, 30].map(k => `<option value="${k}"${k === a.r ? ' selected' : ''}>${k} km</option>`).join('')}</select>
    um ${esc(shortLabel(state.stages[i].to.label))} <span class="muted">(nur dieser Platz wird getauscht, alle anderen Etappen bleiben)</span></div>`;
  if (!a.list) return h + '<div class="muted" style="margin-top:6px">Suche läuft …</div></div>';
  if (!a.list.length)
    return h + `<div class="muted" style="margin-top:6px">Keine anderen Campingplätze in diesem Umkreis – Umkreis vergrößern.</div>${addCampHtml('alt')}</div>`;
  h += chipsHtml(a.list) + sortHtml(a.list) + '<ul class="cands">';
  sortRows(a.list.filter(passFilter)).forEach(c => {
    h += `<li class="cand"><span class="dot" style="background:${COL.ok}"></span>
      <div class="body" data-show="${esc(c.id)}"><div class="name">${nameHtml(c)}${rateHtml(c)}</div>${priceHtml(c, true)}
      <div class="muted">${fkm1(c.air)} Luftlinie${phoneOf(c) ? ' · ' + esc(phoneOf(c)) : ''}</div></div>
      <div style="display:flex;flex-direction:column;gap:4px">
        <button class="btn small primary" type="button" data-altpick="${esc(c.id)}" ${busy ? 'disabled' : ''}>Übernehmen</button>
        <a class="btn small" href="${navUrl(c)}" target="_blank" rel="noopener">Navi</a></div></li>`;
  });
  return h + `</ul>${addCampHtml('alt')}</div>`;
}
function splitHtml(i) {
  const a = state.split,
    busy = state.busy,
    s = state.stages[i];
  let h = `<div class="alt"><div class="hd"><b>Zwischenstopp</b> zwischen ${esc(shortLabel(s.from.label))} und ${esc(shortLabel(s.to.label))}
    <span class="muted">(Plätze im mittleren Teil der Etappe, beste Teilung zuerst)</span></div>`;
  if (!a.list) return h + '<div class="muted" style="margin-top:6px">Suche läuft …</div></div>';
  if (a.note) h += `<div class="note">${esc(a.note)}</div>`;
  if (!a.list.length)
    return (
      h +
      '<div class="muted" style="margin-top:6px">Keine Campingplätze nahe der Route gefunden. Zoom auf der Karte rein – jeder Platz lässt sich dort als Zwischenstopp übernehmen.</div></div>'
    );
  h += chipsHtml(a.list) + sortHtml(a.list) + '<ul class="cands">';
  sortRows(a.list.filter(passFilter)).forEach(c => {
    h += `<li class="cand"><span class="dot" style="background:${COL.ok}"></span>
      <div class="body" data-show="${esc(c.id)}"><div class="name">${nameHtml(c)}${c.best ? ' <span class="badge best">beste Teilung</span>' : ''}${prevBadge(c)}${amenHtml(c)}${rateHtml(c)}</div>${priceHtml(c, true)}
      <div class="muted">${fkm(c.stageKm)} + ${fkm(c.after)} · ${fkm1(c.detour.d)} / ${fdur(c.detour.t)} von der Route bis zum Platz</div></div>
      <div style="display:flex;flex-direction:column;gap:4px">
        <button class="btn small primary" type="button" data-splitpick="${esc(c.id)}" ${busy ? 'disabled' : ''}>Einfügen</button>
        <a class="btn small" href="${navUrl(c)}" target="_blank" rel="noopener">Navi</a></div></li>`;
  });
  return (
    h +
    `</ul>${addCampHtml('split')}<div class="muted" style="margin-top:6px">Ein anderer Platz? Auf der Karte reinzoomen und dort „Als Zwischenstopp einfügen“ wählen.</div></div>`
  );
}
// Adresse für eine Etappe nachladen, sobald die Details geöffnet werden
async function ensureOneAddr(i) {
  const c = state.stages[i]?.to;
  if (!c || c.kind !== 'camp' || c.addr) return;
  c.addr = addrFromTags(c.tags);
  if (!c.addr && settings.key) {
    try {
      c.addr = await reverseAddr(c);
    } catch (e) {
      console.warn(e);
    }
  }
  if (!c.addr) c.addr = 'unbekannt';
  touch();
  renderPanel();
}

const askingN = () => !!(state.overview && !state.n && !state.stages.length);
function nOptions(R) {
  const rec = plan(R).n,
    out = [];
  for (let n = Math.max(1, rec - 2); n <= rec + 2; n++) if (n === 1 || R / n >= 100000) out.push(n);
  return { rec, list: out };
}
function renderSegAsk() {
  const o = state.overview,
    segs = state.segs,
    n = segs.reduce((a, g) => a + g.n, 0);
  const nights = segs.reduce((a, g) => a + (g.n - 1) + (g.kind === 'sight' ? g.nights : 0), 0);
  let h = `<div class="total"><div class="muted">${state.round ? 'Rundreise ab' : 'Reise'} ${esc(shortLabel(state.start.label))} · ${segs.length} Abschnitte</div>
    <div class="big">${fkm(o.dist)}</div><div>ca. ${fdur(o.dur)} reine Fahrzeit · ${n} Etappen · ${nights} Übernachtungen</div></div>
    <h3>Abschnitte</h3><ol class="segs">`;
  let from = state.start;
  segs.forEach((g, k) => {
    const name =
      g.kind === 'sight'
        ? (g.rest ? '⛺ ' : '★ ') + shortLabel(g.to.label)
        : g.kind === 'home'
          ? 'zurück nach ' + shortLabel(g.to.label)
          : shortLabel(g.to.label);
    h += `<li class="segrow"><div class="st"><b>${esc(shortLabel(from.label))} → ${esc(name)}</b>
      <div class="muted">${fkm(g.dist)} · ${fdur(g.dur)}${g.visits.length ? ' · unterwegs: ' + g.visits.map(v => esc(shortLabel(v.label))).join(', ') : ''}${g.kind === 'sight' ? ` · ${g.nights} ${g.nights === 1 ? 'Nacht' : 'Nächte'} dort` : ''}</div>
      ${
        g.keep
          ? `<div class="keepinfo">✓ bisherige Plätze werden übernommen: ${
              g.keep
                .filter(s => s.to.kind === 'camp')
                .map(s => esc(shortLabel(s.to.label)))
                .join(' → ') || 'Ziel'
            }</div>`
          : ''
      }
      <div class="muted">${g.n === 1 ? 'direkt, ohne Zwischenstopp' : `${g.n - 1} ${g.n === 2 ? 'Zwischenstopp' : 'Zwischenstopps'} · ${g.n} Etappen à ~${fkm(g.dist / g.n)}`}${g.n !== g.rec ? ` (Empfehlung ${g.rec})` : ''}</div></div>
      <div class="segn"><span class="muted">Etappen</span><div class="stepper"><button type="button" data-segn="${k}" data-d="-1" aria-label="weniger Etappen">−</button><span>${g.n}</span><button type="button" data-segn="${k}" data-d="1" aria-label="mehr Etappen (Zwischenstopp)">+</button></div></div></li>`;
    from = g.to;
  });
  h += `</ol><button class="btn primary wide" type="button" id="segGo" style="margin-top:10px" ${state.busy ? 'disabled' : ''}>Plätze wählen</button>
    <div class="muted" style="margin-top:8px">Zahl = Etappen je Abschnitt: mit <b>+</b> kommt ein Zwischenstopp dazu, gesucht wird auf gleich langen Teilstrecken (Empfehlung: höchstens ${+settings.cmax} km je Etappe). Auch später lässt sich an jeder Etappe „+ Zwischenstopp“ einfügen. Am Ende eines Abschnitts mit ★ wählst du einen Platz nahe der Sehenswürdigkeit.</div>`;
  return h;
}
function renderAsk() {
  if (state.segs) return renderSegAsk();
  const o = state.overview,
    { rec, list } = nOptions(o.dist);
  let h = `<div class="total"><div class="muted">Gesamtstrecke ${esc(shortLabel(state.start.label))} → ${esc(shortLabel(state.end.label))}</div>
    <div class="big">${fkm(o.dist)}</div><div>ca. ${fdur(o.dur)} reine Fahrzeit (max. ${Math.max(80, +settings.speed || 80)} km/h)</div></div>
    <h3>Wie viele Etappen?</h3><ul class="opts">`;
  const ret = state.ret ? new Date(state.ret + 'T12:00:00') : null;
  list.forEach(n => {
    const nights = n - 1;
    h += `<li><button type="button" data-n="${n}" class="${n === rec ? 'rec' : ''}" ${state.busy ? 'disabled' : ''}>
      <span class="n">${n}</span><span class="d"><b>${n === 1 ? 'Etappe' : 'Etappen'} à ~${fkm(o.dist / n)}</b>${n === rec ? ' <span class="badge best">Empfehlung</span>' : ''}
      <div class="muted">je ca. ${fdur(o.dur / n)} · ${nights ? nights + (nights === 1 ? ' Übernachtung' : ' Übernachtungen') : 'ohne Übernachtung'}${(() => {
        const e = tripEnd(n);
        return e ? ` · Ankunft ${fdate(e)}${ret && e > ret ? ' <b style="color:var(--danger)">⚠ zu spät</b>' : ''}` : '';
      })()}</div></span></button></li>`;
  });
  h += `</ul><form class="custom" id="nForm"><label for="nIn" class="muted">Andere Anzahl:</label>
    <input id="nIn" type="number" min="1" max="30" step="1" inputmode="numeric" value="${rec}">
    <button class="btn" type="submit" ${state.busy ? 'disabled' : ''}>Planen</button></form>
    <div class="muted" id="nHint" style="margin-top:4px">à ~${fkm(o.dist / rec)}</div>
    <div class="muted" style="margin-top:8px">Empfehlung = so wenige Etappen wie möglich mit höchstens ${+settings.cmax} km (Einstellungen).</div>`;
  return h;
}
function renderPanel() {
  lyr.hits.clearLayers();
  const el = $('#result'),
    p = state.pending,
    busy = state.busy;
  $('#planBtn').disabled = busy;
  $('#fabSum').hidden = !state.stages.length;
  $('#sumBtn').hidden = !state.stages.length || !window.__allTabs; // Reiter 3 ersetzt den Knopf
  let h = askingN() ? renderAsk() : '';
  if (state.stages.length) {
    const ds = stageDates(),
      cur = currentStage();
    h += '<h3>Etappen</h3><ol class="stages">';
    state.stages.forEach((s, i) => {
      const camp = s.to.kind === 'camp',
        open = state.openDet.has(i),
        altOpen = state.alt && state.alt.i === i,
        splitOpen = state.split && state.split.i === i;
      h += `<li class="stage" data-stagecard="${i}"><div class="num">Etappe ${i + 1}${ds ? ' · ' + fdate(ds[i]) : ''}${i === cur ? ' <span class="badge best">heute/nächste</span>' : ''}</div>
        <div class="route">${esc(shortLabel(s.from.label))} → ${camp ? nameHtml(s.to) : esc(shortLabel(s.to.label))}${s.memo?.res ? '<span class="badge res">reserviert ✓</span>' : ''}</div>
        <div class="row"><span class="muted">${fkm(s.dist)} · ${fdur(s.dur)}${s.to.detour ? ` · ${fkm1(s.to.detour.d)} / ${fdur(s.to.detour.t)} von der Route bis zum Platz` : ''}${(s.nights || 1) > 1 && i < state.stages.length - 1 ? ` · ${s.nights} Nächte` : ''}</span>
        ${camp && !(state.done && i === state.stages.length - 1) ? `<button class="btn small ghost" type="button" data-edit="${i}" ${busy ? 'disabled' : ''} title="Alle Plätze ab dieser Etappe neu wählen">Ab hier neu planen</button>` : ''}</div>
        ${
          s.to.sights && s.to.sights.length > 1
            ? `<div class="sightinfo">★ Basislager: ${s.to.sights.map(x => `${esc(shortLabel(x.label))} ${x.d != null ? (x.est ? '≈' : '') + fkm1(x.d) : ''}`).join(' · ')}</div>`
            : s.to.near
              ? `<div class="sightinfo">★ ${esc(shortLabel(s.to.near.label))} · ${s.to.near.d != null ? `${fkm1(s.to.near.d)} / ${fdur(s.to.near.t)}` : `${fkm1(s.to.near.air || 0)} Luftlinie`}</div>`
              : ''
        }
        ${
          s.vias && s.vias.length
            ? `<div class="muted">unterwegs: ${visitsOf(s)
                .map(v =>
                  v.kind === 'pass'
                    ? `über ${esc(shortLabel(v.label))}`
                    : v.kind === 'ferry'
                      ? `⛴ Fähre ${esc(shortLabel(v.label))} → ${esc(shortLabel(v.to?.label || '?'))} (≈ ${fhours(v.hours)})`
                      : `${esc(shortLabel(v.label))} (≈ ${fhours(v.hours)} · <a href="${parkUrl(v)}" target="_blank" rel="noopener">Parken fürs Gespann</a>)`
                )
                .join(', ')}
          · Tag gesamt ≈ ${fdur(s.dur + visitsOf(s).reduce((a, v) => a + (v.kind === 'pass' ? 0 : +v.hours || 2) * 3600, 0))}</div>`
            : ''
        }
        ${i < state.stages.length - 1 || !state.done ? `<div class="nstep">Nächte hier <button type="button" data-nstep="${i}" data-d="-1" aria-label="eine Nacht weniger" ${(s.nights || 1) <= 1 ? 'disabled' : ''}>−</button><b>${s.nights || 1}</b><button type="button" data-nstep="${i}" data-d="1" aria-label="eine Nacht mehr">+</button>${(s.nights || 1) > 1 ? ` · ${(s.nights || 1) - 1} ${(s.nights || 1) === 2 ? 'freier Tag' : 'freie Tage'}` : ''}</div>` : ''}
        ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
        <div class="sbtns">
          <a class="btn" href="${navUrl(s.to)}" target="_blank" rel="noopener">Navigation</a>
          ${
            camp
              ? `<button class="btn${open ? ' on' : ''}" type="button" data-det="${i}">Details ${open ? '▴' : '▾'}</button>
          <button class="btn${altOpen ? ' on' : ''}" type="button" data-alt="${i}" ${busy ? 'disabled' : ''} title="Nur diesen Platz gegen einen anderen in der Nähe tauschen">Platz ändern</button>`
              : ''
          }
          <button class="btn${splitOpen ? ' on' : ''}" type="button" data-split="${i}" ${busy ? 'disabled' : ''} title="Campingplatz etwa auf halbem Weg dieser Etappe einfügen">+ Zwischenstopp</button>
          <button class="btn" type="button" data-share="${i}">Teilen</button>
        </div>
        ${camp && open ? detailsHtml(s, i) : ''}
        ${altOpen ? altHtml(i) : ''}${splitOpen ? splitHtml(i) : ''}</li>`;
    });
    h += '</ol>';
  }
  if (state.done) {
    const km = state.stages.reduce((a, s) => a + s.dist, 0),
      t = state.stages.reduce((a, s) => a + s.dur, 0);
    const n = state.stages.length - 1;
    h += `<div class="summary">Gesamt ${fkm(km)} · ${fdur(t)} Fahrzeit · ${n} ${n === 1 ? 'Übernachtung' : 'Übernachtungen'}</div>`;
    const lastS = state.stages[state.stages.length - 1],
      endIsCamp = lastS.to.kind === 'camp';
    const home = state.segs && state.segs[state.segs.length - 1].kind === 'home'; // Rundreise endet zu Hause
    if (home) h += `<div class="endsel"><span>Zurück in <b>${esc(shortLabel(lastS.to.label))}</b> – Rundreise geschafft.</span></div>`;
    else if (endIsCamp && !state.showEndList)
      h += `<div class="endsel"><span>Zielplatz: <b>${esc(lastS.to.label)}</b> ✓</span>
        <button class="btn small" type="button" id="endListBtn" ${busy ? 'disabled' : ''}>Ändern</button></div>`;
    else if (!state.endSearched && !busy) h += `<button class="btn wide" type="button" id="endSearchBtn">Campingplätze am Ziel suchen</button>`;
    if (state.endCands.length && (!endIsCamp || state.showEndList)) {
      const last = lastS;
      h += `<h3>Campingplatz am Ziel</h3>
        <div class="muted">Plätze im Umkreis von ${Math.max(10, +settings.detour)} km um ${esc(shortLabel(state.end.label))} – wähle einen als Endpunkt.</div>
        ${chipsHtml(state.endCands)}${sortHtml(state.endCands)}<ul class="cands">`;
      sortRows(state.endCands.filter(passFilter)).forEach(c => {
        const chosen = last.to.kind === 'camp' && last.to.id === c.id;
        h += `<li class="cand"><span class="dot" style="background:${COL.ok}"></span>
          <div class="body" data-show="${esc(c.id)}"><div class="name">${nameHtml(c)}${rateHtml(c)}</div>${priceHtml(c, true)}
          <div class="muted">${fkm1(c.air)} vom Zielort</div></div>
          ${chosen ? '<span class="muted">✓ Ziel</span>' : `<button class="btn small primary" type="button" data-endpick="${esc(c.id)}" ${busy ? 'disabled' : ''}>Als Ziel</button>`}</li>`;
      });
      h += '</ul>';
    }
  }
  if (p && p.mode === 'anchor') {
    const g = state.segs[p.seg];
    h += `<h3>Etappe ${state.stages.length + 1} von ${state.n}: ${p.sights && p.sights.length > 1 ? 'Basislager' : 'Campingplatz'} bei ${esc(shortLabel(p.sight.label))}</h3>
      <div class="ideal">${g.rest ? '⛺ Pause' : p.sights && p.sights.length > 1 ? '★ Basislager für' : '★'} <b>${p.sights && p.sights.length > 1 ? p.sights.map(x => esc(shortLabel(x.label))).join(', ') : esc(p.sight.label)}</b> · ${g.nights} ${g.nights === 1 ? 'Nacht' : 'Nächte'}${g.nights > 1 ? ` (${g.nights - 1} ${g.nights === 2 ? 'freier Tag' : 'freie Tage'})` : ''}
        ${!busy ? ` · <button class="linkbtn" type="button" id="nChange">Abschnitte ändern</button>` : ''}
        <div class="sbtns" style="margin-top:4px"><span class="muted">Umkreis</span>
          <select id="ancR" aria-label="Umkreis um die Sehenswürdigkeit">${[...new Set([10, 20, 30, 50, p.radius])]
            .sort((a, b) => a - b)
            .map(k => `<option value="${k}"${k === p.radius ? ' selected' : ''}>${k} km</option>`)
            .join('')}</select>
          ${coordHtml(p.sight)}</div><div class="muted" style="font-size:13px">oder auf der Karte den Griff ↔ am Kreisrand ziehen</div></div>
      <div class="muted">Anfahrt ${fkm(p.remain)} · ${fdur(p.remainDur)}${p.visits.length ? ' · unterwegs: ' + p.visits.map(v => esc(shortLabel(v.label))).join(', ') : ''}</div>
      ${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}
      ${chipsHtml(p.cands)}${sortHtml(p.cands)}<ul class="cands">`;
    const best0 = p.cands.filter(passFilter)[0];
    sortRows(p.cands.filter(passFilter)).forEach(c => {
      h += `<li class="cand"><span class="dot" style="background:${COL.ok}"></span>
        <div class="body" data-show="${esc(c.id)}"><div class="name">${nameHtml(c)}${amenHtml(c)}${c === best0 ? ' <span class="badge best">am nächsten</span>' : ''}${prevBadge(c)}${rateHtml(c)}</div>${priceHtml(c, true)}
        ${
          c.sightD && c.sightD.length > 1
            ? `<div class="sightinfo">${c.sightD
                .map(x => (x ? `★ ${esc(shortLabel(x.label))} ${fkm1(x.d)} / ${fdur(x.t)}` : ''))
                .filter(Boolean)
                .join('<br>')}</div><div class="muted">Ø ${fkm1(c.sight.d)}</div>`
            : `<div class="sightinfo">${c.sight ? `${fkm1(c.sight.d)} / ${fdur(c.sight.t)} ${g.rest ? 'zum Ort' : 'zur Sehenswürdigkeit'}` : `${fkm1(c.air)} Luftlinie ${g.rest ? 'zum Ort' : 'zur Sehenswürdigkeit'}`}</div>`
        }</div>
        <button class="btn small primary" type="button" data-pick="${esc(c.id)}" ${busy ? 'disabled' : ''}>Wählen</button></li>`;
    });
    h += `</ul>${addCampHtml('pending')}<div class="muted" style="margin-top:8px">Sortiert nach ${p.sights && p.sights.length > 1 ? 'mittlerer Entfernung zu allen Sehenswürdigkeiten' : 'Entfernung ' + (g.rest ? 'zum Ort' : 'zur Sehenswürdigkeit')}. Weitere Plätze erscheinen auf der Karte beim Reinzoomen.</div>`;
  } else if (p) {
    h += `<h3>Etappe ${state.stages.length + 1} von ${state.n}: ${state.segs ? 'Transit-Stopp' : 'Platz wählen'}</h3>
      <div class="ideal">Ideal: noch <b>${p.plan.n} Etappen à ~${fkm(p.plan.len)}</b>
        ${state.overview && !busy ? ` · <button class="linkbtn" type="button" id="nChange">${state.segs ? 'Abschnitte ändern' : 'Anzahl ändern'}</button>` : ''}
        ${(() => {
          const q = pointAt(p.line, p.cum, p.plan.len);
          return `<div class="sbtns" style="margin-top:4px"><span class="muted">Idealpunkt:</span> ${coordHtml({ lat: q[0], lon: q[1] })}</div>`;
        })()}</div>
      <div class="muted">Bis ${state.segs ? esc(shortLabel(state.segs[p.seg].to.label)) : 'zum Ziel'} noch ${fkm(p.remain)}${p.visits && p.visits.length ? ' (unterwegs: ' + p.visits.map(v => esc(shortLabel(v.label))).join(', ') + ')' : ''} · Korridor ${p.cmin}–${p.cmax} km · Umweg bis ${p.detour} km${p.info ? '<br>' + esc(p.info) : ''}</div>
      ${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}
      ${chipsHtml(p.cands)}${sortHtml(p.cands)}<ul class="cands">`;
    const best0 = p.cands.filter(passFilter)[0];
    sortRows(p.cands.filter(passFilter)).forEach(c => {
      const k = c === best0 ? 0 : 1;
      h += `<li class="cand"><span class="dot" style="background:${COL.ok}"></span>
        <div class="body" data-show="${esc(c.id)}"><div class="name">${nameHtml(c)}${amenHtml(c)}${k === 0 ? ' <span class="badge best">Empfehlung</span>' : ''}${prevBadge(c)}${rateHtml(c)}</div>${priceHtml(c, true)}
        <div class="muted">bei km ${fkm(c.stageKm)} · ${fkm1(c.detour.d)} / ${fdur(c.detour.t)} von der Route bis zum Platz</div>
        <div class="after">${afterText(c)}</div></div>
        <button class="btn small primary" type="button" data-pick="${esc(c.id)}" ${busy ? 'disabled' : ''}>Wählen</button></li>`;
    });
    h += `</ul>${addCampHtml('pending')}<div class="muted" style="margin-top:8px">Sortiert nach Nähe zur idealen Etappenlänge. Weitere Campingplätze erscheinen auf der Karte beim Reinzoomen.</div>`;
  }
  if (state.n && !state.done && !p && !busy) {
    h += `<button class="btn primary wide" type="button" id="contBtn" style="margin-top:6px">Erneut versuchen – Etappe ${state.stages.length + 1} planen</button>`;
  }
  if (!h)
    h = `<div class="muted" style="margin:10px 0">Noch keine Strecke berechnet. Unter <button class="linkbtn" type="button" data-goto="goals">1 Ziele</button> Start, Zwischenziele und Ziel eingeben und „Strecke berechnen“ drücken.</div>`;
  else if (state.stages.length) {
    h += footHtml(
      `${state.done ? '<button class="btn primary" type="button" data-goto="trip">Weiter: Reiseplan →</button>' : ''}
      <button class="btn" type="button" id="saveBtn" ${busy ? 'disabled' : ''}>Speichern</button>`,
      `<button class="btn" type="button" id="expBtn">Tour-Datei</button>
      <button class="btn" type="button" id="gpxBtn">GPX</button>
      <button class="btn ghost" type="button" id="newBtn" ${busy ? 'disabled' : ''}>Neue Tour</button>`
    );
  }
  el.innerHTML = h;
  const fin = planFinished();
  if (fin && !prevDone) uiTab = 'trip'; // alle Plätze inkl. Zielplatz gewählt → Reiseplan zeigen
  prevDone = fin;
  applyTab();
  el.querySelectorAll('[data-goto]').forEach(b => (b.onclick = () => setTab(b.dataset.goto)));
  el.querySelectorAll('[data-edit]').forEach(
    b =>
      (b.onclick = () => {
        const i = +b.dataset.edit,
          from = state.stages[i].from;
        const later = state.stages.length - i - 1;
        if (
          later > 0 &&
          !confirm(
            `Ab Etappe ${i + 1} neu planen?\n\nDieser Platz und alle ${later} folgenden Etappen werden verworfen und neu gewählt – samt Preisen, Status und Notizen.\n\nNur diesen Platz tauschen: „Platz ändern“.`
          )
        )
          return;
        state.stages = state.stages.slice(0, i);
        state.alt = null;
        state.split = null;
        state.openDet.clear();
        run(() => computeNext(from));
      })
  );
  el.querySelectorAll('[data-det]').forEach(
    b =>
      (b.onclick = () => {
        const i = +b.dataset.det;
        if (state.openDet.has(i)) state.openDet.delete(i);
        else {
          state.openDet.add(i);
          ensureOneAddr(i);
          ensureCountries([i]);
          if (settings.gkey) {
            loadRatings([state.stages[i].to]);
            loadGName(state.stages[i].to).then(f => f && renderPanel());
          }
        }
        renderPanel();
      })
  );
  el.querySelectorAll('form.addcamp').forEach(
    f =>
      (f.onsubmit = e => {
        e.preventDefault();
        if (!state.busy) searchAddCamp(f);
      })
  );
  el.querySelectorAll('[data-split]').forEach(
    b =>
      (b.onclick = () => {
        const i = +b.dataset.split;
        if (state.split && state.split.i === i) {
          state.split = null;
          renderAll();
          return;
        }
        run(() => loadSplit(i));
      })
  );
  el.querySelectorAll('[data-splitpick]').forEach(
    b =>
      (b.onclick = () => {
        const c = campIndex.get(b.dataset.splitpick),
          i = state.split?.i;
        if (c && i != null) run(() => splitStage(i, c));
      })
  );
  el.querySelectorAll('[data-alt]').forEach(
    b =>
      (b.onclick = () => {
        const i = +b.dataset.alt;
        state.split = null;
        if (state.alt && state.alt.i === i) {
          state.alt = null;
          renderAll();
          return;
        }
        run(() => loadAlt(i, +settings.altRadius || 10));
      })
  );
  const ar = $('#altR');
  if (ar)
    ar.onchange = () => {
      settings.altRadius = +ar.value;
      saveSettings();
      run(() => loadAlt(state.alt.i, +ar.value));
    };
  el.querySelectorAll('[data-altpick]').forEach(
    b =>
      (b.onclick = () => {
        const c = campIndex.get(b.dataset.altpick),
          i = state.alt?.i;
        if (c && i != null && confirm(`„${c.tags.name || 'Campingplatz'}“ als neues Ziel von Etappe ${i + 1} übernehmen?`)) run(() => replaceStop(i, c));
      })
  );
  el.querySelectorAll('[data-filter]').forEach(
    b =>
      (b.onclick = () => {
        settings.filters = { ...(settings.filters || {}), [b.dataset.filter]: !(settings.filters || {})[b.dataset.filter] };
        saveSettings();
        renderAll();
      })
  );
  el.querySelectorAll('[data-res]').forEach(
    b =>
      (b.onchange = () => {
        const s = state.stages[+b.dataset.res];
        s.memo = { ...(s.memo || {}), res: b.checked };
        touch();
        renderPanel();
      })
  );
  el.querySelectorAll('[data-memo]').forEach(
    b =>
      (b.onchange = () => {
        const s = state.stages[+b.dataset.memo];
        s.memo = { ...(s.memo || {}), text: b.value.trim() };
        touch();
      })
  );
  el.querySelectorAll('[data-nights]').forEach(
    b =>
      (b.onchange = () => {
        const s = state.stages[+b.dataset.nights];
        s.nights = Math.max(1, Math.min(30, Math.round(+b.value) || 1));
        touch();
        renderPanel();
      })
  );
  el.querySelectorAll('[data-copy]').forEach(b => (b.onclick = () => copyText(b.dataset.copy, b)));
  el.querySelectorAll('[data-share]').forEach(b => (b.onclick = () => shareStage(+b.dataset.share)));
  el.querySelectorAll('[data-sort]').forEach(
    b =>
      (b.onclick = () => {
        if (b.dataset.sort === 'rating' && !settings.gkey) {
          flash('Für Google-Bewertungen bitte unter ⚙︎ einen Google-API-Schlüssel eintragen.');
          return;
        }
        settings.sortBy = b.dataset.sort;
        saveSettings();
        renderPanel();
      })
  );
  el.querySelectorAll('[data-nstep]').forEach(
    b =>
      (b.onclick = () => {
        const s = state.stages[+b.dataset.nstep];
        s.nights = Math.max(1, Math.min(30, (+s.nights || 1) + +b.dataset.d));
        touch();
        renderPanel();
      })
  );
  const elb = $('#endListBtn');
  if (elb)
    elb.onclick = () => {
      state.showEndList = true;
      if (state.endSearched) renderAll();
      else run(loadEndCands);
    };
  el.querySelectorAll('[data-pick]').forEach(
    b =>
      (b.onclick = () => {
        const c = campIndex.get(b.dataset.pick);
        if (c) run(() => selectCamp(c));
      })
  );
  el.querySelectorAll('[data-endpick]').forEach(
    b =>
      (b.onclick = () => {
        const c = campIndex.get(b.dataset.endpick);
        if (c) run(() => selectEnd(c));
      })
  );
  if (matchMedia('(hover:hover)').matches)
    el.querySelectorAll('li.cand').forEach(li => {
      const b = li.querySelector('[data-show]');
      if (!b) return;
      li.onmouseenter = () => {
        const c = campIndex.get(b.dataset.show);
        clearTimeout(hlTimer);
        if (hlCamp && hlCamp !== c) hlCampOn(hlCamp, false);
        li.classList.add('hl');
        hlCampOn(c, true);
        hlTimer = setTimeout(() => followCamp(c), 250);
      };
      li.onmouseleave = () => {
        clearTimeout(hlTimer);
        li.classList.remove('hl');
        hlCampOn(campIndex.get(b.dataset.show), false);
      };
    });
  el.querySelectorAll('[data-show]').forEach(
    b =>
      (b.onclick = () => {
        const c = campIndex.get(b.dataset.show);
        if (!c) return;
        if (window.innerWidth < 900) setSheet('min');
        setTimeout(() => {
          map.setView([c.lat, c.lon], Math.max(map.getZoom(), 11));
          c._m && c._m.openPopup();
        }, 280);
      })
  );
  el.querySelectorAll('[data-n]').forEach(b => (b.onclick = () => chooseN(+b.dataset.n)));
  const nf = $('#nForm');
  if (nf) {
    nf.onsubmit = e => {
      e.preventDefault();
      chooseN(+$('#nIn').value);
    };
    $('#nIn').oninput = () => {
      const n = Math.round(+$('#nIn').value);
      $('#nHint').textContent = n >= 1 && n <= 30 ? `à ~${fkm(state.overview.dist / n)} · je ca. ${fdur(state.overview.dur / n)}` : '';
    };
  }
  const anr = $('#ancR');
  if (anr)
    anr.onchange = () => {
      const q = state.pending;
      if (q && q.mode === 'anchor') run(() => loadAnchorCands(q.from, q.seg, q.visits, { line: q.line, dist: q.remain, dur: q.remainDur }, +anr.value));
    };
  el.querySelectorAll('[data-segn]').forEach(
    b =>
      (b.onclick = () => {
        const g = state.segs[+b.dataset.segn];
        delete g.keep;
        g.n = Math.max(1, Math.min(15, g.n + +b.dataset.d));
        renderPanel();
      })
  );
  const sg = $('#segGo');
  if (sg) sg.onclick = startSegs;
  const nc = $('#nChange');
  if (nc)
    nc.onclick = () => {
      if (state.busy) return;
      const kp = state.segs ? snapshotKeep() : null;
      if (state.segs) state.segs.forEach(g => delete g.keep);
      Object.assign(state, { stages: [], pending: null, done: false, n: null, endCands: [] });
      applyKeep(kp);
      setStatus('');
      renderAll();
      fitAll();
    };
  const esb = $('#endSearchBtn');
  if (esb) esb.onclick = () => run(loadEndCands);
  const cb = $('#contBtn');
  if (cb) cb.onclick = () => run(() => computeNext(state.stages.length ? state.stages[state.stages.length - 1].to : state.start));
  const sb = $('#saveBtn');
  if (sb) sb.onclick = () => saveTour();
  const gb = $('#gpxBtn');
  if (gb) gb.onclick = exportGpx;
  const xb = $('#expBtn');
  if (xb) xb.onclick = exportTour;
  const nb = $('#newBtn');
  if (nb) nb.onclick = resetTour;
  autosaveSoon(); // gespeicherte Tour: Änderungen sichern; neue Tour: Entwurf
}
function renderAll() {
  renderPanel();
  renderMap();
}
/* Reiter „1 Ziele · 2 Plätze · 3 Reiseplan“. window.__allTabs (nur Tests) zeigt alles wie früher untereinander. */
let uiTab = 'goals',
  prevDone = false;
// fertig geplant: alle Etappen + Zielplatz gewählt (oder Rundreise zu Hause / keine Plätze am Ziel)
function planFinished() {
  const l = state.stages[state.stages.length - 1];
  if (!state.done || !l) return false;
  const home = state.segs && state.segs[state.segs.length - 1].kind === 'home';
  return home || l.to.kind === 'camp' || (state.endSearched && !state.endCands.length);
}
function setTab(t) {
  if (uiTab !== t) {
    uiTab = t;
    $('#scroll').scrollTop = 0;
  }
  applyTab();
}
function applyTab() {
  const all = !!window.__allTabs;
  $('#planForm').hidden = !all && uiTab !== 'goals';
  $('#result').hidden = !all && uiTab !== 'plan';
  $('#tripView').hidden = !all && uiTab !== 'trip';
  const total = state.segs ? state.segs.reduce((a, g) => a + g.n, 0) : state.n;
  const cnt = {
    goals: state.via.length ? ` <span class="cnt">(${state.via.length})</span>` : '',
    plan: state.stages.length ? ` <span class="cnt">(${state.stages.length}${total && !state.done ? '/' + total : ''})</span>` : '',
    trip: ''
  };
  // erledigte Schritte bekommen ✓ statt der Nummer
  const done = { goals: !!(state.overview || state.segs || state.stages.length), plan: planFinished(), trip: false };
  const lab = { goals: 'Ziele', plan: 'Plätze', trip: 'Reiseplan' },
    num = { goals: 1, plan: 2, trip: 3 };
  document.querySelectorAll('[data-tabbtn]').forEach(b => {
    const t = b.dataset.tabbtn,
      on = t === uiTab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on);
    b.innerHTML = (done[t] ? '<span class="ok" aria-label="erledigt">✓</span> ' : num[t] + ' ') + lab[t] + cnt[t];
  });
  $('#tripBar').innerHTML = tripChips();
  $('#toPlan').hidden = all || !done.goals;
  document.querySelectorAll('.actions.foot').forEach(f => f.classList.toggle('static', all));
  updateWide();
  if (uiTab === 'trip' || all) renderTrip();
}
// Laptop, Reiter 3: Seitenleiste weg – oben die Karte, unten der Reiseplan über die ganze Breite (Trennlinie ziehbar)
function updateWide() {
  const wide = !window.__allTabs && uiTab === 'trip' && !isMobile() && !!state.stages.length;
  if (document.body.classList.contains('tripwide') === wide) return;
  document.body.classList.toggle('tripwide', wide);
  setTimeout(() => {
    map.invalidateSize();
    popupPad();
  }, 0);
}
window.addEventListener('resize', () => updateWide());
document.querySelectorAll('[data-tabbtn]').forEach(b => (b.onclick = () => setTab(b.dataset.tabbtn)));
$('#toPlan').onclick = () => setTab('plan');
$('#tripBar').addEventListener('click', e => {
  if (e.target.closest('[data-opento]')) gotoOpenList();
  else if (e.target.closest('[data-savenow]')) saveTour();
  else if (e.target.closest('[data-savesync]')) {
    if (saveInfo.online === 'error' || saveInfo.online === 'pending') scheduleOnline(true);
  } else if (e.target.closest('[data-tripx]')) {
    tripOpen = !tripOpen;
    applyTab();
  } else if (e.target.closest('[data-tripdate]')) {
    setTab('goals');
    if (isMobile()) setSheet('full');
    setTimeout(() => {
      $('#dateIn').scrollIntoView({ block: 'center' });
      $('#dateIn').focus();
    }, 60);
  }
});
// „⋯“ in der festen Aktionsleiste: weitere Aktionen ein-/ausklappen
$('#scroll').addEventListener('click', e => {
  const b = e.target.closest('[data-more]');
  if (!b) return;
  const f = b.closest('.foot');
  f.classList.toggle('open');
  b.setAttribute('aria-expanded', f.classList.contains('open'));
});
$('#scroll').addEventListener('scroll', () => $('#panelHead').classList.toggle('shadow', $('#scroll').scrollTop > 2), { passive: true });

/* Bottom-Sheet am Handy */
const SHEET = ['min', 'half', 'full'];
const isMobile = () => window.innerWidth < 900;
let lastSheet = 'half';
function setSheet(s) {
  const p = $('#panel'),
    was = curSheet();
  if (s === 'hide' && was !== 'hide') lastSheet = was;
  [...SHEET, 'hide'].forEach(x => p.classList.toggle(x, x === s));
  $('#fabMenu').title = s === 'hide' ? 'Menü einblenden' : 'Menü ausblenden';
  $('#fabMenu').classList.toggle('on', s === 'hide');
  setTimeout(popupPad, 300);
  setTimeout(sheetVar, 320);
  sheetVar();
}
const sheetHidden = () => $('#panel').classList.contains('hide');
// Zoom/Kartenart/Quellenangabe (unten rechts) auf dem Handy oberhalb des Bottom-Sheets halten
function sheetVar() {
  const p = $('#panel'),
    h = isMobile() && !sheetHidden() ? Math.max(0, window.innerHeight - p.getBoundingClientRect().top) : 0;
  document.documentElement.style.setProperty('--sheet-h', Math.round(h) + 'px');
}
if (window.ResizeObserver) new ResizeObserver(sheetVar).observe($('#panel'));
$('#panel').addEventListener('transitionend', sheetVar);
window.addEventListener('resize', sheetVar);
// Popups auf der Karte nicht unter dem Bottom-Sheet öffnen
function popupPad() {
  L.Popup.prototype.options.autoPanPaddingBottomRight = [20, isMobile() && !sheetHidden() ? $('#panel').offsetHeight + 12 : 20];
}
const curSheet = () => [...SHEET, 'hide'].find(x => $('#panel').classList.contains(x)) || 'half';
$('#fabMenu').onclick = () => setSheet(sheetHidden() ? lastSheet : 'hide');
// Breite der Seitenleiste (Laptop): am rechten Rand ziehen oder mit Pfeiltasten; wird gemerkt
(function () {
  const rz = $('#resizer'),
    root = document.documentElement;
  const setW = w => {
    w = Math.max(320, Math.min(Math.round(window.innerWidth * 0.7), 760, w));
    root.style.setProperty('--pw', w + 'px');
    try {
      localStorage.setItem('gp.ui.pw', w);
    } catch (e) {}
    return w;
  };
  // im breiten Reiseplan (body.tripwide): Höhe der Karte oben
  const setH = h => {
    h = Math.max(120, Math.min(Math.round(window.innerHeight - 160), h));
    root.style.setProperty('--mh', h + 'px');
    try {
      localStorage.setItem('gp.ui.mh', h);
    } catch (e) {}
    return h;
  };
  const wide = () => document.body.classList.contains('tripwide');
  try {
    const w = +localStorage.getItem('gp.ui.pw');
    if (w) root.style.setProperty('--pw', Math.max(320, Math.min(760, w)) + 'px');
    const h = +localStorage.getItem('gp.ui.mh');
    if (h) root.style.setProperty('--mh', Math.max(120, h) + 'px');
  } catch (e) {}
  let drag = false;
  rz.addEventListener('pointerdown', e => {
    drag = true;
    rz.classList.add('on');
    rz.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  rz.addEventListener('pointermove', e => {
    if (drag) wide() ? setH(e.clientY) : setW(e.clientX);
  });
  const end = () => {
    if (!drag) return;
    drag = false;
    rz.classList.remove('on');
    map.invalidateSize();
  };
  rz.addEventListener('pointerup', end);
  rz.addEventListener('pointercancel', end);
  rz.addEventListener('keydown', e => {
    if (wide() && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      setH($('#panel').getBoundingClientRect().top + (e.key === 'ArrowDown' ? 30 : -30));
      map.invalidateSize();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setW($('#panel').offsetWidth + (e.key === 'ArrowRight' ? 30 : -30));
      map.invalidateSize();
    }
  });
})();
let sheetDragged = false;
$('#handle').onclick = () => {
  if (sheetDragged) return;
  setSheet(SHEET[(SHEET.indexOf(curSheet()) + 1) % 3]);
};
// Ziehen am Griff oder an der Kopfzeile: Höhe folgt dem Finger, beim Loslassen auf min/halb/voll einrasten
(function () {
  const p = $('#panel');
  let d = null;
  const start = e => {
    // ziehen geht auch auf Reitern/Knöpfen im Kopf – der Klick danach wird verschluckt (siehe end)
    if (!isMobile() || e.target.closest('a, input, select')) return;
    d = { y: e.clientY, h: p.offsetHeight, t: Date.now(), moved: false, id: e.pointerId };
  };
  const move = e => {
    if (!d || e.pointerId !== d.id) return;
    const dy = d.y - e.clientY;
    if (!d.moved && Math.abs(dy) < 6) return;
    if (!d.moved) {
      d.moved = true;
      p.classList.add('dragging');
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch (x) {}
    }
    const vh = window.innerHeight;
    p.style.height = Math.max(90, Math.min(vh * 0.92, d.h + dy)) + 'px';
    e.preventDefault();
  };
  const end = e => {
    if (!d || e.pointerId !== d.id) return;
    const moved = d.moved,
      h0 = d.h;
    d = null;
    if (!moved) return;
    sheetDragged = true;
    setTimeout(() => (sheetDragged = false), 50);
    const eat = ev => {
      ev.stopPropagation();
      ev.preventDefault();
    }; // kein Reiterwechsel/Knopfdruck nach dem Ziehen
    window.addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', eat, true), 120);
    const h = p.offsetHeight,
      vh = window.innerHeight,
      v = h - h0;
    p.classList.remove('dragging');
    p.style.height = '';
    // Ziel: nächstgelegene Stufe; deutliche Bewegung nach oben/unten springt mindestens eine Stufe weiter
    const stops = { min: 128, half: vh * 0.42, full: vh * 0.9 };
    if (h < 100 && v < 0) {
      setSheet('hide');
      return;
    } // ganz nach unten gezogen → ausblenden
    let best = SHEET.reduce((a, k) => (Math.abs(stops[k] - h) < Math.abs(stops[a] - h) ? k : a), 'half');
    const cur = SHEET.indexOf(curSheet());
    if (best === curSheet() && Math.abs(v) > 40) best = SHEET[Math.max(0, Math.min(2, cur + (v > 0 ? 1 : -1)))];
    setSheet(best);
  };
  for (const el of [$('#handle'), $('#panelHead')]) {
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  window.addEventListener('resize', popupPad);
})();
