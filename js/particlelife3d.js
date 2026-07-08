// particlelife3d.js — 3D mode for Particle Life. Runs the same attraction-matrix
// rules but in a toroidal 3D cube (with a 3D uniform-grid neighbour search), and
// renders the particles as an additive Three.js point cloud you can orbit. It
// reads the live matrix by reference, so dragging the 2D matrix editor reshapes
// the 3D world in real time too.
import { Orbit3D, loadThree } from './orbit3d.js';
import { PALETTE } from './renderer.js';

export class ParticleLife3D {
  constructor() { this.ready = false; }

  async init(sim) {
    const THREE = this.THREE = await loadThree();
    this.matrix = sim.matrix; this.numColors = sim.numColors;
    this.rMax = sim.rMax; this.beta = sim.beta; this.forceFactor = sim.forceFactor;
    this.friction = sim.friction; this.dt = sim.dt;
    this.count = Math.min(sim.count, 3000);
    this._alloc();

    const canvas = this.canvas = document.createElement('canvas');
    canvas.className = 'three-canvas';
    document.body.appendChild(canvas);
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07070c);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 4000);
    this.S = 120; // cube display size
    this.controls = new Orbit3D(canvas, { radius: 210, minRadius: 40, maxRadius: 700, phi: 1.1, autoRotate: 0.1 });

    const geo = this.geo = new THREE.BufferGeometry();
    this.vpos = new Float32Array(this.count * 3);
    const vcol = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      const hex = PALETTE[this.color[i]] || '#ffffff';
      const n = parseInt(hex.slice(1), 16);
      vcol[i * 3] = ((n >> 16) & 255) / 255; vcol[i * 3 + 1] = ((n >> 8) & 255) / 255; vcol[i * 3 + 2] = (n & 255) / 255;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.vpos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(vcol, 3));
    this.vcol = vcol;
    const mat = new THREE.PointsMaterial({ size: 2.2, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.points = new THREE.Points(geo, mat);
    this.scene.add(this.points);

    // faint cube frame for spatial reference
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(this.S, this.S, this.S)), new THREE.LineBasicMaterial({ color: 0x2a2c3a }));
    this.scene.add(box);

    this.resize(); window.addEventListener('resize', () => this.resize());
    this.ready = true;
  }

  _alloc() {
    const n = this.count;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.color = new Int8Array(n);
    for (let i = 0; i < n; i++) { this.px[i] = Math.random(); this.py[i] = Math.random(); this.pz[i] = Math.random(); this.color[i] = (Math.random() * this.numColors) | 0; }
    this.g = Math.max(1, Math.floor(1 / this.rMax));
    const cells = this.g * this.g * this.g;
    this.cellStart = new Int32Array(cells + 1);
    this.cellCount = new Int32Array(cells);
    this.cellOf = new Int32Array(n);
    this.sorted = new Int32Array(n);
    this.cursor = new Int32Array(cells);
  }

  setRules(matrix, numColors) {
    this.matrix = matrix;
    if (numColors !== this.numColors) {
      this.numColors = numColors;
      for (let i = 0; i < this.count; i++) {
        this.color[i] = (Math.random() * numColors) | 0;
        const hex = PALETTE[this.color[i]] || '#fff'; const n = parseInt(hex.slice(1), 16);
        this.vcol[i * 3] = ((n >> 16) & 255) / 255; this.vcol[i * 3 + 1] = ((n >> 8) & 255) / 255; this.vcol[i * 3 + 2] = (n & 255) / 255;
      }
      this.geo.attributes.color.needsUpdate = true;
    }
  }
  scatter() { for (let i = 0; i < this.count; i++) { this.px[i] = Math.random(); this.py[i] = Math.random(); this.pz[i] = Math.random(); this.vx[i] = this.vy[i] = this.vz[i] = 0; } }

  _force(r, a) { if (r < this.beta) return r / this.beta - 1; if (r < 1) return a * (1 - Math.abs(2 * r - 1 - this.beta) / (1 - this.beta)); return 0; }

  _buildGrid() {
    const g = this.g, cells = g * g * g;
    this.cellCount.fill(0);
    for (let i = 0; i < this.count; i++) {
      let cx = (this.px[i] * g) | 0, cy = (this.py[i] * g) | 0, cz = (this.pz[i] * g) | 0;
      if (cx >= g) cx = g - 1; if (cy >= g) cy = g - 1; if (cz >= g) cz = g - 1;
      if (cx < 0) cx = 0; if (cy < 0) cy = 0; if (cz < 0) cz = 0;
      const c = (cz * g + cy) * g + cx; this.cellOf[i] = c; this.cellCount[c]++;
    }
    let acc = 0;
    for (let c = 0; c < cells; c++) { this.cellStart[c] = acc; acc += this.cellCount[c]; }
    this.cellStart[cells] = acc;
    this.cursor.set(this.cellStart.subarray(0, cells));
    for (let i = 0; i < this.count; i++) { const c = this.cellOf[i]; this.sorted[this.cursor[c]++] = i; }
  }

  step() {
    if (!this.ready) return;
    this._buildGrid();
    const g = this.g, rMax = this.rMax, m = this.matrix, n = this.count;
    for (let i = 0; i < n; i++) {
      const xi = this.px[i], yi = this.py[i], zi = this.pz[i], ci = this.color[i];
      let fx = 0, fy = 0, fz = 0;
      let cx = (xi * g) | 0, cy = (yi * g) | 0, cz = (zi * g) | 0;
      if (cx >= g) cx = g - 1; if (cy >= g) cy = g - 1; if (cz >= g) cz = g - 1;
      if (cx < 0) cx = 0; if (cy < 0) cy = 0; if (cz < 0) cz = 0;
      for (let oz = -1; oz <= 1; oz++) { let nz = cz + oz; if (nz < 0) nz += g; else if (nz >= g) nz -= g;
        for (let oy = -1; oy <= 1; oy++) { let ny = cy + oy; if (ny < 0) ny += g; else if (ny >= g) ny -= g;
          for (let ox = -1; ox <= 1; ox++) { let nx = cx + ox; if (nx < 0) nx += g; else if (nx >= g) nx -= g;
            const cell = (nz * g + ny) * g + nx;
            const s0 = this.cellStart[cell], s1 = this.cellStart[cell + 1];
            for (let s = s0; s < s1; s++) {
              const j = this.sorted[s]; if (j === i) continue;
              let dx = this.px[j] - xi, dy = this.py[j] - yi, dz = this.pz[j] - zi;
              if (dx > 0.5) dx -= 1; else if (dx < -0.5) dx += 1;
              if (dy > 0.5) dy -= 1; else if (dy < -0.5) dy += 1;
              if (dz > 0.5) dz -= 1; else if (dz < -0.5) dz += 1;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > rMax * rMax || d2 === 0) continue;
              const d = Math.sqrt(d2);
              const f = this._force(d / rMax, m[ci][this.color[j]]);
              fx += (dx / d) * f; fy += (dy / d) * f; fz += (dz / d) * f;
            }
          }
        }
      }
      fx *= rMax * this.forceFactor; fy *= rMax * this.forceFactor; fz *= rMax * this.forceFactor;
      this.vx[i] = this.vx[i] * this.friction + fx * this.dt;
      this.vy[i] = this.vy[i] * this.friction + fy * this.dt;
      this.vz[i] = this.vz[i] * this.friction + fz * this.dt;
    }
    const S = this.S, vp = this.vpos;
    for (let i = 0; i < n; i++) {
      let x = this.px[i] + this.vx[i] * this.dt, y = this.py[i] + this.vy[i] * this.dt, z = this.pz[i] + this.vz[i] * this.dt;
      if (x < 0) x += 1; else if (x >= 1) x -= 1;
      if (y < 0) y += 1; else if (y >= 1) y -= 1;
      if (z < 0) z += 1; else if (z >= 1) z -= 1;
      this.px[i] = x; this.py[i] = y; this.pz[i] = z;
      vp[i * 3] = (x - 0.5) * S; vp[i * 3 + 1] = (y - 0.5) * S; vp[i * 3 + 2] = (z - 0.5) * S;
    }
    this.geo.attributes.position.needsUpdate = true;
  }

  resize() {
    if (!this.renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  render(dt) {
    if (!this.ready) return;
    this.controls.update(dt); this.controls.applyTo(this.camera);
    this.renderer.render(this.scene, this.camera);
  }
  activate() { if (this.canvas) this.canvas.style.display = 'block'; }
  deactivate() { if (this.canvas) this.canvas.style.display = 'none'; }
}
