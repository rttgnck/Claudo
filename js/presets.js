// presets.js — curated interaction matrices, each a little universe with its own
// emergent "physics". Every preset is a concrete matrix so it's fully
// reproducible and shareable.

function clamp(v) { return Math.max(-1, Math.min(1, v)); }

// Cyclic predator/prey: each color chases the next and flees the previous.
function chase(k) {
  const m = [];
  for (let i = 0; i < k; i++) {
    m[i] = new Array(k).fill(0);
    m[i][i] = 0.1;
    m[i][(i + 1) % k] = 1.0;      // pursue the next color
    m[i][(i + k - 1) % k] = -1.0; // flee the previous
  }
  return m;
}

// Tight self-bonding blobs that gently avoid other colors -> membrane cells.
function cells(k) {
  const m = [];
  for (let i = 0; i < k; i++) {
    m[i] = new Array(k).fill(0);
    for (let j = 0; j < k; j++) {
      m[i][j] = i === j ? 0.9 : -0.15 - Math.random() * 0.2;
    }
  }
  return m;
}

// Everyone mildly likes everyone, self-repels a touch -> lattices / crystals.
function crystals(k) {
  const m = [];
  for (let i = 0; i < k; i++) {
    m[i] = new Array(k).fill(0);
    for (let j = 0; j < k; j++) {
      m[i][j] = i === j ? -0.2 : 0.55;
    }
  }
  return m;
}

const PRESETS = [
  {
    name: 'Genesis',
    colors: 6,
    matrix: [
      [ 0.62, -0.30,  0.10, -0.55,  0.20,  0.40],
      [ 0.35,  0.55, -0.40,  0.15, -0.25,  0.05],
      [-0.20,  0.45,  0.60, -0.35,  0.30, -0.50],
      [ 0.15, -0.30,  0.40,  0.58, -0.45,  0.25],
      [-0.40,  0.20, -0.15,  0.45,  0.52, -0.30],
      [ 0.30, -0.50,  0.25, -0.20,  0.40,  0.60],
    ],
  },
  { name: 'Cells', colors: 6, matrix: cells(6) },
  { name: 'Chase', colors: 5, matrix: chase(5) },
  { name: 'Crystals', colors: 5, matrix: crystals(5) },
  {
    name: 'Nebula',
    colors: 4,
    matrix: [
      [ 0.30,  0.18, -0.12,  0.22],
      [ 0.18,  0.28,  0.20, -0.14],
      [-0.12,  0.20,  0.32,  0.16],
      [ 0.22, -0.14,  0.16,  0.26],
    ],
  },
  {
    name: 'Duel',
    colors: 3,
    matrix: [
      [ 0.90, -0.90,  0.00],
      [ 0.00,  0.90, -0.90],
      [-0.90,  0.00,  0.90],
    ],
  },
  {
    name: 'Symbiosis',
    colors: 4,
    matrix: [
      [ 0.70,  0.60, -0.60, -0.60],
      [ 0.60,  0.70, -0.60, -0.60],
      [-0.60, -0.60,  0.70,  0.60],
      [-0.60, -0.60,  0.60,  0.70],
    ],
  },
];

export { PRESETS, clamp };
