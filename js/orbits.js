// orbits.js — an N-body gravity sandbox. Every body pulls on every other by
// Newton's inverse-square law; positions advance with a velocity-Verlet
// (leapfrog) integrator, which conserves energy far better than plain Euler, so
// orbits stay crisp instead of spiralling from numerical drift. Drag to fling a
// new world and watch the choreography.
import { initNav } from './nav.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d');
const dpr = Math.min(window.devicePixelRatio || 1, 2);

let W, H;
function resize() {
  const r = canvas.getBoundingClientRect();
  W = r.width; H = r.height;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#07070c'; ctx.fillRect(0, 0, W, H);
}
window.addEventListener('resize', resize);
resize();

// ---- camera (world <-> screen) -----------------------------------------
const cam = { scale: 40, x: 0, y: 0 };
const toScreen = (wx, wy) => [W / 2 + (wx - cam.x) * cam.scale, H / 2 + (wy - cam.y) * cam.scale];
const toWorld = (sx, sy) => [(sx - W / 2) / cam.scale + cam.x, (sy - H / 2) / cam.scale + cam.y];

// ---- state --------------------------------------------------------------
const state = { G: 1, newMass: 8, trails: 0.9, speed: 1, merge: true, running: true };
let bodies = [];
const COLORS = ['#ffd166', '#ff6b5c', '#4ade80', '#38bdf8', '#a78bfa', '#f472b6', '#2dd4bf', '#fb923c'];
let colorI = 0;
const radiusOf = (m) => Math.max(0.08, 0.11 * Math.cbrt(m));

function addBody(x, y, vx, vy, m, color, star = false) {
  bodies.push({ x, y, vx, vy, m, r: radiusOf(m), color: color || COLORS[colorI++ % COLORS.length], star, trail: [] });
}

// ---- physics ------------------------------------------------------------
const EPS2 = 0.25; // softening² — avoids infinite forces on close approach
function accelerations() {
  const n = bodies.length;
  const ax = new Float64Array(n), ay = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const bi = bodies[i];
    for (let j = i + 1; j < n; j++) {
      const bj = bodies[j];
      let dx = bj.x - bi.x, dy = bj.y - bi.y;
      const d2 = dx * dx + dy * dy + EPS2;
      const inv = 1 / (d2 * Math.sqrt(d2));   // 1 / r³
      const f = state.G * inv;
      ax[i] += f * bj.m * dx; ay[i] += f * bj.m * dy;
      ax[j] -= f * bi.m * dx; ay[j] -= f * bi.m * dy;
    }
  }
  return [ax, ay];
}
function integrate(dt) {
  let [ax, ay] = accelerations();
  const n = bodies.length;
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    b.vx += ax[i] * dt * 0.5; b.vy += ay[i] * dt * 0.5;
    b.x += b.vx * dt; b.y += b.vy * dt;
  }
  [ax, ay] = accelerations();
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    b.vx += ax[i] * dt * 0.5; b.vy += ay[i] * dt * 0.5;
  }
  if (state.merge) collide();
}
function collide() {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const dx = a.x - b.x, dy = a.y - b.y;
      if (dx * dx + dy * dy < (a.r + b.r) * (a.r + b.r)) {
        const m = a.m + b.m;
        const big = a.m >= b.m ? a : b;
        big.x = (a.x * a.m + b.x * b.m) / m;
        big.y = (a.y * a.m + b.y * b.m) / m;
        big.vx = (a.vx * a.m + b.vx * b.m) / m;
        big.vy = (a.vy * a.m + b.vy * b.m) / m;
        big.m = m; big.r = radiusOf(m); big.star = a.star || b.star;
        bodies.splice(a === big ? j : i, 1);
        i = -1; break;
      }
    }
  }
}

// ---- presets ------------------------------------------------------------
function circular(cx, cy, cm, r, m, dir = 1, color) {
  const v = Math.sqrt(state.G * cm / r) * dir;
  addBody(cx + r, cy, 0, v, m, color);
}
const PRESETS = {
  Solar() {
    cam.scale = 26; cam.x = 0; cam.y = 0; state.G = 1;
    addBody(0, 0, 0, 0, 4000, '#ffd166', true);
    for (const r of [3.5, 5.5, 8, 11, 15]) circular(0, 0, 4000, r, 3 + Math.random() * 6, 1);
  },
  Binary() {
    cam.scale = 22; cam.x = 0; cam.y = 0; state.G = 1;
    const M = 1600, d = 4, v = 0.5 * Math.sqrt(state.G * (2 * M) / d);
    addBody(-d / 2, 0, 0, -v, M, '#ff9a5c', true);
    addBody(d / 2, 0, 0, v, M, '#38bdf8', true);
    for (const r of [9, 13, 17]) circular(0, 0, 2 * M, r, 2 + Math.random() * 4, 1);
  },
  'Figure-8'() {
    cam.scale = 190; cam.x = 0; cam.y = 0; state.G = 1;
    // Chenciner–Montgomery choreography (three equal masses).
    const p = [0.97000436, -0.24308753];
    const v = [-0.93240737, -0.86473146];
    addBody(p[0], p[1], -v[0] / 2, -v[1] / 2, 1, '#4ade80');
    addBody(-p[0], -p[1], -v[0] / 2, -v[1] / 2, 1, '#38bdf8');
    addBody(0, 0, v[0], v[1], 1, '#f472b6');
  },
  Cluster() {
    cam.scale = 18; cam.x = 0; cam.y = 0; state.G = 1;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * 14;
      const spin = 0.6;
      addBody(Math.cos(a) * rr, Math.sin(a) * rr, -Math.sin(a) * rr * spin, Math.cos(a) * rr * spin, 4 + Math.random() * 10);
    }
  },
};
function clearCanvas() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#07070c'; ctx.fillRect(0, 0, W, H); }
function loadPreset(name) { bodies = []; colorI = 0; (PRESETS[name] || PRESETS.Solar)(); clearCanvas(); syncControls(); }

// ---- interaction: drag to fling ----------------------------------------
let drag = null;
function pos(e) { const r = canvas.getBoundingClientRect(); return [(e.touches ? e.touches[0].clientX : e.clientX) - r.left, (e.touches ? e.touches[0].clientY : e.clientY) - r.top]; }
function down(e) { const [sx, sy] = pos(e); drag = { sx, sy, cx: sx, cy: sy }; $('hint')?.classList.add('gone'); }
function move(e) { if (!drag) return; const [sx, sy] = pos(e); drag.cx = sx; drag.cy = sy; if (e.cancelable) e.preventDefault(); }
function up() {
  if (!drag) return;
  const [wx, wy] = toWorld(drag.sx, drag.sy);
  // Velocity = drag vector (flick in the direction you want it to go).
  const vx = (drag.cx - drag.sx) / cam.scale * 0.9;
  const vy = (drag.cy - drag.sy) / cam.scale * 0.9;
  addBody(wx, wy, vx, vy, state.newMass);
  drag = null;
}
canvas.addEventListener('mousedown', down);
canvas.addEventListener('mousemove', move);
window.addEventListener('mouseup', up);
canvas.addEventListener('touchstart', down, { passive: true });
canvas.addEventListener('touchmove', move, { passive: false });
window.addEventListener('touchend', up);

// Scroll / pinch to zoom, keeping the point under the cursor fixed.
function zoomAt(sx, sy, factor) {
  const [wx, wy] = toWorld(sx, sy);
  cam.scale = Math.max(2, Math.min(4000, cam.scale * factor));
  cam.x = wx - (sx - W / 2) / cam.scale;
  cam.y = wy - (sy - H / 2) / cam.scale;
  clearCanvas();
}
canvas.addEventListener('wheel', (e) => { e.preventDefault(); const [sx, sy] = pos(e); zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0012)); }, { passive: false });
let pinchD = 0;
canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 2) return;
  const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
  const d = Math.hypot(dx, dy);
  if (pinchD) { const r = canvas.getBoundingClientRect(); zoomAt((e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top, d / pinchD); }
  pinchD = d; e.preventDefault();
}, { passive: false });
window.addEventListener('touchend', () => { pinchD = 0; });

// ---- render -------------------------------------------------------------
function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (state.trails > 0) { ctx.globalAlpha = 1 - state.trails; ctx.fillStyle = '#07070c'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  else { ctx.fillStyle = '#07070c'; ctx.fillRect(0, 0, W, H); }

  ctx.globalCompositeOperation = 'lighter';
  for (const b of bodies) {
    const [x, y] = toScreen(b.x, b.y);
    if (x < -80 || x > W + 80 || y < -80 || y > H + 80) continue;
    const rr = Math.min(Math.max(1.5, b.r * cam.scale), b.star ? 34 : 12);
    const glow = Math.min(rr * (b.star ? 3.4 : 2.6), b.star ? 120 : 52);
    const g = ctx.createRadialGradient(x, y, 0, x, y, glow);
    g.addColorStop(0, b.star ? 'rgba(255,240,200,0.95)' : 'rgba(255,255,255,0.9)');
    g.addColorStop(0.3, hexA(b.color, 0.7));
    g.addColorStop(1, hexA(b.color, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, glow, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, rr * 0.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // drag aim line
  if (drag) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(drag.sx, drag.sy); ctx.lineTo(drag.cx, drag.cy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(drag.sx, drag.sy, radiusOf(state.newMass) * cam.scale + 2, 0, Math.PI * 2); ctx.fill();
  }

  $('countVal').textContent = bodies.length;
}
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

// ---- loop ---------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now; if (dt > 0.05) dt = 0.05;
  if (state.running) {
    const steps = 4;
    const h = dt * state.speed * 1.6 / steps;
    for (let i = 0; i < steps; i++) integrate(h);
  }
  render();
  requestAnimationFrame(frame);
}

// ---- controls -----------------------------------------------------------
function syncControls() {
  $('gRange').value = state.G; $('gVal').textContent = state.G.toFixed(2);
  $('massRange').value = state.newMass; $('massVal').textContent = state.newMass.toFixed(0);
  $('trailsRange').value = state.trails; $('trailsVal').textContent = state.trails.toFixed(2);
  $('speedRange').value = state.speed; $('speedVal').textContent = state.speed.toFixed(1);
  $('mergeChk').checked = state.merge;
}
function bindControls() {
  $('gRange').addEventListener('input', () => { state.G = parseFloat($('gRange').value); $('gVal').textContent = state.G.toFixed(2); });
  $('massRange').addEventListener('input', () => { state.newMass = parseFloat($('massRange').value); $('massVal').textContent = state.newMass.toFixed(0); });
  $('trailsRange').addEventListener('input', () => { state.trails = parseFloat($('trailsRange').value); $('trailsVal').textContent = state.trails.toFixed(2); });
  $('speedRange').addEventListener('input', () => { state.speed = parseFloat($('speedRange').value); $('speedVal').textContent = state.speed.toFixed(1); });
  $('mergeChk').addEventListener('change', () => { state.merge = $('mergeChk').checked; });
}
function bindButtons() {
  $('playBtn').addEventListener('click', () => { state.running = !state.running; $('playBtn').textContent = state.running ? '❚❚ Pause' : '▶ Play'; $('playBtn').classList.toggle('paused', !state.running); });
  $('clearBtn').addEventListener('click', () => { bodies = []; clearCanvas(); });
  $('randomBtn').addEventListener('click', () => loadPreset('Cluster'));
  $('panelToggle').addEventListener('click', () => document.body.classList.toggle('panel-open'));
  const ps = $('presetSelect');
  Object.keys(PRESETS).forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n; ps.appendChild(o); });
  ps.addEventListener('change', () => { if (ps.value) loadPreset(ps.value); });
}

// ---- boot ---------------------------------------------------------------
initNav('orbits');
bindControls();
bindButtons();
loadPreset('Solar');
if (window.innerWidth > 820) document.body.classList.add('panel-open');
setTimeout(() => $('hint')?.classList.add('gone'), 8000);
requestAnimationFrame(frame);
