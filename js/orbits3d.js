// orbits3d.js — 3D mode for Orbits. A full 3D N-body gravity sim (velocity-Verlet
// + merging), rendered with Three.js: bodies as additive sprites, plus a fading
// point-cloud trail so the orbits draw themselves in space. Orbit the camera to
// view inclined systems from any angle.
import { Orbit3D, loadThree } from './orbit3d.js';

const COLORS = [0xffd166, 0xff6b5c, 0x4ade80, 0x38bdf8, 0xa78bfa, 0xf472b6, 0x2dd4bf, 0xfb923c];

export class Orbits3D {
  constructor() { this.ready = false; this.G = 1; this.softening = 0.25; this.maxTrail = 6000; }

  async init(G) {
    const THREE = this.THREE = await loadThree();
    this.G = G;
    const canvas = this.canvas = document.createElement('canvas');
    canvas.className = 'three-canvas';
    document.body.appendChild(canvas);
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07070c);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 8000);
    this.controls = new Orbit3D(canvas, { radius: 60, minRadius: 5, maxRadius: 1200, phi: 1.2, autoRotate: 0.08 });

    // Glow sprite texture (shared).
    this.sprite = this._glowTexture();

    // Trail point cloud.
    const tg = this.trailGeo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(this.maxTrail * 3);
    this.trailCol = new Float32Array(this.maxTrail * 3);
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setDrawRange(0, 0);
    this.scene.add(new THREE.Points(tg, new THREE.PointsMaterial({ size: 0.5, vertexColors: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })));
    this.trailHead = 0; this.trailCount = 0;

    this.bodies = [];
    this.sprites = [];
    this.spriteGroup = new THREE.Group();
    this.scene.add(this.spriteGroup);

    this.loadPreset('Solar');
    this.resize(); window.addEventListener('resize', () => this.resize());
    this.ready = true;
  }

  _glowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const t = new this.THREE.CanvasTexture(c); return t;
  }

  _radius(m) { return Math.max(0.25, 0.28 * Math.cbrt(m)); }

  _addBody(x, y, z, vx, vy, vz, m, colorHex, star) {
    const THREE = this.THREE;
    const mat = new THREE.SpriteMaterial({ map: this.sprite, color: colorHex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    const r = this._radius(m);
    sp.scale.setScalar(r * (star ? 7 : 4.5));
    sp.position.set(x, y, z);
    this.spriteGroup.add(sp);
    this.bodies.push({ x, y, z, vx, vy, vz, m, r, color: colorHex, star, sprite: sp });
  }

  clear() {
    for (const b of this.bodies) this.spriteGroup.remove(b.sprite);
    this.bodies = []; this.trailCount = 0; this.trailHead = 0; this.trailGeo.setDrawRange(0, 0);
  }

  // Circular orbit in a randomly inclined plane.
  _orbit(cm, r, m, color) {
    const a = Math.random() * Math.PI * 2, inc = (Math.random() - 0.5) * 1.2;
    const u = [Math.cos(a), Math.sin(a) * Math.sin(inc), Math.sin(a) * Math.cos(inc)];
    const w = [-Math.sin(a), Math.cos(a) * Math.sin(inc), Math.cos(a) * Math.cos(inc)];
    const v = Math.sqrt(this.G * cm / r);
    this._addBody(u[0] * r, u[1] * r, u[2] * r, w[0] * v, w[1] * v, w[2] * v, m, color);
  }

  loadPreset(name) {
    this.clear();
    let ci = 0; const nc = () => COLORS[ci++ % COLORS.length];
    if (name === 'Binary') {
      const M = 1600, d = 4, v = 0.5 * Math.sqrt(this.G * 2 * M / d);
      this._addBody(-d / 2, 0, 0, 0, -v, 0, M, 0xff9a5c, true);
      this._addBody(d / 2, 0, 0, 0, v, 0, M, 0x38bdf8, true);
      for (const r of [9, 13, 18]) this._orbit(2 * M, r, 2 + Math.random() * 4, nc());
    } else if (name === 'Figure-8') {
      const p = [0.97000436, -0.24308753], vv = [-0.93240737, -0.86473146], sc = 8;
      this._addBody(p[0] * sc, p[1] * sc, 0, -vv[0] / 2, -vv[1] / 2, 0, 12, 0x4ade80);
      this._addBody(-p[0] * sc, -p[1] * sc, 0, -vv[0] / 2, -vv[1] / 2, 0, 12, 0x38bdf8);
      this._addBody(0, 0, 0, vv[0], vv[1], 0, 12, 0xf472b6);
    } else if (name === 'Cluster') {
      for (let i = 0; i < 40; i++) {
        const rr = Math.cbrt(Math.random()) * 16, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
        const x = rr * Math.sin(ph) * Math.cos(th), y = rr * Math.cos(ph), z = rr * Math.sin(ph) * Math.sin(th);
        this._addBody(x, y, z, -y * 0.14, x * 0.14, z * 0.05, 4 + Math.random() * 10, nc());
      }
    } else { // Solar
      this._addBody(0, 0, 0, 0, 0, 0, 4000, 0xffd166, true);
      for (const r of [4, 6.5, 9.5, 13, 17]) this._orbit(4000, r, 3 + Math.random() * 6, nc());
    }
  }

  _accel() {
    const n = this.bodies.length, G = this.G, eps2 = this.softening;
    const ax = new Float64Array(n), ay = new Float64Array(n), az = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const bi = this.bodies[i];
      for (let j = i + 1; j < n; j++) {
        const bj = this.bodies[j];
        const dx = bj.x - bi.x, dy = bj.y - bi.y, dz = bj.z - bi.z;
        const d2 = dx * dx + dy * dy + dz * dz + eps2;
        const inv = 1 / (d2 * Math.sqrt(d2)), f = G * inv;
        ax[i] += f * bj.m * dx; ay[i] += f * bj.m * dy; az[i] += f * bj.m * dz;
        ax[j] -= f * bi.m * dx; ay[j] -= f * bi.m * dy; az[j] -= f * bi.m * dz;
      }
    }
    return [ax, ay, az];
  }

  step(dt, merge) {
    if (!this.ready || this.bodies.length === 0) return;
    const h = dt, sub = 4, hh = h / sub;
    for (let s = 0; s < sub; s++) {
      let [ax, ay, az] = this._accel();
      const n = this.bodies.length;
      for (let i = 0; i < n; i++) { const b = this.bodies[i]; b.vx += ax[i] * hh * 0.5; b.vy += ay[i] * hh * 0.5; b.vz += az[i] * hh * 0.5; b.x += b.vx * hh; b.y += b.vy * hh; b.z += b.vz * hh; }
      [ax, ay, az] = this._accel();
      for (let i = 0; i < n; i++) { const b = this.bodies[i]; b.vx += ax[i] * hh * 0.5; b.vy += ay[i] * hh * 0.5; b.vz += az[i] * hh * 0.5; }
      if (merge) this._collide();
    }
    // update sprites + trails
    for (const b of this.bodies) {
      b.sprite.position.set(b.x, b.y, b.z);
      const th = this.trailHead;
      this.trailPos[th * 3] = b.x; this.trailPos[th * 3 + 1] = b.y; this.trailPos[th * 3 + 2] = b.z;
      const c = b.color; this.trailCol[th * 3] = ((c >> 16) & 255) / 255; this.trailCol[th * 3 + 1] = ((c >> 8) & 255) / 255; this.trailCol[th * 3 + 2] = (c & 255) / 255;
      this.trailHead = (this.trailHead + 1) % this.maxTrail;
      if (this.trailCount < this.maxTrail) this.trailCount++;
    }
    this.trailGeo.setDrawRange(0, this.trailCount);
    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailGeo.attributes.color.needsUpdate = true;
  }

  _collide() {
    for (let i = 0; i < this.bodies.length; i++) {
      for (let j = i + 1; j < this.bodies.length; j++) {
        const a = this.bodies[i], b = this.bodies[j];
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        if (dx * dx + dy * dy + dz * dz < (a.r + b.r) * (a.r + b.r)) {
          const m = a.m + b.m, big = a.m >= b.m ? a : b, small = a.m >= b.m ? b : a;
          big.x = (a.x * a.m + b.x * b.m) / m; big.y = (a.y * a.m + b.y * b.m) / m; big.z = (a.z * a.m + b.z * b.m) / m;
          big.vx = (a.vx * a.m + b.vx * b.m) / m; big.vy = (a.vy * a.m + b.vy * b.m) / m; big.vz = (a.vz * a.m + b.vz * b.m) / m;
          big.m = m; big.r = this._radius(m); big.star = a.star || b.star;
          big.sprite.scale.setScalar(big.r * (big.star ? 7 : 4.5));
          this.spriteGroup.remove(small.sprite);
          this.bodies.splice(this.bodies.indexOf(small), 1);
          i = -1; break;
        }
      }
    }
  }

  resize() { if (!this.renderer) return; const w = window.innerWidth, h = window.innerHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  render(dt) { if (!this.ready) return; this.controls.update(dt); this.controls.applyTo(this.camera); this.renderer.render(this.scene, this.camera); }
  activate() { if (this.canvas) this.canvas.style.display = 'block'; }
  deactivate() { if (this.canvas) this.canvas.style.display = 'none'; }
  get count() { return this.bodies.length; }
}
