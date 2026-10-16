# Pipes game (`PipesGame`, classic + layered)

Files: state and logic in `game.svelte.js`; renderers `Tile.svelte` (classic) and
`LayeredTile.svelte` (layered); wiring in `Puzzle.svelte`; input in `controls.js`. Tests:
`game.svelte.test.js` (classic + characterization pins) and `game-layers.svelte.test.js` (layered).

The layered variant is a strict generalization of classic: a classic board is a layered board with
exactly one layer per cell. The game exploits that. `PipesGame` accepts classic bitmasks
(`Number[]`) or layered tiles (`Number[][]`), normalizes classic input to one layer per cell, and
runs a single state model for both. The input shape is detected once into `game.isLayered`, which
selects only the renderer and the solver class. Boards are assumed to be a single connected playable
region.

What follows are the four ideas the state model stands on, then the UI that sits on top.

## Sub-cells are the nodes

Once a cell can hold several layers, the cell index stops being the unit of connectivity. The unit
is the **sub-cell**: id = `cell + layer * grid.total`, with `subcellId`/`cellLayerOf` helpers on the
grid. Every map and set in the game is keyed by sub-cell ids. On classic boards sub-cell ids equal
cell indices, which is how classic algorithms ported over unchanged.

Per-cell state (`TileState`) holds static `layers: Number[]` — bitmasks, never mutated; rotations
live in a separate `rotations` counter, and rotating turns all layers at once. Plus `locked`,
`edgeMarks`, and per-layer arrays: `colors`, `hasDisconnects`, `isPartOfLoop`, `isPartOfIsland`. The
`tile` getter ORs the layer masks into a union, used as the cell's geometry by orient-mode controls,
the assistant, and the guide dot.

Connectivity state: `components: Map<subCellId, Component>`, where a component is
`{subcells, openEnds, color}` — its mutually connected sub-cells, the subset of them that currently
has disconnects, and their fill color. Sub-cell granularity means one cell can host layers in
different components. The game-level `openEnds` set is always the union of all component open ends.

Colors are the player-facing connectedness feedback: everything starts white, and components gain
random colors as they form — on a merge the smaller side adopts the larger side's color, on a split
the new component gets a fresh random one.

## Connections are stored only when mutual

A link enters `connections: Map<subCellId, Set<subCellId>>` only when both ends point at each other
right now. One-sided pointing is stored nowhere. It is derived on demand by
`findBackLayer(cell, direction)`, which scans the neighbour's layers for one pointing back.

This asymmetry is the load-bearing decision. Mutual-only storage keeps the map always true, but
never complete: whether a neighbour _currently_ points back is a question about its live layers, so
it must be asked geometrically, never from the map. The map answers "what is definitely connected";
geometry answers "what points where".

## A move is: sever, connect, finalize

Only one cell rotates per move, so a move is a small graph edit. `handleConnections` applies it in
three phases:

1. **Sever** the directions the cell stopped pointing at. Delete the stored edge if there was one,
   mark both endpoints as open ends, `disconnectComponents`. Both `updateOpenEnds` calls are needed
   for island highlighting correctness.
2. **Connect** the directions it newly points at. If the neighbour points back, store the edge,
   `mergeComponents`, resolve the neighbour's open end. Otherwise the layer is recorded as
   disconnected for finalize.
3. **Finalize**: recompute disconnect state for all layers of the rotated cell, then recompute
   `solved`.

The phases exist to preserve two invariants:

- **Nothing closes mid-turn.** The severed cell keeps a provisional open-end mark through the
  connect phase, so no component counts as closed until finalize. Finalize is the only open→closed
  transition of a turn, and therefore the only mid-game place island flags get set.
- **Flags only flip at component transitions.** `isPartOfIsland` changes only when its component
  goes closed↔open (`updateOpenEnds`), touching just that component's subcells. No board-wide
  recompute happens during play; `initializeBoard`'s initial marking is the only wholesale pass.

## Loops and islands

Loops and islands are judgments about a whole component, refreshed after every graph edit:

- Merging a component with itself creates a cycle. Severing an edge inside a loop removes a cycle
  but the component could still hold other cycles. Either way `detectLoops` re-runs and
  `isPartOfLoop` is reassigned per layer.
- A component with no open ends that doesn't cover the whole board is an island; `updateOpenEnds`
  sets and clears `isPartOfIsland` at the transitions described above.

Pinned quirk: `initializeBoard` marks islands without the whole-board size check, so a full-board
component counts as an island too. Intentional — it keeps presolved boards interactive. `startOver`
resets rotations, locks, colors and flags, keeps `'none'` edge marks, and re-runs it.

## Solved is bookkeeping, not a search

The constructor computes `treeShaped` once: pipe ends over all layer masks (Σ popcount) must equal
`2 * (totalSubcells − 1)`. Every mutual connection contributes two ends and every stub one; a
spanning tree over V sub-cells has V−1 connections. Masks are static, so a board either adds up or
never will.

`isSolved()` is then three cheap checks: `treeShaped`, no open ends, and the component of
`firstValidSubcell` covering everything. No loop check is needed, and the reason is worth
understanding: with no open ends every direction is mutual, so the connection count is pipe ends
divided by two, which equals V−1; a connected graph on V nodes with V−1 edges is a tree. Pinned by
the `[[9], [12], [3], [6]]` loop fixture in `game-layers.svelte.test.js`.

## The UI: two renderers, one input path

The renderers are separate because the geometry genuinely diverges; `Puzzle.svelte` picks by
`game.isLayered`. `Tile.svelte` draws straight pipe segments from the cell center and reads state by
layer-0 indexing — safe because empty cells never render. `LayeredTile.svelte` builds each layer's
path with `polygon.get_pipes_path(-layer)`: the negative mask selects the layered case, which starts
from a per-layer offset center so different layers' pipes don't overlap at the cell center.
`.pipe path { fill: none }` — SVG's default black fill would paint crescents on concave bends.

FIXME: loop highlighting by cell background is bad in layered case because it's impossible to see
which layers are in a loop.

Input is shared because `controls.js` works at cell granularity: it calls `rotateTile`,
`toggleLocked`, `toggleEdgeMark` and reads `tileStates`, all by cell index. Edge marks live per grid
edge, not per layer — by the 1-exit-per-cell+direction invariant each cell-edge belongs to at most
one layer. Outer edges of non-wrap boards are pinned to `'none'`. The assistant
(`rotateToMatchMarks`) rotates the cell to the first rotation where the union mask covers all conn
marks plus locked-neighbour connections and hits no wall marks; locked neighbours are probed
one-sided via `findBackLayer`. Orient mode computes the click direction from the union mask
(`clickOrientTile(tileState.tile, …)`). Works well in classic, needs a usability fix in layered.

Shared feedback state: `disconnectStrokeColor` and `disconnectStrokeWidthScale` derive from
`shareDisconnectedSubcells`, fading and shrinking disconnect strokes as you progress. Both renderers
animate rotations with the `.animation-*` classes.

## Persistence and solver wiring

`saveProgress` writes `{rotations, locked, color, edgeMarks}` per tile. The reader accepts `color`
as a single string (pre-unification saves) or a per-layer array, so old saves on the size pages and
`/daily` keep working. No route or wrapper code knows about the variant shapes.

`unleashTheSolver` and `measureSolveTime` pick
`game.isLayered ? new LayeredSolver(...) : new Solver(...)` and share one body. Solver steps and
solutions are rotation counts, applied through `setTileRotation`. `measureSolveTime` runs a full
`solve(true)` synchronously, so heavy boards freeze the UI before animating. Solver internals:
[layers-solver.md](layers-solver.md).
