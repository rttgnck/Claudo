// pulse.js — a step sequencer built on the Web Audio API. Four synthesized
// drum voices plus an 8-note, scale-locked melody lane, so every pattern you
// tap out (or randomize) lands in key and sounds musical. A look-ahead
// scheduler keeps timing rock-solid independent of the render loop.
import { initNav } from './nav.js';
import { Pulse3D } from './pulse3d.js';

const $ = (id) => document.getElementById(id);
let mode3d = false, p3d = null;
const STEPS = 16;

// ---- musical setup ------------------------------------------------------
const SCALES = {
  minor: [0, 3, 5, 7, 10],
  major: [0, 2, 4, 7, 9],
};
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

function melodyFreqs(keyIdx, scaleName) {
  const root = 48 + keyIdx; // around C3
  const scale = SCALES[scaleName];
  const out = [];
  for (let i = 0; i < 8; i++) {
    const oct = Math.floor(i / scale.length);
    out.push(midiToFreq(root + oct * 12 + scale[i % scale.length]));
  }
  return out; // index 0 = lowest
}

// ---- state --------------------------------------------------------------
const state = {
  bpm: 112,
  swing: 0.12,
  volume: 0.8,
  key: 0,
  scale: 'minor',
  drums: [new Uint8Array(STEPS), new Uint8Array(STEPS), new Uint8Array(STEPS), new Uint8Array(STEPS)],
  melody: new Int8Array(STEPS).fill(-1),
};
const DRUMS = [
  { name: 'Kick',  color: '#ff5c7c' },
  { name: 'Snare', color: '#ffd166' },
  { name: 'Hat',   color: '#38bdf8' },
  { name: 'Clap',  color: '#a78bfa' },
];

// ---- audio graph --------------------------------------------------------
let ctx, master, comp, delay, delayMix, noiseBuf;
function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = state.volume;
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.18;
  master.connect(comp); comp.connect(ctx.destination);

  delay = ctx.createDelay(1.0);
  delay.delayTime.value = (60 / state.bpm) * 0.75; // dotted-eighth echo
  const fb = ctx.createGain(); fb.gain.value = 0.3;
  delay.connect(fb); fb.connect(delay);
  delayMix = ctx.createGain(); delayMix.gain.value = 0.28;
  delay.connect(delayMix); delayMix.connect(master);

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
function noise() { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; }
function env(node, t, peak, attack, decay) {
  const g = node.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(peak, t + attack);
  g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

// ---- drum voices --------------------------------------------------------
function kick(t) {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  env(g, t, 1.0, 0.004, 0.34);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.4);
}
function snare(t) {
  const n = noise(); const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.8;
  const ng = ctx.createGain(); env(ng, t, 0.7, 0.003, 0.18);
  n.connect(nf); nf.connect(ng); ng.connect(master);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 180;
  const og = ctx.createGain(); env(og, t, 0.35, 0.003, 0.09);
  o.connect(og); og.connect(master);
  n.start(t); n.stop(t + 0.22); o.start(t); o.stop(t + 0.12);
}
function hat(t, open) {
  const n = noise(); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
  const g = ctx.createGain(); env(g, t, 0.4, 0.002, open ? 0.16 : 0.045);
  n.connect(f); f.connect(g); g.connect(master);
  n.start(t); n.stop(t + 0.2);
}
function clap(t) {
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.9;
  const g = ctx.createGain(); f.connect(g); g.connect(master); g.connect(delay);
  for (const off of [0, 0.012, 0.024]) {
    const n = noise(); const ng = ctx.createGain(); env(ng, t + off, 0.5, 0.002, 0.06);
    n.connect(ng); ng.connect(f); n.start(t + off); n.stop(t + off + 0.09);
  }
}
const DRUM_FN = [kick, snare, (t) => hat(t, false), clap];

function pluck(t, freq) {
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = freq;
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = freq; o2.detune.value = 6;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
  f.frequency.setValueAtTime(3600, t);
  f.frequency.exponentialRampToValueAtTime(700, t + 0.22);
  const g = ctx.createGain(); env(g, t, 0.5, 0.004, 0.34);
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(master); g.connect(delay);
  o1.start(t); o2.start(t); o1.stop(t + 0.5); o2.stop(t + 0.5);
}

// ---- scheduler ----------------------------------------------------------
let playing = false, currentStep = 0, nextTime = 0, timer = null;
const drawQueue = [];
let freqs = melodyFreqs(state.key, state.scale);

function scheduleStep(step, t) {
  for (let r = 0; r < 4; r++) if (state.drums[r][step]) DRUM_FN[r](t);
  const m = state.melody[step];
  if (m >= 0) pluck(t, freqs[m]);
  drawQueue.push({ step, t });
}
function advance() {
  const stepDur = (60 / state.bpm) / 4;
  nextTime += stepDur;
  currentStep = (currentStep + 1) % STEPS;
}
function scheduler() {
  const stepDur = (60 / state.bpm) / 4;
  while (nextTime < ctx.currentTime + 0.1) {
    const swung = (currentStep % 2 === 1) ? state.swing * stepDur : 0;
    scheduleStep(currentStep, nextTime + swung);
    advance();
  }
}
function play() {
  initAudio();
  if (ctx.state === 'suspended') ctx.resume();
  playing = true;
  currentStep = 0; nextTime = ctx.currentTime + 0.06;
  timer = setInterval(scheduler, 25);
  $('playBtn').innerHTML = '❚❚ Stop'; $('playBtn').classList.add('paused');
}
function stop() {
  playing = false;
  clearInterval(timer); timer = null;
  drawQueue.length = 0;
  highlight(-1);
  $('playBtn').innerHTML = '▶ Play'; $('playBtn').classList.remove('paused');
}

// ---- grid UI ------------------------------------------------------------
const colEls = Array.from({ length: STEPS }, () => []);
let drumCells = [], melCells = [];
function buildGrid() {
  const seq = $('seq');
  seq.innerHTML = '';
  drumCells = []; melCells = [];
  freqs = melodyFreqs(state.key, state.scale);

  // Melody lane (high pitch on top).
  for (let p = 7; p >= 0; p--) {
    const row = document.createElement('div'); row.className = 'seq-row mel-row';
    const label = document.createElement('div'); label.className = 'seq-label mel-label';
    label.textContent = p === 7 || p === 0 ? noteName(freqs[p]) : '';
    row.appendChild(label);
    for (let c = 0; c < STEPS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell mel' + (c % 4 === 0 ? ' beat' : '');
      if (state.melody[c] === p) cell.classList.add('active');
      cell.addEventListener('pointerdown', () => toggleMel(c, p));
      row.appendChild(cell); colEls[c].push(cell); (melCells[p] ||= [])[c] = cell;
    }
    seq.appendChild(row);
  }

  const div = document.createElement('div'); div.className = 'seq-divider'; seq.appendChild(div);

  // Drum lanes.
  DRUMS.forEach((d, r) => {
    const row = document.createElement('div'); row.className = 'seq-row';
    const label = document.createElement('div'); label.className = 'seq-label';
    label.textContent = d.name; label.style.color = d.color;
    row.appendChild(label);
    drumCells[r] = [];
    for (let c = 0; c < STEPS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell drum' + (c % 4 === 0 ? ' beat' : '');
      cell.style.setProperty('--c', d.color);
      if (state.drums[r][c]) cell.classList.add('active');
      cell.addEventListener('pointerdown', () => toggleDrum(r, c));
      row.appendChild(cell); colEls[c].push(cell); drumCells[r][c] = cell;
    }
    seq.appendChild(row);
  });
}
function noteName(freq) {
  const m = Math.round(69 + 12 * Math.log2(freq / 440));
  return KEYS[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}
function toggleDrum(r, c) {
  const v = state.drums[r][c] ? 0 : 1;
  state.drums[r][c] = v;
  drumCells[r][c].classList.toggle('active', !!v);
  if (v && audible()) DRUM_FN[r](ctx.currentTime);
  clearPreset();
}
function toggleMel(c, p) {
  const cur = state.melody[c];
  // Clear any active note already in this column (monophonic lane).
  for (let q = 0; q < 8; q++) if (melCells[q] && melCells[q][c]) melCells[q][c].classList.remove('active');
  if (cur === p) { state.melody[c] = -1; }
  else { state.melody[c] = p; melCells[p][c].classList.add('active'); if (audible()) pluck(ctx.currentTime, freqs[p]); }
  clearPreset();
}
// Audition a note/drum when placed (only once audio is unlocked).
function audible() { return ctx && ctx.state === 'running'; }

// ---- playhead -----------------------------------------------------------
let lastCol = -1;
function highlight(col) {
  if (col === lastCol) return;
  if (lastCol >= 0) colEls[lastCol].forEach((c) => c.classList.remove('playhead'));
  if (col >= 0) colEls[col].forEach((c) => c.classList.add('playhead'));
  lastCol = col;
}
let last3 = performance.now();
function draw(now) {
  const dt = Math.min((now - last3) / 1000, 0.05); last3 = now;
  if (playing && ctx) {
    while (drawQueue.length && drawQueue[0].t <= ctx.currentTime) {
      highlight(drawQueue.shift().step);
    }
  }
  if (mode3d && p3d && p3d.ready) p3d.update(state.drums, state.melody, playing ? lastCol : -1), p3d.render(dt);
  requestAnimationFrame(draw);
}

async function toggle3D() {
  const btn = $('mode3dBtn');
  if (!mode3d) {
    if (!p3d) { p3d = new Pulse3D(); await p3d.init(); }
    mode3d = true; document.body.classList.add('mode-3d');
    btn.textContent = '◱ 2D'; btn.classList.add('active');
    p3d.activate();
  } else {
    mode3d = false; document.body.classList.remove('mode-3d');
    btn.textContent = '⬗ 3D'; btn.classList.remove('active');
    if (p3d) p3d.deactivate();
  }
}

// ---- pattern generation -------------------------------------------------
function randomize() {
  const D = state.drums;
  D.forEach((row) => row.fill(0));
  for (let i = 0; i < STEPS; i += 4) D[0][i] = 1;                 // kick four-on-floor
  if (Math.random() < 0.5) D[0][10] = 1;
  D[1][4] = 1; D[1][12] = 1;                                       // snare backbeat
  for (let i = 0; i < STEPS; i++) if (i % 2 === 0 || Math.random() < 0.25) D[2][i] = 1; // hats
  if (Math.random() < 0.4) { D[3][4] = 1; D[3][12] = 1; }
  // Melody: sparse, mostly stepwise motion.
  state.melody.fill(-1);
  let p = 2 + (Math.random() * 4 | 0);
  for (let c = 0; c < STEPS; c++) {
    if (Math.random() < 0.42) {
      p = Math.max(0, Math.min(7, p + (Math.random() * 3 | 0) - 1));
      state.melody[c] = p;
    }
  }
  buildGrid(); clearPreset();
}
function clearAll() {
  state.drums.forEach((r) => r.fill(0));
  state.melody.fill(-1);
  buildGrid(); clearPreset();
}

const PRESETS = {
  'House': { bpm: 124, d: [[0,4,8,12],[4,12],[2,6,10,14],[]], m: { 0:2, 6:4, 8:5, 14:3 } },
  'Lo-fi': { bpm: 82, d: [[0,8],[4,12],[2,6,10,14],[]], m: { 0:4, 3:2, 8:5, 11:3, 12:1 } },
  'Trap':  { bpm: 140, d: [[0,7,10],[4,12],[0,2,4,6,7,8,10,12,14,15],[]], m: { 0:5, 8:3 } },
  'Drift': { bpm: 96, d: [[0,6,10],[8],[0,4,8,12],[4,12]], m: { 0:0, 2:2, 4:4, 6:5, 10:4, 12:2, 14:0 } },
};
function loadPreset(name) {
  const p = PRESETS[name]; if (!p) return;
  state.bpm = p.bpm;
  state.drums.forEach((r) => r.fill(0));
  p.d.forEach((steps, r) => steps.forEach((s) => state.drums[r][s] = 1));
  state.melody.fill(-1);
  for (const [c, v] of Object.entries(p.m)) state.melody[+c] = v;
  syncControls(); buildGrid();
}
function clearPreset() { $('presetSelect').value = ''; }

// ---- controls -----------------------------------------------------------
function syncControls() {
  $('bpmRange').value = state.bpm; $('bpmVal').textContent = state.bpm;
  $('swingRange').value = state.swing; $('swingVal').textContent = Math.round(state.swing * 100) + '%';
  $('volRange').value = state.volume; $('volVal').textContent = Math.round(state.volume * 100);
  $('keySelect').value = state.key;
  $('scaleSelect').value = state.scale;
}
function bindControls() {
  $('bpmRange').addEventListener('input', () => {
    state.bpm = parseInt($('bpmRange').value); $('bpmVal').textContent = state.bpm;
    if (delay) delay.delayTime.setTargetAtTime((60 / state.bpm) * 0.75, ctx.currentTime, 0.05);
  });
  $('swingRange').addEventListener('input', () => { state.swing = parseFloat($('swingRange').value); $('swingVal').textContent = Math.round(state.swing * 100) + '%'; });
  $('volRange').addEventListener('input', () => { state.volume = parseFloat($('volRange').value); $('volVal').textContent = Math.round(state.volume * 100); if (master) master.gain.setTargetAtTime(state.volume, ctx.currentTime, 0.02); });
  $('keySelect').addEventListener('change', () => { state.key = parseInt($('keySelect').value); buildGrid(); });
  $('scaleSelect').addEventListener('change', () => { state.scale = $('scaleSelect').value; buildGrid(); });
}

// ---- share --------------------------------------------------------------
function encode() {
  const bytes = [1, state.bpm & 255, Math.round(state.swing * 255) & 255, state.key & 255, state.scale === 'minor' ? 0 : 1];
  for (let r = 0; r < 4; r++) {
    let bits = 0; for (let c = 0; c < STEPS; c++) if (state.drums[r][c]) bits |= (1 << c);
    bytes.push((bits >> 8) & 255, bits & 255);
  }
  for (let c = 0; c < STEPS; c += 2) {
    const a = state.melody[c] < 0 ? 0 : state.melody[c] + 1;
    const b = state.melody[c + 1] < 0 ? 0 : state.melody[c + 1] + 1;
    bytes.push((a << 4) | b);
  }
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(str) {
  try {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const b = [...bin].map((c) => c.charCodeAt(0));
    if (b[0] !== 1) return false;
    state.bpm = b[1] || 112; state.swing = b[2] / 255; state.key = b[3] % 12; state.scale = b[4] ? 'major' : 'minor';
    let p = 5;
    for (let r = 0; r < 4; r++) { const bits = (b[p++] << 8) | b[p++]; for (let c = 0; c < STEPS; c++) state.drums[r][c] = (bits >> c) & 1; }
    for (let c = 0; c < STEPS; c += 2) { const byte = b[p++]; const a = (byte >> 4) & 15, lo = byte & 15; state.melody[c] = a ? a - 1 : -1; state.melody[c + 1] = lo ? lo - 1 : -1; }
    return true;
  } catch { return false; }
}

// ---- buttons ------------------------------------------------------------
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2000); }
function bindButtons() {
  $('playBtn').addEventListener('click', () => playing ? stop() : play());
  $('randomBtn').addEventListener('click', randomize);
  $('clearBtn').addEventListener('click', clearAll);
  $('shareBtn').addEventListener('click', async () => {
    const code = encode(); const url = `${location.origin}${location.pathname}#${code}`;
    history.replaceState(null, '', `#${code}`);
    try { await navigator.clipboard.writeText(url); toast('Pattern link copied'); } catch { toast('Link set in address bar'); }
  });
  $('mode3dBtn').addEventListener('click', () => toggle3D());
  $('panelToggle').addEventListener('click', () => document.body.classList.toggle('panel-open'));
  document.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') { e.preventDefault(); playing ? stop() : play(); } });
}
function buildSelects() {
  const ks = $('keySelect'); KEYS.forEach((k, i) => { const o = document.createElement('option'); o.value = i; o.textContent = k; ks.appendChild(o); });
  const ps = $('presetSelect'); Object.keys(PRESETS).forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n; ps.appendChild(o); });
  ps.addEventListener('change', () => { if (ps.value) loadPreset(ps.value); });
}

// ---- boot ---------------------------------------------------------------
initNav('pulse');
buildSelects();
bindControls();
bindButtons();

const hash = location.hash.slice(1);
if (hash && decode(hash)) { /* loaded shared */ }
else { loadPreset('Drift'); }
syncControls();
buildGrid();
if (window.innerWidth > 820) document.body.classList.add('panel-open');

// Scroll to zoom the grid.
(() => {
  const seqEl = $('seq'), wrap = seqEl.parentElement; let z = 1;
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    z = Math.max(0.5, Math.min(2.4, z * Math.exp(-e.deltaY * 0.0012)));
    seqEl.style.transform = `scale(${z})`;
    seqEl.style.transformOrigin = 'center top';
  }, { passive: false });
})();

requestAnimationFrame(draw);
