// ripple.js — a 2-D wave tank. It integrates the wave equation
//   u_tt = c² ∇²u
// on a grid with a leapfrog finite-difference scheme, plus a "sponge" border
// that absorbs outgoing waves so nothing reflects off the canvas edge. Drop
// ripples, place oscillating sources, or paint reflecting walls and watch real
// interference and diffraction — including the double-slit experiment.
import { initNav } from './nav.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d');
const grid = document.createElement('canvas');
const gctx = grid.getContext('2d');

// ---- palettes -----------------------------------------------------------
function buildLUT(stops) {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0; while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1];
    const f = (t - t0) / (t1 - t0 || 1);
    lut[i * 3] = c0[0] + (c1[0] - c0[0]) * f;
    lut[i * 3 + 1] = c0[1] + (c1[1] - c0[1]) * f;
    lut[i * 3 + 2] = c0[2] + (c1[2] - c0[2]) * f;
  }
  return lut;
}
// Diverging maps: trough -> dark -> crest.
const PALETTES = {
  ocean:  buildLUT([[0, [10, 30, 90]], [0.5, [6, 10, 18]], [0.72, [30, 150, 170]], [1, [200, 255, 255]]]),
  ember:  buildLUT([[0, [70, 20, 100]], [0.5, [8, 6, 12]], [0.72, [230, 110, 40]], [1, [255, 245, 200]]]),
  mono:   buildLUT([[0, [20, 30, 45]], [0.5, [6, 7, 10]], [0.7, [120, 130, 150]], [1, [245, 248, 255]]]),
  neon:   buildLUT([[0, [180, 30, 120]], [0.5, [8, 8, 14]], [0.7, [40, 200, 160]], [1, [180, 255, 230]]]),
};
const PAL_KEYS = Object.keys(PALETTES);

// ---- state --------------------------------------------------------------
const state = { freq: 0.22, speed: 0.5, damping: 0.0015, palette: 'ocean', mode: 'drop', running: true };
let gw, gh, u, u1, wall, imgData, buf32, stepCount = 0;
const sources = []; // {x,y}
const pointer = { x: 0, y: 0, down: false };
const view = { z: 1, cx: 0.5, cy: 0.5 }; // zoom viewport over the grid
function srcRect() {
  const sw = gw / view.z, sh = gh / view.z;
  let sx = view.cx * gw - sw / 2, sy = view.cy * gh - sh / 2;
  sx = Math.max(0, Math.min(gw - sw, sx)); sy = Math.max(0, Math.min(gh - sh, sy));
  return { sx, sy, sw, sh };
}
function toGrid(nx, ny) { const r = srcRect(); return { gx: Math.round(r.sx + nx * r.sw), gy: Math.round(r.sy + ny * r.sh) }; }

function setup() {
  const r = canvas.getBoundingClientRect();
  const dprc = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.floor(r.width * dprc); canvas.height = Math.floor(r.height * dprc);
  ctx.imageSmoothingEnabled = true;
  const maxCells = 78000;
  const aspect = r.width / r.height;
  gh = Math.round(Math.sqrt(maxCells / aspect));
  gw = Math.round(gh * aspect);
  grid.width = gw; grid.height = gh;
  u = new Float32Array(gw * gh);
  u1 = new Float32Array(gw * gh);
  wall = new Uint8Array(gw * gh);
  imgData = gctx.createImageData(gw, gh);
  buf32 = new Uint32Array(imgData.data.buffer);
}

function clearField() { u.fill(0); u1.fill(0); }
function clearAll() { clearField(); wall.fill(0); sources.length = 0; }

// Sponge damping profile: strong near the border, ~0 in the interior.
function sponge(x, y) {
  const m = 18;
  const d = Math.min(x, y, gw - 1 - x, gh - 1 - y);
  if (d >= m) return state.damping;
  const t = 1 - d / m;
  return state.damping + t * t * 0.16;
}

function step() {
  const c2 = state.speed * state.speed;
  for (let y = 1; y < gh - 1; y++) {
    for (let x = 1; x < gw - 1; x++) {
      const i = y * gw + x;
      if (wall[i]) { u[i] = 0; continue; }
      const lap = u1[i - 1] + u1[i + 1] + u1[i - gw] + u1[i + gw] - 4 * u1[i];
      // Textbook leapfrog: u_next = 2·u_cur − u_prev + c²∇²u_cur, then a light
      // amplitude damping (heavier in the border "sponge" so waves don't reflect).
      let v = (2 * u1[i] - u[i] + c2 * lap) * (1 - sponge(x, y));
      if (v > 1.5) v = 1.5; else if (v < -1.5) v = -1.5;
      u[i] = v;
    }
  }
  // Drive oscillating sources over a small disc so they emit strongly.
  const s = Math.sin(state.freq * stepCount);
  const sp = Math.sin(state.freq * (stepCount - 1));
  for (const src of sources) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const px = src.x + dx, py = src.y + dy;
      if (px < 1 || py < 1 || px >= gw - 1 || py >= gh - 1) continue;
      const i = py * gw + px;
      u[i] = s; u1[i] = sp;
    }
  }
  const t = u; u = u1; u1 = t; // rotate buffers (u1 = newest)
  stepCount++;
}

function drop(gx, gy, r = 4) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d2 = x * x + y * y; if (d2 > r * r) continue;
    const px = gx + x, py = gy + y;
    if (px < 1 || py < 1 || px >= gw - 1 || py >= gh - 1) continue;
    const a = Math.cos((Math.sqrt(d2) / r) * Math.PI / 2);
    const i = py * gw + px; u[i] += a; u1[i] += a;
  }
}
function paintWall(gx, gy, r, erase) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (x * x + y * y > r * r) continue;
    const px = gx + x, py = gy + y;
    if (px < 0 || py < 0 || px >= gw || py >= gh) continue;
    wall[py * gw + px] = erase ? 0 : 1;
  }
}

function paint() {
  const lut = PALETTES[state.palette];
  for (let i = 0; i < u1.length; i++) {
    if (wall[i]) { buf32[i] = (255 << 24) | (60 << 16) | (48 << 8) | 40; continue; }
    let t = 0.5 + u1[i] * 2.2; if (t < 0) t = 0; else if (t > 1) t = 1;
    const li = (t * 255) | 0;
    buf32[i] = (255 << 24) | (lut[li * 3 + 2] << 16) | (lut[li * 3 + 1] << 8) | lut[li * 3];
  }
  gctx.putImageData(imgData, 0, 0);
  const r = srcRect();
  ctx.drawImage(grid, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
  // source markers (mapped through the zoom viewport)
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const s of sources) {
    const mx = (s.x - r.sx) / r.sw * canvas.width, my = (s.y - r.sy) / r.sh * canvas.height;
    if (mx < 0 || my < 0 || mx > canvas.width || my > canvas.height) continue;
    ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill();
  }
}

function applyPointer() {
  if (!pointer.down) return;
  const { gx, gy } = toGrid(pointer.x, pointer.y);
  if (state.mode === 'wall') paintWall(gx, gy, 3, false);
  else if (state.mode === 'erase') { paintWall(gx, gy, 5, true); for (let k = sources.length - 1; k >= 0; k--) if (Math.abs(sources[k].x - gx) < 6 && Math.abs(sources[k].y - gy) < 6) sources.splice(k, 1); }
}

function loop() {
  if (state.running) {
    applyPointer();
    step(); step(); step();
  }
  paint();
  requestAnimationFrame(loop);
}

// ---- presets ------------------------------------------------------------
const PRESETS = {
  'Double slit'() {
    clearAll();
    const wx = Math.round(gw * 0.42);
    for (let y = 0; y < gh; y++) wall[y * gw + wx] = 1;
    // two slits
    const gap = 3, s1 = Math.round(gh * 0.42), s2 = Math.round(gh * 0.58);
    for (let y = s1 - gap; y <= s1 + gap; y++) wall[y * gw + wx] = 0;
    for (let y = s2 - gap; y <= s2 + gap; y++) wall[y * gw + wx] = 0;
    // plane-wave source column (past the left absorbing border)
    for (let y = 22; y < gh - 22; y += 1) sources.push({ x: 26, y });
  },
  'Two sources'() { clearAll(); sources.push({ x: Math.round(gw * 0.5), y: Math.round(gh * 0.38) }); sources.push({ x: Math.round(gw * 0.5), y: Math.round(gh * 0.62) }); },
  'Single'() { clearAll(); sources.push({ x: Math.round(gw * 0.5), y: Math.round(gh * 0.5) }); },
  'Corridor'() {
    clearAll();
    const y1 = Math.round(gh * 0.36), y2 = Math.round(gh * 0.64);
    for (let x = 0; x < gw * 0.7; x++) { wall[y1 * gw + x] = 1; wall[y2 * gw + x] = 1; }
    sources.push({ x: 26, y: Math.round(gh * 0.5) });
  },
};
function loadPreset(name) { (PRESETS[name] || PRESETS.Single)(); clearField(); }

// ---- interaction --------------------------------------------------------
function pos(e) { const r = canvas.getBoundingClientRect(); return { x: ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width, y: ((e.touches ? e.touches[0].clientY : e.clientY) - r.top) / r.height }; }
function down(e) {
  const p = pos(e); pointer.x = p.x; pointer.y = p.y; pointer.down = true;
  const { gx, gy } = toGrid(p.x, p.y);
  if (state.mode === 'drop') drop(gx, gy, 4);
  else if (state.mode === 'source') sources.push({ x: gx, y: gy });
  $('hint')?.classList.add('gone');
}
function move(e) { if (!pointer.down) return; const p = pos(e); pointer.x = p.x; pointer.y = p.y; if (e.cancelable) e.preventDefault(); }
function up() { pointer.down = false; }
canvas.addEventListener('mousedown', down);
canvas.addEventListener('mousemove', move);
window.addEventListener('mouseup', up);
canvas.addEventListener('touchstart', down, { passive: true });
canvas.addEventListener('touchmove', move, { passive: false });
window.addEventListener('touchend', up);

function zoomAt(px, py, f) {
  const r = srcRect();
  const gx = (r.sx + px * r.sw) / gw, gy = (r.sy + py * r.sh) / gh;
  view.z = Math.max(1, Math.min(10, view.z * f));
  const sw = gw / view.z, sh = gh / view.z;
  view.cx = gx + (0.5 - px) * sw / gw; view.cy = gy + (0.5 - py) * sh / gh;
}
canvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, Math.exp(-e.deltaY * 0.0012)); }, { passive: false });
let rpinch = 0;
canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 2) return;
  pointer.down = false;
  const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  if (rpinch) { const r = canvas.getBoundingClientRect(); zoomAt(((e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left) / r.width, ((e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top) / r.height, d / rpinch); }
  rpinch = d; e.preventDefault();
}, { passive: false });
window.addEventListener('touchend', () => { rpinch = 0; });

// ---- controls -----------------------------------------------------------
function bindControls() {
  $('freqRange').addEventListener('input', () => { state.freq = parseFloat($('freqRange').value); $('freqVal').textContent = state.freq.toFixed(2); });
  $('speedRange').addEventListener('input', () => { state.speed = parseFloat($('speedRange').value); $('speedVal').textContent = state.speed.toFixed(2); });
  $('dampRange').addEventListener('input', () => { state.damping = parseFloat($('dampRange').value); $('dampVal').textContent = state.damping.toFixed(3); });
  $('paletteSelect').addEventListener('change', () => { state.palette = $('paletteSelect').value; });
  document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach((x) => x.classList.toggle('active', x === b));
  }));
}
function buildSelects() {
  const ps = $('presetSelect');
  Object.keys(PRESETS).forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n; ps.appendChild(o); });
  ps.addEventListener('change', () => { if (ps.value) loadPreset(ps.value); });
  const pal = $('paletteSelect');
  PAL_KEYS.forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = k[0].toUpperCase() + k.slice(1); pal.appendChild(o); });
}
function bindButtons() {
  $('playBtn').addEventListener('click', () => { state.running = !state.running; $('playBtn').textContent = state.running ? '❚❚ Pause' : '▶ Play'; $('playBtn').classList.toggle('paused', !state.running); });
  $('clearBtn').addEventListener('click', clearField);
  $('resetBtn').addEventListener('click', clearAll);
  $('panelToggle').addEventListener('click', () => document.body.classList.toggle('panel-open'));
}

// ---- boot ---------------------------------------------------------------
initNav('ripple');
setup();
buildSelects();
bindControls();
bindButtons();
loadPreset('Double slit');
if (window.innerWidth > 820) document.body.classList.add('panel-open');
setTimeout(() => $('hint')?.classList.add('gone'), 9000);
window.addEventListener('resize', () => { setup(); loadPreset($('presetSelect').value || 'Double slit'); });
requestAnimationFrame(loop);
