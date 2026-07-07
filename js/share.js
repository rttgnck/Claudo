// share.js — pack a whole universe (interaction matrix + tuning) into a short
// URL-safe string so people can share the worlds they discover. Positions stay
// random on load; the *rules* are the universe.

const VERSION = 1;

// Quantize a float in [lo,hi] to a byte and back.
const q = (v, lo, hi) => Math.max(0, Math.min(255, Math.round(((v - lo) / (hi - lo)) * 255)));
const dq = (b, lo, hi) => lo + (b / 255) * (hi - lo);

export function encodeState(st) {
  const k = st.numColors;
  const bytes = [];
  bytes.push(VERSION, k);
  bytes.push((st.count >> 8) & 255, st.count & 255);
  bytes.push(q(st.rMax, 0.02, 0.3));
  bytes.push(q(st.beta, 0.05, 0.6));
  bytes.push(q(st.forceFactor, 0, 12));
  bytes.push(q(st.friction, 0.6, 0.99));
  bytes.push(q(st.glow, 0, 1));
  bytes.push(q(st.particleSize, 0.8, 6));
  bytes.push(q(st.trails, 0, 0.98));
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++)
      bytes.push(q(st.matrix[i][j], -1, 1));
  return toB64(Uint8Array.from(bytes));
}

export function decodeState(str) {
  try {
    const bytes = fromB64(str);
    if (bytes[0] !== VERSION) return null;
    const k = bytes[1];
    let p = 2;
    const count = (bytes[p++] << 8) | bytes[p++];
    const rMax = dq(bytes[p++], 0.02, 0.3);
    const beta = dq(bytes[p++], 0.05, 0.6);
    const forceFactor = dq(bytes[p++], 0, 12);
    const friction = dq(bytes[p++], 0.6, 0.99);
    const glow = dq(bytes[p++], 0, 1);
    const particleSize = dq(bytes[p++], 0.8, 6);
    const trails = dq(bytes[p++], 0, 0.98);
    const matrix = [];
    for (let i = 0; i < k; i++) {
      matrix[i] = [];
      for (let j = 0; j < k; j++) matrix[i][j] = dq(bytes[p++], -1, 1);
    }
    return { numColors: k, count, rMax, beta, forceFactor, friction, glow, particleSize, trails, matrix };
  } catch (e) {
    return null;
  }
}

function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(str);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
