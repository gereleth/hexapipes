# Layers variant: game state & UI (`LayeredPipesGame`)

Files: `src/lib/puzzle/game-layers.svelte.js` (state/logic), `src/lib/puzzle/LayeredTile.svelte`
(rendering), branching + solver wiring in `Puzzle.svelte`, input in shared `controls.js`. Classic
counterparts: `game.svelte.js` (`PipesGame`) + `Tile.svelte`. Tests:
`game-layers.svelte.test.js` (components, merge/split, loops, progress, scramble→solve e2e,
solver wiring).

`Puzzle.svelte` instantiates `LayeredPipesGame` when `tiles[0]` is not an integer (layered tiles
are `Number[][]`, classic tiles are `Number[]`).

Boards are assumed to have a single connected playable region — grids with disconnected areas
are not supported.

## Data model

- `LayeredTileState` per cell: static `layers: Number[]` (bitmasks, never mutated); reactive
  `rotations`, `locked`, `edgeMarks`; arrays on each tile, **one entry per layer**:
  `colors`, `hasDisconnects`, `isPartOfLoop`, `isPartOfIsland`; `tile` getter = OR of all layer
  masks (only used by orient-mode controls and assistant rotation, see below).
- Everything is keyed by **sub-cell id** = `cell + layer * grid.total` (`idOf`/`cellOf`/
  `layerOf`). Plain-number keys so classic Map/Set algorithms port over unchanged.
- `connections: Map<subCellId, Set<subCellId>>` stores **mutual edges only**. This is the
  structural deviation from classic, which stores one-sided pointing links and re-checks
  mutuality wherever it matters.
- Non-mutual-ness is derived on demand via `findBackLayer(cell, direction)`: scans the
  neighbour's layers for one pointing in the opposite direction. Resolution is stable during a
  rotation because the neighbour's rotation never changes while I rotate.
- **Gotcha: never reintroduce one-sided links, and never test mutuality in "does the neighbour
  point at me?" queries — the query must be one-sided via `findBackLayer`.** This bit
  `rotateToMatchMarks` once: a locked neighbour's extended connection is precisely a link the
  rotating cell does not (yet) point back at, so a mutual check misclassified it as a wall.

### Differences vs classic `PipesGame` at a glance

| Aspect             | classic                | layered                                   |
| ------------------ | ---------------------- | ----------------------------------------- |
| tile shape         | one bitmask `tile`     | `layers: Number[]`, `tile` = union getter |
| identity           | cell index             | sub-cell id `cell + layer * total`        |
| connections        | one-sided links        | mutual-only + `findBackLayer`             |
| color/status flags | one per tile           | array per tile, one entry per layer       |
| saved progress     | `color`                | `colors` array                            |
| isSolved stubs     | BFS mutuality re-check | `openEnds` covers both stub types         |

## Rotation & connection updates

- `rotateTile(cell, times)`: rotates **all layers at once** (one `rotations` counter per cell);
  computes per-layer `dirIn`/`dirOut` (`{layer, direction}` pairs) and hands them to
  `handleConnections`. No-ops when solved, locked, or empty cell.
- `handleConnections`: dirOut removes stored edges (non-mutual links were never stored, nothing
  to remove); dirIn adds an edge only when the neighbour has a back-layer, else marks a
  disconnect; finally recomputes disconnect state of all layers of the rotated cell and updates
  `solved` when initialized.
- Pointing off-board or at a non-mutual neighbour ⇒ `hasDisconnects` for that layer and the id
  joins `openEnds` (game-level set + `component.openEnds`).
- `setTileOrientation(cell, rotation, animate)`: rotates to an **absolute rotation relative to
  the base layers** (the solver's frame), independent of accumulated player rotations; modular
  delta, `animate` spins a full turn when already at target (classic parity). This is what the
  solver wiring uses (Puzzle.svelte applies solution steps as absolute rotations).
  **FIXME: this diverges from classic**, whose `setTileOrientation` targets a rotated _mask_
  searched for from the tile's current state (and throws if unreachable). The layered version
  had to take a rotation count because a target union mask cannot disambiguate a cell rotation
  (different rotations can share the same union, e.g. layers `[5, 10]`). Switching between
  solutions in layered puzzles (the "Solution k" buttons in Puzzle.svelte, replaying per-cell
  absolute rotations) is currently buggy and this semantic divergence is the suspected cause —
  investigate and fix there rather than by reintroducing mask-based targeting.

## Components, loops, islands

- `mergeComponents` (on connect) / `disconnectComponents` (on break) mirror classic, but at
  sub-cell granularity: one cell can host layers in different components.
- Merging a component into itself = loop → `detectLoops` marks `isPartOfLoop` per layer
  (dead-end pruning + loop path tracing, ported from classic; mutual-only storage means classic's
  extra mutuality filtering inside it is unnecessary).
- A component with no open ends that isn't everything ⇒ island, `isPartOfIsland` per layer.
- `shareDisconnectedTiles` + derived `disconnectStrokeColor`/`disconnectStrokeWidthScale` give
  the same "disconnects fade/shrink as you progress" feedback as classic.

## Solved check

`isSolved()`: `openEnds` empty AND the first valid sub-cell's component covers `totalSubCells`
AND a BFS from it sees no loop and no unreached tiles.

- Mutual-only storage means `openEnds` catches both stub types (pointing at an empty cell / at a
  neighbour that doesn't point back). Classic needed one-sided link storage + a mutuality
  re-check inside its BFS for neighbour stubs; its off-board (`-1`) stub check is dead code
  (`dirIn` never stores `-1`). Keep `openEnds`; don't port the re-check.
- **Pending simplification (discussed, not applied)**: the BFS loop check is redundant for
  generator-shaped boards. Layer popcounts are rotation-invariant and `pregenerate_layers`
  produces a tree over sub-cells, so `Σ popcount(layers) === 2 * (totalSubCells - 1)` holds at
  all times; if `openEnds` is empty, edges = V-1, and a connected graph with V-1 edges is
  automatically a tree. Corollary: on generator-valid boards loops can only coexist with stubs.
  If applied: add a cheap constructor assertion of the popcount invariant, then reduce
  `isSolved()` to `openEnds empty && components.get(firstValidId).tiles.size === totalSubCells`.
  Gotcha: hand-made fixtures that aren't generator-shaped (e.g. the 4-cycle `[[9],[12],[3],[6]]`
  loop fixture in `game-layers.svelte.test.js`) violate the invariant and would false-positive;
  rework them (e.g. build a loop-with-stubs state by rotating a valid tree board). The same math
  applies to classic `PipesGame`, left untouched on purpose.

## Board lifecycle

- Constructor: builds tileStates (from `LayeredProgress`: rotations/locked/edgeMarks/colors
  restored; else white, rotations 0), sets `edgeMarks` to `'none'` on outer edges of non-wrap
  boards (length = `EDGEMARK_DIRECTIONS.length`), computes `firstValidId` skipping empty cells,
  then `initializeBoard()`.
- `initializeBoard()`: fills `connections` (mutual-only, back-layer resolved per direction) +
  initial per-layer disconnect flags, then flood-merges initial components and marks loops and
  islands. Uses classic's `connectedThrough` trick: reaching the same neighbour through another
  layer means a loop suspicion.
- `startOver()`: resets rotations/locked/colors/per-layer flags, keeps only `'none'` edge marks,
  re-runs `initializeBoard()`.

## Rendering (`LayeredTile.svelte`)

- One `<g class="pipe">` per cell rotated by `rotations` — all layers share the transform
  (rotation turns the whole cell).
- Per layer: outline path + insides path, insides colored by `colors[layer]` (component color).
- Per-layer path via `polygon.get_pipes_path(-layer)`: a **negative mask selects the "layered
  case"** in `polygonutils.js` — the path starts at a per-layer offset center
  (`get_layer_center`, centroid of the layer's stubs) instead of the cell center, so parallel
  pipes within a cell don't overlap.
- Sinks (circles) drawn on deadend layers (single-direction layers), positioned at the layer
  center offset, filled with the layer's component color.
- Per-layer strokes: `#888` normal; `disconnectStrokeColor`/scaled width when that layer has
  disconnects; `#b55` when part of an island. Background: pink when the cell (any layer) is part
  of a loop, darker gray when locked. Derived helpers `cellHasDisconnects`/`cellIsPartOfLoop`/
  `cellIsPartOfIsland` OR the per-layer flags for this.
- Guide dot (orient_lock mode) uses `getGuideDotPosition(data.tile, i)` — the **union** mask,
  same UX as classic.
- Rotation animation via `.animation-normal/fast/instant` CSS classes, same mechanism as
  `Tile.svelte`.

## User input

- `controls.js` is **shared with classic** — it only calls `rotateTile`, `toggleLocked`,
  `toggleEdgeMark` and reads `tileStates`, so the layered game plugs in unchanged (signatures
  are cell-index based; internally everything fans out to layers).
- Edge marks live per cell-edge exactly like classic — marks are on grid edges, not layers, and
  by the 1-exit-per-cell+direction invariant each cell-edge belongs to at most one layer.
- Assistant (`rotateToMatchMarks(cell)`): rotates so **all layers fit at once** — it checks the
  union mask (`tileState.tile`) against conn/wall marks (union ⊇ connections, union ∩ walls = 0).
  Locked neighbours are evaluated one-sided via `findBackLayer` (gotcha above).
- Orient mode (`orient_lock`): controls compute the click direction from `tileState.tile` (union)
  - `rotations`, identical to classic.

## Integration notes (Puzzle.svelte)

- `saveProgress` stores `colors` (array) for layered, `color` for classic; restore path matches.
- Solver wiring: `unleashTheSolver` has a layered branch — runs `LayeredSolver.solve(true)` and
  applies steps as absolute rotations via `setTileOrientation` (locking `final` + `initial` steps
  like classic); multi-solution lock/unlock compares picture ids; `solutions` are converted to
  rotation arrays for the "Solution k" buttons (template branches classic vs layered). Solver
  details: see layers-solver doc.
- `measureSolveTime` runs a full `solve(true)` for the stats readout, so heavy boards freeze the
  UI before animating — same exposure as classic.
