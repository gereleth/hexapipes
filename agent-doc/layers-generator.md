# Layers variant: generator (`pregenerate_layers`, `LayeredGenerator`)

Files: `src/lib/puzzle/generator-layers.js`, `src/lib/puzzle/worker-layers.js` (web worker),
`src/routes/custom/+page.svelte` + `LayeredGeneratorComponent.svelte` (UI wiring),
`/generator-debug` (research tooling, no nav link). Classic counterpart: `generator.js`
(`pregenerate_growingtree`, `Generator`). Tests: `generator-layers.test.js` (pregeneration,
scrambling, startLayers reuse, `LayeredGenerator` modes, worker smoke tests, growth-event
mirroring, `uniqueIterations`). Run:
`npx vitest run src/lib/puzzle/generator-layers.test.js`.

## `pregenerate_layers(grid, branchingAmount, avoidObvious, startLayers, reuseMinCount, onMove, layeringAmount)`

GrowingTree maze growth over cells (Prim↔backtracker mix: `usePrims = Math.random() <
branchingAmount` picks a random frontier cell, else the newest one). Layers variant twists:

- Moves are `(existing layer, free direction)` pairs of the source cell. Growing into an
  **unvisited** cell pushes a fresh layer there (the back direction); growing into a **visited**
  cell adds a _new layer_ to it — revisiting is how the board becomes layered (merging would
  close a cycle).
- `layeringAmount` (default `0.6`): per-direction probability of _allowing_ a move into an
  already-visited cell. `0` ⇒ every move reaches a fresh cell ⇒ a classic single-layer tree.
  **Plumbing planned**: only `pregenerate_layers` takes it today — `LayeredGenerator`,
  `worker-layers.js` and the UI always run the default `0.6`, and `GeneratorOptions` does not
  expose it yet.
- Frontier tiers, picked in order `visited > avoiding > lastResort`:
  - fully-connected moves (source or neighbour union would become `polygon.fully_connected`;
    skipped on triangular grids) and obvious moves (below) are demoted: the cell is moved out of
    `visited` into `avoiding`/`lastResort` and other cells are tried first.
  - **Moves that would make the source or neighbour fully connected/obvious while reaching an
    already-visited cell are disregarded outright** (`continue`), not demoted. So a demoted move
    always reaches unvisited cells — demotion is pure progress, never a wasteful pure revisit.
    (This replaced an earlier design where demoted revisits competed in the same tier.)
- `avoidObvious`: forbidden union masks per border cell, computed inline from
  `polygon.tileTypes` str-groups (shape orientations forced by that cell's walls — shapes with a
  single wall-respecting orientation). Checked for both the source cell and the neighbour, and
  gated per move by `Math.random() < avoidObvious`. Not yet wired: classic's avoidStraights.
- Assertions: a neighbour never already connects back in the moved-to direction; no frontier
  cells left while unvisited cells remain. Moves into unvisited cells are never gated or
  disregarded (every skip path assumes a visited neighbour), so a frontier cell bordering one
  always has a legal move and cannot pop — the no-frontier assertion can only fire for a
  **disconnected playable region**, and that is exactly what it is for: **boards with
  disconnected areas are not supported** by the generator, the solver or the game.

Quirk: a cell demoted to `avoiding`/`lastResort` can later classify for the _other_ demotion
tier (unions only grow, so moves can become fully connected/obvious after demotion); it is then
pushed to the second tier without being removed from the first. Harmless — the duplicate yields
a no-op pick and pops eventually — but tiers can hold a cell twice.

### startLayers reuse (`planReuse`)

`startLayers` (`StartLayers` typedef) = per-cell solved layers rotated to the solver's
representative rotation, `null` for cells to regenerate; wrong-length array ⇒ ignored (fresh
board). Keepability is per cell (non-null); no fully-connected exclusion (in classic that is
aesthetic only; structurally unnecessary because pruning dissolves any boundary cell's full
usage). `planReuse(grid, startLayers, reuseMinCount)` floods **sub-cell components**
(`cell + layer * total`) over mutual edges within keepable cells — layers within a cell never
interconnect, so one cell can host sub-cells of several components (a path "through" a cell
enters/exits via different layers!). Then:

- largest component → **live** seed: layers pruned to intra-component edges (empty-mask layers
  dropped), cells claimed + marked visited;
- components `< max(2, reuseMinCount)` dissolve (size < 2 has no edges to preserve — and would
  seed empty layer lists, crashing absorption);
- bigger ones → dormant **islands**, under the claim rule: any cell conflict with live or a
  bigger island dissolves the whole island (multi-island cells would strand one island under
  per-cell visited);
- everything else → dissolved/erased.

The `/generator-debug` page's Reused view renders this exact plan (green = live, blue =
islands, red = dissolved).

During growth: entering an unvisited island cell **absorbs** the whole island by _extending one
of the island's existing layers_ with the back direction (`layers[neighbour][0] |= back`) —
pushing a fresh layer would NOT connect to the island (layers never interconnect within a
cell). Legal because the neighbour-connects-back assertion guarantees the direction is free in
every layer, and move classification already evaluated that exact union. Absorbed cells join
`liveFromBefore` (below). By loop termination every registered island must have been absorbed
(island cells leave `unvisited` only via absorption) — deterministic assertion for tests.

**`liveFromBefore` rule**: growth moves where _both_ endpoints are reused cells (live seed or
absorbed island) are skipped — "don't break what we reused". Kept regions stay exactly as the
previous solver iteration certified them; new layers can only attach to them from outside.

If no live seed exists (fresh board or nothing keepable), the start cell is chosen uniformly at
random from `unvisited` and seeded with a zero layer.

### `GrowthMove` events

`onMove` callback mirrors every board mutation exactly (`seed`/`move`/`absorb`); `demote`/`pop`
are frontier bookkeeping without board effects. `erase` is still in the typedef (and handled by
the debug page) but currently never emitted — its only emitter, an island-dissolve fallback,
was removed. Event-mirroring fidelity is asserted by tests (apply events == returned tiles).

## `LayeredGenerator`

Mirrors classic `Generator`. Constructor knobs: `reuse_tiles_min_count = 3`,
`uniqueness_patience = 5`, `max_attempts = 100`, `max_uniqueness_iterations = 100`,
`max_solver_iterations = 0` (solver search cap, see the solver doc — a crutch to be removed),
plus solver/generator progress callbacks (forwarded as worker messages).

`generate(branchingAmount, avoidObvious, solutionsNumber)`:

- `'unique'`: consumes `uniqueIterations`, returns
  `randomRotate(applyRotations(tiles, marked))` of the unique snapshot; throws when attempts
  are exhausted.
- `'whatever'`: one `pregenerate_layers` + `randomRotate`.
- `'multiple'`: requires `complete && !unique` from `markAmbiguousTiles(1, maxSolverIterations)`,
  retries up to `max_attempts`.

`uniqueIterations(branchingAmount, avoidObvious, ambiguousLimitOverride)` yields an
`IterationSnapshot` per solver iteration (`attempt, iteration, tiles, marked, numAmbiguous,
unique, complete, keptCount, elapsedMs`); `marked` holds solver-frame rotations with
`AMBIGUOUS`/`UNSOLVED` sentinels, and non-sentinel cells feed the next iteration as
`startLayers` (`keptCount` = how many cells that was). Per iteration:

- `markAmbiguousTiles(min(ambiguous, ambiguousLimit), maxSolverIterations)`; ambiguousLimit
  defaults to `max(100, 0.1 * total)`; the override exists so research runs can mark every
  ambiguity and let patience work on true counts.
- `!solvable` ⇒ throw (pregeneration produced garbage).
- `unique && complete` ⇒ yield and stop.
- `!complete` (solver cap hit) ⇒ trust nothing: yield, keep `startLayers`, next attempt.
- Patience: if the previous count exceeded the limit and `numAmbiguous` sits saturated at the
  limit, rebuild `startLayers` anyway (no way to tell improvement, don't punish patience);
  else if no improvement, `patienceLeft -= 1`; else record the new count, reset patience and
  rebuild `startLayers`. Patience exhausted ⇒ next attempt.

## Utilities

- `validateLayers(grid, layers)`: throws on broken invariants — coverage, per-cell disjointness
  (OR == XOR of layers), per-layer mask validity, edge matching, single tree
  (`connectionEnds === 2 * (subCells - 1)` + BFS reachability). Applies to **solved** boards
  only — scrambled boards intentionally break mutual edge matching (that is the puzzle). 1×1
  boards are degenerate (the start cell keeps a zero layer, rejected here) — irrelevant, not a
  playable board.
- `randomRotate(layers, grid)`: scramble; one random rotation per cell, all layers together.
- `applyRotations(grid, layers, rotations)`: rotate each cell's layers; solver sentinel
  rotations count as no-op. Shared with `solver-layers.test.js`.
- `buildStartLayers(grid, layers, marked)`: solved board + marked rotations → `StartLayers`
  (`null` for empty cells and `AMBIGUOUS`/`UNSOLVED` sentinels).

## Worker & debug tooling

`worker-layers.js` commands (mirror of classic `worker.js` plus debug):

- `generate`: full `LayeredGenerator.generate`; replies `{msg: 'generated', tiles}` (already
  scrambled) or `{msg: 'error', error}`; progress as `generator_progress`/`solver_progress`.
- `debug-start`/`debug-step`: step through `uniqueIterations` one snapshot at a time
  (`options.maxAmbiguousTiles` → `ambiguousLimitOverride`), `debug-done` when unique/exhausted.
- `debug-true-count`: unlimited `markAmbiguousTiles()` on the last stepped board → `true-count`.
- `debug-stop`.
- `growth-start`: one `pregenerate_layers` run with `options.startLayers`/`reuseMinCount`,
  streaming a `growth-move` message per `GrowthMove` event, then `growth-done`.

Worker smoke tests shim `globalThis.postMessage`/`onmessage` and import the worker module
directly (module cache means the handler from the first import persists across tests).

The `/generator-debug` page steps the loop and visualizes: solved board with per-cell status
underlay (green reused / red ambiguous / gray unresolved / blue newly certified), live solver
progress row, iteration history (ambiguous/kept bars + ms), snapshot carousel, true-count
button, the Reused (planReuse roles) view, and an animated Growth view replaying `GrowthMove`
events (play/pause/step, optional seeding from the viewed iteration's `startLayers`).

## Convergence of the uniqueness loop (research status)

Initial state: 20×20 unique generation barely converged (one run ~1 h): `numAmbiguous` sat
pinned at `ambiguousLimit` every iteration, patience never fired, solver trial stacks grew very
deep. Three growth-side fixes landed:

1. fully-connected/obvious moves into visited cells are disregarded instead of demoted
   (demotion ⇒ guaranteed progress);
2. `liveFromBefore` blocks new growth between reused cells, so kept regions keep their exact
   certified shape;
3. `layeringAmount` gates revisits probabilistically (default 0.6).

Empirically a 20×20 square now converges to unique in **10–50 iterations**. The problem is
considered partially understood — research continues on the `/generator-debug` page:

- **H1**: the `ambiguousLimit` cap masks the true ambiguity count (progress invisible, patience
  blind). The page's max-ambiguous control exists to investigate; the cap-saturation rule in
  `uniqueIterations` is the current mitigation.
- **H2**: rerolled regions regenerate dense ambiguity (layered boards are intrinsically more
  ambiguous than classic — parallel pipes, multi-layer rearrangements). Partially mitigated by
  the revisit gating.
- **H4**: solver backtracking tail (heavy on large wrapped boards) — see the solver doc; this
  is the `max_solver_iterations` crutch.
- ~~H3 (reuse not engaging)~~: the `liveFromBefore` rule and reuse role visualization address
  the reuse side; kept-count behavior still worth watching on big boards.

## Differences vs classic generator at a glance

| Aspect            | classic                        | layered                                           |
| ----------------- | ------------------------------ | ------------------------------------------------- |
| revisit handling  | avoided (merges would loop)    | new layer on revisit, `layeringAmount` gate       |
| fully-connected   | aesthetic demotion             | demotion + hard disregard when not reaching fresh |
| obvious avoidance | per-tile tileTypes + straights | union-based forbidden sets; straights not ported  |
| reuse             | keepable tiles verbatim        | sub-cell components: live seed + dormant islands  |
| uniqueness loop   | patience over ambiguous counts | + limit cap, cap-saturation rule, `complete` flag |
| observability     | progress callbacks             | + `uniqueIterations` snapshots, GrowthMove events |
