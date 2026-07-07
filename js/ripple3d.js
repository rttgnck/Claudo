// ripple3d.js — the 3D mode for the Ripple page. The wave field becomes a lit
// height-field surface: each grid cell drives a vertex's height, so the ripples,
// interference and diffraction you'd see from above become a real undulating
// surface you can orbit around. Walls stand up as dark ridges.
import { Orbit3D, loadThree } from './orbit3d.js';

export class Ripple3D {
  constructor() { this.ready = false; }

  async init(gw, gh) {
    const THREE = this.THREE = await loadThree();
    const canvas = this.canvas = document.createElement('canvas');
    canvas.className = 'three-canvas';
    document.body.appendChild(canvas);
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07070c);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
    this.controls = new Orbit3D(canvas, { radius: 150, minRadius: 30, maxRadius: 500, phi: 0.9, autoRotate: 0.05 });

    // Lighting for the surface sheen.
    this.scene.add(new THREE.HemisphereLight(0x8899ff, 0x080810, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(60, 120, 40);
    this.scene.add(dir);

    // Mesh grid (down-sampled from the sim grid for a steady frame rate).
    this.nx = Math.min(gw, 200);
    this.nz = Math.min(gh, 150);
    const sizeX = 120, sizeZ = 120 * (gh / gw);
    this.sizeX = sizeX; this.sizeZ = sizeZ;
    const nx = this.nx, nz = this.nz;
    const verts = nx * nz;
    const pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = (j * nx + i) * 3;
        pos[k] = (i / (nx - 1) - 0.5) * sizeX;
        pos[k + 1] = 0;
        pos[k + 2] = (j / (nz - 1) - 0.5) * sizeZ;
      }
    }
    const idx = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.pos = pos; this.col = col;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide, flatShading: false });
    this.mesh = new THREE.Mesh(g, mat);
    this.scene.add(this.mesh);

    this.lut = null; this.height = 18;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.ready = true;
  }

  resize() {
    if (!this.renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setPaletteLUT(lut) { this.lut = lut; }

  // Sample the live field into vertex heights + colours.
  update(field, gw, gh, wall) {
    if (!this.ready) return;
    const nx = this.nx, nz = this.nz, pos = this.pos, col = this.col, lut = this.lut, H = this.height;
    for (let j = 0; j < nz; j++) {
      const gj = Math.round(j / (nz - 1) * (gh - 1));
      for (let i = 0; i < nx; i++) {
        const gi = Math.round(i / (nx - 1) * (gw - 1));
        const gk = gj * gw + gi;
        const k = (j * nx + i) * 3;
        if (wall && wall[gk]) {
          pos[k + 1] = H * 0.5;
          col[k] = 0.16; col[k + 1] = 0.17; col[k + 2] = 0.2;
          continue;
        }
        const u = field[gk];
        pos[k + 1] = u * H;
        let t = 0.5 + u * 2.2; if (t < 0) t = 0; else if (t > 1) t = 1;
        if (lut) { const li = (t * 255) | 0; col[k] = lut[li * 3] / 255; col[k + 1] = lut[li * 3 + 1] / 255; col[k + 2] = lut[li * 3 + 2] / 255; }
        else { col[k] = col[k + 1] = col[k + 2] = t; }
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  render(dt) {
    if (!this.ready) return;
    this.controls.update(dt);
    this.controls.applyTo(this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  activate() { if (this.canvas) this.canvas.style.display = 'block'; }
  deactivate() { if (this.canvas) this.canvas.style.display = 'none'; }
}
