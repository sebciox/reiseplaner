/* Reiseplaner – Pinnwand: Ideen (Sehenswürdigkeiten) sammeln, die App schlägt daraus Basislager vor.
   Klassisches Skript (kein ES-Modul): alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in index.html
   in fester Reihenfolge geladen – Code auf oberster Ebene darf nur Dinge aus früheren Dateien benutzen.

   Gerüst (Sebastian, Nov. 2026): Rundreise = erst Ideen sammeln, dann Basislager bilden; Anreise = Etappenplanung wie bisher.
   state.ideas = Ideen ohne Zuordnung [{uid, label, lat, lon, info}]. Basislager = Zwischenziel „★ Übernachten in der Nähe“
   (state.via, kind 'stay') mit weiteren Sehenswürdigkeiten (via.sights). Ein Basislager auflösen (✕) oder eine
   Sehenswürdigkeit dort entfernen legt sie zurück auf die Pinnwand – es geht nichts verloren. */
const PIN_NEAR = 40; // km: Idee gehört zu einem bestehenden Basislager, wenn sie so nah an dessen Mitte liegt
const PIN_SPAN = 70; // km: größter Abstand zweier Ideen in einem neuen Basislager (Tagesausflug ohne Wohnwagen)
let pinProp = null; // Vorschlag {groups: [{key, base (via-uid) | null, nights}], pick: {ideaUid: groupKey | 'visit' | 'keep'}}
let pinOpen = null; // Ideen-Ablage auf/zu (null = automatisch: offen, sobald es Ideen gibt)

const pinKm = (a, b) => hav([a.lat, a.lon], [b.lat, b.lon]) / 1000;
const pinMid = pts => ({ lat: pts.reduce((s, p) => s + +p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + +p.lon, 0) / pts.length });
const pinLetter = k => String.fromCharCode(65 + k);
const bases = () => state.via.filter(v => (v.kind || 'stay') === 'stay');
const baseMid = v => pinMid([v, ...(v.sights || [])]);
const ideaPt = x => ({ uid: x.uid, label: x.label, lat: x.lat, lon: x.lon, ...(x.info ? { info: x.info } : {}), ...(x.my ? { my: x.my } : {}) });

// Idee zurück auf die Pinnwand (aus einem Basislager oder Besuch) – doppelte werden nicht zweimal abgelegt
function toPinboard(x) {
  if (!x || x.lat == null) return;
  state.ideas = state.ideas || [];
  if (state.ideas.some(y => y.uid === x.uid || (Math.abs(y.lat - x.lat) < 1e-4 && Math.abs(y.lon - x.lon) < 1e-4))) return;
  state.ideas.push(ideaPt({ ...x, uid: x.uid || 'i' + ++viaSeq }));
  pinProp = null;
}
function addIdea(g) {
  if (!g) return;
  state.ideas = state.ideas || [];
  const same = y => Math.abs(y.lat - g.lat) < 1e-4 && Math.abs(y.lon - g.lon) < 1e-4;
  if (state.ideas.some(same) || state.via.some(v => same(v) || (v.sights || []).some(same))) {
    flash(`„${shortLabel(g.label)}“ ist schon eingeplant oder auf der Pinnwand.`);
    return;
  }
  const x = { uid: 'i' + ++viaSeq, label: g.label, lat: g.lat, lon: g.lon };
  state.ideas.push(x);
  pinProp = null;
  renderPinboard();
  renderMap();
  fitGoals();
  touch();
  enrichSight(x); // Website/Öffnungszeiten aus OSM im Hintergrund
}

/* ---------- Vorschlag: Ideen → Basislager ---------- */
function proposeBases() {
  const ideas = state.ideas || [];
  if (!ideas.length) return null;
  const pick = {},
    groups = [];
  // 1. Ideen nahe einem bestehenden Basislager → dorthin
  const old = bases().map(v => ({ v, m: baseMid(v) }));
  const rest = [];
  ideas.forEach(x => {
    let best = null;
    old.forEach(o => {
      const d = pinKm(x, o.m);
      if (d <= PIN_NEAR && (!best || d < best.d)) best = { o, d };
    });
    if (best) {
      let g = groups.find(y => y.base === best.o.v.uid);
      if (!g) groups.push((g = { key: 'b' + best.o.v.uid, base: best.o.v.uid }));
      pick[x.uid] = g.key;
    } else rest.push(x);
  });
  // 2. Übrige Ideen: zusammenfassen, solange der größte Abstand innerhalb einer Gruppe ≤ PIN_SPAN bleibt (complete linkage)
  let cl = rest.map(x => [x]);
  const span = (a, b) => Math.max(...a.flatMap(p => b.map(q => pinKm(p, q))));
  for (;;) {
    let bi = -1,
      bj = -1,
      bd = Infinity;
    for (let i = 0; i < cl.length; i++)
      for (let j = i + 1; j < cl.length; j++) {
        const d = span(cl[i], cl[j]);
        if (d < bd) [bi, bj, bd] = [i, j, d];
      }
    if (bi < 0 || bd > PIN_SPAN) break;
    cl[bi] = cl[bi].concat(cl[bj]);
    cl.splice(bj, 1);
  }
  cl.forEach(c => {
    const g = { key: 'n' + ++viaSeq, base: null, nights: Math.min(7, Math.max(2, c.length + 1)) };
    groups.push(g);
    c.forEach(x => (pick[x.uid] = g.key));
  });
  return { groups, pick };
}
// Neues Basislager: Hauptort = Idee mit der kleinsten Entfernung zu allen anderen (liegt „in der Mitte“)
function groupMain(list) {
  let best = list[0],
    bs = Infinity;
  list.forEach(a => {
    const s = list.reduce((t, b) => t + pinKm(a, b), 0);
    if (s < bs) [best, bs] = [a, s];
  });
  return best;
}
const groupIdeas = key => (state.ideas || []).filter(x => pinProp && pinProp.pick[x.uid] === key);
// Neues Zwischenziel dort einfügen, wo es den kleinsten Umweg macht (Luftlinie); Reihenfolge der übrigen bleibt
function insertCheapest(v) {
  const S = state.start,
    E = state.round ? state.start : state.end;
  const pts = [S, ...state.via, E];
  let at = state.via.length,
    best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i],
      b = pts[i + 1];
    if (!a && !b) continue;
    const d = (a ? pinKm(a, v) : 0) + (b ? pinKm(v, b) : 0) - (a && b ? pinKm(a, b) : 0);
    if (d < best) [best, at] = [d, i];
  }
  state.via.splice(at, 0, v);
}
function applyProposal() {
  if (!pinProp) return;
  const used = new Set();
  let nNew = 0,
    nAdd = 0,
    nVis = 0;
  pinProp.groups.forEach(g => {
    const list = groupIdeas(g.key);
    if (!list.length) return;
    list.forEach(x => used.add(x.uid));
    const base = g.base && state.via.find(v => v.uid === g.base);
    if (base) {
      base.sights = (base.sights || []).concat(list.map(ideaPt));
      nAdd += list.length;
      return;
    }
    const m = groupMain(list);
    insertCheapest({
      ...ideaPt(m),
      uid: 'v' + ++viaSeq,
      kind: 'stay',
      nights: g.nights || 2,
      sights: list.filter(x => x !== m).map(ideaPt)
    });
    nNew++;
  });
  (state.ideas || [])
    .filter(x => pinProp.pick[x.uid] === 'visit')
    .forEach(x => {
      used.add(x.uid);
      insertCheapest({ ...ideaPt(x), uid: 'v' + ++viaSeq, kind: 'visit', hours: 2 });
      nVis++;
    });
  state.ideas = (state.ideas || []).filter(x => !used.has(x.uid));
  pinProp = null;
  renderVia();
  renderPinboard();
  renderMap();
  fitGoals();
  touch();
  const t = [
    nNew && `${nNew} ${nNew === 1 ? 'Basislager' : 'Basislager'} angelegt`,
    nAdd && `${nAdd} zu bestehenden Basislagern`,
    nVis && `${nVis} als Besuch unterwegs`
  ]
    .filter(Boolean)
    .join(', ');
  flash(`${t || 'Nichts übernommen'} – Nächte und Reihenfolge unten bei den Zwischenzielen prüfen, dann „Strecke berechnen“.`);
}

/* ---------- Anzeige ---------- */
// Neue Basislager heißen A, B, C … (bestehende zählen nicht mit)
const newLetter = g => pinLetter(pinProp.groups.filter(y => !y.base).indexOf(g));
function groupName(g) {
  const base = g.base && state.via.find(v => v.uid === g.base);
  if (base) return `zu Basislager ${shortLabel(base.label)}`;
  const list = groupIdeas(g.key);
  return `Neues Basislager ${newLetter(g)}${list.length ? ' bei ' + shortLabel(groupMain(list).label) : ''}`;
}
function propHtml() {
  if (!pinProp) return '';
  const opts = cur =>
    pinProp.groups.map(g => `<option value="${g.key}"${cur === g.key ? ' selected' : ''}>${esc(groupName(g))}</option>`).join('') +
    `<option value="new"${cur === 'new' ? ' selected' : ''}>eigenes neues Basislager</option><option value="visit"${cur === 'visit' ? ' selected' : ''}>Besuch unterwegs</option><option value="keep"${cur === 'keep' ? ' selected' : ''}>auf der Pinnwand lassen</option>`;
  const row = x =>
    `<li><span class="pn">${esc(shortLabel(x.label))}</span><select data-pinpick="${esc(x.uid)}" aria-label="Zuordnung von ${esc(shortLabel(x.label))}">${opts(pinProp.pick[x.uid])}</select></li>`;
  const cards = pinProp.groups
    .map(g => {
      const list = groupIdeas(g.key);
      if (!list.length) return '';
      const nights = g.base
        ? ''
        : `<span class="nstep pnights"><button type="button" data-pinn="${g.key}" data-d="-1" aria-label="eine Nacht weniger" ${g.nights <= 1 ? 'disabled' : ''}>−</button><span>${g.nights} ${g.nights === 1 ? 'Nacht' : 'Nächte'}</span><button type="button" data-pinn="${g.key}" data-d="1" aria-label="eine Nacht mehr">+</button></span>`;
      return `<div class="pgroup"><div class="pghead"><span class="pglet">${g.base ? '★' : newLetter(g)}</span><b>${esc(groupName(g))}</b>${nights}</div><ul>${list.map(row).join('')}</ul></div>`;
    })
    .join('');
  const other = (state.ideas || []).filter(x => ['visit', 'keep'].includes(pinProp.pick[x.uid]));
  return `<div class="pinprop"><div class="pphead">Vorschlag – Zuordnung bei Bedarf ändern:</div>${cards}${
    other.length ? `<div class="pgroup other"><div class="pghead"><b>Unterwegs / Pinnwand</b></div><ul>${other.map(row).join('')}</ul></div>` : ''
  }<div class="actions"><button class="btn primary small" type="button" id="pinApply">Übernehmen</button><button class="btn small" type="button" id="pinCancel">Verwerfen</button></div></div>`;
}
function renderPinboard() {
  const ul = $('#pinList');
  if (!ul) return;
  const ideas = state.ideas || [];
  ul.innerHTML = ideas
    .map(x => {
      const near = bases()
        .map(v => ({ v, d: pinKm(x, baseMid(v)) }))
        .sort((a, b) => a.d - b.d)[0];
      const hint = near && near.d <= PIN_NEAR ? `<span class="muted"> · ${fkm1(near.d * 1000)} von ${esc(shortLabel(near.v.label))}</span>` : '';
      return `<li data-pindrag="${esc(x.uid)}" title="auf eine Station ziehen"><span class="pn">${esc(shortLabel(x.label))}</span>${hint}<button type="button" data-pindel="${esc(x.uid)}" aria-label="${esc(shortLabel(x.label))} entfernen" title="von der Pinnwand entfernen">✕</button></li>`;
    })
    .join('');
  $('#pinCount').textContent = ideas.length ? `(${ideas.length})` : '';
  // eingeklappt, solange leer (antippen öffnet); mit Ideen offen, außer selbst zugeklappt
  const open = pinOpen ?? ideas.length > 0;
  $('#pinField').classList.toggle('closed', !open);
  $('#pinTog').setAttribute('aria-expanded', open);
  $('#pinTog .tri').textContent = open ? '▾' : '▸';
  $('#pinHint').hidden = !ideas.length || !!pinProp;
  $('#pinSuggest').hidden = !ideas.length || !!pinProp;
  $('#pinProp').innerHTML = propHtml();
}
$('#pinField').addEventListener('click', e => {
  if (e.target.closest('#pinTog')) {
    pinOpen = !(pinOpen ?? (state.ideas || []).length > 0);
    renderPinboard();
    if (pinOpen) $('#pinIn').focus();
    return;
  }
  const del = e.target.closest('[data-pindel]');
  if (del) {
    state.ideas = (state.ideas || []).filter(x => x.uid !== del.dataset.pindel);
    pinProp = null;
    renderPinboard();
    renderMap();
    touch();
    return;
  }
  if (e.target.closest('#pinSuggest')) {
    pinProp = proposeBases();
    renderPinboard();
    renderMap();
    return;
  }
  const nb = e.target.closest('[data-pinn]');
  if (nb && pinProp) {
    const g = pinProp.groups.find(y => y.key === nb.dataset.pinn);
    if (g) g.nights = Math.max(1, Math.min(30, g.nights + +nb.dataset.d));
    renderPinboard();
    return;
  }
  if (e.target.closest('#pinApply')) return applyProposal();
  if (e.target.closest('#pinCancel')) {
    pinProp = null;
    renderPinboard();
    renderMap();
  }
});
$('#pinField').addEventListener('change', e => {
  const s = e.target.closest('[data-pinpick]');
  if (!s || !pinProp) return;
  let v = s.value;
  if (v === 'new') {
    const g = { key: 'n' + ++viaSeq, base: null, nights: 2 };
    pinProp.groups.push(g);
    v = g.key;
  }
  pinProp.pick[s.dataset.pinpick] = v;
  renderPinboard();
  renderMap();
});
// Karte: Ideen als eigene Punkte; während eines Vorschlags mit dem Buchstaben ihres Basislagers
function drawIdeas(layer) {
  (state.ideas || []).forEach(x => {
    const p = pinProp && pinProp.pick[x.uid],
      k = pinProp ? pinProp.groups.findIndex(g => g.key === p) : -1,
      g = k >= 0 ? pinProp.groups[k] : null;
    const txt = g ? (g.base ? '★' : newLetter(g)) : p === 'visit' ? '•' : '?';
    L.marker([x.lat, x.lon], { icon: pinIcon(txt, 'idea'), zIndexOffset: -150 })
      .bindPopup(() => `<b>${esc(shortLabel(x.label))}</b><br><span class="muted">Idee auf der Pinnwand – noch keinem Basislager zugeordnet</span>`)
      .addTo(layer);
  });
}
// Eingabe: wie bei den Zwischenzielen (Enter übernimmt nur einen Treffer mit allen Suchwörtern, sonst Auswahl)
(function () {
  const inp = $('#pinIn'),
    list = $('#pinSugg');
  let last = [],
    lastQ = '',
    adding = false;
  const show = (r, head) => {
    list.innerHTML = (head ? `<li class="sugghead">${head}</li>` : '') + suggHtml(r);
    list.querySelectorAll('button').forEach(
      b =>
        (b.onclick = () => {
          addIdea(r[+b.dataset.i]);
          inp.value = '';
          list.innerHTML = '';
          last = [];
          lastQ = '';
          inp.focus();
        })
    );
  };
  const search = debounce(async () => {
    const t = inp.value.trim();
    if (t.length < 3 || (!settings.key && !useFallback)) {
      list.innerHTML = '';
      return;
    }
    try {
      if (list.querySelector('.sugghead') && lastQ === t) return;
      const r = await placeSearch(t, true);
      if (inp.value.trim() !== t || document.activeElement !== inp) return;
      last = r;
      lastQ = t;
      show(r);
    } catch (e) {
      list.innerHTML = '';
    }
  }, 450);
  const add = async () => {
    const t = inp.value.trim();
    if (!t || adding) return;
    adding = true;
    try {
      const r = last.length && lastQ === t ? last : await placeSearch(t, false);
      if (!r.length) throw new Error('Ort nicht gefunden: ' + t);
      if (r[0].full) {
        addIdea(r[0]);
        inp.value = '';
        list.innerHTML = '';
        last = [];
        lastQ = '';
      } else {
        last = r;
        lastQ = t;
        show(r, `„${esc(t)}“ nicht genau gefunden – bitte auswählen:`);
      }
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      adding = false;
    }
    inp.focus();
  };
  inp.addEventListener('input', search);
  inp.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    add();
  });
  inp.addEventListener('blur', () =>
    setTimeout(() => {
      if (!list.querySelector('.sugghead')) list.innerHTML = '';
    }, 200)
  );
  document.addEventListener('pointerdown', e => {
    if (list.querySelector('.sugghead') && !e.target.closest('#pinField .viaadd')) list.innerHTML = '';
  });
  $('#pinAddBtn').onclick = add;
})();

/* Idee auf eine Station ziehen: auf ein ★-Zwischenziel = Sehenswürdigkeit dort, auf ein anderes = Besuch unterwegs danach,
   auf die Liste bzw. das Eingabefeld darunter = neues ★-Zwischenziel am Ende */
function dropIdea(uid, vi) {
  const x = (state.ideas || []).find(y => y.uid === uid);
  if (!x) return;
  const v = vi != null ? state.via[vi] : null,
    n = shortLabel(x.label);
  if (v && (v.kind || 'stay') === 'stay') {
    v.sights = (v.sights || []).concat(ideaPt(x));
    flash(`„${n}“ gehört jetzt zu „${shortLabel(v.label)}“.`);
  } else if (v) {
    state.via.splice(vi + 1, 0, { ...ideaPt(x), uid: 'v' + ++viaSeq, kind: 'visit', hours: 2 });
    flash(`„${n}“ als Besuch unterwegs nach „${shortLabel(v.label)}“ eingefügt.`);
  } else {
    state.via.push({ ...ideaPt(x), uid: 'v' + ++viaSeq, kind: 'stay', nights: 2 });
    flash(`„${n}“ als neues Zwischenziel (★ Übernachten, 2 Nächte) ans Ende gesetzt.`);
  }
  state.ideas = state.ideas.filter(y => y !== x);
  pinProp = null;
  renderVia();
  renderPinboard();
  renderMap();
  touch();
}
$('#pinList').addEventListener('pointerdown', e => {
  const li = e.target.closest('[data-pindrag]');
  if (!li || e.target.closest('button') || e.button > 0) return;
  const uid = li.dataset.pindrag,
    x0 = e.clientX,
    y0 = e.clientY;
  let ghost = null,
    tgt = null;
  const targetAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el || el.closest('#pinField')) return null;
    return el.closest('#viaList li[data-vi]') || el.closest('#viaList, #viaIn');
  };
  const move = ev => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      ghost = li.cloneNode(true);
      ghost.className = 'pinghost';
      document.body.appendChild(ghost);
      li.classList.add('dragging');
    }
    ev.preventDefault();
    ghost.style.left = ev.clientX + 10 + 'px';
    ghost.style.top = ev.clientY + 10 + 'px';
    const t = targetAt(ev.clientX, ev.clientY);
    if (t !== tgt) {
      tgt?.classList.remove('droptgt');
      tgt = t;
      tgt?.classList.add('droptgt');
    }
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
    li.classList.remove('dragging');
    ghost?.remove();
    tgt?.classList.remove('droptgt');
    if (ghost && tgt) dropIdea(uid, tgt.dataset.vi != null ? +tgt.dataset.vi : null);
  };
  document.addEventListener('pointermove', move, { passive: false });
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
});
