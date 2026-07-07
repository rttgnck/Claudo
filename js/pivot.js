// pivot.js — a one-tap reflex arcade. You orbit a sun on a ring; tap / click /
// space reverses your direction. Weave past the rotating blades, sweep up the
// glowing orbs, keep your combo alive. One input, endless panic.
import { initNav } from './nav.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d');
const dpr = Math.min(window.devicePixelRatio || 1, 2);

let W, H, cx, cy, R;
function resize() {
  const r = canvas.getBoundingClientRect();
  W = r.width; H = r.height;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = W / 2; cy = H / 2;
  R = Math.min(W, H) * 0.30;
}
window.addEventListener('resize', resize);
resize();

// ---- audio (tiny SFX) ---------------------------------------------------
let actx, muted = false;
function beep(freq, dur, type = 'sine', vol = 0.18) {
  if (!actx || muted) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(vol, actx.currentTime + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(); o.stop(actx.currentTime + dur + 0.02);
}
function unlockAudio() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); }
const PENT = [0, 3, 5, 7, 10, 12, 15];
const collectSound = (combo) => beep(220 * Math.pow(2, PENT[Math.min(combo, PENT.length - 1)] / 12), 0.18, 'triangle', 0.2);

// ---- game state ---------------------------------------------------------
const PLAYER_HALF = 0.09;
let mode = 'menu';          // menu | play | dead
let ang, dir, omega, score, combo, best, shake, obstacles, orbs, particles, pulse, t;
best = +(localStorage.getItem('pivot-best') || 0);
$('bestVal') && ($('bestVal').textContent = best);

function reset() {
  ang = -Math.PI / 2; dir = 1; omega = 1.7;
  score = 0; combo = 0; shake = 0; pulse = 0; t = 0;
  obstacles = []; orbs = []; particles = [];
  for (let i = 0; i < 3; i++) spawnOrb();
  updateHud();
}

function angDiff(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }

function farFromPlayer(a, min) { return angDiff(a, ang) > min; }

function spawnObstacle() {
  let a = null;
  for (let i = 0; i < 24; i++) { const c = Math.random() * Math.PI * 2; if (farFromPlayer(c, 1.4)) { a = c; break; } }
  if (a === null) return; // no safe spot right now — try again later
  const speedScale = 1 + Math.min(score * 0.018, 0.9);
  const spin = (0.4 + Math.random() * 0.8) * speedScale * (Math.random() < 0.5 ? 1 : -1);
  obstacles.push({ ang: a, half: 0.12 + Math.random() * 0.15, spin, hue: 355 });
}
function spawnOrb() {
  let a;
  for (let i = 0; i < 30; i++) {
    a = Math.random() * Math.PI * 2;
    if (!farFromPlayer(a, 0.5)) continue;
    if (obstacles.some((o) => angDiff(a, o.ang) < o.half + 0.25)) continue;
    break;
  }
  orbs.push({ ang: a, born: t });
}

function flip() {
  if (mode === 'menu') { start(); return; }
  if (mode === 'dead') { if (t - deadAt > 0.4) start(); return; }
  dir *= -1;
  beep(160, 0.05, 'square', 0.05);
  particles.push(...burst(ring(ang), 4, '#ffffff', 40));
}

let deadAt = 0, startedAt = 0;
function start() { unlockAudio(); reset(); startedAt = t; mode = 'play'; $('startScreen').classList.add('hide'); $('overScreen').classList.add('hide'); document.body.classList.add('playing'); }
function die() {
  mode = 'dead'; deadAt = t; shake = 18;
  beep(80, 0.5, 'sawtooth', 0.25); setTimeout(() => beep(55, 0.6, 'sine', 0.2), 60);
  particles.push(...burst(ring(ang), 40, '#ff5c7c', 220));
  if (score > best) { best = score; localStorage.setItem('pivot-best', best); $('newBest').classList.remove('hide'); }
  else $('newBest').classList.add('hide');
  $('finalScore').textContent = score;
  $('finalBest').textContent = best;
  document.body.classList.remove('playing');
  setTimeout(() => $('overScreen').classList.remove('hide'), 550);
}

// ---- helpers ------------------------------------------------------------
function ring(a, r = R) { return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }; }
function burst(p, n, color, speed) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
    out.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, color });
  }
  return out;
}

// ---- update -------------------------------------------------------------
function update(dt) {
  t += dt;
  if (mode === 'play') {
    omega = 1.6 + Math.min(score * 0.028, 1.5);
    ang += dir * omega * dt;

    // Grace period at the start so you can get oriented.
    const grace = t - startedAt < 2.2;
    const target = grace ? 0 : Math.min(1 + Math.floor(score / 4), 6);
    if (obstacles.length < target && Math.random() < 0.05) spawnObstacle();

    for (const o of obstacles) { o.ang += o.spin * dt; }

    // Collisions with blades (never during grace).
    if (!grace) {
      for (const o of obstacles) {
        if (angDiff(ang, o.ang) < o.half + PLAYER_HALF) { die(); break; }
      }
    }

    // Orb pickups.
    for (let i = orbs.length - 1; i >= 0; i--) {
      if (angDiff(ang, orbs[i].ang) < PLAYER_HALF + 0.05) {
        combo++; score += combo;
        pulse = 1;
        particles.push(...burst(ring(orbs[i].ang), 14, '#4ade80', 150));
        collectSound(combo);
        orbs.splice(i, 1); spawnOrb();
        updateHud();
      }
    }
  }

  // particles + shake decay
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt * 1.6;
    if (p.life <= 0) particles.splice(i, 1);
  }
  shake *= Math.pow(0.001, dt);
  pulse *= Math.pow(0.02, dt);
}

function updateHud() {
  $('scoreVal').textContent = score;
  $('comboVal').textContent = combo > 1 ? '×' + combo : '';
  $('bestVal').textContent = best;
  const bm = $('bestValMenu'); if (bm) bm.textContent = best;
}

// ---- render -------------------------------------------------------------
function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#07070c';
  ctx.fillRect(0, 0, W, H);
  const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
  ctx.translate(sx, sy);

  // ring
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2; ctx.stroke();

  // sun
  const sunR = 22 + pulse * 10 + Math.sin(t * 2) * 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, sunR * 3);
  grad.addColorStop(0, 'rgba(255,220,150,0.9)');
  grad.addColorStop(0.3, 'rgba(255,140,80,0.4)');
  grad.addColorStop(1, 'rgba(255,140,80,0)');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, sunR * 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffe6b0'; ctx.beginPath(); ctx.arc(cx, cy, sunR, 0, Math.PI * 2); ctx.fill();

  ctx.globalCompositeOperation = 'lighter';

  // orbs
  for (const o of orbs) {
    const p = ring(o.ang);
    const rr = 7 + Math.sin(t * 4 + o.ang * 5) * 1.5;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr * 2.4);
    g.addColorStop(0, 'rgba(150,255,180,0.95)'); g.addColorStop(0.4, 'rgba(74,222,128,0.6)'); g.addColorStop(1, 'rgba(74,222,128,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, rr * 2.4, 0, Math.PI * 2); ctx.fill();
  }

  // blades
  for (const o of obstacles) {
    ctx.beginPath();
    ctx.arc(cx, cy, R, o.ang - o.half, o.ang + o.half);
    ctx.strokeStyle = '#ff5c7c'; ctx.lineWidth = 15; ctx.lineCap = 'round';
    ctx.shadowColor = '#ff5c7c'; ctx.shadowBlur = 18; ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // particles
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3 * p.life + 0.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // player
  if (mode !== 'menu') {
    const p = ring(ang);
    const pr = 9;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pr * 2.6);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(120,200,255,0.9)'); g.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, pr * 2.6, 0, Math.PI * 2); ctx.fill();
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---- loop ---------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

// ---- input --------------------------------------------------------------
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); flip(); });
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') { e.preventDefault(); flip(); }
});
$('startBtn').addEventListener('click', (e) => { e.stopPropagation(); start(); });
$('againBtn').addEventListener('click', (e) => { e.stopPropagation(); start(); });
$('muteBtn').addEventListener('click', () => {
  muted = !muted;
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
});
$('shareBtn').addEventListener('click', async () => {
  const text = `I scored ${score} in Pivot 🌀 — a one-tap reflex game.`;
  const url = `${location.origin}${location.pathname}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Pivot', text, url }); }
    else { await navigator.clipboard.writeText(`${text} ${url}`); toast('Score copied to clipboard'); }
  } catch { toast('Could not share'); }
});

let toastTimer;
function toast(msg) { const t2 = $('toast'); t2.textContent = msg; t2.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t2.classList.remove('show'), 2000); }

// ---- boot ---------------------------------------------------------------
initNav('pivot');
reset();
mode = 'menu';
requestAnimationFrame(frame);
