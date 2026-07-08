// fusion.js — a 0-D tokamak burn simulator. This is a real power-balance model,
// not a mock-up:
//
//   dW/dt = P_aux + P_alpha(T) − P_bremsstrahlung(T) − W/τ_E
//
// D-T reactivity <σv> comes from the Bosch–Hale parametrization. Alpha particles
// (3.5 MeV) heat the plasma; if that self-heating overtakes the losses, the burn
// runs away to a hot equilibrium — ignition. Push the density, heating and
// confinement until you get there, then pull the external heating to zero and see
// if it stays lit.
import { initNav } from './nav.js';
import { Fusion3D } from './fusion3d.js';

const $ = (id) => document.getElementById(id);
let mode3d = false, f3d = null;
const canvas = $('stage');
const ctx = canvas.getContext('2d');
const dpr = Math.min(window.devicePixelRatio || 1, 2);

// ---- physical constants -------------------------------------------------
const KEV_J = 1.602e-16;   // 1 keV in joules
const MU0 = 4 * Math.PI * 1e-7;
// ITER-like geometry.
const R0 = 6.2, A_MINOR = 2.0, KAPPA = 1.7, DELTA = 0.33;
const VOL = 2 * Math.PI * Math.PI * R0 * A_MINOR * A_MINOR * KAPPA; // ≈ 830 m³

// Bosch–Hale D-T reactivity, T in keV -> <σv> in m³/s.
function reactivityDT(T) {
  if (T < 0.2) return 0;
  const BG = 34.3827, mrc2 = 1.124656e6;
  const C1 = 1.17302e-9, C2 = 1.51361e-2, C3 = 7.51886e-2, C4 = 4.60643e-3,
        C5 = 1.35000e-2, C6 = -1.06750e-4, C7 = 1.36600e-5;
  const theta = T / (1 - (T * (C2 + T * (C4 + T * C6))) / (1 + T * (C3 + T * (C5 + T * C7))));
  const xi = Math.pow((BG * BG) / (4 * theta), 1 / 3);
  const sv = C1 * theta * Math.sqrt(xi / (mrc2 * T * T * T)) * Math.exp(-3 * xi); // cm³/s
  return sv * 1e-6;
}

// ---- state --------------------------------------------------------------
const state = {
  n: 1.0e20,     // density  (m^-3)
  Paux: 50e6,    // aux heating (W)
  tauE: 3.0,     // energy confinement time (s)
  B: 5.3,        // toroidal field (T)
  T: 0.5,        // temperature (keV) — evolves
  running: true,
};
// Derived, recomputed each step for the readouts.
let out = {};

function computePowers(T) {
  const n = state.n;
  const rate = (n / 2) * (n / 2) * reactivityDT(T);        // reactions / m³ / s
  const Palpha = rate * 3.5e6 * 1.602e-19 * VOL;            // W
  const Pfus = rate * 17.6e6 * 1.602e-19 * VOL;             // W
  const Pbrem = 5.35e-37 * n * n * Math.sqrt(T) * VOL;      // W
  const W = 3 * n * (T * KEV_J) * VOL;                      // J
  const Ploss = W / state.tauE;                             // W
  const p = 2 * n * (T * KEV_J);                            // Pa (e + i)
  const beta = p / (state.B * state.B / (2 * MU0));         // fraction
  const triple = n * T * state.tauE;                        // keV·s·m^-3
  return { Palpha, Pfus, Pbrem, W, Ploss, beta, triple, rate };
}

let betaLimited = false;
function betaLimitT() {
  // Temperature at which plasma pressure hits the Troyon-like β limit (~8%).
  return 0.0795 * (state.B * state.B / (2 * MU0)) / (2 * state.n * KEV_J);
}
function step(dt) {
  const p = computePowers(state.T);
  let W = p.W;
  const dW = state.Paux + p.Palpha - p.Pbrem - p.Ploss;
  W += dW * dt;
  if (W < 0) W = 0;
  let T = W / (3 * state.n * KEV_J * VOL);
  if (T < 0.05) T = 0.05;
  if (T > 120) T = 120;                // reactivity fit valid to ~100 keV
  // The pressure limit is a hard ceiling: above it, ballooning transport dumps
  // the excess energy, so the plasma settles right at the β limit.
  const tLim = betaLimitT();
  betaLimited = T > tLim;
  if (betaLimited) T = tLim;
  state.T = T;
  out = computePowers(T);
  out.dW = dW;
}

// ---- fusion-flash particles (viz of reaction rate) ----------------------
const flashes = [];
let flashAcc = 0;

// ---- rendering ----------------------------------------------------------
let W, H, ccx, ccy, scale;
function resize() {
  const r = canvas.getBoundingClientRect();
  W = r.width; H = r.height;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Place the cross-section left of the panel on wide screens.
  ccx = W > 900 ? W * 0.40 : W * 0.5;
  ccy = H * 0.52;
  scale = Math.min(W * 0.32, H * 0.34) / (KAPPA * A_MINOR);
}
window.addEventListener('resize', resize);
resize();

// Scroll / pinch to zoom the cross-section about the cursor.
function zoomAt(mx, my, f) {
  ccx = mx - (mx - ccx) * f; ccy = my - (my - ccy) * f;
  scale = Math.max(8, Math.min(2000, scale * f));
}
canvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0012)); }, { passive: false });
let fpinch = 0;
canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 2) return;
  const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  if (fpinch) { const r = canvas.getBoundingClientRect(); zoomAt((e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top, d / fpinch); }
  fpinch = d; e.preventDefault();
}, { passive: false });
window.addEventListener('touchend', () => { fpinch = 0; });

// Point on a flux surface (poloidal cross-section) at minor-radius fraction rho.
function fluxPoint(rho, theta) {
  const x = ccx + scale * (A_MINOR * rho) * Math.cos(theta + DELTA * rho * Math.sin(theta));
  const y = ccy - scale * (KAPPA * A_MINOR * rho) * Math.sin(theta);
  return [x, y];
}
function tracePath(rho) {
  ctx.beginPath();
  for (let i = 0; i <= 60; i++) {
    const th = (i / 60) * Math.PI * 2;
    const [x, y] = fluxPoint(rho, th);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Temperature -> plasma glow colour.
function plasmaColor(T, alpha) {
  const t = Math.min(T / 30, 1);
  // dim red -> orange -> white-blue
  let r, g, b;
  if (t < 0.5) { const u = t / 0.5; r = 120 + 135 * u; g = 20 + 120 * u; b = 20 + 30 * u; }
  else { const u = (t - 0.5) / 0.5; r = 255; g = 140 + 115 * u; b = 50 + 205 * u; }
  return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#07070c';
  ctx.fillRect(0, 0, W, H);

  // Toroidal field coils (schematic) around the plasma.
  ctx.strokeStyle = 'rgba(120,140,200,0.22)';
  ctx.lineWidth = 8;
  tracePath(1.55); ctx.stroke();
  ctx.strokeStyle = 'rgba(120,140,200,0.10)';
  ctx.lineWidth = 3;
  tracePath(1.75); ctx.stroke();

  // Vessel wall.
  ctx.strokeStyle = 'rgba(200,210,235,0.28)';
  ctx.lineWidth = 2;
  tracePath(1.18); ctx.stroke();

  // Plasma: filled nested flux surfaces, brightness by temperature.
  ctx.globalCompositeOperation = 'lighter';
  const layers = 14;
  for (let i = layers; i >= 1; i--) {
    const rho = i / layers;
    const core = 1 - rho * 0.85;            // hotter toward the core
    const a = 0.06 + core * 0.16 * Math.min(state.T / 12, 1.4);
    ctx.fillStyle = plasmaColor(state.T * core, a);
    tracePath(rho * 1.02);
    ctx.fill();
  }

  // Fusion flashes (alpha events) — rate scales with reaction rate.
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.life -= 0.045;
    if (f.life <= 0) { flashes.splice(i, 1); continue; }
    ctx.fillStyle = `rgba(255,240,180,${f.life})`;
    ctx.beginPath(); ctx.arc(f.x, f.y, 1.5 + f.life * 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Central label.
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '700 15px "Space Grotesk", sans-serif';
  ctx.fillText('poloidal cross-section', ccx, ccy + scale * KAPPA * A_MINOR * 1.5 + 8);
}

function spawnFlashes(dt) {
  // reactions/s in the whole plasma, mapped to a viewable flash rate.
  const reactions = out.rate ? out.rate * VOL : 0;
  const perSec = Math.min(Math.pow(reactions, 0.19) * 0.9, 400);
  flashAcc += perSec * dt;
  while (flashAcc >= 1 && flashes.length < 500) {
    flashAcc -= 1;
    const rho = Math.pow(Math.random(), 0.6) * 0.9;
    const th = Math.random() * Math.PI * 2;
    const [x, y] = fluxPoint(rho, th);
    flashes.push({ x, y, life: 1 });
  }
}

// ---- readouts -----------------------------------------------------------
function fmtPower(w) {
  const mw = w / 1e6;
  if (mw >= 1000) return (mw / 1000).toFixed(2) + ' GW';
  if (mw >= 1) return mw.toFixed(1) + ' MW';
  return (w / 1e3).toFixed(0) + ' kW';
}
function updateReadouts() {
  const Q = state.Paux > 1e5 ? out.Pfus / state.Paux : Infinity;
  const ignited = state.Paux <= 1e5 && out.Pfus > 5e6;
  $('tOut').textContent = state.T.toFixed(1);
  $('pfusOut').textContent = fmtPower(out.Pfus);
  $('qOut').textContent = ignited ? '∞' : (isFinite(Q) ? Q.toFixed(1) : '—');

  // Triple product bar vs Lawson ignition threshold (~3e21).
  const tp = out.triple, thr = 3e21;
  $('tripleOut').textContent = tp.toExponential(1).replace('e+', '×10^');
  $('tripleBar').style.width = Math.min(100, (tp / thr) * 100) + '%';
  $('tripleBar').style.background = tp >= thr ? 'linear-gradient(90deg,#4ade80,#a3e635)' : 'linear-gradient(90deg,#38bdf8,#818cf8)';

  // Beta bar vs Troyon-ish limit (~8%).
  const betaPct = out.beta * 100, betaLim = 8;
  $('betaOut').textContent = betaPct.toFixed(1) + '%';
  $('betaBar').style.width = Math.min(100, (betaPct / betaLim) * 100) + '%';
  const overBeta = betaPct > betaLim;
  $('betaBar').style.background = overBeta ? 'linear-gradient(90deg,#f59e0b,#ff5c7c)' : 'linear-gradient(90deg,#2dd4bf,#38bdf8)';

  // Status line.
  let status, cls;
  if (ignited && betaLimited) { status = '★ Ignited — β-limited burn'; cls = 'good'; }
  else if (ignited) { status = '★ Ignited — self-sustaining'; cls = 'good'; }
  else if (betaLimited) { status = '⚠ At β limit'; cls = 'warn'; }
  else if (out.Pfus > 5e6 && state.T > 4) { status = 'Burning'; cls = 'ok'; }
  else if (state.T > 2) { status = 'Heating…'; cls = 'ok'; }
  else { status = 'Cold plasma'; cls = ''; }
  const s = $('statusOut'); s.textContent = status; s.className = 'status ' + cls;
}

// ---- loop ---------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  if (state.running) {
    const simDt = dt * 2.5;            // ~2.5× real time
    const sub = 6;
    for (let i = 0; i < sub; i++) step(simDt / sub);
    spawnFlashes(dt);
    updateReadouts();
  }
  if (mode3d) { if (f3d && f3d.ready) { f3d.update(state.T, out.Pfus || 0, dt); f3d.render(dt); } }
  else render();
  requestAnimationFrame(frame);
}

async function toggle3D() {
  const btn = $('mode3dBtn');
  if (!mode3d) {
    if (!f3d) { f3d = new Fusion3D(); await f3d.init(); }
    mode3d = true; document.body.classList.add('mode-3d');
    btn.textContent = '◱ 2D'; btn.classList.add('active');
    f3d.activate();
  } else {
    mode3d = false; document.body.classList.remove('mode-3d');
    btn.textContent = '⬗ 3D'; btn.classList.remove('active');
    if (f3d) f3d.deactivate();
  }
}

// ---- controls -----------------------------------------------------------
function syncControls() {
  $('nRange').value = state.n / 1e20; $('nVal').textContent = (state.n / 1e20).toFixed(2);
  $('pauxRange').value = state.Paux / 1e6; $('pauxVal').textContent = (state.Paux / 1e6).toFixed(0);
  $('tauRange').value = state.tauE; $('tauVal').textContent = state.tauE.toFixed(1);
  $('bRange').value = state.B; $('bVal').textContent = state.B.toFixed(1);
}
function bindControls() {
  $('nRange').addEventListener('input', () => { state.n = parseFloat($('nRange').value) * 1e20; $('nVal').textContent = parseFloat($('nRange').value).toFixed(2); });
  $('pauxRange').addEventListener('input', () => { state.Paux = parseFloat($('pauxRange').value) * 1e6; $('pauxVal').textContent = parseFloat($('pauxRange').value).toFixed(0); });
  $('tauRange').addEventListener('input', () => { state.tauE = parseFloat($('tauRange').value); $('tauVal').textContent = state.tauE.toFixed(1); });
  $('bRange').addEventListener('input', () => { state.B = parseFloat($('bRange').value); $('bVal').textContent = state.B.toFixed(1); });
}

function bindButtons() {
  $('playBtn').addEventListener('click', () => {
    state.running = !state.running;
    $('playBtn').textContent = state.running ? '❚❚ Pause' : '▶ Run';
    $('playBtn').classList.toggle('paused', !state.running);
  });
  $('igniteBtn').addEventListener('click', () => {
    // Enough heating to clear the ignition hill; alpha heating then takes over
    // and it settles at the β limit. Cut the heating afterward to test ignition.
    state.n = 1.3e20; state.Paux = 120e6; state.tauE = 3.5; state.B = 6.0; state.T = 0.5;
    state.running = true;
    $('playBtn').textContent = '❚❚ Pause'; $('playBtn').classList.remove('paused');
    syncControls();
  });
  $('coldBtn').addEventListener('click', () => { state.T = 0.5; });
  $('mode3dBtn').addEventListener('click', () => toggle3D());
  $('shareBtn').addEventListener('click', async () => {
    const code = encode();
    const url = `${location.origin}${location.pathname}#${code}`;
    history.replaceState(null, '', `#${code}`);
    try { await navigator.clipboard.writeText(url); toast('Reactor link copied'); } catch { toast('Link set in address bar'); }
  });
  $('panelToggle').addEventListener('click', () => document.body.classList.toggle('panel-open'));
}

// ---- share --------------------------------------------------------------
function encode() {
  const q = (v, lo, hi) => Math.max(0, Math.min(255, Math.round((v - lo) / (hi - lo) * 255)));
  const bytes = [1, q(state.n / 1e20, 0.2, 2), q(state.Paux / 1e6, 0, 150), q(state.tauE, 0.2, 5), q(state.B, 2, 13)];
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(str) {
  try {
    const b = [...atob(str.replace(/-/g, '+').replace(/_/g, '/'))].map((c) => c.charCodeAt(0));
    if (b[0] !== 1) return false;
    const dq = (x, lo, hi) => lo + x / 255 * (hi - lo);
    state.n = dq(b[1], 0.2, 2) * 1e20; state.Paux = dq(b[2], 0, 150) * 1e6;
    state.tauE = dq(b[3], 0.2, 5); state.B = dq(b[4], 2, 13);
    return true;
  } catch { return false; }
}

let toastTimer;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2000); }

// ---- boot ---------------------------------------------------------------
initNav('fusion');
bindControls();
bindButtons();
const hash = location.hash.slice(1);
if (hash) decode(hash);
out = computePowers(state.T);
syncControls();
if (window.innerWidth > 820) document.body.classList.add('panel-open');
requestAnimationFrame(frame);
