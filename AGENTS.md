# AGENTS.md

Web-based logic puzzle game (pipes/Net variant), SvelteKit + Svelte 5 (repo is mid Svelte 3 → 5
migration, runes are used in `.svelte.js` files). Prettier with tabs, JSDoc types everywhere,
vitest for tests (`npm run test`, excludes dailies). The `layers` branch hosts an experimental
puzzle variant developed across several sessions — detailed docs live in `agent-doc/`.

## The "layers" variant

Classic rules: every cell has one pipe piece (bitmask of open edges), rotate all pieces to form
a single spanning tree, no loops, everything connected.

Layers variant: each grid cell holds up to `num_directions` **independent layers** (sub-cells):

- Layers within a cell never connect to each other.
- At most one layer of a cell may use any given direction ("1 exit per cell+direction").
- Rotating a cell rotates **all its layers simultaneously** by the same amount. Layer
  direction-sets start disjoint and uniform shifts preserve disjointness, so this holds at all
  times (edge marks per cell-edge stay unambiguous, two layers can never point the same way).
- A cell can be "revisited" by the generator: that adds a new layer instead of a loop.
- Solved condition: **one tree over all sub-cells** — every layer of every playable cell
  mutually connected, no loops, no open ends.

## Encodings

- `LayeredTiles` = `Number[][]`: per cell, a list of layer bitmasks; `[]` for empty cells.
  Direction bits per grid (square: E=1 N=2 W=4 S=8), same as classic tiles.
- Sub-cell id = `cell + layer * grid.total`. Decode: `cell = id % total`,
  `layer = Math.floor(id / total)`. Plain-number keys so classic Map/Set algorithms port over.
- `validateLayers` applies to **solved** boards only — scrambled boards intentionally break
  mutual edge matching (that is the puzzle).

## Detailed docs (`agent-doc/`)

- [layers-game.md](agent-doc/layers-game.md) — `LayeredPipesGame` + `LayeredTile.svelte` +
  `Puzzle.svelte` wiring: state model, rendering, user input, solved checking; differences vs
  classic `PipesGame`.
- [layers-solver.md](agent-doc/layers-solver.md) — `LayeredSolver` (`solver-layers-alt.js`):
  rotation state classes, sub-cell tree constraint via slot components, deadend facts,
  propagation, search, `markAmbiguousTiles`; differences vs classic `Solver`.
- [layers-generator.md](agent-doc/layers-generator.md) — `pregenerate_layers`, startLayers
  reuse via `planReuse`, `LayeredGenerator` uniqueness loop, worker + `/generator-debug`
  tooling, convergence research; differences vs classic generator.

Layered test suite:
`npx vitest run src/lib/puzzle/generator-layers.test.js src/lib/puzzle/game-layers.svelte.test.js src/lib/puzzle/solver-layers-alt.test.js`

## Known quirks

- Repo-wide `npm run check` reports ~42 pre-existing svelte-check errors from the migration;
  only worry about new ones in touched files. `npm run lint` has 2 pre-existing warnings
  (`src/app.html`, `src/routes/app.css`).
