// pulse3d.js — 3D mode for Pulse. The step grid becomes a field of bars: active
// steps rise and glow (melody rows tinted by pitch, drum rows by voice), a
// translucent slab sweeps the current beat. Orbit the camera around your loop.
import { Orbit3D, loadThree } from './orbit3d.js';

const STEPS = 16, ROWS = 12;         // 8 melody (top) + 4 drums
const GAP = 1.35;
const DRUM_COLS = [[1, 0.36, 0.49], [1, 0.82, 0.4], [0.22, 0.74, 0.97], [0.66, 0.55, 0.98]];

export class Pulse3D {
  constructor() { this.ready = false; }

  async init() {
    const THREE = this.THREE = await loadThree();
    const canvas = this.canvas = document.createElement('canvas');
    canvas.className = 'three-canvas';
    document.body.appendChild(canvas);
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07070c);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    this.controls = new Orbit3D(canvas, { radius: 34, minRadius: 12, maxRadius: 90, phi: 0.85, theta: -0.9, autoRotate: 0.05, target: [0, 1, 0] });
    this.scene.add(new THREE.HemisphereLight(0x99aaff, 0x0a0a12, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.85); dir.position.set(8, 20, 12); this.scene.add(dir);

    const count = STEPS * ROWS;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.25 });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.mesh);
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();

    // Floor.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(STEPS * GAP + 2, ROWS * GAP + 2), new THREE.MeshStandardMaterial({ color: 0x11131c, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; this.scene.add(floor);

    // Beat sweep slab.
    this.slab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6, ROWS * GAP + 1.5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false }));
    this.slab.position.y = 3; this.scene.add(this.slab);

    this.resize(); window.addEventListener('resize', () => this.resize());
    this.ready = true;
  }

  _melodyColor(p, out) {
    // teal -> violet across the 8 pitches
    const t = p / 7;
    out.setRGB(0.18 + t * 0.5, 0.78 - t * 0.35, 0.85);
  }

  update(drums, melody, playCol) {
    if (!this.ready) return;
    const d = this.dummy, c = this.color, m = this.mesh;
    let idx = 0;
    for (let ri = 0; ri < ROWS; ri++) {
      const x0 = -(STEPS - 1) / 2 * GAP, z = (ri - (ROWS - 1) / 2) * GAP;
      for (let cc = 0; cc < STEPS; cc++) {
        let active = false;
        if (ri < 8) { const p = 7 - ri; active = melody[cc] === p; if (active) this._melodyColor(p, c); }
        else { const r = ri - 8; active = !!drums[r][cc]; if (active) { const col = DRUM_COLS[r]; c.setRGB(col[0], col[1], col[2]); } }
        const h = active ? 3.0 : 0.28;
        d.position.set(x0 + cc * GAP, h / 2, z);
        d.scale.set(1, h, 1);
        d.updateMatrix();
        m.setMatrixAt(idx, d.matrix);
        if (!active) c.setRGB(0.11, 0.12, 0.16);
        if (cc === playCol) c.offsetHSL(0, 0, 0.22);   // brighten the playing column
        m.setColorAt(idx, c);
        idx++;
      }
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (playCol >= 0) { this.slab.visible = true; this.slab.position.x = -(STEPS - 1) / 2 * GAP + playCol * GAP; }
    else this.slab.visible = false;
  }

  resize() { if (!this.renderer) return; const w = window.innerWidth, h = window.innerHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  render(dt) { if (!this.ready) return; this.controls.update(dt); this.controls.applyTo(this.camera); this.renderer.render(this.scene, this.camera); }
  activate() { if (this.canvas) this.canvas.style.display = 'block'; }
  deactivate() { if (this.canvas) this.canvas.style.display = 'none'; }
}
