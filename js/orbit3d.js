// orbit3d.js — a tiny framework-agnostic orbit camera: drag to rotate,
// wheel / pinch to zoom. It just tracks spherical coordinates; call applyTo()
// with a THREE camera each frame. Shared by every 3D mode across the suite so
// the controls (and the "zoom" gesture) feel identical everywhere.

export class Orbit3D {
  constructor(dom, opts = {}) {
    this.dom = dom;
    this.radius = opts.radius ?? 30;
    this.minR = opts.minRadius ?? 3;
    this.maxR = opts.maxRadius ?? 600;
    this.theta = opts.theta ?? 0.7;      // azimuth
    this.phi = opts.phi ?? 1.05;         // polar from +Y
    this.target = opts.target ?? [0, 0, 0];
    this.autoRotate = opts.autoRotate ?? 0.12; // rad/s when idle
    this._drag = null;
    this._pinchDist = 0;
    this._idle = 0;
    this._bind();
  }

  _bind() {
    const dom = this.dom;
    const down = (e) => {
      if (e.touches && e.touches.length === 2) {
        this._pinchDist = this._dist(e.touches);
        this._drag = null;
        return;
      }
      const p = this._pt(e);
      this._drag = { x: p.x, y: p.y };
      this._idle = -1e9; // stop auto-rotate while interacting
    };
    const move = (e) => {
      if (e.touches && e.touches.length === 2) {
        const d = this._dist(e.touches);
        if (this._pinchDist) this._zoom(this._pinchDist / d);
        this._pinchDist = d;
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (!this._drag) return;
      const p = this._pt(e);
      this.theta -= (p.x - this._drag.x) * 0.006;
      this.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.phi - (p.y - this._drag.y) * 0.006));
      this._drag = { x: p.x, y: p.y };
      if (e.cancelable) e.preventDefault();
    };
    const up = () => { this._drag = null; this._pinchDist = 0; this._idle = 0; };
    dom.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    dom.addEventListener('touchstart', down, { passive: true });
    dom.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
    dom.addEventListener('wheel', (e) => { e.preventDefault(); this._zoom(Math.exp(e.deltaY * 0.001)); this._idle = 0; }, { passive: false });
  }

  _pt(e) { return { x: e.touches ? e.touches[0].clientX : e.clientX, y: e.touches ? e.touches[0].clientY : e.clientY }; }
  _dist(t) { const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.hypot(dx, dy); }
  _zoom(f) { this.radius = Math.max(this.minR, Math.min(this.maxR, this.radius * f)); }

  update(dt) {
    this._idle += dt;
    if (this.autoRotate && this._idle > 1.2 && !this._drag) this.theta += this.autoRotate * dt;
  }

  applyTo(camera) {
    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    camera.position.set(
      this.target[0] + this.radius * sp * Math.cos(this.theta),
      this.target[1] + this.radius * cp,
      this.target[2] + this.radius * sp * Math.sin(this.theta)
    );
    camera.lookAt(this.target[0], this.target[1], this.target[2]);
  }
}

// Lazy-load Three.js from a CDN, once, shared across a session.
let _threePromise = null;
export function loadThree() {
  if (!_threePromise) {
    _threePromise = import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
  }
  return _threePromise;
}
