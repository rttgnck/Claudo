# Claudo

**A particle-life studio in your browser.** Thousands of colored particles, one
absurdly simple rule — *each color attracts or repels every other color by an
amount you choose* — and out of it crawls something that looks unnervingly
alive: cells that grow membranes, swarms that hunt, crystals that lattice,
comets that streak across a toroidal sky.

No installs, no dependencies, no build step. Just open it and start tuning the
laws of a tiny universe.

### ▶ [Launch Claudo](https://rttgnck.github.io/Claudo/)

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
index.html           layout + controls
css/style.css        the whole look
js/simulation.js     spatial-hash physics engine
js/renderer.js       glow-sprite + trail rendering
js/ui.js             the drag-to-edit interaction matrix
js/presets.js        curated universes
js/share.js          pack/unpack a universe into a URL
js/app.js            glue
```

## Credits

Built by [@rttgnck](https://github.com/rttgnck) with [Claude Code](https://claude.com/claude-code).
Inspired by the artificial-life / Particle Life lineage of Jeffrey Ventrella,
Tom Mohr, and CodeParade.

## License

MIT
