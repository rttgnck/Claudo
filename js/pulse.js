// pulse.js — Pulse, a browser groovebox. Multi-track step sequencer (synth drum
// kit + bass + lead synths), per-track mixer, master FX, an 8-slot pattern bank,
// save/load, URL sharing, WAV export, a live keyboard, and an output scope.
import { initNav } from './nav.js';
import { TRACKS, TRACK_MAP, SCALES, KEYS, trackNoteFreq, noteName, defaultSynthParams } from './pulse-defs.js';
import { Engine } from './pulse-audio.js';
import { Pulse3D } from './pulse3d.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hexRGB = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// ---- project model ------------------------------------------------------
function makeSeq(track, steps) { return track.kind === 'drum' ? new Float32Array(steps) : Array.from({ length: steps }, () => []); }
function makePattern(steps) { const seq = {}; for (const t of TRACKS) seq[t.id] = makeSeq(t, steps); return { seq }; }

function defaultProject() {
  const steps = 16;
  const p = {
    bpm: 110, swing: 0.14, steps, key: 9, scale: 'minorPent', metronome: false,
    patternIndex: 0,
    master: { vol: 0.85, drive: 0.12, cutoff: 1, reverb: 0.22, delay: 0.16 },
    mixer: {}, synth: {},
    patterns: Array.from({ length: 8 }, () => makePattern(steps)),
  };
  for (const t of TRACKS) p.mixer[t.id] = { vol: 0.85, pan: 0, mute: false, solo: false };
  p.synth.bass = defaultSynthParams('bass');
  p.synth.lead = defaultSynthParams('lead');
  // a starter groove in pattern 0
  const s = p.patterns[0].seq;
  [0, 4, 8, 12].forEach((i) => s.kick[i] = 0.95);
  s.kick[10] = 0.6;
  [4, 12].forEach((i) => s.snare[i] = 0.9);
  for (let i = 0; i < steps; i++) s.chat[i] = i % 2 === 0 ? 0.5 : 0.32;
  [2, 6, 10, 14].forEach((i) => s.ohat[i] = 0.4);
  const bassLine = { 0: 0, 3: 0, 6: 2, 8: 3, 11: 2, 14: 0 };
  for (const [i, n] of Object.entries(bassLine)) s.bass[+i] = [n];
  s.lead[0] = [4, 7]; s.lead[6] = [5]; s.lead[8] = [7, 9]; s.lead[12] = [6];
  return p;
}

let project = defaultProject();
let selectedTrack = 'lead';
let clipboard = null;

const engine = new Engine(() => project);

// ---- presets ------------------------------------------------------------
const PRESETS = {
  House: (p) => { setGroove(p, { kick: [0, 4, 8, 12], snare: [4, 12], clap: [4, 12], chat: [2, 6, 10, 14], ohat: [] , ride: [] }, { bass: { 0: [0], 4: [2], 8: [3], 12: [2] }, lead: { 0: [4, 7], 8: [5, 9] } }, 124); },
  Techno: (p) => { setGroove(p, { kick: [0, 4, 8, 12], chat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], ohat: [2, 6, 10, 14], rim: [3, 11] }, { bass: { 0: [0], 2: [0], 4: [0], 6: [0], 8: [0], 10: [0], 12: [0], 14: [0] } }, 132); },
  'Lo-fi': (p) => { setGroove(p, { kick: [0, 8], snare: [4, 12], chat: [2, 6, 10, 14], rim: [7] }, { bass: { 0: [0], 6: [2], 8: [3], 12: [1] }, lead: { 0: [4, 7, 9], 8: [3, 6] } }, 82); },
  Trap: (p) => { setGroove(p, { kick: [0, 7, 10], snare: [4, 12], chat: [0, 2, 3, 4, 6, 7, 8, 10, 12, 14, 15], clap: [4, 12] }, { bass: { 0: [0], 8: [3] } }, 70); },
  Funk: (p) => { setGroove(p, { kick: [0, 6, 10], snare: [4, 12], chat: [0, 2, 4, 6, 8, 10, 12, 14], ohat: [7, 15], rim: [2, 9] }, { bass: { 0: [0], 3: [2], 4: [3], 7: [0], 10: [2], 11: [3] }, lead: { 2: [4], 6: [5, 7], 10: [6] } }, 104); },
  Ambient: (p) => { setGroove(p, { kick: [0], ride: [0, 8], chat: [4, 12] }, { bass: { 0: [0], 8: [1] }, lead: { 0: [0, 2, 4], 4: [2, 4, 6], 8: [4, 6, 8], 12: [1, 3, 5] } }, 78); },
};
function setGroove(p, drums, notes, bpm) {
  const s = p.patterns[p.patternIndex].seq;
  for (const t of TRACKS) if (t.kind === 'drum') s[t.id].fill(0); else s[t.id] = Array.from({ length: p.steps }, () => []);
  for (const [id, arr] of Object.entries(drums)) if (s[id]) arr.forEach((i) => { if (i < p.steps) s[id][i] = 0.9; });
  for (const [id, m] of Object.entries(notes || {})) for (const [i, ns] of Object.entries(m)) if (+i < p.steps) s[id][+i] = ns.slice();
  p.bpm = bpm;
}

// ================= UI =================
function buildTransport() {
  const t = $('transport');
  t.innerHTML = '';
  const mk = (label, node) => { const w = el('div', 'tctl'); w.appendChild(el('label', 'tlabel', label)); w.appendChild(node); return w; };

  const play = el('button', 'btn primary big', '▶ Play'); play.id = 'playBtn';
  const stopStyleBtns = el('div', 'trow');
  stopStyleBtns.append(play);

  const bpm = el('input'); bpm.type = 'number'; bpm.id = 'bpmInput'; bpm.min = 40; bpm.max = 220; bpm.value = project.bpm; bpm.className = 'num';
  const tap = el('button', 'btn ghost sm', 'Tap'); tap.id = 'tapBtn';
  const bpmWrap = el('div', 'bpm-wrap'); bpmWrap.append(bpm, tap);

  const swing = range('swingInput', 0, 0.6, 0.01, project.swing);
  const steps = el('select', 'inline-select'); steps.id = 'stepsSelect';[16, 32].forEach((n) => { const o = el('option', null, n + ' steps'); o.value = n; steps.append(o); }); steps.value = project.steps;
  const vol = range('masterVolInput', 0, 1, 0.01, project.master.vol);
  const metro = el('button', 'btn ghost sm', '𝅘𝅥 Metro'); metro.id = 'metroBtn';

  t.append(
    stopStyleBtns,
    mk('Tempo', bpmWrap),
    mk('Swing', swing),
    mk('Steps', steps),
    mk('Volume', vol),
    metro,
  );
  const scope = el('canvas', 'scope'); scope.id = 'scope'; scope.width = 240; scope.height = 46;
  t.append(scope);
}
function range(id, min, max, step, val) { const r = el('input'); r.type = 'range'; r.id = id; r.min = min; r.max = max; r.step = step; r.value = val; r.className = 'trange'; return r; }

let colCells = [];
function buildSeq() {
  const wrap = $('seq'); wrap.innerHTML = '';
  colCells = Array.from({ length: project.steps }, () => []);
  const seq = project.patterns[project.patternIndex].seq;

  // Drum section
  const drumSec = el('div', 'seq-section');
  drumSec.append(sectionHead('Drums'));
  for (const t of TRACKS.filter((x) => x.kind === 'drum')) drumSec.append(drumRow(t, seq[t.id]));
  wrap.append(drumSec);

  // Synth sections (note grids)
  for (const t of TRACKS.filter((x) => x.kind === 'synth')) {
    const sec = el('div', 'seq-section');
    sec.append(trackHeaderBar(t));
    sec.append(noteGrid(t, seq[t.id]));
    wrap.append(sec);
  }
}
function sectionHead(txt) { const h = el('div', 'sec-head'); h.append(el('span', 'sec-title', txt)); return h; }

function trackHeaderBar(t) {
  const bar = el('div', 'track-headbar' + (selectedTrack === t.id ? ' sel' : ''));
  bar.dataset.track = t.id;
  const dot = el('span', 'tdot'); dot.style.background = t.color;
  const name = el('span', 'tname', t.name);
  bar.append(dot, name, mixerControls(t));
  bar.addEventListener('click', (e) => { if (e.target.closest('.mx')) return; selectTrack(t.id); });
  return bar;
}
function drumRow(t, seqArr) {
  const row = el('div', 'drum-row' + (selectedTrack === t.id ? ' sel' : ''));
  row.dataset.track = t.id;
  const head = el('div', 'drum-head');
  const dot = el('span', 'tdot'); dot.style.background = t.color;
  head.append(dot, el('span', 'tname', t.name), mixerControls(t));
  head.addEventListener('click', (e) => { if (e.target.closest('.mx')) return; selectTrack(t.id); engine.previewDrum(t.voice); });
  row.append(head);
  const cells = el('div', 'cells'); cells.style.setProperty('--steps', project.steps);
  for (let c = 0; c < project.steps; c++) {
    const cell = el('div', 'cell drum' + (c % 4 === 0 ? ' beat' : ''));
    cell.style.setProperty('--c', t.color);
    paintDrumCell(cell, seqArr[c]);
    cell.addEventListener('pointerdown', () => { const v = seqArr[c] > 0 ? 0 : 0.9; seqArr[c] = v; paintDrumCell(cell, v); if (v) engine.previewDrum(t.voice, v); });
    cell.addEventListener('wheel', (e) => { if (seqArr[c] <= 0) return; e.preventDefault(); seqArr[c] = clamp(seqArr[c] - Math.sign(e.deltaY) * 0.1, 0.1, 1); paintDrumCell(cell, seqArr[c]); }, { passive: false });
    cells.append(cell); colCells[c].push(cell);
  }
  row.append(cells);
  return row;
}
function paintDrumCell(cell, v) { cell.classList.toggle('active', v > 0); cell.style.setProperty('--v', v > 0 ? (0.35 + v * 0.65).toFixed(2) : 0); }

function noteGrid(t, seqArr) {
  const grid = el('div', 'note-grid');
  const scale = SCALES[project.scale].steps;
  for (let p = t.rows - 1; p >= 0; p--) {
    const row = el('div', 'note-row');
    const lab = el('div', 'note-label', (p === t.rows - 1 || p === 0 || p % scale.length === 0) ? noteName(t, p, project.key, scale) : '');
    row.append(lab);
    const cells = el('div', 'cells'); cells.style.setProperty('--steps', project.steps);
    for (let c = 0; c < project.steps; c++) {
      const cell = el('div', 'cell note' + (c % 4 === 0 ? ' beat' : ''));
      cell.style.setProperty('--c', t.color);
      if (seqArr[c].includes(p)) cell.classList.add('active');
      cell.addEventListener('pointerdown', () => toggleNote(t, seqArr, c, p, cell));
      cells.append(cell); colCells[c].push(cell);
    }
    row.append(cells); grid.append(row);
  }
  return grid;
}
function toggleNote(t, seqArr, c, p, cell) {
  const set = seqArr[c];
  const has = set.includes(p);
  if (t.poly) {
    if (has) set.splice(set.indexOf(p), 1); else { set.push(p); previewNote(t, p); }
    cell.classList.toggle('active', !has);
  } else {
    // clear the column, then set (mono)
    cell.parentElement.querySelectorAll('.cell.active').forEach((x) => x.classList.remove('active'));
    if (has && set.length === 1) { seqArr[c] = []; }
    else { seqArr[c] = [p]; cell.classList.add('active'); previewNote(t, p); }
  }
}
function previewNote(t, p) { engine.previewNote(t.id, trackNoteFreq(t, p, project.key, SCALES[project.scale].steps)); }

// mixer controls in a track header
function mixerControls(t) {
  const mx = el('div', 'mx');
  const m = project.mixer[t.id];
  const mute = el('button', 'mxb' + (m.mute ? ' on' : ''), 'M'); mute.title = 'Mute';
  mute.addEventListener('click', () => { m.mute = !m.mute; mute.classList.toggle('on', m.mute); engine.refresh(); });
  const solo = el('button', 'mxb solo' + (m.solo ? ' on' : ''), 'S'); solo.title = 'Solo';
  solo.addEventListener('click', () => { m.solo = !m.solo; solo.classList.toggle('on', m.solo); engine.refresh(); });
  const vol = el('input'); vol.type = 'range'; vol.min = 0; vol.max = 1; vol.step = 0.01; vol.value = m.vol; vol.className = 'mxvol';
  vol.addEventListener('input', () => { m.vol = +vol.value; engine.refresh(); });
  mx.append(mute, solo, vol);
  return mx;
}

// ---- side panel: instrument + FX + key/scale + pattern bank -------------
function buildSidePanel() {
  const s = $('sidePanel'); s.innerHTML = '';
  s.append(patternBank());
  s.append(instrumentPanel());
  s.append(fxPanel());
  s.append(musicPanel());
  s.append(ioPanel());
}
function group(title) { const g = el('section', 'sgroup'); g.append(el('h3', null, title)); return g; }

function patternBank() {
  const g = group('Patterns');
  const bank = el('div', 'pbank');
  for (let i = 0; i < 8; i++) {
    const b = el('button', 'pslot' + (i === project.patternIndex ? ' on' : '') + (patternHasContent(i) ? ' filled' : ''), String.fromCharCode(65 + i));
    b.addEventListener('click', () => { project.patternIndex = i; buildSeq(); refreshBank(); });
    bank.append(b);
  }
  g.append(bank);
  const row = el('div', 'brow');
  const dup = el('button', 'btn ghost sm', '⧉ Dup'); dup.addEventListener('click', () => { const src = project.patterns[project.patternIndex]; const dst = (project.patternIndex + 1) % 8; project.patterns[dst] = clonePattern(src); project.patternIndex = dst; buildSeq(); refreshBank(); });
  const clr = el('button', 'btn ghost sm', '⌫ Clear'); clr.addEventListener('click', () => { project.patterns[project.patternIndex] = makePattern(project.steps); buildSeq(); refreshBank(); });
  const rnd = el('button', 'btn ghost sm', '⚄ Rand'); rnd.addEventListener('click', () => { randomizePattern(); buildSeq(); refreshBank(); });
  row.append(rnd, dup, clr); g.append(row);
  return g;
}
function refreshBank() { const bank = document.querySelector('.pbank'); if (!bank) return; [...bank.children].forEach((b, i) => { b.classList.toggle('on', i === project.patternIndex); b.classList.toggle('filled', patternHasContent(i)); }); }
function patternHasContent(i) { const seq = project.patterns[i].seq; return TRACKS.some((t) => t.kind === 'drum' ? seq[t.id].some((v) => v > 0) : seq[t.id].some((a) => a.length)); }
function clonePattern(p) { const seq = {}; for (const t of TRACKS) seq[t.id] = t.kind === 'drum' ? Float32Array.from(p.seq[t.id]) : p.seq[t.id].map((a) => a.slice()); return { seq }; }

let instrumentPanelEl;
function instrumentPanel() {
  const g = group('Instrument'); g.id = 'instrPanel'; instrumentPanelEl = g;
  renderInstrument(g);
  return g;
}
function renderInstrument(g) {
  [...g.querySelectorAll('.instr-body')].forEach((n) => n.remove());
  const body = el('div', 'instr-body');
  const t = TRACK_MAP[selectedTrack];
  body.append(el('div', 'instr-name', `<span class="tdot" style="background:${t.color}"></span> ${t.name}`));
  if (t.kind === 'synth') {
    const p = project.synth[t.id];
    const wave = el('select', 'inline-select');['sine', 'triangle', 'sawtooth', 'square'].forEach((w) => { const o = el('option', null, w); o.value = w; wave.append(o); }); wave.value = p.wave;
    wave.addEventListener('change', () => p.wave = wave.value);
    body.append(ctlRow('Wave', wave));
    body.append(knobRow('Cutoff', 80, 12000, 10, p.cutoff, (v) => p.cutoff = v));
    body.append(knobRow('Reso', 0.5, 22, 0.1, p.reso, (v) => p.reso = v));
    body.append(knobRow('Attack', 0.001, 0.4, 0.001, p.attack, (v) => p.attack = v));
    body.append(knobRow('Decay', 0.02, 0.8, 0.01, p.decay, (v) => p.decay = v));
    body.append(knobRow('Sustain', 0, 1, 0.01, p.sustain, (v) => p.sustain = v));
    body.append(knobRow('Release', 0.02, 1.2, 0.01, p.release, (v) => p.release = v));
    if (!t.poly) body.append(knobRow('Glide', 0, 0.2, 0.005, p.glide, (v) => p.glide = v));
  } else {
    body.append(el('p', 'tip', 'Drum voice — set level, pan, mute &amp; solo in its track header on the left.'));
  }
  g.append(body);
}
function ctlRow(label, node) { const r = el('label', 'ctl'); r.append(el('span', null, label), node, el('output')); return r; }
function knobRow(label, min, max, step, val, on) {
  const r = el('label', 'ctl');
  const rng = el('input'); rng.type = 'range'; rng.min = min; rng.max = max; rng.step = step; rng.value = val;
  const out = el('output', null, fmt(val));
  rng.addEventListener('input', () => { const v = +rng.value; out.textContent = fmt(v); on(v); });
  r.append(el('span', null, label), rng, out);
  return r;
}
function fmt(v) { return v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(v < 1 ? 3 : 2); }

function fxPanel() {
  const g = group('Master FX');
  const m = project.master;
  g.append(knobRow('Drive', 0, 1, 0.01, m.drive, (v) => { m.drive = v; engine.refresh(); }));
  g.append(knobRow('Filter', 0, 1, 0.01, m.cutoff, (v) => { m.cutoff = v; engine.refresh(); }));
  g.append(knobRow('Reverb', 0, 0.9, 0.01, m.reverb, (v) => { m.reverb = v; engine.refresh(); }));
  g.append(knobRow('Delay', 0, 0.7, 0.01, m.delay, (v) => { m.delay = v; engine.refresh(); }));
  return g;
}
function musicPanel() {
  const g = group('Key & Scale');
  const key = el('select', 'inline-select'); KEYS.forEach((k, i) => { const o = el('option', null, k); o.value = i; key.append(o); }); key.value = project.key;
  key.addEventListener('change', () => { project.key = +key.value; buildSeq(); });
  const scale = el('select', 'inline-select'); Object.entries(SCALES).forEach(([id, sc]) => { const o = el('option', null, sc.name); o.value = id; scale.append(o); }); scale.value = project.scale;
  scale.addEventListener('change', () => { project.scale = scale.value; buildSeq(); });
  g.append(ctlRow('Root', key), ctlRow('Scale', scale));
  g.append(el('p', 'tip', 'Melody rows lock to this scale, so anything you tap stays in key. Play the <b>Lead</b> with your keyboard: <b>Z–M</b> and <b>Q–U</b>.'));
  return g;
}
function ioPanel() {
  const g = group('Project');
  const row1 = el('div', 'brow');
  const share = el('button', 'btn primary sm', '⇪ Share'); share.addEventListener('click', doShare);
  const wav = el('button', 'btn sm', '⬇ WAV'); wav.id = 'wavBtn'; wav.addEventListener('click', doExport);
  row1.append(share, wav); g.append(row1);
  const row2 = el('div', 'brow');
  const save = el('button', 'btn ghost sm', '★ Save'); save.addEventListener('click', doSave);
  const load = el('select', 'inline-select'); load.id = 'loadSelect';
  load.addEventListener('change', () => { if (load.value) doLoad(load.value); });
  row2.append(save, load); g.append(row2);
  refreshSavedList(load);
  const presetRow = el('div', 'brow');
  const preset = el('select', 'inline-select'); const o0 = el('option', null, 'Presets…'); o0.value = ''; o0.disabled = true; o0.selected = true; preset.append(o0);
  Object.keys(PRESETS).forEach((n) => { const o = el('option', null, n); o.value = n; preset.append(o); });
  preset.addEventListener('change', () => { if (preset.value) { PRESETS[preset.value](project); syncTransport(); buildSeq(); refreshBank(); } });
  presetRow.append(preset); g.append(presetRow);
  return g;
}

// ---- selection ----------------------------------------------------------
function selectTrack(id) {
  selectedTrack = id;
  document.querySelectorAll('.drum-row, .track-headbar').forEach((r) => r.classList.toggle('sel', r.dataset.track === id));
  if (instrumentPanelEl) renderInstrument(instrumentPanelEl);
}

// ---- transport / global handlers ---------------------------------------
function bindTransport() {
  $('playBtn').addEventListener('click', togglerun);
  $('bpmInput').addEventListener('input', () => { project.bpm = clamp(+$('bpmInput').value || 110, 40, 220); engine.refresh(); });
  $('swingInput').addEventListener('input', () => project.swing = +$('swingInput').value);
  $('masterVolInput').addEventListener('input', () => { project.master.vol = +$('masterVolInput').value; engine.refresh(); });
  $('stepsSelect').addEventListener('change', () => resizeSteps(+$('stepsSelect').value));
  $('metroBtn').addEventListener('click', () => { project.metronome = !project.metronome; $('metroBtn').classList.toggle('on', project.metronome); });
  $('tapBtn').addEventListener('click', tapTempo);
}
let running = false;
function togglerun() { running = !running; if (running) engine.play(); else engine.stop(); $('playBtn').innerHTML = running ? '❚❚ Stop' : '▶ Play'; $('playBtn').classList.toggle('paused', running); if (!running) highlight(-1); }
let taps = [];
function tapTempo() { const now = performance.now(); taps = taps.filter((t) => now - t < 2000); taps.push(now); if (taps.length >= 2) { const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); project.bpm = clamp(Math.round(60000 / avg), 40, 220); $('bpmInput').value = project.bpm; engine.refresh(); } }
function syncTransport() { $('bpmInput').value = project.bpm; $('swingInput').value = project.swing; $('masterVolInput').value = project.master.vol; $('stepsSelect').value = project.steps; }

function resizeSteps(n) {
  const old = project.steps; project.steps = n;
  for (const pat of project.patterns) for (const t of TRACKS) {
    const cur = pat.seq[t.id];
    const next = makeSeq(t, n);
    for (let i = 0; i < Math.min(old, n); i++) next[i] = t.kind === 'drum' ? cur[i] : cur[i].slice();
    pat.seq[t.id] = next;
  }
  buildSeq();
}

function randomizePattern() {
  const s = project.patterns[project.patternIndex].seq, steps = project.steps;
  for (const t of TRACKS) if (t.kind === 'drum') s[t.id].fill(0); else s[t.id] = Array.from({ length: steps }, () => []);
  for (let i = 0; i < steps; i += 4) s.kick[i] = 0.95; if (Math.random() < 0.4) s.kick[10] = 0.6;
  s.snare[4] = 0.9; s.snare[12] = 0.9;
  for (let i = 0; i < steps; i++) if (i % 2 === 0 || Math.random() < 0.3) s.chat[i] = 0.3 + Math.random() * 0.4;
  if (Math.random() < 0.5) [2, 6, 10, 14].forEach((i) => s.ohat[i] = 0.4);
  let bp = 0; for (let c = 0; c < steps; c++) if (Math.random() < 0.4) { bp = clamp(bp + (Math.random() * 3 | 0) - 1, 0, 7); s.bass[c] = [bp]; }
  let lp = 3; for (let c = 0; c < steps; c++) if (Math.random() < 0.32) { lp = clamp(lp + (Math.random() * 5 | 0) - 2, 0, 13); const notes = [lp]; if (Math.random() < 0.4) notes.push(clamp(lp + 2, 0, 13)); s.lead[c] = notes; }
}

// ---- save / load / share / export --------------------------------------
function serialize(p) {
  // Only include patterns/tracks that actually have content, to keep links short.
  const o = { bpm: p.bpm, swing: p.swing, steps: p.steps, key: p.key, scale: p.scale, metronome: !!p.metronome, patternIndex: p.patternIndex, master: p.master, mixer: p.mixer, synth: p.synth, patterns: [] };
  p.patterns.forEach((pat, i) => {
    if (!patternHasContent(i)) return;
    const seq = {};
    for (const t of TRACKS) {
      if (t.kind === 'drum') { const a = Array.from(pat.seq[t.id]); if (a.some((v) => v > 0)) seq[t.id] = a.map((v) => +v.toFixed(2)); }
      else if (pat.seq[t.id].some((x) => x.length)) seq[t.id] = pat.seq[t.id];
    }
    o.patterns.push({ i, seq });
  });
  return o;
}
function deserialize(o) {
  const p = defaultProject();
  p.bpm = o.bpm ?? p.bpm; p.swing = o.swing ?? p.swing; p.steps = o.steps ?? p.steps;
  p.key = o.key ?? p.key; p.scale = o.scale ?? p.scale; p.metronome = !!o.metronome; p.patternIndex = o.patternIndex || 0;
  if (o.master) p.master = o.master; if (o.mixer) p.mixer = o.mixer; if (o.synth) p.synth = o.synth;
  p.patterns = Array.from({ length: 8 }, () => makePattern(p.steps));
  for (const ent of (o.patterns || [])) {
    const pat = p.patterns[ent.i]; if (!pat) continue;
    for (const t of TRACKS) {
      const d = ent.seq[t.id]; if (!d) continue;
      if (t.kind === 'drum') { const arr = makeSeq(t, p.steps); for (let i = 0; i < Math.min(d.length, p.steps); i++) arr[i] = d[i]; pat.seq[t.id] = arr; }
      else pat.seq[t.id] = d.map((a) => a.slice());
    }
  }
  return p;
}
function doShare() {
  const code = btoa(unescape(encodeURIComponent(JSON.stringify(serialize(project))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = `${location.origin}${location.pathname}#${code}`;
  history.replaceState(null, '', '#' + code);
  navigator.clipboard.writeText(url).then(() => toast('Project link copied')).catch(() => toast('Link set in address bar'));
}
function loadFromHash() {
  const h = location.hash.slice(1); if (!h) return false;
  try { const json = decodeURIComponent(escape(atob(h.replace(/-/g, '+').replace(/_/g, '/')))); project = deserialize(JSON.parse(json)); return true; } catch { return false; }
}
const LS_KEY = 'pulse-projects';
function savedProjects() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } }
function doSave() { const name = prompt('Save project as:', 'My beat'); if (!name) return; const all = savedProjects(); all[name] = serialize(project); localStorage.setItem(LS_KEY, JSON.stringify(all)); refreshSavedList($('loadSelect')); toast('Saved “' + name + '”'); }
function doLoad(name) { const all = savedProjects(); if (!all[name]) return; project = deserialize(all[name]); afterLoad(); toast('Loaded “' + name + '”'); }
function refreshSavedList(sel) { if (!sel) return; sel.innerHTML = ''; const o0 = el('option', null, 'Load…'); o0.value = ''; sel.append(o0); Object.keys(savedProjects()).forEach((n) => { const o = el('option', null, n); o.value = n; sel.append(o); }); }
function afterLoad() { syncTransport(); buildSeq(); buildSidePanel(); refreshBank(); engine.refresh(); }

async function doExport() {
  const btn = $('wavBtn'); const prev = btn.textContent; btn.textContent = '…rendering'; btn.disabled = true;
  try {
    engine.unlock();
    const bars = 2;
    const blob = await engine.exportWav(bars);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pulse-${project.bpm}bpm-${Date.now()}.wav`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Exported ' + bars + ' bars to WAV');
  } catch (e) { toast('Export failed'); }
  btn.textContent = prev; btn.disabled = false;
}

// ---- live keyboard ------------------------------------------------------
const KEYMAP = { KeyZ: 0, KeyX: 1, KeyC: 2, KeyV: 3, KeyB: 4, KeyN: 5, KeyM: 6, KeyQ: 7, KeyW: 8, KeyE: 9, KeyR: 10, KeyT: 11, KeyY: 12, KeyU: 13 };
function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); togglerun(); return; }
    const p = KEYMAP[e.code];
    if (p != null) { const t = TRACK_MAP.lead; engine.previewNote('lead', trackNoteFreq(t, p, project.key, SCALES[project.scale].steps)); }
  });
}

// ---- playhead + scope ---------------------------------------------------
let lastCol = -1;
function highlight(col) {
  if (col === lastCol) return;
  if (lastCol >= 0 && colCells[lastCol]) colCells[lastCol].forEach((c) => c.classList.remove('playhead'));
  if (col >= 0 && colCells[col]) colCells[col].forEach((c) => c.classList.add('playhead'));
  lastCol = col;
}
function drawScope() {
  const cv = $('scope'); if (cv) {
    const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
    const an = engine.analyser;
    if (an && running) {
      const n = an.fftSize, data = new Uint8Array(n); an.getByteTimeDomainData(data);
      ctx.beginPath(); ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.5;
      for (let i = 0; i < n; i += 4) { const x = (i / n) * cv.width, y = (data[i] / 255) * cv.height; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
    } else { ctx.strokeStyle = 'rgba(120,130,160,0.4)'; ctx.beginPath(); ctx.moveTo(0, cv.height / 2); ctx.lineTo(cv.width, cv.height / 2); ctx.stroke(); }
  }
  if (mode3d && p3d && p3d.ready) { p3d.update(grid3d(), project.steps, running ? lastCol : -1); p3d.render(0.016); }
  requestAnimationFrame(drawScope);
}
function frameStep() { if (running) { const s = engine.drawStep(); if (s >= 0) highlight(s); } requestAnimationFrame(frameStep); }

// ---- 3D -----------------------------------------------------------------
let mode3d = false, p3d = null;
function grid3d() {
  const seq = project.patterns[project.patternIndex].seq, rows = [];
  for (const t of TRACKS.filter((x) => x.kind === 'drum')) rows.push({ color: hexRGB(t.color).map((c) => c / 255), cells: Array.from(seq[t.id]) });
  for (const t of TRACKS.filter((x) => x.kind === 'synth')) for (let p = 0; p < t.rows; p++) { const cells = []; for (let c = 0; c < project.steps; c++) cells.push(seq[t.id][c].includes(p) ? 0.9 : 0); rows.push({ color: hexRGB(t.color).map((c) => c / 255), cells }); }
  return rows;
}
async function toggle3D() {
  const btn = $('mode3dBtn');
  if (!mode3d) { if (!p3d) { p3d = new Pulse3D(); await p3d.init(); } mode3d = true; document.body.classList.add('mode-3d'); btn.textContent = '◱ 2D'; btn.classList.add('active'); p3d.activate(); }
  else { mode3d = false; document.body.classList.remove('mode-3d'); btn.textContent = '⬗ 3D'; btn.classList.remove('active'); if (p3d) p3d.deactivate(); }
}

// ---- misc ---------------------------------------------------------------
let toastTimer;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }

// ---- boot ---------------------------------------------------------------
initNav('pulse');
loadFromHash();
buildTransport();
buildSeq();
buildSidePanel();
bindTransport();
bindKeyboard();
selectTrack(selectedTrack);
$('mode3dBtn').addEventListener('click', () => toggle3D());
$('panelToggle').addEventListener('click', () => document.body.classList.toggle('panel-open'));
if (window.innerWidth > 900) document.body.classList.add('panel-open');
requestAnimationFrame(drawScope);
requestAnimationFrame(frameStep);
