// nav.js — turns the "Claudo" brand into a dropdown that switches between the
// three experiences. Injected into the #logo element so every page shares one
// consistent menu.

const PAGES = [
  { href: 'index.html',     key: 'life',      group: 'Generative',  name: 'Particle Life', desc: 'Emergent life from a rule matrix', dots: ['#ff5c7c', '#38bdf8', '#4ade80'] },
  { href: 'attractor.html', key: 'attractor', group: 'Generative',  name: 'Attractors',    desc: 'Chaos plotted into strange beauty', dots: ['#ffd166', '#fb923c', '#f472b6'] },
  { href: 'reaction.html',  key: 'reaction',  group: 'Generative',  name: 'Reaction',      desc: 'Living Turing patterns you paint',  dots: ['#2dd4bf', '#a78bfa', '#38bdf8'] },
  { href: 'pulse.html',     key: 'pulse',     group: 'Interactive', name: 'Pulse',         desc: 'A step sequencer you can play',      dots: ['#f472b6', '#38bdf8', '#ffd166'] },
  { href: 'pivot.html',     key: 'pivot',     group: 'Interactive', name: 'Pivot',         desc: 'A one-tap reflex arcade',           dots: ['#4ade80', '#ff5c7c', '#a78bfa'] },
  { href: 'fusion.html',    key: 'fusion',    group: 'Science',     name: 'Fusion',        desc: 'Ignite a tokamak plasma',           dots: ['#ff6b5c', '#ff9a5c', '#ffd166'] },
  { href: 'orbits.html',    key: 'orbits',    group: 'Science',     name: 'Orbits',        desc: 'An N-body gravity sandbox',         dots: ['#ffd166', '#4ade80', '#38bdf8'] },
  { href: 'ripple.html',    key: 'ripple',    group: 'Science',     name: 'Ripple',        desc: 'A 2-D wave interference tank',      dots: ['#38bdf8', '#2dd4bf', '#7dd3fc'] },
];

export function initNav(currentKey) {
  const logo = document.getElementById('logo');
  if (!logo) return;
  logo.classList.add('nav-trigger');
  logo.setAttribute('role', 'button');
  logo.setAttribute('tabindex', '0');

  const caret = document.createElement('span');
  caret.className = 'nav-caret';
  caret.textContent = '▾';
  logo.appendChild(caret);

  const menu = document.createElement('div');
  menu.className = 'nav-menu';
  let html = '';
  let lastGroup = null;
  for (const p of PAGES) {
    if (p.group !== lastGroup) { html += `<div class="nav-menu-head">${p.group}</div>`; lastGroup = p.group; }
    html += `
    <a class="nav-item${p.key === currentKey ? ' current' : ''}" href="${p.href}">
      <span class="nav-dots">${p.dots.map((c) => `<i style="background:${c};color:${c}"></i>`).join('')}</span>
      <span class="nav-text"><b>${p.name}</b><small>${p.desc}</small></span>
      ${p.key === currentKey ? '<span class="nav-here">●</span>' : ''}
    </a>`;
  }
  menu.innerHTML = html;
  document.body.appendChild(menu);

  const place = () => {
    const r = logo.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.top = r.bottom + 8 + 'px';
  };
  const open = () => { place(); menu.classList.add('show'); logo.classList.add('open'); };
  const close = () => { menu.classList.remove('show'); logo.classList.remove('open'); };
  const toggle = (e) => { e.stopPropagation(); menu.classList.contains('show') ? close() : open(); };

  logo.addEventListener('click', toggle);
  logo.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
  window.addEventListener('resize', () => { if (menu.classList.contains('show')) place(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
