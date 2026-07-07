// attractor3d.js — the 3D mode for the Attractors page. Classic chaotic ODE
// systems (Lorenz, Aizawa, Thomas, …) integrated into a glowing point cloud with
// Three.js and additively blended. Shares the Orbit3D drag/zoom controls.
import { Orbit3D, loadThree } from './orbit3d.js';

// Each system: derivative step(x,y,z,params) -> [dx,dy,dz], an integration dt,
// a display scale and a centre offset (so the shape sits at the origin).
const ATTRACTORS = {
  lorenz:    { name: 'Lorenz',    dt: 0.006, scale: 1.4, center: [0, 0, 25], p: [10, 28, 2.667],
    step: (x, y, z, [a, b, c]) => [a * (y - x), x * (b - z) - y, x * y - c * z] },
  aizawa:    { name: 'Aizawa',    dt: 0.01,  scale: 34,  center: [0, 0, 0.6], p: [0.95, 0.7, 0.6, 3.5, 0.25, 0.1],
    step: (x, y, z, [a, b, c, d, e, f]) => [(z - b) * x - d * y, d * x + (z - b) * y, c + a * z - z * z * z / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x] },
  thomas:    { name: 'Thomas',    dt: 0.04,  scale: 17,  center: [0, 0, 0], p: [0.208],
    step: (x, y, z, [b]) => [Math.sin(y) - b * x, Math.sin(z) - b * y, Math.sin(x) - b * z] },
  halvorsen: { name: 'Halvorsen', dt: 0.008, scale: 9,   center: [-2.5, -2.5, -2.5], p: [1.4],
    step: (x, y, z, [a]) => [-a * x - 4 * y - 4 * z - y * y, -a * y - 4 * z - 4 * x - z * z, -a * z - 4 * x - 4 * y - x * x] },
  dadras:    { name: 'Dadras',    dt: 0.008, scale: 8,   center: [0, 0, 0], p: [3, 2.7, 1.7, 2, 9],
    step: (x, y, z, [a, b, c, d, e]) => [y - a * x + b * y * z, c * y - x * z + z, d * x * y - e * z] },
  chen:      { name: 'Chen',      dt: 0.005, scale: 1.5, center: [0, 0, 20], p: [35, 3, 28],
    step: (x, y, z, [a, b, c]) => [a * (y - x), (c - a) * x - x * z + c * y, x * y - b * z] },
};
export const ATTRACTOR3D = Object.fromEntries(Object.entries(ATTRACTORS).map(([k, v]) => [k, v.name]));

export class Attractor3D {
  constructor() { this.ready = false; this.max = 90000; this.perFrame = 700; }

  async init() {
    const THREE = this.THREE = await loadThree();
    const canvas = this.canvas = document.createElement('canvas');
    canvas.className = 'three-canvas';
    document.body.appendChild(canvas);
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07070c);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.5, 6000);
    this.controls = new Orbit3D(canvas, { radius: 150, minRadius: 20, maxRadius: 900, phi: 1.15 });

    const pos = this.pos = new Float32Array(this.max * 3);
    const col = this.col = new Float32Array(this.max * 3);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({ size: 0.9, vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.points = new THREE.Points(g, mat);
    this.scene.add(this.points);

    this.lut = null;
    this.setFamily('lorenz');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.ready = true;
  }

  resize() {
    if (!this.renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setPaletteLUT(lut) { this.lut = lut; this._recolorAll(); }

  setFamily(key) {
    this.fam = ATTRACTORS[key] || ATTRACTORS.lorenz;
    this.count = 0; this.head = 0;
    this.px = 0.1; this.py = 0.0; this.pz = 0.0;
    for (let i = 0; i < 400; i++) this._advance();  // skip the transient
    this.geo.setDrawRange(0, 0);
  }

  _advance() {
    const f = this.fam;
    const d = f.step(this.px, this.py, this.pz, f.p);
    this.px += f.dt * d[0]; this.py += f.dt * d[1]; this.pz += f.dt * d[2];
  }

  _colorFor(frac, out, o) {
    const lut = this.lut;
    if (!lut) { out[o] = out[o + 1] = out[o + 2] = 1; return; }
    const li = (Math.max(0, Math.min(1, frac)) * 255) | 0;
    out[o] = lut[li * 3] / 255; out[o + 1] = lut[li * 3 + 1] / 255; out[o + 2] = lut[li * 3 + 2] / 255;
  }

  _recolorAll() {
    if (!this.geo) return;
    for (let i = 0; i < this.max; i++) this._colorFor(i / this.max, this.col, i * 3);
    this.geo.attributes.color.needsUpdate = true;
  }

  step() {
    if (!this.ready) return;
    const f = this.fam, s = f.scale, c = f.center;
    for (let i = 0; i < this.perFrame; i++) {
      this._advance();
      const h = this.head;
      // Map (x, y, z) with z as the vertical axis for a nicer default framing.
      this.pos[h * 3] = (this.px - c[0]) * s;
      this.pos[h * 3 + 1] = (this.pz - c[2]) * s;
      this.pos[h * 3 + 2] = (this.py - c[1]) * s;
      this._colorFor(h / this.max, this.col, h * 3);
      this.head = (this.head + 1) % this.max;
      if (this.count < this.max) this.count++;
    }
    this.geo.setDrawRange(0, this.count);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  render(dt) {
    if (!this.ready) return;
    this.controls.update(dt);
    this.controls.applyTo(this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  activate() { if (this.canvas) this.canvas.style.display = 'block'; }
  deactivate() { if (this.canvas) this.canvas.style.display = 'none'; }
  get pointCount() { return this.count; }
}
