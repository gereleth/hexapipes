# Pipes game state & UI (`PipesGame`, classic + layered)

One class serves both variants: `src/lib/puzzle/game.svelte.js` (state/logic), rendering in
`Tile.svelte` (classic) and `LayeredTile.svelte` (layered), wiring in `Puzzle.svelte`, input in
shared `controls.js`. Tests: `game.svelte.test.js` (classic behavior + characterization pins) and
`game-layers.svelte.test.js` (layered: components, merge/split, loops, progress, scramble→solve e2e,
solver wiring). The former `LayeredPipesGame`/`game-layers.svelte.js` are gone — unified 2026-10-12,
see git history.

`PipesGame` accepts `Number[]` (classic bitmasks) or `Number[][]` (layered) tiles and normalizes
classic input to **one layer per cell** (`[mask]` per playable cell, `[]` for empty). The only
variant bit left is `game.isLayered`, set from the input shape; it selects the renderer and the
solver class — nothing else.

Boards are assumed to have a single connected playable region — grids with disconnected areas are
not supported.

## Data model

- `TileState` per cell: static `layers: Number[]` (bitmasks, never mutated); reactive `rotations`,
  `locked`, `edgeMarks`; arrays on each tile, **one entry per layer**: `colors`, `hasDisconnects`,
  `isPartOfLoop`, `isPartOfIsland`; `tile` getter = OR of all layer masks (used by orient-mode
  controls, the assistant rotation, and `Tile.svelte`'s fixed pipe geometry).
- Everything is keyed by **sub-cell id** = `cell + layer * grid.total` (`subcellId`/`cellLayerOf` on
  the grid). For classic boards `subcellId(cell, 0) === cell`, so the keys coincide with the plain
  cell indices the pre-unification classic code used. Plain-number keys so classic Map/Set
  algorithms port over unchanged.
- `connections: Map<subCellId, Set<subCellId>>` stores **mutual edges only** — for both variants
  since the unification (classic previously stored one-sided pointing links and re-checked mutuality
  at every use site).
- Non-mutual-ness is derived on demand via `findBackLayer(cell, direction)`: scans the neighbour's
  layers for one pointing in the opposite direction (for one-layer boards this reduces to a boolean
  "does the neighbour point back"). Resolution is stable during a rotation because the neighbour's
  rotation never changes while I rotate.
- **Gotcha: never reintroduce one-sided links, and never test mutuality in "does the neighbour point
  at me?" queries — the query must be one-sided via `findBackLayer`.** This bit `rotateToMatchMarks`
  once: a locked neighbour's extended connection is precisely a link the rotating cell does not
  (yet) point back at, so a mutual check misclassified it as a wall. The locked-neighbour probe in
  `rotateToMatchMarks` deliberately asks `findBackLayer` (geometric answer), not the stored links.

### Variant differences at a glance

| Aspect         | classic                                         | layered                                  |
| -------------- | ----------------------------------------------- | ---------------------------------------- |
| tiles input    | one bitmask per cell `Number[]`                 | `layers: Number[]` per cell `Number[][]` |
| renderer       | `Tile.svelte`                                   | `LayeredTile.svelte`                     |
| solver class   | `Solver`                                        | `LayeredSolver`                          |
| saved progress | same format: `color` holds `String \| String[]` | same                                     |

Everything else — connection storage, components, loops, islands, solved check, rotation handling,
save format — is shared code.

## Rotation & connection updates

- `rotateTile(cell, times)`: rotates **all layers at once** (one `rotations` counter per cell);
  computes per-layer `dirIn`/`dirOut` (`{layer, direction}` pairs) and hands them to
  `handleConnections`. No-ops when solved, locked, or empty cell.
- `handleConnections` runs three phases, in order. **Sever**: dirOut removes stored edges gated by
  `findBackLayer` (non-mutual links were never stored, nothing to remove) and splits the component
  if needed via `disconnectComponents`. Both endpoints are marked as open ends: the neighbour's mark
  is genuine (it still points at the rotated cell) and doubles as the closed→open transition that
  clears island highlighting from the whole component before the split; the rotated cell's mark is
  provisional (the final recompute corrects it) and keeps its component open through the connect
  phase. **Connect**: dirIn adds an edge only when the neighbour has a back-layer —
  `mergeComponents` unions the components, `updateOpenEnds` resolves the neighbour's open end — else
  it just records a disconnect for the finalize pass. **Finalize**: recomputes disconnect state of
  all layers of the rotated cell and updates `solved` when initialized. The provisional mark is what
  makes this safe: nothing can close until all merges are done, so finalize is the only open→closed
  transition of the turn and the only place island flags get set mid-game. Dropping the mark
  re-opens the stale-highlighting class of bug (see the characterization test "Keeps island
  highlight off when a second connection re-opens the component").
- Pointing off-board or at a non-mutual neighbour ⇒ `hasDisconnects` for that layer and the id joins
  `openEnds` (game-level set + `component.openEnds`).
- `setTileRotation(cell, rotation, animate)`: rotates to an **absolute rotation relative to the base
  layers** (the solver's frame), independent of accumulated player rotations; modular delta,
  `animate` spins a full turn when already at target. Unlocks the tile first. This is what
  Puzzle.svelte uses for solver animations, multiple solutions, and the empty-cell no-op guard.
- Quirk (pinned by tests): `solved` is only recomputed inside `handleConnections`, so a freshly
  constructed or startOver'd solved board reports `solved === false` until the next rotation.

## Components, loops, islands

- `mergeComponents` (on connect) / `disconnectComponents` (on break) work at sub-cell granularity:
  one cell can host layers in different components.
- Merging a component into itself = loop → `detectLoops` marks `isPartOfLoop` per layer (dead-end
  pruning + loop path tracing; mutual-only storage means no extra mutuality filtering inside it).
- A component with no open ends that isn't everything ⇒ island, `isPartOfIsland` per layer. The
  flags change only on a component's closed↔open transition (`updateOpenEnds`), never wholesale.
  Intentional (pinned by tests): `initializeBoard` marks islands without a size check, so a
  whole-board component counts as an island too — keeps presolved boards interactive; in practice
  only reachable via debug tools.
- `shareDisconnectedSubcells` + derived `disconnectStrokeColor`/`disconnectStrokeWidthScale` give
  the "disconnects fade/shrink as you progress" feedback.

## Solved check

`isSolved()`: `openEnds` empty AND the first valid sub-cell's component covers `totalSubcells` AND a
BFS from it sees no loop and no unreached tiles.

- Mutual-only storage means `openEnds` catches both stub types (pointing at an empty cell / at a
  neighbour that doesn't point back). Keep it; don't reintroduce a mutuality re-check inside the
  BFS.
- **Pending simplification (discussed, not applied)**: the BFS loop check is redundant for
  generator-shaped boards. Layer popcounts are rotation-invariant and `pregenerate_layers` produces
  a tree over sub-cells, so `Σ popcount(layers) === 2 * (totalSubcells - 1)` holds at all times; if
  `openEnds` is empty, edges = V-1, and a connected graph with V-1 edges is automatically a tree.
  Corollary: on generator-valid boards loops can only coexist with stubs. If applied: add a cheap
  constructor assertion of the popcount invariant, then reduce `isSolved()` to
  `openEnds empty && components.get(firstValidSubcell).subcells.size === totalSubcells`. Gotcha:
  hand-made fixtures that aren't generator-shaped (e.g. the 4-cycle `[[9],[12],[3],[6]]` loop
  fixture in `game-layers.svelte.test.js`) violate the invariant and would false-positive; rework
  them (e.g. build a loop-with-stubs state by rotating a valid tree board).

## Board lifecycle

- Constructor: normalizes classic input, builds tileStates (from `Progress`: rotations/locked/
  edgeMarks restored, `color` accepted as `String` (old saves) or `String[]`, missing → white;
  `locked ?? false` and `edgeMarks || defaults` fallbacks), sets `edgeMarks` to `'none'` on outer
  edges of non-wrap boards (length = `EDGEMARK_DIRECTIONS.length`), computes `firstValidSubcell`
  skipping empty cells, then `initializeBoard()`.
- `initializeBoard()`: fills `connections` (mutual-only, back-layer resolved per direction; empty
  cells get no entries) + initial per-layer disconnect flags, then flood-merges initial components
  and marks loops and islands. Uses the `connectedThrough` trick: reaching the same neighbour
  through another layer means a loop suspicion.
- `startOver()`: resets rotations/locked/colors/per-layer flags, keeps only `'none'` edge marks,
  re-runs `initializeBoard()`.

## Rendering

Both renderers stay separate — the geometric divergence is real. `Puzzle.svelte` picks via
`game.isLayered`.

`Tile.svelte` (classic): straight pipe segments from the cell center (`get_pipes_path` on the
non-negative mask), `pipeWidth`, sinks at the center. Reads the unified state forms by layer-0
indexing (`data.colors[0]`, `data.hasDisconnects[0]`, `data.isPartOfIsland[0]`,
`data.isPartOfLoop[0]`), plus `data.tile` (union getter) for geometry. Empty cells never render —
`getVisibleTiles` skips them — so the index-0 reads are safe.

`LayeredTile.svelte` (layered):

- One `<g class="pipe">` per cell rotated by `rotations` — all layers share the transform.
- Per layer: outline path + insides path, insides colored by `colors[layer]`.
- Per-layer path via `polygon.get_pipes_path(-layer)`: a **negative mask selects the "layered
  case"** in `polygonutils.js` — the path starts at a per-layer offset center (`get_layer_center`,
  centroid of the layer's stubs) instead of the cell center, so parallel pipes within a cell don't
  overlap. Each leg runs straight from that center, bends through a quadratic corner and exits
  perpendicular to the tile edge (`pipes_bend_fraction` / `pipes_corner_rounding` tunables in
  `RegularPolygonTile`); legs retrace to the bend point so the stroke ends flush at the edge
  midpoint.
- Pipe paths are stroke-only: `.pipe path { fill: none }`. SVG's default black fill would paint
  crescents on concave bends.
- Sinks drawn on deadend layers, positioned at the layer center offset, filled with the layer's
  component color. `pipeWidth * 0.7` and `SINK_RADIUS * 0.7` scale down for density.
- Per-layer strokes: `#888` normal; `disconnectStrokeColor`/scaled width when that layer has
  disconnects; `#b55` when part of an island — read per layer index. Background: pink when any layer
  of the cell is part of a loop (`data.isPartOfLoop.some((x) => x)` — the background polygon is the
  one genuinely cell-level surface), darker gray when locked.
- Guide dot (orient_lock mode) uses `getGuideDotPosition(data.tile, i)` — the **union** mask, same
  UX as classic.
- Rotation animation via `.animation-normal/fast/instant` CSS classes in both renderers.

## User input

- `controls.js` only calls `rotateTile`, `toggleLocked`, `toggleEdgeMark` and reads `tileStates`, so
  both variants plug in unchanged (signatures are cell-index based; internally everything fans out
  to layers). It types `game` as the single `PipesGame`.
- Edge marks live per cell-edge — marks are on grid edges, not layers, and by the
  1-exit-per-cell+direction invariant each cell-edge belongs to at most one layer.
- Assistant (`rotateToMatchMarks(cell)`): rotates so **all layers fit at once** — it checks the
  union mask (`tileState.tile`) against conn/wall marks (union ⊇ connections, union ∩ walls = 0).
  Locked neighbours are evaluated one-sided via `findBackLayer` (gotcha above).
- Orient mode (`orient_lock`): controls compute the click direction from `tileState.tile` (union)
  - `rotations`, identical for both variants.

## Integration notes (Puzzle.svelte)

- `saveProgress` maps every tile to `{ rotations, locked, color: data.colors, edgeMarks }`; the
  constructor's reader accepts `String | String[]` under `color`, so pre-unification string saves on
  the size pages and `/daily` keep working forever. No route or wrapper code knows about the variant
  shapes.
- Solver wiring: `unleashTheSolver` and `measureSolveTime` pick
  `game.isLayered ? new LayeredSolver(...) : new Solver(...)` and share one body — solver steps and
  `solutions` are rotation counts for both variants, applied via `setTileRotation`. Solver details:
  see layers-solver doc.
- `measureSolveTime` runs a full `solve(true)` for the stats readout, so heavy boards freeze the UI
  before animating.
