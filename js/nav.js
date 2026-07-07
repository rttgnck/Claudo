// nav.js — turns the "Claudo" brand into a dropdown that switches between the
// three experiences. Injected into the #logo element so every page shares one
// consistent menu.

const PAGES = [
  { href: 'index.html',     key: 'life',      name: 'Particle Life', desc: 'Emergent life from a rule matrix', dots: ['#ff5c7c', '#38bdf8', '#4ade80'] },
  { href: 'attractor.html', key: 'attractor', name: 'Attractors',    desc: 'Chaos plotted into strange beauty', dots: ['#ffd166', '#fb923c', '#f472b6'] },
  { href: 'reaction.html',  key: 'reaction',  name: 'Reaction',      desc: 'Living Turing patterns you paint',  dots: ['#2dd4bf', '#a78bfa', '#38bdf8'] },
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
  menu.innerHTML = `<div class="nav-menu-head">Explore</div>` + PAGES.map((p) => `
    <a class="nav-item${p.key === currentKey ? ' current' : ''}" href="${p.href}">
      <span class="nav-dots">${p.dots.map((c) => `<i style="background:${c};color:${c}"></i>`).join('')}</span>
      <span class="nav-text"><b>${p.name}</b><small>${p.desc}</small></span>
      ${p.key === currentKey ? '<span class="nav-here">●</span>' : ''}
    </a>`).join('');
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
