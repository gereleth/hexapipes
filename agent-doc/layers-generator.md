# Layers variant: generator (`pregenerate_layers`, `LayeredGenerator`)

Files: `src/lib/puzzle/generator-layers.js`, `src/lib/puzzle/worker-layers.js` (web worker),
`src/routes/custom/+page.svelte` + `LayeredGeneratorComponent.svelte` (UI wiring),
`/generator-debug` (research tooling, no nav link). Classic counterpart: `generator.js`
(`pregenerate_growingtree`, `Generator`). Tests: `generator-layers.test.js` (pregeneration,
scrambling, startLayers reuse, `LayeredGenerator` modes, worker smoke tests, growth-event mirroring,
`uniqueIterations`). Run: `npx vitest run src/lib/puzzle/generator-layers.test.js`.

## `pregenerate_layers(grid, layeringAmount, branchingAmount, avoidObvious, startLayers, reuseMinCount, onMove)`

One growth algorithm for fresh and reused boards alike, producing a single spanning tree over all
sub-cells. `min(playable, max(3, floor(total / 50)))` subtrees grow simultaneously
(`subtreeCountFor`: three on small boards, one more per 50 tiles); on reused boards the surviving
`planReuse` components become the first subtrees and fresh ones only top the count up — a
fully-keepable board grows nothing and returns verbatim. Each subtree grows like a classic
GrowingTree, with the layers twists:

- The frontier unit is the **sub-cell** (`cell + layer * total`), not the cell: each frontier
  entry's kind is its own layer's degree, so a reused through-path cell hosting a deadend and a
  branched sub-cell simply contributes two entries — no per-cell dual membership. `extending` holds
  deadend sub-cells (≤ 1 connection), `branching` branched ones (≥ 2); a subtree's occupancy is a
  plain cell set. Low `branchingAmount` grows from `extending` (long corridor-like paths), high from
  `branching` (Prim-like spread); if the rolled list is empty, the other one is used, then the
  `lastResort` demotion tier. Picks are random in all lists (no LIFO backtracking). An **opening
  round** gives every fresh subtree one forced expansion into an unvisited neighbour (random order,
  skipped when a seed has no unvisited neighbour on tiny boards): without it a subtree could lose
  the opening race — never picked while its seed cell gets saturated by a busy co-tenant — and sit
  out the game as a never-grown mask-0 seed, easily sealed off from every merge connection (each
  expansion into an unvisited cell may spend a mixed cell's last in-board spare, see below). Reused
  components already have territory and skip the opening round.
- **Edges are exclusive across subtrees**: a subtree never carves an edge another subtree took. A
  layer bitmask bit _is_ the edge to the neighbour, so per-edge exclusivity directly yields the
  per-cell "at most one layer per direction" invariant — no separate bookkeeping. Directions are
  checked cell-wide (`usedDirections`), so a direction spent by any sub-cell of the cell is spent
  for all of them.
- Growing into an **unvisited** cell pushes a fresh layer there (the back direction); growing into a
  cell occupied by **another** subtree pushes a fresh layer too (a new sub-cell for the entering
  subtree) — that is how the board becomes layered. A subtree never enters a cell it already
  occupies (that would close a cycle). `layeringAmount` (default `0.6`): per-direction probability
  of _allowing_ an entry into another subtree's cell. `0` ⇒ the subtrees stay disjoint and the
  merges alone connect them ⇒ a classic single-layer board (exactly one layer per playable cell).
  Fully plumbed: `LayeredGenerator.generate` / `uniqueIterations` take it as their **first**
  parameter, `GeneratorOptions.layeringAmount` (optional, default 0.6) flows through
  `worker-layers.js` (`generate`, `debug-start`, `growth-start`), and both UIs expose a slider
  (custom puzzle page — shown only when the Layered checkbox is on — and `/generator-debug`).
- Frontier tiers: moves that would make the source or neighbour tile union **fully connected** are a
  last resort (skipped on triangular grids — no fully-connected shape). Such moves reaching an
  unvisited cell demote the entry into the subtree's `lastResort` tier (other entries tried first;
  the guard requires another primary entry, so a lone frontier entry moves instead of demoting);
  such moves reaching an already-visited cell are **disregarded outright** — demotion is pure
  progress, never a wasteful pure revisit. Demotion is permanent (tier entries are not re-synced
  into primary after moving). `avoidObvious` is accepted but **not applied** by this growth — the
  border-union machinery died with the single-tree strategy; classic's avoidStraights remains
  unwired in both.
- **Spare-direction rule**: a _mixed_ cell (hosting several **distinct** subtrees, tracked in
  `owners` aligned with the cell's layer indices) must always keep a **spare in-board** free
  direction — layering entries need ≥ 2 in-board free directions at the target, and non-expansion
  growth out of a mixed cell needs ≥ 2 too. Expansion into unvisited cells is always allowed
  (blocking it would wall off unvisited pockets behind frozen mixed cells). This keeps the
  components' free-edge graph connected at stop time, which is what the merge phase needs.
- **Stop condition: every playable cell visited by some subtree** — not by every subtree. Dead
  subtrees (empty frontier lists) are skipped.
- **Merge phase**: union-find over subtrees; while more than one component exists, collect free
  edges between cells hosting different components and carve one at random, attaching the two cells'
  layers owned by the respective components. Exactly `subtreeCount − 1` merges, no loops
  (same-component pairs excluded). Each merge (except the last) is only taken if the remaining
  components stay connected through free edges — consuming a shared bridge edge could otherwise
  strand a component. Fully-connected-making merge unions are a last resort (normal candidates
  preferred, as during growth).
- **Retry**: growth can still fail on dense boards (an unvisited pocket walled in by frozen mixed
  cells; a grown subtree whose every boundary cell got drained to zero spares) — both random and
  rare, so **a failed attempt is simply retried on a fresh board** (`pregenerate_layers_attempt`, up
  to 20 tries); only the successful attempt's events are reported, keeping event replays exact.
- Assertions: a neighbour never already connects back in the moved-to direction; no subtree can grow
  while unvisited cells remain. The latter can only fire for a **disconnected playable region**, and
  that is what it is for: **boards with disconnected areas are not supported** by the generator, the
  solver or the game.

Measured (default knobs, 20 fresh boards): 10×10 squares (3 subtrees) end at ~1.16 sub-cells/cell
(~16% multi-layer cells), hex 7×6 (3 subtrees) at ~1.50 (~45% multi-layer), 20×20 squares (8
subtrees) at ~1.21 (~21%) — the in-board spare rule caps interpenetration on 4-direction cells, and
smaller subtree counts mean fewer cross-tree entries. The `branchingAmount` knob still shifts
deadend ratios (square 21%→35%, hex 19%→48% for b=0→1).

### startLayers reuse (`planReuse`)

`startLayers` (`StartLayers` typedef) = per-cell solved layers rotated to the solver's
representative rotation, `null` for cells to regenerate; wrong-length array ⇒ ignored (fresh board).
Keepability is per cell (non-null); no fully-connected exclusion (in classic that is aesthetic only;
structurally unnecessary because pruning dissolves any boundary cell's full usage).
`planReuse(grid, startLayers, reuseMinCount)` floods **sub-cell components**
(`cell + layer * total`) over mutual edges within keepable cells — layers within a cell never
interconnect, so one cell can host sub-cells of several components (a path "through" a cell
enters/exits via different layers!). Then:

- largest component → **live** seed: layers pruned to intra-component edges (empty-mask layers
  dropped), cells claimed + marked visited;
- components `< max(2, reuseMinCount)` dissolve (size < 2 has no edges to preserve — and would seed
  empty layer lists, crashing absorption);
- bigger ones → dormant **islands**, **carved around cells already claimed by bigger components**
  instead of dissolving entirely: the remaining sub-cells re-flood into connected pieces, pieces ≥
  `minIslandSize` register (descending, bigger wins shared cells), everything else dissolves as
  fragments;
- everything else → dissolved/erased.

Historical note: originally any cell conflict dissolved the whole island ("claim rule"). On large
dense boards this discarded huge certified regions (measured: 45% of keepable sub-cells in one 20×20
iteration, the biggest single loss an island of 184 sub-cells, all 5 conflicts with live) — see H5
below. The invariants the claim rule protected still hold under carving: every registered component
owns its cells exclusively (pieces conflicting over a cell dissolve into fragments), so per-cell
seeding and island absorption stay correct. Two subtleties: components can hold several sub-cells of
one cell (through-paths), so carved pieces can share cells even when sub-cell-disjoint — the
descending registration dissolves the losers; and piece masks are pruned to intra-piece edges, so
carved-off edges vanish cleanly. This fix was the dominant convergence bottleneck: 20×20 squares
dropped from 10–50 iterations to **3–5 iterations**; typical first-iteration accounting is ~79% of
keepable sub-cells registered (islands now carry the bulk of reused material), with small losses at
claimed cells, in fragments and in too-small components.

`planReuse` also returns `stats` (fate accounting for research): cells/sub-cells per role (live,
islands) and sub-cell losses per cause (carving at claimed cells, fragment pieces, too-small
components). This measured how much certified material the claim rule threw away and now tracks the
carve losses. `liveSubCells` counts actually seeded sub-cells, so
`liveSubCells + islandSubCells + conflictLostSubCells + fragmentLostSubCells + tooSmallLostSubCells === keepableSubCells`
always (asserted by the fuzz test).

The `/generator-debug` page's Reused view renders this exact plan (green = live, blue = islands, red
= dissolved) plus a stats line with the same accounting.

The surviving components (live seed + islands) become the growth's first subtrees: their cells are
claimed up front (removed from `unvisited`), their pruned layers seeded verbatim via `seed` events,
and every sub-cell joins its component's frontier. There is no dormancy and no absorption step: the
components keep growing like freshly seeded ones, and the merge phase connects them to each other
and to the fresh subtrees. Certification of a kept region is preserved by growing _from_ it (its
internal edges stay exactly as pruned), not by walling it off — the same class of layer extension
the old single-tree strategy performed once per island at absorption. Components can host several
sub-cells of one cell (through-paths); under the sub-cell frontier each of them is its own frontier
entry, so multi-layer reused cells grow without any special casing.

### `GrowthMove` events

`onMove` callback mirrors every board mutation exactly (`seed`/`move`/`merge`); `demote`/`pop` are
frontier bookkeeping without board effects. `erase` and `absorb` are still in the typedef (and
handled by the replay helpers and the debug page) but currently never emitted — `erase`'s only
emitter, an island-dissolve fallback, was removed, and `absorb` died with the single-tree strategy
(islands are subtrees now, connected by the merge phase). Event-mirroring fidelity is asserted by
tests (apply events == returned tiles). History: `seed` events used to pass the reused cell's layer
array **by reference** — a later push onto that cell mutated the already-emitted payload, so replays
double-counted the push (found via the multi-subtree-era replay tests; seed events now snapshot).

## `LayeredGenerator`

Mirrors classic `Generator`. Constructor knobs: `reuse_tiles_min_count = 3`,
`uniqueness_patience = 5`, `max_attempts = 100`, `max_uniqueness_iterations = 100`, plus
solver/generator progress callbacks (forwarded as worker messages).

`generate(layeringAmount, branchingAmount, avoidObvious, solutionsNumber)`:

- `'unique'`: consumes `uniqueIterations`, returns `randomRotate(applyRotations(tiles, marked))` of
  the unique snapshot; throws when attempts are exhausted.
- `'whatever'`: one `pregenerate_layers` + `randomRotate`.
- `'multiple'`: requires `!unique` from `markAmbiguousTiles(1)`, retries up to `max_attempts`.

`uniqueIterations(layeringAmount, branchingAmount, avoidObvious, ambiguousLimitOverride)` yields an
`IterationSnapshot` per solver iteration
(`attempt, iteration, tiles, marked, numAmbiguous, unique, keptCount, elapsedMs`); `marked` holds
solver-frame rotations with `AMBIGUOUS`/`UNSOLVED` sentinels, and non-sentinel cells feed the next
iteration as `startLayers` (`keptCount` = how many cells that was). Per iteration:

- `markAmbiguousTiles(min(ambiguous, ambiguousLimit))`; ambiguousLimit defaults to
  `max(100, 0.1 * total)`; the override exists so research runs can mark every ambiguity and let
  patience work on true counts.
- `!solvable` ⇒ throw (pregeneration produced garbage).
- `unique` ⇒ yield and stop.
- Patience: if the previous count exceeded the limit and `numAmbiguous` sits saturated at the limit,
  rebuild `startLayers` anyway (no way to tell improvement, don't punish patience); else if no
  improvement, `patienceLeft -= 1`; else record the new count, reset patience and rebuild
  `startLayers`. Patience exhausted ⇒ next attempt.

## Utilities

- `validateLayers(grid, layers)`: throws on broken invariants — coverage, per-cell disjointness (OR
  == XOR of layers), per-layer mask validity, edge matching, single tree
  (`connectionEnds === 2 * (subCells - 1)` + BFS reachability). Applies to **solved** boards only —
  scrambled boards intentionally break mutual edge matching (that is the puzzle). 1×1 boards are
  degenerate (the start cell keeps a zero layer, rejected here) — irrelevant, not a playable board.
- `randomRotate(layers, grid)`: scramble; one random rotation per cell, all layers together.
- `applyRotations(grid, layers, rotations)`: rotate each cell's layers; solver sentinel rotations
  count as no-op. Shared with `solver-layers.test.js`.
- `buildStartLayers(grid, layers, marked)`: solved board + marked rotations → `StartLayers` (`null`
  for empty cells and `AMBIGUOUS`/`UNSOLVED` sentinels).

## Worker & debug tooling

`worker-layers.js` commands (mirror of classic `worker.js` plus debug):

- `generate`: full `LayeredGenerator.generate`; replies `{msg: 'generated', tiles}` (already
  scrambled) or `{msg: 'error', error}`; progress as `generator_progress`/`solver_progress`.
- `debug-start`/`debug-step`: step through `uniqueIterations` one snapshot at a time
  (`options.maxAmbiguousTiles` → `ambiguousLimitOverride`), `debug-done` when unique/exhausted.
- `debug-true-count`: unlimited `markAmbiguousTiles()` on the last stepped board → `true-count`.
- `debug-stop`.
- `growth-start`: one `pregenerate_layers` run with `options.startLayers`/`reuseMinCount`, streaming
  a `growth-move` message per `GrowthMove` event, then `growth-done`. The "grow from survivors"
  checkbox on the debug page only has an effect from iteration 2 onward — the first iteration has no
  survivors by definition.

Worker smoke tests shim `globalThis.postMessage`/`onmessage` and import the worker module directly
(module cache means the handler from the first import persists across tests).

The `/generator-debug` page steps the loop and visualizes: solved board with per-cell status
underlay (green reused / red ambiguous / gray unresolved / blue newly certified), live solver
progress row, iteration history (ambiguous/kept bars + ms), snapshot carousel, true-count button,
the Reused (planReuse roles) view, and an animated Growth view replaying `GrowthMove` events
(play/pause/step, optional seeding from the viewed iteration's `startLayers`).

## Convergence of the uniqueness loop (research status)

Initial state: 20×20 unique generation barely converged (one run ~1 h): `numAmbiguous` sat pinned at
`ambiguousLimit` every iteration, patience never fired, solver trial stacks grew very deep. Three
growth-side fixes landed:

1. fully-connected/obvious moves into visited cells are disregarded instead of demoted (demotion ⇒
   guaranteed progress);
2. ~~`liveFromBefore` blocks new growth between reused cells~~ (obsolete: reuse components are
   growing subtrees now, and a subtree can never enter its own cells, so kept interiors stay
   certified by construction);
3. `layeringAmount` gates revisits probabilistically (default 0.6).

4. `planReuse` carves conflicting islands around claimed cells instead of dissolving them (the H5
   fix, see `planReuse` above).

Empirically a 20×20 square now converges to unique in **3–5 iterations** (was 10–50 before the carve
fix, ~1 h of pinned iterations before the earlier growth-side fixes). Under the unified
multi-subtree growth (reused components grow as subtrees, 2026-10) 20×20 squares measured a median
of **4 iterations** (3–7 over 10 runs) and hex 12×8 a median of **2** (1–4) — no convergence
regression from active islands observed yet. Research continues on the `/generator-debug` page:

- **H1**: the `ambiguousLimit` cap masks the true ambiguity count (progress invisible, patience
  blind). The page's max-ambiguous control exists to investigate; the cap-saturation rule in
  `uniqueIterations` is the current mitigation.
- **H2**: rerolled regions regenerate dense ambiguity (layered boards are intrinsically more
  ambiguous than classic — parallel pipes, multi-layer rearrangements). Partially mitigated by the
  revisit gating.
- **H5 (confirmed, fixed, converged)**: the planReuse claim rule dissolved whole islands for sharing
  a single cell with live or a bigger island. Measured on a 20×20 iteration: 235 of 526 keepable
  sub-cells (45%) conflict-dissolved, all 5 conflicts with live, biggest island 184 sub-cells —
  while registered islands totalled just 9. Fixed by carving conflicting islands around claimed
  cells (see `planReuse` above); post-fix 20×20 squares converge in 3–5 iterations, islands carry
  most of the reused material, and remaining losses (claimed cells, fragments, too-small) are minor.
- **H4**: solver backtracking tail (heavy on large wrapped boards) — see the solver doc.
- ~~H3 (reuse not engaging)~~: the `liveFromBefore` rule and reuse role visualization address the
  reuse side; kept-count behavior still worth watching on big boards.

## Differences vs classic generator at a glance

| Aspect            | classic                         | layered                                             |
| ----------------- | ------------------------------- | --------------------------------------------------- |
| revisit handling  | avoided (merges would loop)     | new layer on revisit, `layeringAmount` gate         |
| branchingAmount   | Prim↔backtracker over frontier | extend-deadend vs branch lists (classic rule broke) |
| fully-connected   | aesthetic demotion              | demotion + hard disregard when not reaching fresh   |
| obvious avoidance | per-tile tileTypes + straights  | not ported (parameter accepted, unused)             |
| reuse             | keepable tiles verbatim         | sub-cell components grown as subtrees, merged       |
| uniqueness loop   | patience over ambiguous counts  | + limit cap, cap-saturation rule                    |
| observability     | progress callbacks              | + `uniqueIterations` snapshots, GrowthMove events   |
