// pulse.js — Pulse, a browser groovebox. Multi-track step sequencer with a synth
// drum kit (switchable 808/909/LoFi/Acoustic), bass/lead/chord synths (5 engines),
// variable pattern length with scrolling, per-step velocity + ratchets, per-track
// probability, a style-aware beat generator, song mode, master FX, pattern bank,
// undo, save/load, URL sharing, WAV + MIDI export, a live keyboard, and a scope.
import { initNav } from './nav.js';
import { TRACKS, TRACK_MAP, DRUM_IDS, SYNTH_IDS, SCALES, KEYS, KITS, ENGINES, trackNoteFreq, noteName, defaultSynthParams } from './pulse-defs.js';
import { Engine, exportMidi } from './pulse-audio.js';
import { Pulse3D } from './pulse3d.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (p) => Math.random() < p;
const hexRGB = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const MAX_BARS = 8;

// ---- model --------------------------------------------------------------
function makeSeq(track, steps) { return track.kind === 'drum' ? new Float32Array(steps) : Array.from({ length: steps }, () => []); }
function makePattern(steps) { const seq = {}, ratchet = {}; for (const t of TRACKS) { seq[t.id] = makeSeq(t, steps); if (t.kind === 'drum') ratchet[t.id] = new Uint8Array(steps).fill(1); } return { seq, ratchet }; }
function clonePattern(p) { const seq = {}, ratchet = {}; for (const t of TRACKS) { seq[t.id] = t.kind === 'drum' ? Float32Array.from(p.seq[t.id]) : p.seq[t.id].map((a) => a.slice()); if (t.kind === 'drum') ratchet[t.id] = Uint8Array.from(p.ratchet[t.id]); } return { seq, ratchet }; }

function defaultProject() {
  const bars = 1, steps = bars * 16;
  const p = {
    bpm: 110, swing: 0.14, bars, steps, key: 9, scale: 'minorPent', kit: '808', metronome: false, humanize: 0.18,
    patternIndex: 0, song: { on: false, chain: [0, 0, 1, 0] },
    master: { vol: 0.85, drive: 0.12, cutoff: 1, reverb: 0.22, delay: 0.16 },
    mixer: {}, synth: {},
    patterns: Array.from({ length: 8 }, () => makePattern(steps)),
  };
  for (const t of TRACKS) p.mixer[t.id] = { vol: 0.85, pan: 0, mute: false, solo: false, prob: 1 };
  for (const id of SYNTH_IDS) p.synth[id] = defaultSynthParams(id);
  generateStyle(p, 'House');
  p.bpm = 110;
  return p;
}

let project;   // assigned in boot (after generator consts are initialized)
let selectedTrack = 'lead';

const engine = new Engine(() => project);

// When song mode plays, expose the chained pattern as the "current" for the engine.
let songPos = 0;
function songProject() { return project; }

// ---- undo ---------------------------------------------------------------
const undoStack = [], redoStack = [];
let undoTimer = null;
function pushUndo() { clearTimeout(undoTimer); undoTimer = setTimeout(() => { undoStack.push(JSON.stringify(serialize(project))); if (undoStack.length > 40) undoStack.shift(); redoStack.length = 0; }, 250); }
function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(serialize(project))); project = deserialize(JSON.parse(undoStack.pop())); afterLoad(); toast('Undo'); }
function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(serialize(project))); project = deserialize(JSON.parse(redoStack.pop())); afterLoad(); toast('Redo'); }

// ================= STYLE GENERATOR =================
const STYLES = ['House', 'Techno', 'Trap', 'Drum & Bass', 'Breakbeat', 'Funk', 'Lo-fi', 'Latin', 'Pop', 'Ambient'];
const STYLE_CFG = {
  House: { bpm: 124, swing: 0.08, kit: '909' }, Techno: { bpm: 132, swing: 0.04, kit: '909' },
  Trap: { bpm: 140, swing: 0.06, kit: '808' }, 'Drum & Bass': { bpm: 174, swing: 0.03, kit: '909' },
  Breakbeat: { bpm: 128, swing: 0.12, kit: 'Acoustic' }, Funk: { bpm: 104, swing: 0.18, kit: 'Acoustic' },
  'Lo-fi': { bpm: 82, swing: 0.32, kit: 'LoFi' }, Latin: { bpm: 102, swing: 0.1, kit: 'Acoustic' },
  Pop: { bpm: 112, swing: 0.1, kit: '909' }, Ambient: { bpm: 76, swing: 0.2, kit: 'LoFi' },
};
function progression(scale) { const minor = /min|pent|dorian|phrygian|blues|harmonic/i.test(scale); return minor ? [0, 5, 3, 4] : [0, 4, 5, 3]; }
function triad(deg) { return [deg, deg + 2, deg + 4]; }

function generateStyle(p, style, opts = {}) {
  const cfg = STYLE_CFG[style] || STYLE_CFG.House;
  p.kit = cfg.kit; if (!opts.keepTempo) { p.bpm = cfg.bpm; p.swing = cfg.swing; }
  const pat = p.patterns[p.patternIndex]; const steps = p.steps, bars = steps / 16;
  for (const t of TRACKS) { if (t.kind === 'drum') { pat.seq[t.id].fill(0); pat.ratchet[t.id].fill(1); } else pat.seq[t.id] = Array.from({ length: steps }, () => []); }
  const s = pat.seq, r = pat.ratchet;
  const each = (id, fn) => { for (let b = 0; b < bars; b++) for (let i = 0; i < 16; i++) fn(s[id], r[id], b * 16 + i, i, b); };
  const put = (arr, i, v) => { arr[i] = v; };

  if (style === 'House' || style === 'Pop') {
    each('kick', (a, rr, gi, i) => { if (i % 4 === 0) put(a, gi, 0.95); });
    each('snare', (a, rr, gi, i) => { if (i === 4 || i === 12) put(a, gi, 0.9); });
    if (style === 'House') each('ohat', (a, rr, gi, i) => { if (i % 4 === 2) put(a, gi, 0.5); });
    each('chat', (a, rr, gi, i) => { if (i % 2 === 0 || rand(0.25)) put(a, gi, 0.3 + Math.random() * 0.3); });
    each('clap', (a, rr, gi, i) => { if (i === 4 || i === 12) put(a, gi, 0.6); });
  } else if (style === 'Techno') {
    each('kick', (a, rr, gi, i) => { if (i % 4 === 0) put(a, gi, 0.95); });
    each('chat', (a, rr, gi, i) => put(a, gi, i % 2 ? 0.28 : 0.42));
    each('ohat', (a, rr, gi, i) => { if (i % 4 === 2) put(a, gi, 0.45); });
    each('rim', (a, rr, gi, i) => { if (i === 3 || i === 11) put(a, gi, 0.4); });
    each('clap', (a, rr, gi, i) => { if (i === 4 || i === 12) put(a, gi, 0.55); });
  } else if (style === 'Trap') {
    each('kick', (a, rr, gi, i) => { if (i === 0 || i === 6 || (i === 10 && rand(0.6))) put(a, gi, 0.95); });
    each('snare', (a, rr, gi, i) => { if (i === 8) put(a, gi, 0.9); });
    each('chat', (a, rr, gi, i) => { put(a, gi, 0.32 + Math.random() * 0.3); if (rand(0.18)) rr[gi] = 2 + (Math.random() * 2 | 0); });
    each('clap', (a, rr, gi, i) => { if (i === 8) put(a, gi, 0.6); });
  } else if (style === 'Drum & Bass') {
    each('kick', (a, rr, gi, i) => { if (i === 0 || i === 10) put(a, gi, 0.95); });
    each('snare', (a, rr, gi, i) => { if (i === 4 || i === 12) put(a, gi, 0.9); if (i === 14 && rand(0.4)) put(a, gi, 0.5); });
    each('chat', (a, rr, gi, i) => { if (i % 2 === 1 || rand(0.3)) put(a, gi, 0.3 + Math.random() * 0.3); });
    each('ride', (a, rr, gi, i) => { if (i % 4 === 0) put(a, gi, 0.3); });
  } else if (style === 'Breakbeat') {
    each('kick', (a, rr, gi, i) => { if (i === 0 || i === 6 || i === 10) put(a, gi, 0.9); });
    each('snare', (a, rr, gi, i) => { if (i === 4 || i === 12 || (i === 7 && rand(0.3))) put(a, gi, 0.85); });
    each('chat', (a, rr, gi, i) => { if (rand(0.6)) put(a, gi, 0.3 + Math.random() * 0.3); });
  } else if (style === 'Funk') {
    each('kick', (a, rr, gi, i) => { if (i === 0 || i === 3 || i === 6 || (i === 10 && rand(0.7))) put(a, gi, 0.9); });
    each('snare', (a, rr, gi, i) => { if (i === 4 || i === 12) put(a, gi, 0.9); else if (rand(0.12)) put(a, gi, 0.3); });
    each('chat', (a, rr, gi, i) => put(a, gi, i % 2 ? 0.25 : 0.5));
    each('ohat', (a, rr, gi, i) => { if (i === 7 || i === 15) put(a, gi, 0.4); });
  } else if (style === 'Lo-fi') {
    each('kick', (a, rr, gi, i) => { if (i === 0 || i === 8 || (i === 11 && rand(0.4))) put(a, gi, 0.85); });
    each('snare', (a, rr, gi, i) => { if (i === 4 || i === 12) put(a, gi, 0.8); });
    each('chat', (a, rr, gi, i) => { if (i % 2 === 0) put(a, gi, 0.3 + Math.random() * 0.2); });
    each('rim', (a, rr, gi, i) => { if (i === 7) put(a, gi, 0.35); });
    each('shaker', (a, rr, gi, i) => { if (rand(0.4)) put(a, gi, 0.25); });
  } else if (style === 'Latin') {
    each('rim', (a, rr, gi, i) => { if ([0, 3, 6, 10, 12].includes(i)) put(a, gi, 0.6); });
    each('cowbell', (a, rr, gi, i) => { if (i % 4 === 0) put(a, gi, 0.4); });
    each('tom', (a, rr, gi, i) => { if (i === 7 || i === 14) put(a, gi, 0.5); });
    each('kick', (a, rr, gi, i) => { if (i === 0 || i === 8) put(a, gi, 0.8); });
    each('shaker', (a, rr, gi, i) => put(a, gi, i % 2 ? 0.2 : 0.35));
  } else if (style === 'Ambient') {
    each('kick', (a, rr, gi, i) => { if (i === 0) put(a, gi, 0.6); });
    each('shaker', (a, rr, gi, i) => { if (rand(0.2)) put(a, gi, 0.2); });
    each('ride', (a, rr, gi, i) => { if (i === 0 || i === 8) put(a, gi, 0.25); });
  }
  generateMelodic(p, style);
}

function generateMelodic(p, style) {
  const pat = p.patterns[p.patternIndex]; const steps = p.steps, bars = steps / 16;
  const prog = progression(p.scale);
  const dense = { Techno: 0.9, 'Drum & Bass': 0.7, Trap: 0.3, Ambient: 0.15, 'Lo-fi': 0.35 }[style] ?? 0.5;
  pat.seq.bass = Array.from({ length: steps }, () => []);
  pat.seq.lead = Array.from({ length: steps }, () => []);
  pat.seq.chords = Array.from({ length: steps }, () => []);
  for (let b = 0; b < bars; b++) {
    const deg = prog[b % prog.length];
    // chords: one triad per bar (pad) unless funk/house -> stabs
    if (style === 'Ambient' || style === 'Lo-fi' || style === 'Pop') pat.seq.chords[b * 16] = triad(deg).map((d) => clamp(d, 0, 13));
    else if (style === 'House' || style === 'Funk') { [0, 6, 10].forEach((i) => { if (rand(0.7)) pat.seq.chords[b * 16 + i] = triad(deg).map((d) => clamp(d, 0, 13)); }); }
    // bass
    for (let i = 0; i < 16; i++) {
      const gi = b * 16 + i;
      if (style === 'Techno') { if (i % 2 === 0) pat.seq.bass[gi] = [deg]; }
      else if (style === 'Trap' || style === 'Drum & Bass' || style === 'Ambient') { if (i === 0 || (i === 8 && rand(0.5))) pat.seq.bass[gi] = [deg]; }
      else { if (i % 4 === 0 || rand(0.25)) pat.seq.bass[gi] = [rand(0.3) ? deg + 2 : deg]; }
    }
    // lead: chord tones + passing, rhythmic
    let cur = deg + 4;
    for (let i = 0; i < 16; i++) { const gi = b * 16 + i; if (rand(dense * 0.5)) { cur = clamp(cur + (Math.random() * 5 | 0) - 2, 0, 13); const notes = [cur]; if (style === 'House' && rand(0.3)) notes.push(clamp(cur + 2, 0, 13)); pat.seq.lead[gi] = notes; } }
  }
}
function mutate() {
  const pat = project.patterns[project.patternIndex], steps = project.steps;
  for (const id of DRUM_IDS) { const a = pat.seq[id]; for (let i = 0; i < steps; i++) { if (rand(0.06)) a[i] = a[i] > 0 ? 0 : 0.7 + Math.random() * 0.25; } }
  for (const id of SYNTH_IDS) { const seq = pat.seq[id]; for (let i = 0; i < steps; i++) if (rand(0.05) && seq[i].length) seq[i] = seq[i].map((n) => clamp(n + (Math.random() * 3 | 0) - 1, 0, TRACK_MAP[id].rows - 1)); }
}
function diceTrack(id) {
  const pat = project.patterns[project.patternIndex], steps = project.steps, t = TRACK_MAP[id];
  if (t.kind === 'drum') { const a = pat.seq[id]; a.fill(0); const density = { kick: 0.25, snare: 0.15, chat: 0.5, ohat: 0.2 }[id] ?? 0.25; for (let i = 0; i < steps; i++) if (rand(density)) a[i] = 0.6 + Math.random() * 0.35; }
  else { pat.seq[id] = Array.from({ length: steps }, () => []); const prog = progression(project.scale); let cur = 4; for (let i = 0; i < steps; i++) if (rand(0.35)) { cur = clamp(cur + (Math.random() * 5 | 0) - 2, 0, t.rows - 1); pat.seq[id][i] = [cur]; } }
}

// ================= UI =================
function buildTransport() {
  const t = $('transport'); t.innerHTML = '';
  const mk = (label, node) => { const w = el('div', 'tctl'); w.append(el('label', 'tlabel', label), node); return w; };
  const play = el('button', 'btn primary big', '▶ Play'); play.id = 'playBtn';
  const bpm = el('input'); bpm.type = 'number'; bpm.id = 'bpmInput'; bpm.min = 40; bpm.max = 220; bpm.value = project.bpm; bpm.className = 'num';
  const tap = el('button', 'btn ghost sm', 'Tap'); tap.id = 'tapBtn';
  const bpmWrap = el('div', 'bpm-wrap'); bpmWrap.append(bpm, tap);
  const swing = range('swingInput', 0, 0.6, 0.01, project.swing);
  // length
  const lenWrap = el('div', 'len-wrap');
  const minus = el('button', 'btn ghost sm', '−'); minus.id = 'barMinus';
  const barsLbl = el('span', 'bars-lbl'); barsLbl.id = 'barsLbl'; barsLbl.textContent = project.bars + (project.bars > 1 ? ' bars' : ' bar');
  const plus = el('button', 'btn ghost sm', '+'); plus.id = 'barPlus';
  lenWrap.append(minus, barsLbl, plus);
  const vol = range('masterVolInput', 0, 1, 0.01, project.master.vol);
  const metro = el('button', 'btn ghost sm', '𝅘𝅥 Metro'); metro.id = 'metroBtn';
  const song = el('button', 'btn ghost sm', '⛓ Song'); song.id = 'songBtn';
  const scopeBtn = el('button', 'btn ghost sm', '∿'); scopeBtn.id = 'scopeModeBtn'; scopeBtn.title = 'Scope / spectrum';
  t.append(play, mk('Tempo', bpmWrap), mk('Swing', swing), mk('Length', lenWrap), mk('Volume', vol), metro, song);
  const scope = el('canvas', 'scope'); scope.id = 'scope'; scope.width = 220; scope.height = 46;
  const scopeWrap = el('div', 'scope-wrap'); scopeWrap.append(scopeBtn, scope);
  t.append(scopeWrap);
}
function range(id, min, max, step, val) { const r = el('input'); r.type = 'range'; r.id = id; r.min = min; r.max = max; r.step = step; r.value = val; r.className = 'trange'; return r; }

let colCells = [];
// Single global drum velocity-drag handler (avoids per-cell listeners).
let vdrag = null;
window.addEventListener('pointermove', (e) => { if (!vdrag) return; const d = vdrag; d.seqArr[d.c] = clamp(d.startV + (d.startY - e.clientY) / 90, 0.05, 1); if (Math.abs(d.seqArr[d.c] - d.startV) > 0.02) d.moved = true; paintDrumCell(d.cell, d.seqArr[d.c], d.ratArr[d.c]); });
window.addEventListener('pointerup', () => { if (vdrag && !vdrag.moved) { vdrag.seqArr[vdrag.c] = 0; paintDrumCell(vdrag.cell, 0, vdrag.ratArr[vdrag.c]); } vdrag = null; });

function buildSeq() {
  const wrap = $('seq'); wrap.innerHTML = '';
  colCells = Array.from({ length: project.steps }, () => []);
  const pat = project.patterns[project.patternIndex];
  const drumSec = el('div', 'seq-section');
  drumSec.append(sectionHead('Drums'));
  for (const t of TRACKS.filter((x) => x.kind === 'drum')) drumSec.append(drumRow(t, pat.seq[t.id], pat.ratchet[t.id]));
  wrap.append(drumSec);
  for (const t of TRACKS.filter((x) => x.kind === 'synth')) {
    const sec = el('div', 'seq-section');
    sec.append(trackHeaderBar(t)); sec.append(noteGrid(t, pat.seq[t.id]));
    wrap.append(sec);
  }
}
function sectionHead(txt) { const h = el('div', 'sec-head'); h.append(el('span', 'sec-title', txt)); return h; }
function trackHeaderBar(t) { const bar = el('div', 'track-headbar' + (selectedTrack === t.id ? ' sel' : '')); bar.dataset.track = t.id; bar.append(headContent(t, false)); bar.addEventListener('click', (e) => { if (e.target.closest('.mx') || e.target.closest('.dice')) return; selectTrack(t.id); }); return bar; }
function headContent(t, isDrum) {
  const frag = document.createDocumentFragment();
  const dot = el('span', 'tdot'); dot.style.background = t.color;
  const name = el('span', 'tname', t.name);
  const dice = el('button', 'dice', '⚄'); dice.title = 'Randomize this track'; dice.addEventListener('click', (e) => { e.stopPropagation(); pushUndo(); diceTrack(t.id); buildSeq(); });
  frag.append(dot, name, dice, mixerControls(t));
  return frag;
}
function drumRow(t, seqArr, ratArr) {
  const row = el('div', 'drum-row' + (selectedTrack === t.id ? ' sel' : '')); row.dataset.track = t.id;
  const head = el('div', 'drum-head'); head.append(headContent(t, true));
  head.addEventListener('click', (e) => { if (e.target.closest('.mx') || e.target.closest('.dice')) return; selectTrack(t.id); engine.previewDrum(t.voice); });
  row.append(head);
  const cells = el('div', 'cells'); cells.style.setProperty('--steps', project.steps);
  for (let c = 0; c < project.steps; c++) {
    const cell = el('div', 'cell drum' + (c % 4 === 0 ? ' beat' : '') + (c % 16 === 0 ? ' bar' : '')); cell.style.setProperty('--c', t.color);
    paintDrumCell(cell, seqArr[c], ratArr[c]);
    cell.addEventListener('pointerdown', (e) => {
      pushUndo();
      if (seqArr[c] > 0) vdrag = { seqArr, c, cell, ratArr, startY: e.clientY, startV: seqArr[c], moved: false };
      else { seqArr[c] = 0.9; paintDrumCell(cell, 0.9, ratArr[c]); engine.previewDrum(t.voice, 0.9); }
    });
    cell.addEventListener('contextmenu', (e) => { e.preventDefault(); if (seqArr[c] <= 0) return; ratArr[c] = ratArr[c] >= 4 ? 1 : (ratArr[c] < 2 ? 2 : ratArr[c] + 1); paintDrumCell(cell, seqArr[c], ratArr[c]); });
    cells.append(cell); colCells[c].push(cell);
  }
  row.append(cells); return row;
}
function paintDrumCell(cell, v, r) { cell.classList.toggle('active', v > 0); cell.style.setProperty('--v', v > 0 ? (0.4 + v * 0.6).toFixed(2) : 0); cell.dataset.r = (r > 1 && v > 0) ? r : ''; }
function noteGrid(t, seqArr) {
  const grid = el('div', 'note-grid'); const scale = SCALES[project.scale].steps;
  for (let p = t.rows - 1; p >= 0; p--) {
    const row = el('div', 'note-row');
    row.append(el('div', 'note-label', (p % scale.length === 0) ? noteName(t, p, project.key, scale) : ''));
    const cells = el('div', 'cells'); cells.style.setProperty('--steps', project.steps);
    for (let c = 0; c < project.steps; c++) {
      const cell = el('div', 'cell note' + (c % 4 === 0 ? ' beat' : '') + (c % 16 === 0 ? ' bar' : '')); cell.style.setProperty('--c', t.color);
      if (seqArr[c].includes(p)) cell.classList.add('active');
      cell.addEventListener('pointerdown', () => { pushUndo(); toggleNote(t, seqArr, c, p, cell); });
      cells.append(cell); colCells[c].push(cell);
    }
    row.append(cells); grid.append(row);
  }
  return grid;
}
function toggleNote(t, seqArr, c, p, cell) {
  const set = seqArr[c], has = set.includes(p);
  if (t.poly) { if (has) set.splice(set.indexOf(p), 1); else { set.push(p); previewNote(t, p); } cell.classList.toggle('active', !has); }
  else { cell.parentElement.querySelectorAll('.cell.active').forEach((x) => x.classList.remove('active')); if (has && set.length === 1) seqArr[c] = []; else { seqArr[c] = [p]; cell.classList.add('active'); previewNote(t, p); } }
}
function previewNote(t, p) { engine.previewNote(t.id, trackNoteFreq(t, p, project.key, SCALES[project.scale].steps)); }

function mixerControls(t) {
  const mx = el('div', 'mx'); const m = project.mixer[t.id];
  const mute = el('button', 'mxb' + (m.mute ? ' on' : ''), 'M'); mute.title = 'Mute'; mute.addEventListener('click', () => { m.mute = !m.mute; mute.classList.toggle('on', m.mute); engine.refresh(); });
  const solo = el('button', 'mxb solo' + (m.solo ? ' on' : ''), 'S'); solo.title = 'Solo'; solo.addEventListener('click', () => { m.solo = !m.solo; solo.classList.toggle('on', m.solo); engine.refresh(); });
  const vol = el('input'); vol.type = 'range'; vol.min = 0; vol.max = 1; vol.step = 0.01; vol.value = m.vol; vol.className = 'mxvol'; vol.addEventListener('input', () => { m.vol = +vol.value; engine.refresh(); });
  mx.append(mute, solo, vol); return mx;
}

// ---- side panel ---------------------------------------------------------
function buildSidePanel() { const s = $('sidePanel'); s.innerHTML = ''; s.append(generatorPanel(), patternBank(), songPanel(), instrumentPanel(), fxPanel(), musicPanel(), ioPanel()); }
function group(title) { const g = el('section', 'sgroup'); g.append(el('h3', null, title)); return g; }

function generatorPanel() {
  const g = group('Generator');
  const style = el('select', 'inline-select'); STYLES.forEach((n) => { const o = el('option', null, n); o.value = n; style.append(o); }); style.value = 'House'; style.id = 'styleSelect';
  g.append(ctlRow('Style', style));
  const row = el('div', 'brow');
  const gen = el('button', 'btn primary sm', '✨ Generate'); gen.addEventListener('click', () => { pushUndo(); generateStyle(project, style.value); syncTransport(); buildSeq(); refreshBank(); toast(style.value + ' beat generated'); });
  const mut = el('button', 'btn sm', '↝ Mutate'); mut.addEventListener('click', () => { pushUndo(); mutate(); buildSeq(); });
  row.append(gen, mut); g.append(row);
  g.append(knobRow('Humanize', 0, 1, 0.01, project.humanize, (v) => project.humanize = v));
  const kit = el('select', 'inline-select'); KITS.forEach((k) => { const o = el('option', null, k); o.value = k; kit.append(o); }); kit.value = project.kit; kit.id = 'kitSelect';
  kit.addEventListener('change', () => project.kit = kit.value);
  g.append(ctlRow('Drum kit', kit));
  return g;
}
function patternBank() {
  const g = group('Patterns'); const bank = el('div', 'pbank');
  for (let i = 0; i < 8; i++) { const b = el('button', 'pslot' + (i === project.patternIndex ? ' on' : '') + (patternHasContent(i) ? ' filled' : ''), String.fromCharCode(65 + i)); b.addEventListener('click', () => { project.patternIndex = i; buildSeq(); refreshBank(); }); bank.append(b); }
  g.append(bank);
  const row = el('div', 'brow');
  const dup = el('button', 'btn ghost sm', '⧉ Dup'); dup.addEventListener('click', () => { pushUndo(); const dst = (project.patternIndex + 1) % 8; project.patterns[dst] = clonePattern(project.patterns[project.patternIndex]); project.patternIndex = dst; buildSeq(); refreshBank(); });
  const clr = el('button', 'btn ghost sm', '⌫ Clear'); clr.addEventListener('click', () => { pushUndo(); project.patterns[project.patternIndex] = makePattern(project.steps); buildSeq(); refreshBank(); });
  row.append(dup, clr); g.append(row);
  return g;
}
function refreshBank() { const bank = document.querySelector('.pbank'); if (bank) [...bank.children].forEach((b, i) => { b.classList.toggle('on', i === project.patternIndex); b.classList.toggle('filled', patternHasContent(i)); }); }
function patternHasContent(i) { const pat = project.patterns[i]; return TRACKS.some((t) => t.kind === 'drum' ? pat.seq[t.id].some((v) => v > 0) : pat.seq[t.id].some((a) => a.length)); }

function songPanel() {
  const g = group('Song'); g.id = 'songPanel';
  const chain = el('div', 'chain'); chain.id = 'chainEl';
  renderChain(chain);
  g.append(chain);
  const row = el('div', 'brow');
  const add = el('button', 'btn ghost sm', '＋ Step'); add.addEventListener('click', () => { project.song.chain.push(project.patternIndex); renderChain(chain); });
  const en = el('button', 'btn sm' + (project.song.on ? ' on' : ''), '▷ Play song'); en.id = 'songPlayBtn'; en.addEventListener('click', () => { project.song.on = !project.song.on; en.classList.toggle('on', project.song.on); $('songBtn').classList.toggle('on', project.song.on); });
  row.append(add, en); g.append(row);
  g.append(el('p', 'tip', 'Chain patterns into a song. Click a step to cycle its pattern; it advances each loop while “Play song” is on.'));
  return g;
}
function renderChain(chain) {
  chain.innerHTML = '';
  project.song.chain.forEach((pi, idx) => {
    const c = el('button', 'chain-slot' + (project.song.on && idx === songPos ? ' cur' : ''), String.fromCharCode(65 + pi));
    c.addEventListener('click', () => { project.song.chain[idx] = (pi + 1) % 8; renderChain(chain); });
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); if (project.song.chain.length > 1) { project.song.chain.splice(idx, 1); renderChain(chain); } });
    chain.append(c);
  });
}

let instrumentPanelEl;
function instrumentPanel() { const g = group('Instrument'); g.id = 'instrPanel'; instrumentPanelEl = g; renderInstrument(g); return g; }
function renderInstrument(g) {
  [...g.querySelectorAll('.instr-body')].forEach((n) => n.remove());
  const body = el('div', 'instr-body'); const t = TRACK_MAP[selectedTrack];
  body.append(el('div', 'instr-name', `<span class="tdot" style="background:${t.color}"></span> ${t.name}`));
  body.append(knobRow('Chance', 0, 1, 0.01, project.mixer[t.id].prob, (v) => { project.mixer[t.id].prob = v; }));
  if (t.kind === 'synth') {
    const p = project.synth[t.id];
    const eng = el('select', 'inline-select'); ENGINES.forEach((e) => { const o = el('option', null, e); o.value = e; eng.append(o); }); eng.value = p.engine; eng.addEventListener('change', () => p.engine = eng.value);
    body.append(ctlRow('Engine', eng));
    const wave = el('select', 'inline-select');['sine', 'triangle', 'sawtooth', 'square'].forEach((w) => { const o = el('option', null, w); o.value = w; wave.append(o); }); wave.value = p.wave; wave.addEventListener('change', () => p.wave = wave.value);
    body.append(ctlRow('Wave', wave));
    body.append(knobRow('Cutoff', 80, 12000, 10, p.cutoff, (v) => p.cutoff = v));
    body.append(knobRow('Reso', 0.5, 22, 0.1, p.reso, (v) => p.reso = v));
    body.append(knobRow('Attack', 0.001, 0.4, 0.001, p.attack, (v) => p.attack = v));
    body.append(knobRow('Decay', 0.02, 0.8, 0.01, p.decay, (v) => p.decay = v));
    body.append(knobRow('Sustain', 0, 1, 0.01, p.sustain, (v) => p.sustain = v));
    body.append(knobRow('Release', 0.02, 1.4, 0.01, p.release, (v) => p.release = v));
    body.append(knobRow('Gate', 0.1, 4, 0.05, p.gate, (v) => p.gate = v));
    if (!t.poly) body.append(knobRow('Glide', 0, 0.2, 0.005, p.glide, (v) => p.glide = v));
  } else {
    const fill = el('div', 'brow');
    const label = el('span', 'tip', 'Euclid fill:');
    const inp = el('input'); inp.type = 'number'; inp.min = 0; inp.max = project.steps; inp.value = 4; inp.className = 'num'; inp.style.width = '52px';
    const go = el('button', 'btn ghost sm', 'Fill'); go.addEventListener('click', () => { pushUndo(); euclidFill(t.id, clamp(+inp.value, 0, project.steps)); buildSeq(); });
    fill.append(inp, go); body.append(el('p', 'tip', 'Right-click a step for a <b>ratchet</b> (roll). Drag a step up/down for <b>velocity</b>.'), fill);
  }
  g.append(body);
}
function euclidFill(id, k) { const a = project.patterns[project.patternIndex].seq[id], n = project.steps; a.fill(0); for (let i = 0; i < n; i++) if (Math.floor((i * k) / n) !== Math.floor(((i - 1) * k) / n)) a[i] = 0.85; }
function ctlRow(label, node) { const r = el('label', 'ctl'); r.append(el('span', null, label), node, el('output')); return r; }
function knobRow(label, min, max, step, val, on) { const r = el('label', 'ctl'); const rng = el('input'); rng.type = 'range'; rng.min = min; rng.max = max; rng.step = step; rng.value = val; const out = el('output', null, fmt(val)); rng.addEventListener('input', () => { const v = +rng.value; out.textContent = fmt(v); on(v); }); r.append(el('span', null, label), rng, out); return r; }
function fmt(v) { return v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(v < 1 ? 3 : 2); }

function fxPanel() { const g = group('Master FX'); const m = project.master; g.append(knobRow('Drive', 0, 1, 0.01, m.drive, (v) => { m.drive = v; engine.refresh(); }), knobRow('Filter', 0, 1, 0.01, m.cutoff, (v) => { m.cutoff = v; engine.refresh(); }), knobRow('Reverb', 0, 0.9, 0.01, m.reverb, (v) => { m.reverb = v; engine.refresh(); }), knobRow('Delay', 0, 0.7, 0.01, m.delay, (v) => { m.delay = v; engine.refresh(); })); return g; }
function musicPanel() {
  const g = group('Key & Scale');
  const key = el('select', 'inline-select'); KEYS.forEach((k, i) => { const o = el('option', null, k); o.value = i; key.append(o); }); key.value = project.key; key.addEventListener('change', () => { project.key = +key.value; buildSeq(); });
  const scale = el('select', 'inline-select'); Object.entries(SCALES).forEach(([id, sc]) => { const o = el('option', null, sc.name); o.value = id; scale.append(o); }); scale.value = project.scale; scale.addEventListener('change', () => { project.scale = scale.value; buildSeq(); });
  g.append(ctlRow('Root', key), ctlRow('Scale', scale), el('p', 'tip', 'Play the <b>Lead</b> live: keys <b>Z–M</b> &amp; <b>Q–U</b>. <b>⌘/Ctrl+Z</b> to undo.'));
  return g;
}
function ioPanel() {
  const g = group('Project');
  const r1 = el('div', 'brow');
  const share = el('button', 'btn primary sm', '⇪ Share'); share.addEventListener('click', doShare);
  const wav = el('button', 'btn sm', '⬇ WAV'); wav.id = 'wavBtn'; wav.addEventListener('click', doExportWav);
  const midi = el('button', 'btn sm', '⬇ MIDI'); midi.addEventListener('click', doExportMidi);
  r1.append(share, wav, midi); g.append(r1);
  const r2 = el('div', 'brow');
  const save = el('button', 'btn ghost sm', '★ Save'); save.addEventListener('click', doSave);
  const load = el('select', 'inline-select'); load.id = 'loadSelect'; load.addEventListener('change', () => { if (load.value) doLoad(load.value); });
  r2.append(save, load); g.append(r2); refreshSavedList(load);
  return g;
}

function selectTrack(id) { selectedTrack = id; document.querySelectorAll('.drum-row, .track-headbar').forEach((r) => r.classList.toggle('sel', r.dataset.track === id)); if (instrumentPanelEl) renderInstrument(instrumentPanelEl); }

// ---- transport handlers -------------------------------------------------
function bindTransport() {
  $('playBtn').addEventListener('click', togglerun);
  $('bpmInput').addEventListener('input', () => { project.bpm = clamp(+$('bpmInput').value || 110, 40, 220); engine.refresh(); });
  $('swingInput').addEventListener('input', () => project.swing = +$('swingInput').value);
  $('masterVolInput').addEventListener('input', () => { project.master.vol = +$('masterVolInput').value; engine.refresh(); });
  $('metroBtn').addEventListener('click', () => { project.metronome = !project.metronome; $('metroBtn').classList.toggle('on', project.metronome); });
  $('songBtn').addEventListener('click', () => { project.song.on = !project.song.on; $('songBtn').classList.toggle('on', project.song.on); const b = $('songPlayBtn'); if (b) b.classList.toggle('on', project.song.on); });
  $('tapBtn').addEventListener('click', tapTempo);
  $('barMinus').addEventListener('click', () => setBars(project.bars - 1));
  $('barPlus').addEventListener('click', () => setBars(project.bars + 1));
  $('scopeModeBtn').addEventListener('click', () => { scopeMode = scopeMode === 'wave' ? 'spectrum' : 'wave'; $('scopeModeBtn').textContent = scopeMode === 'wave' ? '∿' : '▮'; });
}
let running = false;
function togglerun() { running = !running; if (running) { songPos = 0; if (project.song.on) project.patternIndex = project.song.chain[0]; engine.play(); } else engine.stop(); $('playBtn').innerHTML = running ? '❚❚ Stop' : '▶ Play'; $('playBtn').classList.toggle('paused', running); if (!running) highlight(-1); }
let taps = [];
function tapTempo() { const now = performance.now(); taps = taps.filter((t) => now - t < 2000); taps.push(now); if (taps.length >= 2) { const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); project.bpm = clamp(Math.round(60000 / avg), 40, 220); $('bpmInput').value = project.bpm; engine.refresh(); } }
function syncTransport() { $('bpmInput').value = project.bpm; $('swingInput').value = project.swing; $('masterVolInput').value = project.master.vol; $('barsLbl').textContent = project.bars + (project.bars > 1 ? ' bars' : ' bar'); if ($('kitSelect')) $('kitSelect').value = project.kit; }
function setBars(n) { n = clamp(n, 1, MAX_BARS); if (n === project.bars) return; pushUndo(); const old = project.steps; project.bars = n; project.steps = n * 16; for (const pat of project.patterns) for (const t of TRACKS) { const cur = pat.seq[t.id]; const next = makeSeq(t, project.steps); for (let i = 0; i < Math.min(old, project.steps); i++) next[i] = t.kind === 'drum' ? cur[i] : cur[i].slice(); pat.seq[t.id] = next; if (t.kind === 'drum') { const nr = new Uint8Array(project.steps).fill(1); for (let i = 0; i < Math.min(old, project.steps); i++) nr[i] = pat.ratchet[t.id][i]; pat.ratchet[t.id] = nr; } } $('barsLbl').textContent = n + (n > 1 ? ' bars' : ' bar'); buildSeq(); }

// ---- save / load / share ------------------------------------------------
function serialize(p) {
  const o = { bpm: p.bpm, swing: p.swing, bars: p.bars, steps: p.steps, key: p.key, scale: p.scale, kit: p.kit, metronome: !!p.metronome, humanize: p.humanize, patternIndex: p.patternIndex, song: p.song, master: p.master, mixer: p.mixer, synth: p.synth, patterns: [] };
  p.patterns.forEach((pat, i) => {
    if (!patternHasContent(i)) return;
    const seq = {}, ratchet = {};
    for (const t of TRACKS) { if (t.kind === 'drum') { const a = Array.from(pat.seq[t.id]); if (a.some((v) => v > 0)) seq[t.id] = a.map((v) => +v.toFixed(2)); const rr = Array.from(pat.ratchet[t.id]); if (rr.some((v) => v > 1)) ratchet[t.id] = rr; } else if (pat.seq[t.id].some((x) => x.length)) seq[t.id] = pat.seq[t.id]; }
    o.patterns.push({ i, seq, ratchet });
  });
  return o;
}
function deserialize(o) {
  const p = defaultProject();
  p.bpm = o.bpm ?? p.bpm; p.swing = o.swing ?? p.swing; p.bars = o.bars ?? Math.max(1, (o.steps || 16) / 16); p.steps = o.steps ?? p.bars * 16;
  p.key = o.key ?? p.key; p.scale = o.scale ?? p.scale; p.kit = o.kit ?? p.kit; p.metronome = !!o.metronome; p.humanize = o.humanize ?? p.humanize; p.patternIndex = o.patternIndex || 0;
  if (o.song) p.song = o.song; if (o.master) p.master = o.master; if (o.mixer) p.mixer = o.mixer; if (o.synth) p.synth = o.synth;
  for (const t of TRACKS) { if (!p.mixer[t.id]) p.mixer[t.id] = { vol: 0.85, pan: 0, mute: false, solo: false, prob: 1 }; if (p.mixer[t.id].prob == null) p.mixer[t.id].prob = 1; if (t.kind === 'synth' && !p.synth[t.id]) p.synth[t.id] = defaultSynthParams(t.id); }
  p.patterns = Array.from({ length: 8 }, () => makePattern(p.steps));
  for (const ent of (o.patterns || [])) { const pat = p.patterns[ent.i]; if (!pat) continue; for (const t of TRACKS) { const d = ent.seq[t.id]; if (d) { if (t.kind === 'drum') { const arr = makeSeq(t, p.steps); for (let i = 0; i < Math.min(d.length, p.steps); i++) arr[i] = d[i]; pat.seq[t.id] = arr; } else pat.seq[t.id] = d.map((a) => a.slice()); } if (t.kind === 'drum' && ent.ratchet && ent.ratchet[t.id]) { const rr = ent.ratchet[t.id]; for (let i = 0; i < Math.min(rr.length, p.steps); i++) pat.ratchet[t.id][i] = rr[i]; } } }
  return p;
}
function doShare() { const code = btoa(unescape(encodeURIComponent(JSON.stringify(serialize(project))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); const url = `${location.origin}${location.pathname}#${code}`; history.replaceState(null, '', '#' + code); navigator.clipboard.writeText(url).then(() => toast('Project link copied')).catch(() => toast('Link set in address bar')); }
function loadFromHash() { const h = location.hash.slice(1); if (!h) return false; try { project = deserialize(JSON.parse(decodeURIComponent(escape(atob(h.replace(/-/g, '+').replace(/_/g, '/')))))); return true; } catch { return false; } }
const LS_KEY = 'pulse-projects';
function savedProjects() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } }
function doSave() { const name = prompt('Save project as:', 'My beat'); if (!name) return; const all = savedProjects(); all[name] = serialize(project); localStorage.setItem(LS_KEY, JSON.stringify(all)); refreshSavedList($('loadSelect')); toast('Saved “' + name + '”'); }
function doLoad(name) { const all = savedProjects(); if (!all[name]) return; pushUndo(); project = deserialize(all[name]); afterLoad(); toast('Loaded “' + name + '”'); }
function refreshSavedList(sel) { if (!sel) return; sel.innerHTML = ''; sel.append(el('option', null, 'Load…')); Object.keys(savedProjects()).forEach((n) => { const o = el('option', null, n); o.value = n; sel.append(o); }); }
function afterLoad() { syncTransport(); buildSeq(); buildSidePanel(); refreshBank(); engine.refresh(); }
async function doExportWav() { const btn = $('wavBtn'), prev = btn.textContent; btn.textContent = '…'; btn.disabled = true; try { engine.unlock(); const blob = await engine.exportWav(2); download(blob, `pulse-${project.bpm}bpm-${Date.now()}.wav`); toast('Exported WAV'); } catch (e) { toast('Export failed'); } btn.textContent = prev; btn.disabled = false; }
function doExportMidi() { try { download(exportMidi(project), `pulse-${project.bpm}bpm-${Date.now()}.mid`); toast('Exported MIDI'); } catch (e) { toast('MIDI failed'); } }
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

// ---- keyboard -----------------------------------------------------------
const KEYMAP = { KeyZ: 0, KeyX: 1, KeyC: 2, KeyV: 3, KeyB: 4, KeyN: 5, KeyM: 6, KeyQ: 7, KeyW: 8, KeyE: 9, KeyR: 10, KeyT: 11, KeyY: 12, KeyU: 13 };
function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (e.repeat || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); togglerun(); return; }
    const p = KEYMAP[e.code]; if (p != null) engine.previewNote('lead', trackNoteFreq(TRACK_MAP.lead, p, project.key, SCALES[project.scale].steps));
  });
}

// ---- playhead + scope + song advance ------------------------------------
let lastCol = -1;
function highlight(col) {
  if (col === lastCol) return;
  if (col === 0 && lastCol > 0) advanceSong();
  if (lastCol >= 0 && colCells[lastCol]) colCells[lastCol].forEach((c) => c.classList.remove('playhead'));
  if (col >= 0 && colCells[col]) { colCells[col].forEach((c) => c.classList.add('playhead')); autoScroll(col); }
  lastCol = col;
}
function autoScroll(col) {
  const sc = $('seqScroll'), cell = colCells[col] && colCells[col][0]; if (!sc || !cell) return;
  const cr = cell.getBoundingClientRect(), sr = sc.getBoundingClientRect();
  if (cr.left < sr.left + 180) sc.scrollLeft += cr.left - sr.left - 180;
  else if (cr.right > sr.right - 20) sc.scrollLeft += cr.right - sr.right + 40;
}
function advanceSong() {
  if (!project.song.on || !running) return;
  songPos = (songPos + 1) % project.song.chain.length;
  project.patternIndex = project.song.chain[songPos];
  buildSeq(); refreshBank();
  const chain = $('chainEl'); if (chain) [...chain.children].forEach((c, i) => c.classList.toggle('cur', i === songPos));
}
let scopeMode = 'wave';
function drawScope() {
  const cv = $('scope');
  if (cv) {
    const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height); const an = engine.analyser;
    if (an && running) {
      if (scopeMode === 'wave') { const n = an.fftSize, data = new Uint8Array(n); an.getByteTimeDomainData(data); ctx.beginPath(); ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.5; for (let i = 0; i < n; i += 4) { const x = (i / n) * cv.width, y = (data[i] / 255) * cv.height; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); }
      else { const n = an.frequencyBinCount, data = new Uint8Array(n); an.getByteFrequencyData(data); const bars = 40; for (let i = 0; i < bars; i++) { const v = data[(i / bars * n) | 0] / 255; const h = v * cv.height; ctx.fillStyle = `hsl(${190 + v * 80},70%,60%)`; ctx.fillRect(i / bars * cv.width, cv.height - h, cv.width / bars - 1, h); } }
    } else { ctx.strokeStyle = 'rgba(120,130,160,0.4)'; ctx.beginPath(); ctx.moveTo(0, cv.height / 2); ctx.lineTo(cv.width, cv.height / 2); ctx.stroke(); }
  }
  if (mode3d && p3d && p3d.ready) { p3d.update(grid3d(), project.steps, running ? lastCol : -1); p3d.render(0.016); }
  requestAnimationFrame(drawScope);
}
function frameStep() { if (running) { const s = engine.drawStep(); if (s >= 0) highlight(s); } requestAnimationFrame(frameStep); }

// ---- 3D -----------------------------------------------------------------
let mode3d = false, p3d = null;
function grid3d() { const pat = project.patterns[project.patternIndex], rows = []; for (const t of TRACKS.filter((x) => x.kind === 'drum')) rows.push({ color: hexRGB(t.color).map((c) => c / 255), cells: Array.from(pat.seq[t.id]) }); for (const t of TRACKS.filter((x) => x.kind === 'synth')) for (let p = 0; p < t.rows; p++) { const cells = []; for (let c = 0; c < project.steps; c++) cells.push(pat.seq[t.id][c].includes(p) ? 0.9 : 0); rows.push({ color: hexRGB(t.color).map((c) => c / 255), cells }); } return rows; }
async function toggle3D() { const btn = $('mode3dBtn'); if (!mode3d) { if (!p3d) { p3d = new Pulse3D(); await p3d.init(); } mode3d = true; document.body.classList.add('mode-3d'); btn.textContent = '◱ 2D'; btn.classList.add('active'); p3d.activate(); } else { mode3d = false; document.body.classList.remove('mode-3d'); btn.textContent = '⬗ 3D'; btn.classList.remove('active'); if (p3d) p3d.deactivate(); } }

// ---- misc ---------------------------------------------------------------
let toastTimer; function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }

// ---- boot ---------------------------------------------------------------
initNav('pulse');
project = defaultProject();
loadFromHash();
buildTransport(); buildSeq(); buildSidePanel(); bindTransport(); bindKeyboard(); selectTrack(selectedTrack);
$('mode3dBtn').addEventListener('click', () => toggle3D());
$('panelToggle').addEventListener('click', () => document.body.classList.toggle('panel-open'));
if (window.innerWidth > 900) document.body.classList.add('panel-open');
requestAnimationFrame(drawScope); requestAnimationFrame(frameStep);
