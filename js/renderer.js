// renderer.js — draws the simulation with additive glow sprites and motion
// trails. Each color gets a cached radial-glow sprite (drawImage of a prebaked
// canvas is far cheaper than thousands of live gradients), composited with
// 'lighter' so overlapping particles bloom.

// A palette tuned to look vivid on near-black without vibrating against each
// other. Up to 9 colors.
export const PALETTE = [
  '#ff5c7c', // rose
  '#ffd166', // gold
  '#4ade80', // green
  '#38bdf8', // sky
  '#a78bfa', // violet
  '#fb923c', // orange
  '#2dd4bf', // teal
  '#f472b6', // pink
  '#e2e8f0', // pale
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.sprites = [];
    this.glow = 0.55;
    this.particleSize = 2.0;
    this.trails = 0.82;         // 0 = no trails (clear each frame), ->1 = long trails
    this.bg = '#07070c';
    this.resize();
    this._bakeSprites();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
    // First paint fills the whole buffer so trails have a clean base.
    this.ctx.fillStyle = this.bg;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  setGlow(g) { this.glow = g; this._bakeSprites(); }
  setParticleSize(s) { this.particleSize = s; this._bakeSprites(); }

  _bakeSprites() {
    const base = this.particleSize * this.dpr;
    const glowR = base * (1.5 + this.glow * 3);
    const size = Math.ceil(glowR * 2) + 2;
    this.spriteSize = size;
    this.sprites = PALETTE.map((hex) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      const cx = size / 2;
      const { r, gr, b } = hexToRgb(hex);
      // Outer soft glow.
      const grad = g.createRadialGradient(cx, cx, 0, cx, cx, glowR);
      grad.addColorStop(0, `rgba(${r},${gr},${b},0.65)`);
      grad.addColorStop(0.3, `rgba(${r},${gr},${b},${0.22 * this.glow})`);
      grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      // Bright core.
      g.globalCompositeOperation = 'lighter';
      const core = g.createRadialGradient(cx, cx, 0, cx, cx, base);
      core.addColorStop(0, 'rgba(255,255,255,0.7)');
      core.addColorStop(0.5, `rgba(${r},${gr},${b},0.85)`);
      core.addColorStop(1, `rgba(${r},${gr},${b},0)`);
      g.fillStyle = core;
      g.fillRect(0, 0, size, size);
      return c;
    });
  }

  render(sim) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    if (this.trails <= 0) {
      ctx.fillStyle = this.bg;
      ctx.fillRect(0, 0, W, H);
    } else {
      // Fade the previous frame toward the background instead of clearing.
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1 - this.trails;
      ctx.fillStyle = this.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    ctx.globalCompositeOperation = 'lighter';
    const s = this.spriteSize;
    const half = s / 2;
    for (let i = 0; i < sim.count; i++) {
      const x = sim.posX[i] * W;
      const y = sim.posY[i] * H;
      ctx.drawImage(this.sprites[sim.color[i]], x - half, y - half);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, gr: (n >> 8) & 255, b: n & 255 };
}
