// ui.js — the interaction-matrix editor. A K×K grid where cell (row i, col j)
// is "how strongly color i is pulled toward color j". Green = attract, red =
// repel. Drag a cell up/down to tune it live and watch the world reorganize.

import { PALETTE } from './renderer.js';

export class MatrixEditor {
  constructor(container, sim, onChange) {
    this.container = container;
    this.sim = sim;
    this.onChange = onChange || (() => {});
    this._drag = null;
    this._bindGlobal();
    this.build();
  }

  _bindGlobal() {
    const move = (e) => {
      if (!this._drag) return;
      e.preventDefault();
      const y = (e.touches ? e.touches[0].clientY : e.clientY);
      const dy = this._drag.startY - y;
      let v = this._drag.startVal + dy / 80; // 80px of drag = full range
      v = Math.max(-1, Math.min(1, v));
      const { i, j } = this._drag;
      this.sim.matrix[i][j] = v;
      this._paintCell(this._drag.el, v);
      this.onChange();
    };
    const up = () => { this._drag = null; document.body.classList.remove('dragging'); };
    window.addEventListener('mousemove', move, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
  }

  _color(v) {
    // v in [-1,1] -> red (repel) .. dark .. green (attract)
    if (v >= 0) {
      const a = 0.12 + v * 0.78;
      return `rgba(74, 222, 128, ${a})`;
    }
    const a = 0.12 + (-v) * 0.78;
    return `rgba(255, 92, 124, ${a})`;
  }

  _paintCell(el, v) {
    el.style.background = this._color(v);
    el.title = v.toFixed(2);
  }

  build() {
    const k = this.sim.numColors;
    const grid = document.createElement('div');
    grid.className = 'matrix';
    grid.style.setProperty('--k', k);

    // Top-left corner label.
    grid.appendChild(this._corner());
    // Column headers.
    for (let j = 0; j < k; j++) grid.appendChild(this._swatch(j));

    for (let i = 0; i < k; i++) {
      grid.appendChild(this._swatch(i)); // row header
      for (let j = 0; j < k; j++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        this._paintCell(cell, this.sim.matrix[i][j]);
        const startDrag = (e) => {
          const y = (e.touches ? e.touches[0].clientY : e.clientY);
          this._drag = { i, j, el: cell, startY: y, startVal: this.sim.matrix[i][j] };
          document.body.classList.add('dragging');
          e.preventDefault();
        };
        cell.addEventListener('mousedown', startDrag);
        cell.addEventListener('touchstart', startDrag, { passive: false });
        grid.appendChild(cell);
      }
    }

    this.container.innerHTML = '';
    this.container.appendChild(grid);
    this.grid = grid;
  }

  _corner() {
    const c = document.createElement('div');
    c.className = 'mhead corner';
    c.textContent = '↴';
    c.title = 'row color is pulled toward column color';
    return c;
  }

  _swatch(idx) {
    const s = document.createElement('div');
    s.className = 'mhead swatch';
    s.style.background = PALETTE[idx];
    return s;
  }

  refresh() { this.build(); }
}
