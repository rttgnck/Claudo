// reaction.js — a Gray-Scott reaction-diffusion sandbox. Two virtual chemicals
// A and B diffuse across a grid; B feeds on A and both decay. From those two
// coupled equations you get coral, spots, mazes, dividing cells — the same
// "Turing patterns" that paint seashells and animal coats. Paint with the
// cursor to inject chemical B and watch it spread.
import { initNav } from './nav.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d', { alpha: false });
const grid = document.createElement('canvas');
const gctx = grid.getContext('2d');

// ---- presets: each is a (feed, kill) pair with its own emergent character ---
const PRESETS = [
  { name: 'Coral',      f: 0.0545, k: 0.0620 },
  { name: 'Mitosis',    f: 0.0367, k: 0.0649 },
  { name: 'Fingerprint',f: 0.0620, k: 0.0610 },
  { name: 'Maze',       f: 0.0290, k: 0.0570 },
  { name: 'Solitons',   f: 0.0300, k: 0.0620 },
  { name: 'Worms',      f: 0.0580, k: 0.0650 },
  { name: 'Bubbles',    f: 0.0140, k: 0.0450 },
  { name: 'Flower',     f: 0.0550, k: 0.0620 },
];

// ---- colour maps --------------------------------------------------------
function buildLUT(stops) {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1];
    const f = (t - t0) / (t1 - t0 || 1);
    lut[i * 3] = c0[0] + (c1[0] - c0[0]) * f;
    lut[i * 3 + 1] = c0[1] + (c1[1] - c0[1]) * f;
    lut[i * 3 + 2] = c0[2] + (c1[2] - c0[2]) * f;
  }
  return lut;
}
const PALETTES = {
  lagoon: buildLUT([[0, [6, 10, 22]], [0.5, [12, 70, 90]], [0.75, [40, 200, 190]], [1, [220, 255, 240]]]),
  ember:  buildLUT([[0, [8, 4, 10]], [0.5, [90, 20, 60]], [0.78, [235, 100, 45]], [1, [255, 240, 190]]]),
  violet: buildLUT([[0, [8, 6, 18]], [0.5, [60, 30, 110]], [0.78, [150, 90, 230]], [1, [240, 225, 255]]]),
  mono:   buildLUT([[0, [4, 4, 6]], [0.55, [70, 74, 88]], [1, [240, 244, 255]]]),
  moss:   buildLUT([[0, [6, 10, 8]], [0.5, [30, 70, 40]], [0.78, [120, 200, 90]], [1, [235, 255, 220]]]),
};
const PAL_KEYS = Object.keys(PALETTES);

// ---- state --------------------------------------------------------------
const state = { f: 0.0545, k: 0.0620, palette: 'lagoon', speed: 12, Da: 1.0, Db: 0.5 };

let gw, gh, A, B, A2, B2, imgData, buf32;
let running = true;
const pointer = { x: 0, y: 0, down: false };
const view = { z: 1, cx: 0.5, cy: 0.5 }; // zoom viewport over the grid
function srcRect() {
  const sw = gw / view.z, sh = gh / view.z;
  let sx = view.cx * gw - sw / 2, sy = view.cy * gh - sh / 2;
  sx = Math.max(0, Math.min(gw - sw, sx)); sy = Math.max(0, Math.min(gh - sh, sy));
  return { sx, sy, sw, sh };
}

function setup() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.imageSmoothingEnabled = true;

  // Simulation grid — capped cell count for a steady frame rate.
  const maxCells = 52000;
  const aspect = rect.width / rect.height;
  gh = Math.round(Math.sqrt(maxCells / aspect));
  gw = Math.round(gh * aspect);
  grid.width = gw; grid.height = gh;
  A = new Float32Array(gw * gh);
  B = new Float32Array(gw * gh);
  A2 = new Float32Array(gw * gh);
  B2 = new Float32Array(gw * gh);
  imgData = gctx.createImageData(gw, gh);
  buf32 = new Uint32Array(imgData.data.buffer);
  seed();
}

function seed() {
  A.fill(1); B.fill(0);
  // A central splash plus a scatter of specks so structure always emerges.
  splash(gw / 2, gh / 2, Math.max(6, gh * 0.06));
  for (let i = 0; i < 14; i++) splash(Math.random() * gw, Math.random() * gh, 3 + Math.random() * 4);
}

function splash(cxp, cyp, r) {
  const r2 = r * r;
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r2) continue;
      const gx = ((((cxp + x) | 0) % gw) + gw) % gw;
      const gy = ((((cyp + y) | 0) % gh) + gh) % gh;
      B[gy * gw + gx] = 1;
    }
  }
}

// One Gray-Scott step with a wrap-around 3x3 Laplacian.
function step() {
  const f = state.f, k = state.k, Da = state.Da, Db = state.Db;
  for (let y = 0; y < gh; y++) {
    const yu = (y - 1 + gh) % gh, yd = (y + 1) % gh;
    const row = y * gw, rowU = yu * gw, rowD = yd * gw;
    for (let x = 0; x < gw; x++) {
      const xl = (x - 1 + gw) % gw, xr = (x + 1) % gw;
      const i = row + x;
      const a = A[i], b = B[i];
      // Laplacian: orthogonal 0.2, diagonal 0.05, center -1.
      const lapA =
        A[row + xl] * 0.2 + A[row + xr] * 0.2 + A[rowU + x] * 0.2 + A[rowD + x] * 0.2 +
        A[rowU + xl] * 0.05 + A[rowU + xr] * 0.05 + A[rowD + xl] * 0.05 + A[rowD + xr] * 0.05 - a;
      const lapB =
        B[row + xl] * 0.2 + B[row + xr] * 0.2 + B[rowU + x] * 0.2 + B[rowD + x] * 0.2 +
        B[rowU + xl] * 0.05 + B[rowU + xr] * 0.05 + B[rowD + xl] * 0.05 + B[rowD + xr] * 0.05 - b;
      const abb = a * b * b;
      let na = a + (Da * lapA - abb + f * (1 - a));
      let nb = b + (Db * lapB + abb - (k + f) * b);
      A2[i] = na < 0 ? 0 : na > 1 ? 1 : na;
      B2[i] = nb < 0 ? 0 : nb > 1 ? 1 : nb;
    }
  }
  let t;
  t = A; A = A2; A2 = t;
  t = B; B = B2; B2 = t;
}

function paint() {
  const lut = PALETTES[state.palette];
  for (let i = 0; i < B.length; i++) {
    let tval = B[i] * 3.2;
    if (tval > 1) tval = 1;
    const li = (tval * 255) | 0;
    const r = lut[li * 3], g = lut[li * 3 + 1], bl = lut[li * 3 + 2];
    buf32[i] = (255 << 24) | (bl << 16) | (g << 8) | r;
  }
  gctx.putImageData(imgData, 0, 0);
  const r = srcRect();
  ctx.drawImage(grid, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
}

function applyPointer() {
  if (!pointer.down) return;
  const r = srcRect();
  const gx = r.sx + pointer.x * r.sw, gy = r.sy + pointer.y * r.sh;
  splash(gx, gy, Math.max(4, gh * 0.03) / view.z);
}

function loop() {
  if (running) {
    applyPointer();
    for (let s = 0; s < state.speed; s++) step();
  }
  paint();
  requestAnimationFrame(loop);
}

// ---- controls -----------------------------------------------------------
function syncControls() {
  $('feedRange').value = state.f; $('feedVal').textContent = state.f.toFixed(4);
  $('killRange').value = state.k; $('killVal').textContent = state.k.toFixed(4);
  $('speedRange').value = state.speed; $('speedVal').textContent = state.speed;
  $('paletteSelect').value = state.palette;
}
function bindControls() {
  $('feedRange').addEventListener('input', () => { state.f = parseFloat($('feedRange').value); $('feedVal').textContent = state.f.toFixed(4); $('presetSelect').value = ''; });
  $('killRange').addEventListener('input', () => { state.k = parseFloat($('killRange').value); $('killVal').textContent = state.k.toFixed(4); $('presetSelect').value = ''; });
  $('speedRange').addEventListener('input', () => { state.speed = parseInt($('speedRange').value); $('speedVal').textContent = state.speed; });
  $('paletteSelect').addEventListener('change', () => { state.palette = $('paletteSelect').value; });
}

// ---- pointer paint ------------------------------------------------------
function pos(e) {
  const r = canvas.getBoundingClientRect();
  const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
  const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
  return { x: cx / r.width, y: cy / r.height };
}
function bindPointer() {
  const down = (e) => { const p = pos(e); pointer.x = p.x; pointer.y = p.y; pointer.down = true; $('hint').classList.add('gone'); };
  const move = (e) => { if (!pointer.down) return; const p = pos(e); pointer.x = p.x; pointer.y = p.y; if (e.cancelable) e.preventDefault(); };
  const up = () => { pointer.down = false; };
  canvas.addEventListener('mousedown', down);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  canvas.addEventListener('touchstart', down, { passive: true });
  canvas.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', up);

  const zoomAt = (px, py, f) => {
    const r = srcRect();
    const gx = (r.sx + px * r.sw) / gw, gy = (r.sy + py * r.sh) / gh;
    view.z = Math.max(1, Math.min(9, view.z * f));
    const sw = gw / view.z, sh = gh / view.z;
    view.cx = gx + (0.5 - px) * sw / gw; view.cy = gy + (0.5 - py) * sh / gh;
  };
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, Math.exp(-e.deltaY * 0.0012)); }, { passive: false });
  let pd = 0;
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pd) { const r = canvas.getBoundingClientRect(); zoomAt(((e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left) / r.width, ((e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top) / r.height, d / pd); }
    pd = d; e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchend', () => { pd = 0; });
}

// ---- share --------------------------------------------------------------
function encode() {
  const palIdx = PAL_KEYS.indexOf(state.palette);
  const qf = Math.round((state.f / 0.1) * 65535);
  const qk = Math.round((state.k / 0.1) * 65535);
  const bytes = [1, palIdx, (qf >> 8) & 255, qf & 255, (qk >> 8) & 255, qk & 255];
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(str) {
  try {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const b = [...bin].map((c) => c.charCodeAt(0));
    if (b[0] !== 1) return false;
    state.palette = PAL_KEYS[b[1]] || 'lagoon';
    state.f = +(((b[2] << 8) | b[3]) / 65535 * 0.1).toFixed(4);
    state.k = +(((b[4] << 8) | b[5]) / 65535 * 0.1).toFixed(4);
    return true;
  } catch { return false; }
}

// ---- buttons ------------------------------------------------------------
function bindButtons() {
  $('playBtn').addEventListener('click', () => {
    running = !running;
    $('playBtn').textContent = running ? '❚❚ Pause' : '▶ Play';
    $('playBtn').classList.toggle('paused', !running);
  });
  $('resetBtn').addEventListener('click', seed);
  $('randomBtn').addEventListener('click', () => {
    const p = PRESETS[(Math.random() * PRESETS.length) | 0];
    state.f = p.f; state.k = p.k;
    state.palette = PAL_KEYS[(Math.random() * PAL_KEYS.length) | 0];
    $('presetSelect').value = '';
    syncControls(); seed();
  });
  $('shareBtn').addEventListener('click', async () => {
    const code = encode();
    const url = `${location.origin}${location.pathname}#${code}`;
    history.replaceState(null, '', `#${code}`);
    try { await navigator.clipboard.writeText(url); toast('Pattern link copied'); }
    catch { toast('Link set in address bar'); }
  });
  $('saveBtn').addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = `claudo-reaction-${Date.now()}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  });
  $('panelToggle').addEventListener('click', () => document.body.classList.toggle('panel-open'));
}

function buildSelects() {
  const ps = $('presetSelect');
  PRESETS.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = p.name; ps.appendChild(o); });
  ps.addEventListener('change', () => {
    const p = PRESETS[+ps.value]; if (!p) return;
    state.f = p.f; state.k = p.k; syncControls(); seed();
  });
  const pal = $('paletteSelect');
  for (const kk of PAL_KEYS) { const o = document.createElement('option'); o.value = kk; o.textContent = kk[0].toUpperCase() + kk.slice(1); pal.appendChild(o); }
}

let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2000); }

// ---- boot ---------------------------------------------------------------
initNav('reaction');
buildSelects();
bindControls();
bindPointer();
bindButtons();
window.addEventListener('resize', () => setup());

const hash = location.hash.slice(1);
if (hash) decode(hash);
setup();
syncControls();
if (window.innerWidth > 820) document.body.classList.add('panel-open');
setTimeout(() => $('hint').classList.add('gone'), 8000);
requestAnimationFrame(loop);
