// fusion3d.js — 3D mode for Fusion: the tokamak as a glowing torus. The plasma
// torus takes its colour and brightness from the live temperature, a white-hot
// core appears as it heats, and fusion events spark and *fade* around the ring at
// a rate set by the fusion power (a shader point-system so the sparks decay
// instead of piling up). A wireframe vessel, field coils and central solenoid
// frame it.
import { Orbit3D, loadThree } from './orbit3d.js';

const R = 34, TUBE = 11;

function plasmaColor(T) {
  const t = Math.min(T / 30, 1);
  let r, g, b;
  if (t < 0.5) { const u = t / 0.5; r = (150 + 105 * u) / 255; g = (30 + 110 * u) / 255; b = (30 + 20 * u) / 255; }
  else { const u = (t - 0.5) / 0.5; r = 1; g = (140 + 115 * u) / 255; b = (50 + 205 * u) / 255; }
  return [r, g, b];
}
function torusPt(u, v, rr) {
  const x = (R + rr * Math.cos(v)) * Math.cos(u);
  const z = (R + rr * Math.cos(v)) * Math.sin(u);
  const y = rr * Math.sin(v);
  return [x, y, z];
}

export class Fusion3D {
  constructor() { this.ready = false; this.maxFlash = 1400; this.flashAcc = 0; this.flashHead = 0; }

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
    this.controls = new Orbit3D(canvas, { radius: 130, minRadius: 45, maxRadius: 380, phi: 1.05, autoRotate: 0.14 });

    // Plasma torus — additive so it reads as glowing gas.
    const geo = new THREE.TorusGeometry(R, TUBE, 26, 100); geo.rotateX(Math.PI / 2);
    this.plasmaMat = new THREE.MeshBasicMaterial({ color: 0x803828, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
    this.plasma = new THREE.Mesh(geo, this.plasmaMat); this.scene.add(this.plasma);

    // White-hot core torus (revealed as it heats).
    const cgeo = new THREE.TorusGeometry(R, TUBE * 0.45, 20, 100); cgeo.rotateX(Math.PI / 2);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.core = new THREE.Mesh(cgeo, this.coreMat); this.scene.add(this.core);

    // Vessel wireframe + field coils + solenoid (dim, so the plasma dominates).
    const vgeo = new THREE.TorusGeometry(R, TUBE * 1.4, 10, 54); vgeo.rotateX(Math.PI / 2);
    this.scene.add(new THREE.LineSegments(new THREE.WireframeGeometry(vgeo), new THREE.LineBasicMaterial({ color: 0x222a44, transparent: true, opacity: 0.35 })));
    const coilMat = new THREE.MeshBasicMaterial({ color: 0x3a4568, transparent: true, opacity: 0.28 });
    for (let i = 0; i < 16; i++) {
      const u = (i / 16) * Math.PI * 2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(TUBE * 1.5, 0.45, 8, 36), coilMat);
      const [x, , z] = torusPt(u, 0, 0);
      ring.position.set(x, 0, z); ring.lookAt(0, 0, 0);
      this.scene.add(ring);
    }
    this.scene.add(new THREE.Mesh(new THREE.CylinderGeometry(3, 3, TUBE * 3.2, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x2c3452, transparent: true, opacity: 0.3, side: THREE.DoubleSide })));

    // Fusion sparks — fading point system via a small shader.
    const fg = this.flashGeo = new THREE.BufferGeometry();
    this.flashPos = new Float32Array(this.maxFlash * 3);
    this.flashLife = new Float32Array(this.maxFlash);
    fg.setAttribute('position', new THREE.BufferAttribute(this.flashPos, 3).setUsage(THREE.DynamicDrawUsage));
    fg.setAttribute('alife', new THREE.BufferAttribute(this.flashLife, 1).setUsage(THREE.DynamicDrawUsage));
    const fmat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0xfff0b4) } },
      vertexShader: `attribute float alife; varying float vLife; void main(){ vLife=alife; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=(alife*5.0+2.0)*(220.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying float vLife; uniform vec3 uColor; void main(){ if(vLife<=0.0) discard; vec2 d=gl_PointCoord-vec2(0.5); float r=length(d); if(r>0.5) discard; float a=smoothstep(0.5,0.0,r)*vLife; gl_FragColor=vec4(uColor,a); }`,
    });
    this.scene.add(new THREE.Points(fg, fmat));

    this.resize(); window.addEventListener('resize', () => this.resize());
    this.ready = true;
  }

  update(T, Pfus, dt) {
    if (!this.ready) return;
    const [r, g, b] = plasmaColor(T);
    this.plasmaMat.color.setRGB(r, g, b);
    this.plasmaMat.opacity = 0.45 + Math.min(T / 25, 1) * 0.4;
    this.coreMat.opacity = Math.max(0, Math.min((T - 5) / 22, 1)) * 0.85;

    // Decay every spark.
    const life = this.flashLife;
    const dec = dt * 1.6;
    for (let i = 0; i < this.maxFlash; i++) if (life[i] > 0) life[i] -= dec;

    // Spawn new sparks proportional to fusion power.
    const perSec = Math.min(Math.pow(Math.max(0, Pfus) / 1e6, 0.5) * 5, 350);
    this.flashAcc += perSec * dt;
    while (this.flashAcc >= 1) {
      this.flashAcc -= 1;
      const u = Math.random() * Math.PI * 2, v = Math.random() * Math.PI * 2, rr = Math.random() * TUBE * 0.85;
      const [x, y, z] = torusPt(u, v, rr);
      const h = this.flashHead;
      this.flashPos[h * 3] = x; this.flashPos[h * 3 + 1] = y; this.flashPos[h * 3 + 2] = z;
      life[h] = 1;
      this.flashHead = (this.flashHead + 1) % this.maxFlash;
    }
    this.flashGeo.setDrawRange(0, this.maxFlash);
    this.flashGeo.attributes.position.needsUpdate = true;
    this.flashGeo.attributes.alife.needsUpdate = true;
  }

  resize() { if (!this.renderer) return; const w = window.innerWidth, h = window.innerHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  render(dt) { if (!this.ready) return; this.controls.update(dt); this.controls.applyTo(this.camera); this.renderer.render(this.scene, this.camera); }
  activate() { if (this.canvas) this.canvas.style.display = 'block'; }
  deactivate() { if (this.canvas) this.canvas.style.display = 'none'; }
}
