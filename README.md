# Claudo

**A little suite of generative playgrounds** where dead-simple rules bloom into
startling complexity. No installs, no dependencies, no build step — three
full-screen toys, each shareable by URL. Switch between them from the **Claudo ▾**
menu in the corner.

### ▶ [Launch Claudo](https://rttgnck.github.io/Claudo/)

---

## The three experiences

### 🔴🔵🟢 Particle Life — *emergent life from a rule matrix*
Thousands of colored particles, one absurdly simple rule — *each color attracts
or repels every other color by an amount you choose* — and out of it crawls
something that looks unnervingly alive: cells that grow membranes, swarms that
hunt, crystals that lattice, comets that streak across a toroidal sky.

### 🟡🟠🟣 Attractors — *chaos plotted into strange beauty*
Iterate a chaotic equation millions of times and accumulate where it lands. The
picture "develops" like a long-exposure photograph into infinitely intricate
strange attractors (Clifford, De Jong, Svensson). Nudge four numbers and the
entire structure reshapes.

### 🟢🟣🔵 Reaction — *living Turing patterns you can paint*
A Gray-Scott reaction-diffusion sandbox: two virtual chemicals diffuse and react,
self-organizing into coral, spots, mazes, and dividing cells — the same math that
paints seashells and animal coats. Drag on the canvas to inject chemical and
watch it spread.

### 🩷🔵🟡 Pulse — *a browser groovebox*
A full Web Audio music tool. An **8-voice synthesized drum kit** plus **Bass and
Lead subtractive synths** (waveform, filter, ADSR, glide), a **per-track mixer**
(mute/solo/volume/pan), and scale-locked note grids across 11 scales so anything
you tap stays in key. **Master FX** — drive, filter, reverb, tempo-synced delay.
An **8-slot pattern bank**, genre presets, tap tempo, swing, 16/32 steps, a
metronome, and an output scope. **Export your loop to WAV**, share it by URL,
save/load projects, and play the lead live with your computer keyboard.

### 🟢🩷🟣 Pivot — *a one-tap reflex arcade*
A game. You orbit a sun on a ring; **tap, click, or press space** to reverse
direction. Weave through spinning blades, sweep up glowing orbs, and stack your
combo. Screen shake, particles, sound, and a local high score. One input, endless
panic.

### 🔴🟠🟡 Fusion — *ignite a tokamak plasma*
A physically real 0-D tokamak burn simulator — not a mock-up. It integrates the
plasma power balance with **Bosch–Hale D-T reactivity**, alpha self-heating,
bremsstrahlung and transport losses, plus a Troyon-style β limit. Tune density,
heating, confinement and field until the alpha heating overtakes the losses and
the burn runs away to ignition — then cut the external heating and watch it stay
lit (Q → ∞). Live temperature, fusion power, gain, and the Lawson triple product.

### 🟡🟢🔵 Orbits — *an N-body gravity sandbox*
A real gravity simulator using velocity-Verlet integration and merging
collisions. **Drag on empty space** to fling a new body; everything attracts
everything. Build solar systems, cause three-body chaos, or run the famous
figure-8 choreography.

### 🔵🟦🟣 Ripple — *a 2-D wave interference tank*
A finite-difference wave-equation solver with an absorbing border, so the
interference and diffraction you see are genuine physics. Drop ripples, place
oscillating sources, paint reflecting walls — and load the **double-slit** preset
to watch the fringes form.

The generative pages let you **randomize**, load **presets**, **share** the exact
state via a compact URL, and **save a PNG**.

### Every page: zoom + a 3D mode
- **Zoom** — scroll (or pinch) to zoom, anywhere.
- **3D** — hit the **⬗ 3D** button to flip into three dimensions (drag to orbit,
  scroll to zoom). Attractors become Lorenz/Aizawa/Thomas point clouds; Ripple &
  Reaction become lit relief surfaces; Particle Life & Orbits run true 3D physics;
  Fusion becomes a glowing torus; Pulse becomes a field of riser bars. Powered by
  [Three.js](https://threejs.org) (loaded on demand, only when you enter 3D).

---

## What you can do

- **Tune the universe live.** Drag any cell in the interaction matrix — green
  means "this color chases that one," red means "flee." Watch the world
  reorganize in real time.
- **Roll a new cosmos.** Hit *Randomize* for a fresh, never-before-seen set of
  rules. Most are chaos; some are gorgeous. That's the fun.
- **Load curated presets** — Genesis, Cells, Chase, Crystals, Nebula, Duel,
  Symbiosis — each a hand-picked universe with its own emergent personality.
- **Stir it with your cursor.** Click and drag on the canvas to attract or repel
  particles (toggle the mode).
- **Share what you discover.** *Share* packs the entire universe — matrix and all
  — into a short link. Send it to a friend and they see the exact same physics.
- **Save a snapshot** as a PNG for your wallpaper / feed.

## How it works

Every particle has a color. For each pair within an interaction radius, a force
is computed: a hard universal repulsion at very short range (so nothing collapses
to a point), then, further out, an attraction or repulsion set by a `K×K` matrix.
Integrate over a few thousand particles each frame and emergent structure falls
out for free — no rules about "cells" or "creatures" are ever written down; they
simply *happen*.

The space is a **torus** (edges wrap, so there are no walls to pile up against),
and neighbor lookups run through a **uniform spatial-hash grid**, keeping the
whole thing `O(N)` and smooth at 60fps.

It's a pop-friendly cousin of Clusters / Particle Life, built from scratch in
vanilla JavaScript and the 2D canvas.

## Run locally

It's fully static — any static server works:

```bash
python3 -m http.server 4177
# open http://localhost:4177
```

## Structure

```
index.html           Particle Life page      pulse.html      Pulse page
attractor.html       Attractors page         pivot.html      Pivot page
reaction.html        Reaction page           css/style.css   the shared look

js/nav.js            the brand-as-dropdown navigation
js/app.js            Particle Life glue
js/simulation.js     spatial-hash physics engine
js/renderer.js       glow-sprite + trail rendering
js/ui.js             the drag-to-edit interaction matrix
js/presets.js        curated universes
js/share.js          pack/unpack a universe into a URL
js/attractor.js      strange-attractor accumulator + rendering
js/reaction.js       Gray-Scott reaction-diffusion engine
js/pulse.js          groovebox app (UI, transport, patterns, share, export)
js/pulse-audio.js    audio engine: synthesis, FX graph, scheduler, WAV bounce
js/pulse-defs.js     track roster + scales
js/pivot.js          the Pivot arcade game
js/fusion.js         0-D tokamak burn model (Bosch–Hale reactivity)
js/orbits.js         N-body gravity (velocity-Verlet)
js/ripple.js         2-D wave-equation solver
```

Pages: `index.html`, `attractor.html`, `reaction.html`, `pulse.html`,
`pivot.html`, `fusion.html`, `orbits.html`, `ripple.html`.

## Credits

Built by [@rttgnck](https://github.com/rttgnck) with [Claude Code](https://claude.com/claude-code).
Inspired by the artificial-life / Particle Life lineage of Jeffrey Ventrella,
Tom Mohr, and CodeParade.

## License

MIT
