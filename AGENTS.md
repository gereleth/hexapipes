# AGENTS.md

Web-based logic puzzle game (pipes/Net variant), SvelteKit + Svelte 5 (repo is mid Svelte 3 → 5
migration, runes are used in `.svelte.js` files). Prettier with tabs, JSDoc types everywhere,
vitest for tests (`npm run test`, excludes dailies). The `layers` branch hosts an experimental
puzzle variant developed across several sessions — this file summarizes it.

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
  mutually connected, no loops, no open ends. `isSolved()` also requires `openEnds` empty.
  Classic blocks neighbour-stubs via one-sided link storage + a mutuality re-check in its BFS,
  but its off-board stub check is dead code (`dirIn` never stores `-1`) — irrelevant in practice
  since generated boards never point off-board. The layered game stores mutual-only edges, so
  `openEnds` handles both stub types — keep it.

## Encodings

- `LayeredTiles` = `Number[][]`: per cell, a list of layer bitmasks; `[]` for empty cells.
  Direction bits per grid (square: E=1 N=2 W=4 S=8), same as classic tiles.
- Sub-cell id = `cell + layer * grid.total`. Decode: `cell = id % total`,
  `layer = Math.floor(id / total)`. Plain-number keys so classic Map/Set algorithms port over.
- `validateLayers` applies to **solved** boards only — scrambled boards intentionally break
  mutual edge matching (that is the puzzle).

## Implemented so far (branch `layers`)

- `src/lib/puzzle/generator-layers.js`
  - `pregenerate_layers(grid, branchingAmount, avoidObvious = 0)`: GrowingTree maze
    (Prim↔backtracker mix) over cells; moves are `(existing layer, free direction)` pairs;
    growing into an already visited cell pushes a **new layer** there (merging would close a
    cycle); moves that would complete a fully connected union are a last resort (frontier
    demotion, mirrors classic `fullyConnectedNeighbours`, checked for both the source cell and
    the neighbour). `avoidObvious` demotes moves whose resulting **union** is a border cell
    shape forced by that cell's walls, checked for both the source cell and the neighbour
    (forbidden sets computed inline from `polygon.tileTypes`
    str-groups; frontier tier `visited > avoiding > lastResort`; no-op on wrapped boards).
    Not yet wired: startTiles reuse, avoidStraights.
  - `validateLayers(grid, layers)`: throws on broken invariants — coverage, per-cell disjointness
    (OR == XOR of layers), edge matching, single tree (`connectionEnds === 2 * (subCells - 1)`
    plus BFS reachability).
  - `randomRotate(layers, grid)`: scramble; one random rotation per cell applied to all layers.
- `src/lib/puzzle/game-layers.svelte.js` — `LayeredPipesGame`
  - `connections: Map<subCellId, Set<subCellId>>` stores **mutual edges only** (deviation from
    classic, which stored one-sided pointing links). Non-mutual-ness is derived on demand via
    `findBackLayer(cell, direction)` — the neighbour's rotation never changes during my rotation,
    so resolution is stable. Don't reintroduce one-sided links.
  - `LayeredTileState` per cell: static `layers: Number[]`; reactive `rotations`, `locked`,
    `edgeMarks`; per-layer arrays `colors`, `hasDisconnects`, `isPartOfLoop`, `isPartOfIsland`;
    `tile` getter = union of layer masks (used by controls' orient mode).
  - Mutual-only storage gotcha: any "does the neighbour point at me?" query must be one-sided
    via `findBackLayer(neighbour, direction)` — do not test mutuality there. This bit
    `rotateToMatchMarks` once: a locked neighbour's extended connection is precisely a link
    the rotating cell does not (yet) point back at, so a mutual check classified it as a wall.
  - `setTileOrientation(cell, rotation, animate)`: rotates a cell to an absolute rotation
    relative to its base layers (the solver's frame), independent of accumulated player rotations;
    `animate` spins a full turn when already at the target (classic parity).
- `src/lib/puzzle/solver-layers.js` — `LayeredCell` + `LayeredSolver` (port of classic `Solver`)
  - **Decision variable is the cell rotation**, represented as **pictures**: equivalence
    classes of rotations with the same multiset of rotated layer masks (`sorted masks.join('-')`,
    `'0'` for empty cells). Same-picture rotations are provably solved-equivalent (the induced
    sub-cell relabeling is a graph isomorphism), so classic's mask-dedupe carries over soundly;
    `marked`/solutions are compared by picture id. `LayeredCell.pictures: Map<id, repRotation>`,
    plus classic-style `walls`/`connections` direction bitmasks (`applyConstraints` intersects
    unions over surviving pictures). Multi-layer cells are `[5, 10]` (plain masks), NOT `[[5],[10]]`
    — the latter only passes tests via array→number coercion.
  - **Tree constraint**: sub-cell union-find + pending links, pinned cells only. `pinCell`
    (called after the cell leaves `unsolved` — ordering matters, the island check depends on it)
    resolves pendings from earlier-pinned neighbours (missing back-layer ⇒ throw), stores new
    pendings under unpinned neighbours, then runs the edge-budget check
    (`internalEdges + pendingCount > totalEdges ⇒ throw`; `totalEdges = ½ Σ popcount` is
    rotation-invariant, so the budget fires only for already-doomed branches) and
    `checkForIslands` (a component with no pending links while unsolved cells remain can never
    connect). Each edge is stored exactly once (at the later-pinning endpoint).
  - **Propagation order gotcha that once broke correctness**: prune/shrink of the picture set can
    imply NEW walls/connections; `processDirtyCells` therefore loops
    apply → propagate → `pruneContradictoryPictures` until stable and only then considers
    pinning. Without the loop, a pinned cell's full union never reached neighbours as facts and
    they pinned to wrong rotations (rare, random-boards-only, found by a 450-board stress loop).
  - `pruneContradictoryPictures`: deletes pictures where a layer points at a pinned cell with no
    back-layer, or where one layer would connect into the same pinned component twice (definite
    cycle). After each pin, unpinned neighbours are re-dirtied so prune-only (fact-less)
    eliminations propagate. Propagation into pinned neighbours never resurrects them (classic
    silently re-creates solved cells via `getCell`); instead consistency is checked and
    contradictions thrown.
  - Guessing: MRV over picture counts, tie-break "most pinned neighbours", value order "picture
    with most pinned connections" (greedy tree-growing; safe for completeness — all values are
    tried on backtrack). This + the pruners took 10×10 from ~75% timeouts to ≤1.1 s.
  - `markAmbiguousTiles(limit, maxIterations)` mirrors classic (marked by picture id, converted
    to representative rotations in the result; ambiguous per CELL). Returns an extra
    `complete: false` when the iteration cap fires (capped runs then also report
    `unique: false` and optimistic `solvable: true` so callers retry instead of trusting it).
  - Perf: fine ≤10×10 and hexa 7×6; **12×12 wrap still has a heavy tail** (most runs seconds,
    some >>20 s) — wrong-branch detection is fundamentally weaker than classic's cell-level
    component walls (parallel pipes make cell-level loop pruning unsound). The future generator
    should pass `maxIterations` and rely on a classic-style patience/regenerate loop.
- `src/lib/puzzle/LayeredTile.svelte` — per-layer pipe paths, sinks on deadend layers positioned
  at the layer junction, per-layer stroke states. `getPipesPath(-layer)` (negative mask) selects
  the "layered case" in `polygonutils.js` `get_pipes_path` where the path starts at a per-layer
  offset center (`get_layer_center`) instead of the cell center.
- `src/lib/puzzle/Puzzle.svelte` — instantiates `LayeredPipesGame` when `tiles[0]` is not an
  integer; renders `LayeredTile` vs `Tile`; `saveProgress` stores `colors` array for layered.
  `unleashTheSolver` has a layered branch: runs `LayeredSolver.solve(true)` and applies steps as
  absolute rotations via `setTileOrientation` (locking `final`+`initial` steps like classic);
  multi-solution lock/unlock compares picture ids, and `solutions` is converted to rotation
  arrays for the "Solution k" buttons (which branch classic-vs-layered in the template).
  `measureSolveTime` instantiates the matching solver for the stats readout (full `solve(true)`,
  so heavy boards freeze the UI before animating — same exposure as classic).
- `src/routes/custom/+page.svelte` — "Layered" checkbox generates via
  `randomRotate(pregenerate_layers(grid, branchingAmount), grid)` and plays in the browser.
- Tests: `generator-layers.test.js` (pregeneration + scrambling),
  `game-layers.svelte.test.js` (components, merge/split, loops, progress, scramble→solve e2e,
  solver wiring: `setTileOrientation` + apply solution rotations → solved)
  and `solver-layers.test.js` (cell constraints mirroring `solver.test.js`, border/deduction
  parity on single-layer boards, unsolvable/unique/multiple/wrap/empty-cell boards, picture
  dedupe, cap behavior). Run:
  `npx vitest run src/lib/puzzle/generator-layers.test.js src/lib/puzzle/game-layers.svelte.test.js src/lib/puzzle/solver-layers.test.js`.

## Known quirks

- 1×1 board is degenerate (start cell keeps a zero layer; `validateLayers` would reject it) —
  irrelevant, not a playable board.
- Edge marks array length = `EDGEMARK_DIRECTIONS.length` (classic Tile.svelte hardcodes 3).
- Repo-wide `npm run check` reports ~42 pre-existing svelte-check errors from the migration;
  only worry about new ones in touched files. `npm run lint` has 2 pre-existing warnings
  (`src/app.html`, `src/routes/app.css`).

## Next session: uniqueness generation + UI wiring

- Solver is in place (`solver-layers.js`); the uniqueness verdict is **per cell by picture id**,
  `marked` gives representative rotations per cell (or UNSOLVED/AMBIGUOUS), so a scramble is
  just `marked`-rotations of the solution layers; symmetric twins collapse like classic straights
  (same-picture rotations are always solved-equivalent — no fairness check needed, proven by the
  picture-isomorphism argument).
- Goal: unique-solution generation loop for layered puzzles (like `Generator.generate` with
  `solutionsNumber === 'unique'`), in `generator-layers.js` mirroring the classic
  pregenerate → markAmbiguous → retry cycle, passing `ambiguousTilesLimit` and a
  `maxIterations` cap (treat `complete: false` as "regenerate/retry"). Solver progress callbacks
  feed the UI (`SolverProgress.svelte` — shape already compatible, `total` = playable cells).
- `startLayers` reuse: classic reuses non-ambiguous connected regions via `startTiles`. Layered
  version: store non-ambiguous cells' **solved layer lists** (apply `marked` rotations), seed
  `pregenerate_layers` with them (copy verbatim, mark visited; grow around them — disjointness
  is preserved automatically since growth only pushes new layers).
- UI wiring done: `unleashTheSolver` layered branch applies steps as absolute rotations and the
  "Solution k" buttons replay rotation arrays. Remaining: custom page generation through the
  uniqueness loop (web worker, like classic `worker.js`).
- Consider porting classic's merge-time loop-avoidance pruning for speed, but note parallel
  pipes make naive cell-level rules unsound (two edges between the same cell pair are legal);
  only same-layer double connections into one component are definite cycles.

## Pending idea (discussed, not applied): simplify layered `isSolved()`

The BFS tree check in `LayeredPipesGame.isSolved()` is redundant for generator-shaped boards:

- Layer popcounts are rotation-invariant, and `pregenerate_layers` produces a tree over
  sub-cells, so `Σ popcount(layers) === 2 * (totalSubCells - 1)` holds at all times.
- If `openEnds` is empty, every set bit is mutual, so `edges = Σbits / 2 = subCells - 1`.
- A connected graph with V-1 edges is automatically a tree — the BFS loop check can never fire.
  Corollary: on generator-valid boards loops can only coexist with stubs; a fully mutual state
  is always acyclic.

If applied: add a cheap constructor assertion `Σ popcount(layers) === 2 * (totalSubCells - 1)`
(throw otherwise) so the invariant is enforced, then reduce `isSolved()` to
`openEnds empty && components.get(firstValidId).tiles.size === totalSubCells`.
Gotcha: hand-made fixtures that are not generator-shaped (e.g. the 4-cycle `[[9],[12],[3],[6]]`
loop fixture in `game-layers.svelte.test.js`) violate the invariant and would false-positive;
that fixture needs reworking (e.g. build a loop-with-stubs state by rotating a valid tree board).
The same math applies to classic `PipesGame`, left untouched on purpose.
