// simulation.js — the particle-life physics engine.
//
// The whole "life" comes from one idea: every particle has a color, and each
// color feels an attraction (or repulsion) toward every other color, defined by
// a K×K matrix. Short range is always repulsive (particles can't overlap); the
// mid range follows the matrix. Simple rules, wildly emergent behavior.
//
// Positions live in a toroidal [0,1)×[0,1) world so there are no walls — the
// space wraps, which keeps structures from piling up in corners. A uniform
// spatial-hash grid keeps neighbor lookups O(N) instead of O(N²), so we can push
// several thousand particles at 60fps.

export class Simulation {
  constructor(opts = {}) {
    this.numColors = opts.numColors ?? 6;
    this.count = opts.count ?? 2400;

    // Tunable dynamics.
    this.rMax = opts.rMax ?? 0.11;        // interaction radius (world units)
    this.beta = opts.beta ?? 0.3;         // fraction of rMax that is hard repulsion
    this.forceFactor = opts.forceFactor ?? 4.2;
    this.friction = opts.friction ?? 0.86; // velocity retained per (1/60)s
    this.dt = opts.dt ?? 0.016;

    // External mouse force.
    this.pointer = { x: 0, y: 0, active: false, strength: 0 };

    // Interaction matrix: attraction[a][b] in [-1, 1].
    this.matrix = opts.matrix ?? Simulation.randomMatrix(this.numColors);

    this._allocate();
    this.randomizePositions();
  }

  _allocate() {
    const n = this.count;
    this.posX = new Float32Array(n);
    this.posY = new Float32Array(n);
    this.velX = new Float32Array(n);
    this.velY = new Float32Array(n);
    this.color = new Int8Array(n);

    // Spatial hash grid sized so each cell is ~rMax wide.
    this.gridSize = Math.max(1, Math.floor(1 / this.rMax));
    const cells = this.gridSize * this.gridSize;
    this.cellCount = new Int32Array(cells);
    this.cellStart = new Int32Array(cells + 1);
    this.sorted = new Int32Array(n);
  }

  static randomMatrix(k) {
    const m = [];
    for (let i = 0; i < k; i++) {
      m[i] = [];
      for (let j = 0; j < k; j++) m[i][j] = Math.random() * 2 - 1;
    }
    return m;
  }

  setMatrix(m) {
    this.matrix = m;
    this.numColors = m.length;
    // Re-color any particles whose index is now out of range.
    for (let i = 0; i < this.count; i++) {
      if (this.color[i] >= this.numColors) {
        this.color[i] = (Math.random() * this.numColors) | 0;
      }
    }
  }

  setColors(k) {
    if (k === this.numColors) return;
    const old = this.matrix;
    const m = [];
    for (let i = 0; i < k; i++) {
      m[i] = [];
      for (let j = 0; j < k; j++) {
        m[i][j] = old[i] && old[i][j] !== undefined ? old[i][j] : Math.random() * 2 - 1;
      }
    }
    this.numColors = k;
    this.matrix = m;
    for (let i = 0; i < this.count; i++) this.color[i] = (Math.random() * k) | 0;
  }

  setCount(n) {
    const old = { posX: this.posX, posY: this.posY, velX: this.velX, velY: this.velY, color: this.color, prev: this.count };
    this.count = n;
    this._allocate();
    const keep = Math.min(old.prev, n);
    for (let i = 0; i < keep; i++) {
      this.posX[i] = old.posX[i];
      this.posY[i] = old.posY[i];
      this.velX[i] = old.velX[i];
      this.velY[i] = old.velY[i];
      this.color[i] = old.color[i];
    }
    for (let i = keep; i < n; i++) {
      this.posX[i] = Math.random();
      this.posY[i] = Math.random();
      this.color[i] = (Math.random() * this.numColors) | 0;
    }
  }

  randomizePositions() {
    for (let i = 0; i < this.count; i++) {
      this.posX[i] = Math.random();
      this.posY[i] = Math.random();
      this.velX[i] = 0;
      this.velY[i] = 0;
      this.color[i] = (Math.random() * this.numColors) | 0;
    }
  }

  // Force curve: negative (repel) below beta, then a smooth tent scaled by the
  // matrix attraction value between beta and 1 (in units of rMax).
  _force(r, a) {
    if (r < this.beta) return r / this.beta - 1;
    if (r < 1) return a * (1 - Math.abs(2 * r - 1 - this.beta) / (1 - this.beta));
    return 0;
  }

  _buildGrid() {
    const g = this.gridSize;
    const cells = g * g;
    this.cellCount.fill(0);
    const cellOf = this._cellOf = this._cellOf || new Int32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      let cx = (this.posX[i] * g) | 0;
      let cy = (this.posY[i] * g) | 0;
      if (cx < 0) cx = 0; else if (cx >= g) cx = g - 1;
      if (cy < 0) cy = 0; else if (cy >= g) cy = g - 1;
      const c = cy * g + cx;
      cellOf[i] = c;
      this.cellCount[c]++;
    }
    let acc = 0;
    for (let c = 0; c < cells; c++) {
      this.cellStart[c] = acc;
      acc += this.cellCount[c];
    }
    this.cellStart[cells] = acc;
    const cursor = this._cursor = this._cursor || new Int32Array(cells);
    cursor.set(this.cellStart.subarray(0, cells));
    for (let i = 0; i < this.count; i++) {
      const c = cellOf[i];
      this.sorted[cursor[c]++] = i;
    }
  }

  step() {
    this._buildGrid();
    const g = this.gridSize;
    const rMax = this.rMax;
    const m = this.matrix;

    for (let i = 0; i < this.count; i++) {
      const xi = this.posX[i];
      const yi = this.posY[i];
      const ci = this.color[i];
      let fx = 0, fy = 0;

      let cx = (xi * g) | 0;
      let cy = (yi * g) | 0;
      if (cx < 0) cx = 0; else if (cx >= g) cx = g - 1;
      if (cy < 0) cy = 0; else if (cy >= g) cy = g - 1;

      for (let oy = -1; oy <= 1; oy++) {
        let ny = cy + oy;
        if (ny < 0) ny += g; else if (ny >= g) ny -= g;
        for (let ox = -1; ox <= 1; ox++) {
          let nx = cx + ox;
          if (nx < 0) nx += g; else if (nx >= g) nx -= g;
          const cell = ny * g + nx;
          const start = this.cellStart[cell];
          const end = this.cellStart[cell + 1];
          for (let s = start; s < end; s++) {
            const j = this.sorted[s];
            if (j === i) continue;
            let dx = this.posX[j] - xi;
            let dy = this.posY[j] - yi;
            // Toroidal wrap: take the shortest path across the seam.
            if (dx > 0.5) dx -= 1; else if (dx < -0.5) dx += 1;
            if (dy > 0.5) dy -= 1; else if (dy < -0.5) dy += 1;
            const d2 = dx * dx + dy * dy;
            if (d2 > rMax * rMax || d2 === 0) continue;
            const d = Math.sqrt(d2);
            const f = this._force(d / rMax, m[ci][this.color[j]]);
            fx += (dx / d) * f;
            fy += (dy / d) * f;
          }
        }
      }

      fx *= rMax * this.forceFactor;
      fy *= rMax * this.forceFactor;

      // Pointer force (attract/repel toward cursor).
      if (this.pointer.active && this.pointer.strength !== 0) {
        let dx = this.pointer.x - xi;
        let dy = this.pointer.y - yi;
        if (dx > 0.5) dx -= 1; else if (dx < -0.5) dx += 1;
        if (dy > 0.5) dy -= 1; else if (dy < -0.5) dy += 1;
        const d2 = dx * dx + dy * dy;
        const rp = 0.18;
        if (d2 < rp * rp && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const fall = (1 - d / rp);
          fx += (dx / d) * fall * this.pointer.strength;
          fy += (dy / d) * fall * this.pointer.strength;
        }
      }

      this.velX[i] = this.velX[i] * this.friction + fx * this.dt;
      this.velY[i] = this.velY[i] * this.friction + fy * this.dt;
    }

    // Integrate + wrap.
    for (let i = 0; i < this.count; i++) {
      let x = this.posX[i] + this.velX[i] * this.dt;
      let y = this.posY[i] + this.velY[i] * this.dt;
      if (x < 0) x += 1; else if (x >= 1) x -= 1;
      if (y < 0) y += 1; else if (y >= 1) y -= 1;
      this.posX[i] = x;
      this.posY[i] = y;
    }
  }
}
