// attractor.js — strange attractors rendered like a long-exposure photograph.
// We iterate a chaotic 2D map hundreds of thousands of times, accumulate how
// often each pixel is visited into a density buffer, and colour it by
// log-density. The picture "develops" over successive frames.
import { initNav } from './nav.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d', { alpha: false });

// ---- attractor families -------------------------------------------------
// Each returns [nextX, nextY] and declares a rough coordinate span for framing.
const FAMILIES = {
  clifford: {
    name: 'Clifford',
    span: 4.2,
    step: (x, y, [a, b, c, d]) => [
      Math.sin(a * y) + c * Math.cos(a * x),
      Math.sin(b * x) + d * Math.cos(b * y),
    ],
  },
  dejong: {
    name: 'De Jong',
    span: 4.4,
    step: (x, y, [a, b, c, d]) => [
      Math.sin(a * y) - Math.cos(b * x),
      Math.sin(c * x) - Math.cos(d * y),
    ],
  },
  svensson: {
    name: 'Svensson',
    span: 4.0,
    step: (x, y, [a, b, c, d]) => [
      d * Math.sin(a * x) - Math.sin(b * y),
      c * Math.cos(a * x) + Math.cos(b * y),
    ],
  },
};

// ---- colour maps (256-entry LUTs) --------------------------------------
function buildLUT(stops) {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    const f = (t - t0) / (t1 - t0 || 1);
    lut[i * 3] = c0[0] + (c1[0] - c0[0]) * f;
    lut[i * 3 + 1] = c0[1] + (c1[1] - c0[1]) * f;
    lut[i * 3 + 2] = c0[2] + (c1[2] - c0[2]) * f;
  }
  return lut;
}
const PALETTES = {
  ember:  buildLUT([[0, [4, 2, 12]], [0.35, [120, 20, 70]], [0.7, [240, 110, 40]], [1, [255, 240, 180]]]),
  ice:    buildLUT([[0, [3, 6, 16]], [0.4, [20, 70, 130]], [0.75, [70, 190, 230]], [1, [230, 255, 255]]]),
  aurora: buildLUT([[0, [3, 8, 12]], [0.4, [30, 120, 90]], [0.7, [80, 220, 160]], [1, [220, 255, 210]]]),
  gold:   buildLUT([[0, [8, 6, 10]], [0.5, [110, 70, 20]], [0.8, [220, 170, 60]], [1, [255, 250, 220]]]),
  magma:  buildLUT([[0, [6, 3, 14]], [0.35, [90, 20, 110]], [0.7, [220, 60, 120]], [1, [255, 220, 160]]]),
};
const PAL_KEYS = Object.keys(PALETTES);

// ---- state --------------------------------------------------------------
const state = {
  family: 'clifford',
  params: [-1.7, 1.8, -0.9, -0.4],
  palette: 'ember',
  rate: 130000,   // points per frame
};

let W, H, density, maxD, x, y, span, cx, cy, scale, imgData, buf32;
const dpr = Math.min(window.devicePixelRatio || 1, 1.6);

function setup() {
  const rect = canvas.getBoundingClientRect();
  // Cap internal resolution so the per-frame density colouring stays cheap.
  const cap = 1_700_000;
  let iw = Math.floor(rect.width * dpr);
  let ih = Math.floor(rect.height * dpr);
  const s = Math.sqrt(cap / (iw * ih));
  if (s < 1) { iw = Math.floor(iw * s); ih = Math.floor(ih * s); }
  W = iw; H = ih;
  canvas.width = W; canvas.height = H;
  density = new Float32Array(W * H);
  imgData = ctx.createImageData(W, H);
  buf32 = new Uint32Array(imgData.data.buffer);
  reset();
}

function reset() {
  density.fill(0);
  maxD = 1;
  x = 0.1; y = 0.1;
  span = FAMILIES[state.family].span;
  scale = Math.min(W, H) / span;
  cx = W / 2; cy = H / 2;
  // Warm up to leave the transient before we start plotting.
  const stepFn = FAMILIES[state.family].step;
  for (let i = 0; i < 1000; i++) [x, y] = stepFn(x, y, state.params);
  frames = 0;
}

let frames = 0;
function iterate() {
  const stepFn = FAMILIES[state.family].step;
  const p = state.params;
  let lx = x, ly = y, m = maxD;
  const n = state.rate;
  for (let i = 0; i < n; i++) {
    const nx = stepFn(lx, ly, p);
    lx = nx[0]; ly = nx[1];
    const px = ((lx * scale) + cx) | 0;
    const py = ((ly * scale) + cy) | 0;
    if (px >= 0 && px < W && py >= 0 && py < H) {
      const idx = py * W + px;
      const v = ++density[idx];
      if (v > m) m = v;
    }
  }
  x = lx; y = ly; maxD = m;
  frames++;
}

function paint() {
  const lut = PALETTES[state.palette];
  const inv = 1 / Math.log(maxD + 1);
  const d = density;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    let t = v > 0 ? Math.log(v + 1) * inv : 0;
    if (t > 1) t = 1;
    const li = (t * 255) | 0;
    const r = lut[li * 3], g = lut[li * 3 + 1], b = lut[li * 3 + 2];
    // Little-endian: 0xAABBGGRR
    buf32[i] = (255 << 24) | (b << 16) | (g << 8) | r;
  }
  ctx.putImageData(imgData, 0, 0);
}

let running = true;
function loop() {
  if (running) iterate();
  paint();
  updateStatus();
  requestAnimationFrame(loop);
}

function updateStatus() {
  const samples = frames * state.rate;
  $('samples').textContent = samples > 1e6 ? (samples / 1e6).toFixed(1) + 'M pts' : Math.round(samples / 1000) + 'k pts';
}

// ---- randomize (bias toward params that produce rich structure) --------
function randomizeParams() {
  const r = () => +(Math.random() * 4 - 2).toFixed(3);
  state.params = [r(), r(), r(), r()];
}

// ---- controls -----------------------------------------------------------
const sliders = [
  ['pA', 'pAV', 0], ['pB', 'pBV', 1], ['pC', 'pCV', 2], ['pD', 'pDV', 3],
];
function syncControls() {
  for (const [rid, vid, i] of sliders) {
    $(rid).value = state.params[i];
    $(vid).textContent = state.params[i].toFixed(2);
  }
  $('familySelect').value = state.family;
  $('paletteSelect').value = state.palette;
  $('rateRange').value = state.rate;
  $('rateVal').textContent = Math.round(state.rate / 1000) + 'k';
}
function bindControls() {
  for (const [rid, vid, i] of sliders) {
    $(rid).addEventListener('input', () => {
      state.params[i] = parseFloat($(rid).value);
      $(vid).textContent = state.params[i].toFixed(2);
      reset();
    });
  }
  $('familySelect').addEventListener('change', () => { state.family = $('familySelect').value; reset(); });
  $('paletteSelect').addEventListener('change', () => { state.palette = $('paletteSelect').value; });
  $('rateRange').addEventListener('input', () => {
    state.rate = parseInt($('rateRange').value);
    $('rateVal').textContent = Math.round(state.rate / 1000) + 'k';
  });
}

// ---- share (compact URL) ------------------------------------------------
function encode() {
  const famIdx = Object.keys(FAMILIES).indexOf(state.family);
  const palIdx = PAL_KEYS.indexOf(state.palette);
  const q = (v) => Math.round(((v + 2) / 4) * 65535); // params in [-2,2] -> 16 bit
  const bytes = [1, famIdx, palIdx];
  for (const p of state.params) { const u = q(p); bytes.push((u >> 8) & 255, u & 255); }
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(str) {
  try {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const b = [...bin].map((c) => c.charCodeAt(0));
    if (b[0] !== 1) return false;
    state.family = Object.keys(FAMILIES)[b[1]] || 'clifford';
    state.palette = PAL_KEYS[b[2]] || 'ember';
    const dq = (u) => +((u / 65535) * 4 - 2).toFixed(3);
    for (let i = 0; i < 4; i++) state.params[i] = dq((b[3 + i * 2] << 8) | b[4 + i * 2]);
    return true;
  } catch { return false; }
}

function bindButtons() {
  $('playBtn').addEventListener('click', () => {
    running = !running;
    $('playBtn').textContent = running ? '❚❚ Pause' : '▶ Resume';
    $('playBtn').classList.toggle('paused', !running);
  });
  $('randomBtn').addEventListener('click', () => { randomizeParams(); syncControls(); reset(); });
  $('restartBtn').addEventListener('click', reset);
  $('shareBtn').addEventListener('click', async () => {
    const code = encode();
    const url = `${location.origin}${location.pathname}#${code}`;
    history.replaceState(null, '', `#${code}`);
    try { await navigator.clipboard.writeText(url); toast('Attractor link copied'); }
    catch { toast('Link set in address bar'); }
  });
  $('saveBtn').addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = `claudo-attractor-${Date.now()}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  });
  $('panelToggle').addEventListener('click', () => document.body.classList.toggle('panel-open'));
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

// ---- boot ---------------------------------------------------------------
initNav('attractor');
buildSelects();
bindControls();
bindButtons();
window.addEventListener('resize', () => setup());

const hash = location.hash.slice(1);
if (hash) decode(hash);
setup();
syncControls();
if (window.innerWidth > 820) document.body.classList.add('panel-open');
setTimeout(() => $('hint').classList.add('gone'), 8000);
requestAnimationFrame(loop);

function buildSelects() {
  const fam = $('familySelect');
  for (const [k, v] of Object.entries(FAMILIES)) {
    const o = document.createElement('option'); o.value = k; o.textContent = v.name; fam.appendChild(o);
  }
  const pal = $('paletteSelect');
  for (const k of PAL_KEYS) {
    const o = document.createElement('option'); o.value = k; o.textContent = k[0].toUpperCase() + k.slice(1); pal.appendChild(o);
  }
}
