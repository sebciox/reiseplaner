/* Reiseplaner – Zwischenziele und Start/Ziel-Eingabe.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen. */
/* ---------- Zwischenziele (Sehenswürdigkeiten) ---------- */
let viaSeq = Date.now() % 1e6;
function renderVia() {
  const ul = $('#viaList');
  ul.innerHTML = state.via
    .map(
      (v, i) => `<li class="${v.kind === 'visit' ? 'visit' : v.kind === 'ferry' ? 'visit ferry' : ''}" data-vi="${i}">
    <button type="button" class="vgrip" data-vgrip="${i}" aria-label="${esc(v.label)} verschieben (ziehen oder Pfeiltasten)" title="ziehen zum Verschieben">
      <svg viewBox="0 0 12 20" width="12" height="20" aria-hidden="true" fill="currentColor"><circle cx="3" cy="4" r="1.6"/><circle cx="9" cy="4" r="1.6"/><circle cx="3" cy="10" r="1.6"/><circle cx="9" cy="10" r="1.6"/><circle cx="3" cy="16" r="1.6"/><circle cx="9" cy="16" r="1.6"/></svg></button>
    <span class="vn">${i + 1}</span>
    <div class="vt"><b>${esc(cleanLabel(v.label))}</b><div class="vopts">
      <select data-vkind="${i}" aria-label="Art des Zwischenziels"><option value="stay"${v.kind === 'stay' || !v.kind ? ' selected' : ''}>★ Übernachten in der Nähe</option><option value="rest"${v.kind === 'rest' ? ' selected' : ''}>Pause / freie Tage (nur Campingplatz)</option><option value="visit"${v.kind === 'visit' ? ' selected' : ''}>Besuch unterwegs</option><option value="ferry"${v.kind === 'ferry' ? ' selected' : ''}>⛴ Fähre ab hier</option></select>
      ${
        v.kind === 'ferry'
          ? `<label><input type="number" min="0.5" max="36" step="0.5" data-vhours="${i}" value="${+v.hours || 4}"> h Überfahrt</label></div>
        <div class="vferry">nach <input class="vfto" data-vfto="${i}" placeholder="Ankunftshafen, z. B. Malmö Hamn – Enter" enterkeyhint="enter" aria-label="Ankunftshafen" value="${v.to ? esc(cleanLabel(v.to.label)) : ''}">${v.to ? ' <span class="ok">✓</span>' : ' <span class="warnt">Ankunftshafen fehlt</span>'}`
          : v.kind !== 'visit'
            ? `<label><input type="number" min="1" max="30" data-vnights="${i}" value="${Math.max(1, +v.nights || 1)}"> Nächte</label>`
            : `<label><input type="number" min="0.5" max="12" step="0.5" data-vhours="${i}" value="${+v.hours || 2}"> h Besuch</label>`
      }</div>
      ${
        v.kind === 'stay' || !v.kind
          ? `<div class="vsights">${(v.sights || []).map((x, q) => `<span class="vchip">★ ${esc(shortLabel(x.label))}<button type="button" data-vsdel="${i}:${q}" aria-label="${esc(shortLabel(x.label))} entfernen">✕</button></span>`).join('')}
        <input class="vsin" data-vsadd="${i}" placeholder="+ weitere Sehenswürdigkeit hier (Basislager) – Enter" enterkeyhint="enter"></div>`
          : ''
      }</div>
    <div class="vbtns">${v.pin ? `<button type="button" data-vpin="${i}" class="pin-on" title="Platz festgelegt – Antippen löst die Festlegung" aria-label="Festlegung lösen">📌</button>` : ''}<button type="button" data-vdup="${i}" aria-label="duplizieren" title="Duplizieren – Kopie darunter, dann am Griff an ihren Platz ziehen (Fähre: Gegenrichtung)">${DUP_SVG}</button><button type="button" data-vdel="${i}" aria-label="entfernen" title="entfernen">✕</button></div></li>`
    )
    .join('');
  $('#viaTools').hidden = state.via.length < 2 && !(state.round && state.via.length);
  $('#viaOpt').hidden = state.via.length < 2;
  $('#viaBack').hidden = !state.round || !state.via.length;
  if (typeof renderPinboard === 'function') renderPinboard();
  $('#roundIn').checked = !!state.round;
  $('#dateIn').value = state.date || '';
  $('#retIn').value = state.ret || '';
  $('#retIn').min = state.date || '';
  $('#endIn').disabled = !!state.round;
  if (state.round) $('#endIn').value = state.start ? state.start.label : $('#startIn').value;
  const ch = () => {
    renderVia();
    renderMap();
  };
  ul.querySelectorAll('[data-vkind]').forEach(
    b =>
      (b.onchange = () => {
        const v = state.via[+b.dataset.vkind];
        v.kind = b.value;
        // Fähre: bleibt beim „Reihenfolge optimieren“ an ihrem Platz (📌), Dauer der Überfahrt statt Besuchsdauer
        if (v.kind === 'ferry') {
          v.pin = true;
          if (!v.hours || v.hours === 2) v.hours = 4;
        }
        ch();
        if (v.kind === 'ferry' && !v.to) setTimeout(() => $(`[data-vfto="${state.via.indexOf(v)}"]`)?.focus(), 0);
      })
  );
  ul.querySelectorAll('[data-vnights]').forEach(
    b =>
      (b.onchange = () => {
        state.via[+b.dataset.vnights].nights = Math.max(1, Math.round(+b.value) || 1);
      })
  );
  ul.querySelectorAll('[data-vpin]').forEach(
    b =>
      (b.onclick = () => {
        delete state.via[+b.dataset.vpin].pin;
        ch();
      })
  );
  ul.querySelectorAll('[data-vhours]').forEach(
    b =>
      (b.onchange = () => {
        const v = state.via[+b.dataset.vhours];
        v.hours = Math.max(0.5, Math.min(v.kind === 'ferry' ? 36 : 12, +b.value || 2));
      })
  );
  ul.querySelectorAll('[data-vsdel]').forEach(
    b =>
      (b.onclick = () => {
        const [i, q] = b.dataset.vsdel.split(':').map(Number);
        const [x] = state.via[i].sights.splice(q, 1);
        toPinboard(x);
        flash(`„${shortLabel(x.label)}“ liegt jetzt auf der Pinnwand (dort mit ✕ ganz entfernen).`);
        ch();
        touch();
      })
  );
  ul.querySelectorAll('[data-vsadd]').forEach(
    inp =>
      (inp.onkeydown = async e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const t = inp.value.trim(),
          v = state.via[+inp.dataset.vsadd];
        if (!t || !v) return;
        try {
          const r = await placeSearch(t, false);
          if (!r.length) throw new Error('Ort nicht gefunden: ' + t);
          const g = r[0];
          if (!g.full) flash(`„${t}“ nicht genau gefunden – „${shortLabel(g.label)}“ übernommen.`);
          (v.sights = v.sights || []).push({ uid: 's' + ++viaSeq, label: g.label, lat: g.lat, lon: g.lon });
          ch();
          fitGoals();
          enrichSight(v.sights[v.sights.length - 1]);
          setTimeout(() => $(`[data-vsadd="${state.via.indexOf(v)}"]`)?.focus(), 0);
        } catch (err) {
          setStatus(err.message, 'error');
        }
      })
  );
  // Fähre: Ankunftshafen suchen (Enter oder Feld verlassen)
  ul.querySelectorAll('[data-vfto]').forEach(inp => {
    const go = async () => {
      const t = inp.value.trim(),
        v = state.via[+inp.dataset.vfto];
      if (!t || !v || (v.to && cleanLabel(v.to.label) === t)) return;
      try {
        const r = await placeSearch(t, false);
        if (!r.length) throw new Error('Hafen nicht gefunden: ' + t);
        const g = r[0];
        if (!g.full) flash(`„${t}“ nicht genau gefunden – „${shortLabel(g.label)}“ übernommen.`);
        v.to = { lat: g.lat, lon: g.lon, label: g.label };
        ch();
        fitGoals();
      } catch (err) {
        setStatus(err.message, 'error');
      }
    };
    inp.onkeydown = e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      go();
    };
    inp.onchange = go;
  });
  ul.querySelectorAll('[data-vgrip]').forEach(g => {
    // Tastatur: Pfeil hoch/runter verschiebt (für alle ohne Maus/Finger)
    g.onkeydown = e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const i = +g.dataset.vgrip,
        j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j < 0 || j >= state.via.length) return;
      moveVia(i, j);
      setTimeout(() => $(`[data-vgrip="${j}"]`)?.focus(), 0);
    };
    g.onpointerdown = e => startViaDrag(e, g);
  });
  ul.querySelectorAll('[data-vdup]').forEach(
    b =>
      (b.onclick = () => {
        const i = +b.dataset.vdup,
          v = state.via[i],
          c = viaCopy(v);
        state.via.splice(i + 1, 0, c);
        ch();
        touch();
        flash(
          v.kind === 'ferry'
            ? `Fähre in Gegenrichtung (${shortLabel(c.label)} → ${shortLabel(c.to.label)}) eingefügt – am Griff ⠿ an ihren Platz ziehen.`
            : `Kopie von „${shortLabel(v.label)}“ eingefügt – am Griff ⠿ an ihren Platz ziehen.`
        );
      })
  );
  ul.querySelectorAll('[data-vdel]').forEach(
    b =>
      (b.onclick = () => {
        // Basislager/Besuch auflösen: Orte zurück auf die Pinnwand (nichts geht verloren), Campingplatz/Fähre einfach weg
        const [v] = state.via.splice(+b.dataset.vdel, 1);
        if (v.kind === 'stay' || !v.kind || v.kind === 'visit') {
          [v, ...(v.sights || [])].forEach(toPinboard);
          const n = 1 + (v.sights || []).length;
          flash(
            `„${shortLabel(v.label)}“${n > 1 ? ` und ${n - 1} weitere` : ''} ${n > 1 ? 'liegen' : 'liegt'} jetzt auf der Pinnwand (dort mit ✕ ganz entfernen).`
          );
        }
        ch();
        touch();
      })
  );
}
const DUP_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></svg>';
// Kopie eines Zwischenziels (Rückweg): neue uid, ohne eigene Einträge und ohne weitere Sehenswürdigkeiten
// (die besucht man nicht zweimal); Fähre in Gegenrichtung. Kopien bekommen 📌 (bleiben beim Optimieren an ihrem Platz).
function viaCopy(v) {
  const c = { uid: 'v' + ++viaSeq, label: v.label, lat: v.lat, lon: v.lon, kind: v.kind || 'stay', pin: true };
  if (v.nights) c.nights = v.nights;
  if (v.hours) c.hours = v.hours;
  if (v.kind === 'ferry' && v.to) Object.assign(c, { label: v.to.label, lat: v.to.lat, lon: v.to.lon, to: { lat: v.lat, lon: v.lon, label: v.label } });
  else if (v.info) c.info = v.info;
  return c;
}
// Rundreise: die ersten k Stationen (Anreise) in umgekehrter Reihenfolge ans Ende kopieren, Fähren in Gegenrichtung
async function backWay() {
  const P = state.via;
  if (!P.length) return;
  // Vorschlag = Anreise: Fähren und Pause-Plätze am Anfang (bis zum ersten ★-Ziel oder Besuch – die besucht man nicht zweimal)
  const first = P.findIndex(v => v.kind !== 'ferry' && v.kind !== 'rest');
  const sugg = first > 0 ? first : 1,
    max = Math.min(P.length, 6);
  const btns = [];
  for (let k = 1; k <= max; k++)
    btns.push({ v: String(k), label: k === 1 ? `nur 1. ${shortLabel(P[0].label)}` : `1–${k} (bis ${shortLabel(P[k - 1].label)})`, primary: k === sugg });
  btns.push({ v: '', label: 'Abbrechen' });
  const r = await askChoice(
    'Hinweg als Rückweg',
    'Welche Stationen vom Anfang der Reise sollen auf dem Rückweg noch einmal angefahren werden? Sie kommen in umgekehrter Reihenfolge ans Ende, Fähren in Gegenrichtung.',
    btns
  );
  const k = +r;
  if (!k) return;
  state.via.push(...P.slice(0, k).reverse().map(viaCopy));
  renderVia();
  renderMap();
  touch();
  flash(`${k} ${k === 1 ? 'Station' : 'Stationen'} als Rückweg ans Ende gesetzt.`);
}
// Ziel von Position i nach j verschieben; das verschobene Ziel behält beim Optimieren seinen Platz (📌)
function moveVia(i, j) {
  if (i === j) return;
  const [v] = state.via.splice(i, 1);
  state.via.splice(j, 0, v);
  v.pin = true;
  renderVia();
  renderMap();
}
// Drag & Drop am Griff (Maus und Finger): Eintrag folgt dem Zeiger, beim Loslassen einsortieren
function startViaDrag(e, grip) {
  const ul = $('#viaList'),
    sc = $('#scroll'),
    li = grip.closest('li'),
    i = +grip.dataset.vgrip;
  const items = [...ul.children],
    mids = items.map(x => x.offsetTop + x.offsetHeight / 2); // relativ zur Liste
  const y0 = e.clientY,
    s0 = sc.scrollTop;
  let target = i,
    moved = false,
    lastY = e.clientY,
    raf = 0,
    active = true;
  grip.setPointerCapture(e.pointerId);
  e.preventDefault();
  const update = () => {
    const dy = lastY - y0 + (sc.scrollTop - s0);
    if (Math.abs(dy) > 4) moved = true;
    li.classList.add('dragging');
    li.style.transform = `translateY(${dy}px)`;
    const y = mids[i] + dy;
    target = mids.filter((m, k) => k !== i && m < y).length;
    items.forEach((x, k) => x.classList.toggle('drop-before', k !== i && k === (target >= i ? target + 1 : target)));
    ul.classList.toggle('drop-end', target === items.length - 1 && target !== i);
  };
  // Am oberen/unteren Rand der Leiste automatisch weiterscrollen
  const tick = () => {
    if (!active) return;
    const r = sc.getBoundingClientRect(),
      edge = 50;
    const v = lastY > r.bottom - edge ? Math.min(20, (lastY - (r.bottom - edge)) / 2) : lastY < r.top + edge ? -Math.min(20, (r.top + edge - lastY) / 2) : 0;
    if (v) {
      sc.scrollTop += v;
      update();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const move = ev => {
    lastY = ev.clientY;
    update();
  };
  const up = () => {
    active = false;
    cancelAnimationFrame(raf);
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', up);
    items.forEach(x => x.classList.remove('drop-before'));
    ul.classList.remove('drop-end');
    li.classList.remove('dragging');
    li.style.transform = '';
    if (moved) moveVia(i, target);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
}
// Karte folgt der Eingabe: solange noch keine Strecke berechnet ist (oder Reiter 1 offen), alle eingegebenen Orte zeigen
function fitGoals() {
  if ((state.overview || state.stages.length) && uiTab !== 'goals') return;
  const pts = [
    state.start,
    ...state.via.flatMap(v => [v, v.kind === 'ferry' ? v.to : null, ...(v.sights || [])]),
    ...(state.ideas || []),
    state.round ? null : state.end
  ]
    .filter(p => p && p.lat != null)
    .map(p => [p.lat, p.lon]);
  if (!pts.length) return;
  if (pts.length === 1) map.flyTo(pts[0], Math.max(Math.min(map.getZoom(), 9), 7), { duration: 0.6 });
  else map.flyToBounds(L.latLngBounds(pts).pad(0.12), { ...sheetPad(), maxZoom: 9, duration: 0.6 });
}
function addVia(g) {
  if (!g) return;
  const dup = state.via.find(v => v.label === g.label && Math.abs(v.lat - g.lat) < 1e-4 && Math.abs(v.lon - g.lon) < 1e-4);
  // gleicher Ort noch einmal (z. B. Rückweg über denselben Hafen) – nur nach Rückfrage
  if (dup && !confirm(`„${shortLabel(g.label)}“ ist schon in der Reise.\n\nTrotzdem noch einmal hinzufügen (z. B. für den Rückweg)?`)) {
    $('#viaIn').value = '';
    $('#viaSugg').innerHTML = '';
    return;
  }
  state.via.push({ uid: 'v' + ++viaSeq, label: g.label, lat: g.lat, lon: g.lon, kind: g.camp ? 'rest' : 'stay', nights: 1 });
  if (g.camp)
    flash(`⛺ „${shortLabel(g.label)}“ ist ein Campingplatz – als Zwischenstopp „Pause / freie Tage“ eingetragen; er steht bei der Platzwahl ganz oben.`);
  $('#viaIn').value = '';
  $('#viaSugg').innerHTML = '';
  renderVia();
  renderMap();
  fitGoals();
  if (!g.camp) enrichSight(state.via[state.via.length - 1]); // Website/Öffnungszeiten aus OSM im Hintergrund
}
// Reihenfolge mit der kürzesten Gesamtstrecke (Luftlinie; bis 8 Ziele exakt, sonst Nächster Nachbar + 2-opt)
async function optimizeVia() {
  const P = state.via;
  if (P.length < 2) return;
  // Start und Ziel werden gebraucht, damit die Reihenfolge zum Anfang und Ende passt
  try {
    if (!state.start) state.start = await geocodeFirst($('#startIn').value);
    if (!state.round && !state.end) state.end = await geocodeFirst($('#endIn').value);
  } catch (e) {
    setStatus(e.message, 'error');
    return;
  }
  const S = state.start,
    E = state.round ? S : state.end;
  const d = (a, b) => (a && b ? hav([a.lat, a.lon], [b.lat, b.lon]) : 0);
  const cost = o => {
    let c = d(S, P[o[0]]);
    for (let i = 1; i < o.length; i++) c += d(P[o[i - 1]], P[o[i]]);
    return c + d(P[o[o.length - 1]], E);
  };
  // Manuell verschobene Ziele (📌) bleiben an ihrer Position, nur die übrigen werden auf die freien Plätze verteilt
  const free = P.map((v, i) => (v.pin ? -1 : i)).filter(i => i >= 0);
  const slots = free.slice();
  const build = arr => {
    const o = P.map((_, i) => i);
    slots.forEach((sl, k) => {
      o[sl] = arr[k];
    });
    return o;
  };
  let bestF = free.slice(),
    bc = cost(build(bestF));
  if (free.length <= 8) {
    const perm = (arr, l) => {
      if (l === arr.length) {
        const c = cost(build(arr));
        if (c < bc) {
          bc = c;
          bestF = arr.slice();
        }
        return;
      }
      for (let i = l; i < arr.length; i++) {
        [arr[l], arr[i]] = [arr[i], arr[l]];
        perm(arr, l + 1);
        [arr[l], arr[i]] = [arr[i], arr[l]];
      }
    };
    perm(free.slice(), 0);
  } else {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < bestF.length - 1; i++)
        for (let j = i + 1; j < bestF.length; j++) {
          const a = bestF.slice();
          [a[i], a[j]] = [a[j], a[i]];
          const c = cost(build(a));
          if (c < bc - 1) {
            bestF = a;
            bc = c;
            improved = true;
          }
        }
    }
  }
  state.via = build(bestF).map(i => P[i]);
  const np = P.filter(v => v.pin).length;
  renderVia();
  renderMap();
  flash(
    'Reihenfolge optimiert (kürzeste Gesamtstrecke, Luftlinie)' +
      (np ? ` – ${np} festgelegte${np === 1 ? 's Ziel bleibt' : ' Ziele bleiben'} an ${np === 1 ? 'seinem' : 'ihrem'} Platz.` : '.')
  );
}
(function () {
  // last/lastQ: Vorschläge und der Suchtext, zu dem sie gehören (Enter nimmt den ersten Vorschlag nur, wenn er
  // zum aktuellen Text passt – sonst würde nach schnellem Tippen der Treffer des vorigen Ziels erneut eingefügt)
  const inp = $('#viaIn'),
    list = $('#viaSugg');
  let last = [],
    lastQ = '';
  const search = debounce(async () => {
    const t = inp.value.trim();
    if (t.length < 3 || (!settings.key && !useFallback)) {
      list.innerHTML = '';
      return;
    }
    try {
      if (list.querySelector('.sugghead') && lastQ === t) return; // Auswahl nach Enter steht schon
      const r = await placeSearch(t, true);
      if (inp.value.trim() !== t || document.activeElement !== inp || (list.querySelector('.sugghead') && lastQ === t)) return;
      last = r;
      lastQ = t;
      showSugg(r);
    } catch (e) {
      list.innerHTML = '';
    }
  }, 450);
  function showSugg(r, head) {
    list.innerHTML = (head ? `<li class="sugghead">${head}</li>` : '') + suggHtml(r);
    list.querySelectorAll('button').forEach(
      b =>
        (b.onclick = () => {
          addVia(r[+b.dataset.i]);
          last = [];
          lastQ = '';
        })
    );
  }
  inp.addEventListener('input', search);
  inp.addEventListener('blur', () =>
    setTimeout(() => {
      if (!list.querySelector('.sugghead')) list.innerHTML = '';
    }, 200)
  );
  document.addEventListener('pointerdown', e => {
    if (list.querySelector('.sugghead') && !e.target.closest('.viaadd')) list.innerHTML = '';
  });
  let adding = false;
  // Enter/„+ Hinzufügen“: nur ein Treffer mit allen Suchwörtern wird direkt übernommen, sonst Auswahl zeigen
  // (z. B. „Hultsfred Strandcamping“ → nicht still die Ortschaft „Hultsfred“ eintragen)
  window.addViaFromInput = async () => {
    const t = inp.value.trim();
    if (!t || adding) return;
    adding = true;
    try {
      const r = last.length && lastQ === t ? last : await placeSearch(t, false);
      if (!r.length) throw new Error('Ort nicht gefunden: ' + t);
      if (r[0].full) {
        addVia(r[0]);
        last = [];
        lastQ = '';
      } else {
        last = r;
        lastQ = t;
        showSugg(r, `„${esc(t)}“ nicht genau gefunden – bitte auswählen:`);
      }
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      adding = false;
    }
    inp.focus();
  };
  inp.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addViaFromInput();
  });
  $('#viaAddBtn').onclick = () => addViaFromInput();
  $('#viaOpt').onclick = optimizeVia;
  $('#viaBack').onclick = backWay;
  $('#roundIn').onchange = () => {
    state.round = $('#roundIn').checked;
    if (state.round) state.end = null;
    renderVia();
    renderPanel();
  };
  // Abfahrt verschoben → Rückkehr um dieselben Tage mitverschieben (Reisedauer bleibt); nie vor der Abfahrt
  const dayMs = 864e5,
    dd = s => Date.parse(s + 'T12:00:00Z'),
    iso = t => new Date(t).toISOString().slice(0, 10);
  $('#dateIn').onchange = () => {
    const old = state.date,
      d = $('#dateIn').value || null;
    state.date = d;
    if (d && state.ret) {
      if (old) state.ret = iso(dd(state.ret) + Math.round((dd(d) - dd(old)) / dayMs) * dayMs);
      if (state.ret < d) state.ret = d;
    }
    touch();
    renderVia();
    renderPanel();
  };
  // Leeres Rückkehrfeld: beim Antippen vorübergehend die Abfahrt eintragen, damit der Kalender dort aufgeht
  const retIn = $('#retIn'),
    preset = () => {
      if (!state.ret && state.date && !retIn.value) retIn.value = state.date;
    };
  retIn.addEventListener('pointerdown', preset);
  retIn.addEventListener('focus', preset);
  retIn.addEventListener('blur', () => {
    if (!state.ret) retIn.value = '';
  });
  $('#retIn').onchange = () => {
    let r = $('#retIn').value || null;
    if (r && state.date && r < state.date) {
      r = state.date;
      flash('Das Reiseende kann nicht vor dem Reisebeginn liegen – auf den Reisebeginn gesetzt.');
    }
    state.ret = r;
    touch();
    renderVia();
    renderPanel();
  };
})();

/* ---------- Eingabe Start/Ziel ---------- */
function setupGeoInput(inp, list, key) {
  const search = debounce(async () => {
    const t = inp.value.trim();
    if (t.length < 3 || (!settings.key && !useFallback)) {
      list.innerHTML = '';
      return;
    }
    try {
      const r = await geocode(t, 6, true);
      if (inp.value.trim() !== t || document.activeElement !== inp) return;
      list.innerHTML = r.map((g, i) => `<li><button type="button" data-i="${i}">${esc(g.label)}</button></li>`).join('');
      list.querySelectorAll('button').forEach(
        b =>
          (b.onclick = () => {
            state[key] = r[+b.dataset.i];
            inp.value = state[key].label;
            list.innerHTML = '';
            if (key === 'start' && state.round) state.end = null;
            renderVia();
            renderMap();
            fitGoals();
          })
      );
    } catch (e) {
      list.innerHTML = '';
    }
  }, 450);
  inp.addEventListener('input', () => {
    state[key] = null;
    search();
  });
  inp.addEventListener('blur', () => setTimeout(() => (list.innerHTML = ''), 200));
}
setupGeoInput($('#startIn'), $('#startSugg'), 'start');
setupGeoInput($('#endIn'), $('#endSugg'), 'end');

$('#planForm').addEventListener('submit', e => {
  e.preventDefault();
  const ae = document.activeElement;
  if (ae && ae.id === 'viaIn') {
    if (ae.value.trim()) addViaFromInput();
    return;
  }
  if (ae && (ae.classList.contains('vsin') || ae.classList.contains('vfto') || ae.id === 'pinIn')) return;
  const nf = state.via.find(v => v.kind === 'ferry' && !v.to);
  if (nf) {
    setStatus(`Fähre ab „${shortLabel(nf.label)}“: bitte den Ankunftshafen eintragen.`, 'error');
    $(`[data-vfto="${state.via.indexOf(nf)}"]`)?.focus();
    return;
  }
  if (
    !settings.key &&
    !useFallback &&
    !confirm(
      'Kein OpenRouteService-Schlüssel eingetragen.\n\nOK = kostenlosen Ersatzdienst (OSRM/Photon) für diese Sitzung verwenden\nAbbrechen = Schlüssel eintragen'
    )
  ) {
    openSettings();
    return;
  }
  if (!settings.key) {
    useFallback = true;
    renderFallbackNote();
  }
  const keep = snapshotKeep();
  setTab('plan');
  run(async () => {
    setStatus('Orte werden gesucht …', 'busy');
    if (!state.start) state.start = await geocodeFirst($('#startIn').value);
    if (state.round) state.end = { ...state.start };
    else if (!state.end) state.end = await geocodeFirst($('#endIn').value);
    $('#startIn').value = state.start.label;
    $('#endIn').value = state.end.label;
    await computeOverview();
    const kn = applyKeep(keep);
    if (kn) {
      renderAll();
      flash(`${kn} unveränderte${kn === 1 ? 'r Abschnitt wird' : ' Abschnitte werden'} mit den bisherigen Plätzen übernommen.`);
    }
    if (window.innerWidth < 900) setSheet('half');
  });
});
