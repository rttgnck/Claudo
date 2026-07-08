// pulse3d.js — 3D mode for Pulse. The whole track grid becomes a field of bars:
// active steps rise and glow (each row tinted by its track colour), a translucent
// slab sweeps the current beat. Data-driven — it renders whatever rows it's given.
import { Orbit3D, loadThree } from './orbit3d.js';

const GAP = 1.25;

export class Pulse3D {
  constructor() { this.ready = false; this.maxRows = 52; this.maxSteps = 128; }

  async init() {
    const THREE = this.THREE = await loadThree();
    const canvas = this.canvas = document.createElement('canvas');
    canvas.className = 'three-canvas';
    document.body.appendChild(canvas);
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07070c);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
    this.controls = new Orbit3D(canvas, { radius: 46, minRadius: 14, maxRadius: 140, phi: 0.8, theta: -0.9, autoRotate: 0.04, target: [0, 1.5, 0] });
    this.scene.add(new THREE.HemisphereLight(0x99aaff, 0x0a0a12, 0.65));
    const dir = new THREE.DirectionalLight(0xffffff, 0.85); dir.position.set(10, 24, 14); this.scene.add(dir);

    const count = this.maxRows * this.maxSteps;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.25 }), count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.mesh);
    this.dummy = new THREE.Object3D(); this.color = new THREE.Color();

    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(this.maxSteps * GAP + 2, this.maxRows * GAP + 2), new THREE.MeshStandardMaterial({ color: 0x0f111a, roughness: 0.95 }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -0.02; this.scene.add(this.floor);
    this.slab = new THREE.Mesh(new THREE.BoxGeometry(0.85, 6, this.maxRows * GAP + 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false }));
    this.slab.position.y = 3; this.scene.add(this.slab);

    this.resize(); window.addEventListener('resize', () => this.resize());
    this.ready = true;
  }

  update(rows, steps, playCol) {
    if (!this.ready) return;
    const nRows = Math.min(rows.length, this.maxRows), d = this.dummy, c = this.color, m = this.mesh;
    const x0 = -(steps - 1) / 2 * GAP;
    let idx = 0;
    for (let ri = 0; ri < nRows; ri++) {
      const row = rows[ri], z = (ri - (nRows - 1) / 2) * GAP;
      for (let cc = 0; cc < steps; cc++) {
        const v = row.cells[cc] || 0, active = v > 0;
        const h = active ? 0.4 + v * 2.8 : 0.22;
        d.position.set(x0 + cc * GAP, h / 2, z); d.scale.set(0.92, h, 0.92); d.updateMatrix();
        m.setMatrixAt(idx, d.matrix);
        if (active) c.setRGB(row.color[0], row.color[1], row.color[2]); else c.setRGB(0.1, 0.11, 0.15);
        if (cc === playCol) c.offsetHSL(0, 0, 0.22);
        m.setColorAt(idx, c);
        idx++;
      }
    }
    // hide the rest
    d.scale.set(0, 0, 0); d.updateMatrix();
    for (; idx < this.maxRows * this.maxSteps; idx++) m.setMatrixAt(idx, d.matrix);
    m.count = this.maxRows * this.maxSteps;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;

    if (playCol >= 0) { this.slab.visible = true; this.slab.position.x = x0 + playCol * GAP; }
    else this.slab.visible = false;
    // fit camera target to grid height
    this.controls.target[2] = 0;
  }

  resize() { if (!this.renderer) return; const w = window.innerWidth, h = window.innerHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  render(dt) { if (!this.ready) return; this.controls.update(dt); this.controls.applyTo(this.camera); this.renderer.render(this.scene, this.camera); }
  activate() { if (this.canvas) this.canvas.style.display = 'block'; }
  deactivate() { if (this.canvas) this.canvas.style.display = 'none'; }
}
