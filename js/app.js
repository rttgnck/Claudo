// app.js — wires the engine, renderer, and UI into a running toy.
import { Simulation } from './simulation.js';
import { Renderer } from './renderer.js';
import { MatrixEditor } from './ui.js';
import { PRESETS } from './presets.js';
import { encodeState, decodeState } from './share.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');

const sim = new Simulation({ numColors: 6, count: 2400 });
const renderer = new Renderer(canvas);

let running = true;
let cursorMode = 1; // 1 attract, -1 repel

// ---- state <-> URL ------------------------------------------------------
function snapshot() {
  return {
    numColors: sim.numColors,
    count: sim.count,
    rMax: sim.rMax,
    beta: sim.beta,
    forceFactor: sim.forceFactor,
    friction: sim.friction,
    glow: renderer.glow,
    particleSize: renderer.particleSize,
    trails: renderer.trails,
    matrix: sim.matrix,
  };
}

function applyState(st) {
  sim.setColors(st.numColors);
  sim.setMatrix(st.matrix);
  sim.setCount(st.count);
  sim.rMax = st.rMax;
  sim.beta = st.beta;
  sim.forceFactor = st.forceFactor;
  sim.friction = st.friction;
  sim._allocate(); // grid depends on rMax
  renderer.glow = st.glow;
  renderer.particleSize = st.particleSize;
  renderer.trails = st.trails;
  renderer._bakeSprites();
  syncControls();
  editor.refresh();
}

// ---- controls -----------------------------------------------------------
const controls = [
  ['countRange', 'countVal', (v) => sim.setCount(v | 0), () => sim.count, (v) => v | 0],
  ['colorsRange', 'colorsVal', (v) => { sim.setColors(v | 0); editor.refresh(); }, () => sim.numColors, (v) => v | 0],
  ['rmaxRange', 'rmaxVal', (v) => { sim.rMax = v; sim._allocate(); }, () => sim.rMax, (v) => v.toFixed(3)],
  ['betaRange', 'betaVal', (v) => sim.beta = v, () => sim.beta, (v) => v.toFixed(2)],
  ['forceRange', 'forceVal', (v) => sim.forceFactor = v, () => sim.forceFactor, (v) => v.toFixed(1)],
  ['frictionRange', 'frictionVal', (v) => sim.friction = v, () => sim.friction, (v) => v.toFixed(2)],
  ['glowRange', 'glowVal', (v) => renderer.setGlow(v), () => renderer.glow, (v) => v.toFixed(2)],
  ['sizeRange', 'sizeVal', (v) => renderer.setParticleSize(v), () => renderer.particleSize, (v) => v.toFixed(1)],
  ['trailsRange', 'trailsVal', (v) => renderer.trails = v, () => renderer.trails, (v) => v.toFixed(2)],
];

function bindControls() {
  for (const [rangeId, valId, set, , fmt] of controls) {
    const range = $(rangeId);
    const val = $(valId);
    range.addEventListener('input', () => {
      const v = parseFloat(range.value);
      set(v);
      val.textContent = fmt(v);
    });
  }
}

function syncControls() {
  for (const [rangeId, valId, , get, fmt] of controls) {
    const v = get();
    $(rangeId).value = v;
    $(valId).textContent = fmt(v);
  }
}

// ---- presets ------------------------------------------------------------
function buildPresets() {
  const sel = $('presetSelect');
  PRESETS.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = p.name;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => {
    const p = PRESETS[+sel.value];
    if (!p) return;
    sim.setColors(p.colors);
    sim.setMatrix(p.matrix.map((r) => r.slice()));
    sim.randomizePositions();
    editor.refresh();
    syncControls();
  });
}

// ---- pointer interaction ------------------------------------------------
function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  const dx = ((e.touches ? e.touches[0].clientX : e.clientX) - rect.left) * (canvas.width / rect.width);
  const dy = ((e.touches ? e.touches[0].clientY : e.clientY) - rect.top) * (canvas.height / rect.height);
  const v = renderer.view;
  return { x: (dx - v.ox) / (canvas.width * v.zoom), y: (dy - v.oy) / (canvas.height * v.zoom) };
}
function bindPointer() {
  const down = (e) => {
    const p = pointerPos(e);
    sim.pointer.x = p.x; sim.pointer.y = p.y;
    sim.pointer.active = true;
    sim.pointer.strength = cursorMode * 26;
    dismissHint();
  };
  const move = (e) => {
    if (!sim.pointer.active) return;
    const p = pointerPos(e);
    sim.pointer.x = p.x; sim.pointer.y = p.y;
    if (e.cancelable) e.preventDefault();
  };
  const up = () => { sim.pointer.active = false; };
  canvas.addEventListener('mousedown', down);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  canvas.addEventListener('touchstart', down, { passive: true });
  canvas.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', up);

  // Scroll / pinch to zoom about the cursor.
  const zoomAt = (cssX, cssY, f) => {
    const rect = canvas.getBoundingClientRect();
    const dx = (cssX - rect.left) * (canvas.width / rect.width);
    const dy = (cssY - rect.top) * (canvas.height / rect.height);
    const v = renderer.view;
    const wx = (dx - v.ox) / (canvas.width * v.zoom), wy = (dy - v.oy) / (canvas.height * v.zoom);
    v.zoom = Math.max(0.5, Math.min(24, v.zoom * f));
    v.ox = dx - wx * canvas.width * v.zoom; v.oy = dy - wy * canvas.height * v.zoom;
  };
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0012)); }, { passive: false });
  let pd = 0;
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pd) zoomAt((e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2, d / pd);
    pd = d; e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchend', () => { pd = 0; });
}

// ---- buttons ------------------------------------------------------------
function bindButtons() {
  $('playBtn').addEventListener('click', () => {
    running = !running;
    $('playBtn').textContent = running ? '❚❚ Pause' : '▶ Play';
    $('playBtn').classList.toggle('paused', !running);
  });
  $('randomBtn').addEventListener('click', () => {
    sim.setMatrix(Simulation.randomMatrix(sim.numColors));
    sim.randomizePositions();
    editor.refresh();
    $('presetSelect').value = '';
    flashLogo();
  });
  $('restartBtn').addEventListener('click', () => sim.randomizePositions());

  $('cursorBtn').addEventListener('click', () => {
    cursorMode *= -1;
    $('cursorBtn').textContent = cursorMode > 0 ? '✦ Attract' : '✧ Repel';
  });

  $('shareBtn').addEventListener('click', async () => {
    const code = encodeState(snapshot());
    const url = `${location.origin}${location.pathname}#${code}`;
    history.replaceState(null, '', `#${code}`);
    try {
      await navigator.clipboard.writeText(url);
      toast('Universe link copied to clipboard');
    } catch {
      toast('Link set in address bar');
    }
  });

  $('saveBtn').addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = `claudo-${Date.now()}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  });

  $('panelToggle').addEventListener('click', () => {
    document.body.classList.toggle('panel-open');
  });
}

// ---- misc ---------------------------------------------------------------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function flashLogo() {
  const l = $('logo');
  l.classList.remove('flash');
  void l.offsetWidth;
  l.classList.add('flash');
}

let hintDismissed = false;
function dismissHint() {
  if (hintDismissed) return;
  hintDismissed = true;
  $('hint').classList.add('gone');
}

// ---- main loop ----------------------------------------------------------
let last = performance.now();
let fpsAcc = 0, fpsN = 0;
function frame(now) {
  const delta = now - last;
  last = now;
  fpsAcc += delta; fpsN++;
  if (fpsAcc > 500) {
    $('fps').textContent = Math.round(1000 / (fpsAcc / fpsN)) + ' fps';
    fpsAcc = 0; fpsN = 0;
  }
  if (running) sim.step();
  renderer.render(sim);
  requestAnimationFrame(frame);
}

// ---- boot ---------------------------------------------------------------
const editor = new MatrixEditor($('matrix'), sim, () => {
  $('presetSelect').value = '';
});

bindControls();
buildPresets();
bindPointer();
bindButtons();

window.addEventListener('resize', () => renderer.resize());

// Load a shared universe if present, else default preset.
const hash = location.hash.slice(1);
const loaded = hash && decodeState(hash);
if (loaded) {
  applyState(loaded);
  sim.randomizePositions();
} else {
  sim.setMatrix(PRESETS[0].matrix.map((r) => r.slice()));
  editor.refresh();
}
syncControls();

// Open panel by default on wide screens.
if (window.innerWidth > 820) document.body.classList.add('panel-open');

requestAnimationFrame(frame);
