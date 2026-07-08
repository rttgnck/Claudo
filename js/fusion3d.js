// fusion3d.js — 3D mode for Fusion: the tokamak as an actual torus. A glowing
// plasma torus takes its colour and brightness from the live temperature, a
// bright core torus appears as it heats, a wireframe vessel and toroidal-field
// coils surround it, and fusion flashes spark around the ring at a rate set by
// the fusion power.
import { Orbit3D, loadThree } from './orbit3d.js';

const R = 34, TUBE = 11;

function plasmaColor(T) {
  const t = Math.min(T / 30, 1);
  let r, g, b;
  if (t < 0.5) { const u = t / 0.5; r = (120 + 135 * u) / 255; g = (20 + 120 * u) / 255; b = (20 + 30 * u) / 255; }
  else { const u = (t - 0.5) / 0.5; r = 1; g = (140 + 115 * u) / 255; b = (50 + 205 * u) / 255; }
  return [r, g, b];
}
// Point on/near the torus surface (hole axis = Y).
function torusPt(u, v, rr) {
  const x = (R + rr * Math.cos(v)) * Math.cos(u);
  const z = (R + rr * Math.cos(v)) * Math.sin(u);
  const y = rr * Math.sin(v);
  return [x, y, z];
}

export class Fusion3D {
  constructor() { this.ready = false; this.maxFlash = 1500; this.flashAcc = 0; }

  async init() {
    const THREE = this.THREE = await loadThree();
    const canvas = this.canvas = document.createElement('canvas');
    canvas.className = 'three-canvas';
    document.body.appendChild(canvas);
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07070c);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.5, 4000);
    this.controls = new Orbit3D(canvas, { radius: 130, minRadius: 40, maxRadius: 400, phi: 1.05, autoRotate: 0.12 });
    this.scene.add(new THREE.HemisphereLight(0x8899cc, 0x0a0a12, 0.4));

    // Plasma torus (glows by temperature).
    const geo = new THREE.TorusGeometry(R, TUBE, 24, 90); geo.rotateX(Math.PI / 2);
    this.plasmaMat = new THREE.MeshBasicMaterial({ color: 0x502020, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    this.plasma = new THREE.Mesh(geo, this.plasmaMat); this.scene.add(this.plasma);

    // Bright core torus (revealed as it heats).
    const cgeo = new THREE.TorusGeometry(R, TUBE * 0.4, 18, 90); cgeo.rotateX(Math.PI / 2);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.core = new THREE.Mesh(cgeo, this.coreMat); this.scene.add(this.core);

    // Vessel wireframe.
    const vgeo = new THREE.TorusGeometry(R, TUBE * 1.35, 12, 60); vgeo.rotateX(Math.PI / 2);
    this.scene.add(new THREE.LineSegments(new THREE.WireframeGeometry(vgeo), new THREE.LineBasicMaterial({ color: 0x2b3350, transparent: true, opacity: 0.5 })));

    // Toroidal field coils (rings around the tube).
    const coilMat = new THREE.MeshBasicMaterial({ color: 0x5566aa, transparent: true, opacity: 0.35 });
    for (let i = 0; i < 16; i++) {
      const u = (i / 16) * Math.PI * 2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(TUBE * 1.5, 0.5, 8, 40), coilMat);
      const [x, , z] = torusPt(u, 0, 0);
      ring.position.set(x, 0, z);
      ring.lookAt(0, 0, 0);
      this.scene.add(ring);
    }
    // Central solenoid.
    this.scene.add(new THREE.Mesh(new THREE.CylinderGeometry(3, 3, TUBE * 3.4, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x3a4266, transparent: true, opacity: 0.4, side: THREE.DoubleSide })));

    // Fusion flashes.
    const fg = this.flashGeo = new THREE.BufferGeometry();
    this.flashPos = new Float32Array(this.maxFlash * 3);
    this.flashAlpha = new Float32Array(this.maxFlash);
    fg.setAttribute('position', new THREE.BufferAttribute(this.flashPos, 3).setUsage(THREE.DynamicDrawUsage));
    fg.setDrawRange(0, 0);
    this.flash = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xfff0b4, size: 2.2, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.flash);
    this.flashHead = 0;

    this.resize(); window.addEventListener('resize', () => this.resize());
    this.ready = true;
  }

  update(T, Pfus, dt) {
    if (!this.ready) return;
    const [r, g, b] = plasmaColor(T);
    this.plasmaMat.color.setRGB(r, g, b);
    this.plasmaMat.opacity = 0.35 + Math.min(T / 25, 1) * 0.4;
    this.coreMat.opacity = Math.max(0, Math.min((T - 6) / 22, 1)) * 0.8;
    const [cr, cg, cb] = plasmaColor(T * 1.4);
    this.coreMat.color.setRGB(cr, cg, cb);

    // Spawn flashes by fusion power.
    const perSec = Math.min(Math.pow(Math.max(0, Pfus) / 1e6, 0.5) * 4, 300);
    this.flashAcc += perSec * dt;
    while (this.flashAcc >= 1) {
      this.flashAcc -= 1;
      const u = Math.random() * Math.PI * 2, v = Math.random() * Math.PI * 2, rr = Math.random() * TUBE * 0.8;
      const [x, y, z] = torusPt(u, v, rr);
      const h = this.flashHead;
      this.flashPos[h * 3] = x; this.flashPos[h * 3 + 1] = y; this.flashPos[h * 3 + 2] = z;
      this.flashHead = (this.flashHead + 1) % this.maxFlash;
    }
    this.flashGeo.setDrawRange(0, this.maxFlash);
    this.flashGeo.attributes.position.needsUpdate = true;
  }

  resize() { if (!this.renderer) return; const w = window.innerWidth, h = window.innerHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  render(dt) { if (!this.ready) return; this.controls.update(dt); this.controls.applyTo(this.camera); this.renderer.render(this.scene, this.camera); }
  activate() { if (this.canvas) this.canvas.style.display = 'block'; }
  deactivate() { if (this.canvas) this.canvas.style.display = 'none'; }
}
