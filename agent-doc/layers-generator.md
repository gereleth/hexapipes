# Layers variant: generator (`pregenerate_layers`, `LayeredGenerator`)

Files: `src/lib/puzzle/generator-layers.js`, `src/lib/puzzle/worker-layers.js` (web worker),
`src/routes/custom/+page.svelte` + `LayeredGeneratorComponent.svelte` (UI wiring),
`/generator-debug` (research tooling, no nav link). Classic counterpart: `generator.js`
(`pregenerate_growingtree`, `Generator`). Tests: `generator-layers.test.js` (pregeneration,
scrambling, startLayers reuse, `LayeredGenerator` modes, worker smoke tests, growth-event mirroring,
`uniqueIterations`). Run: `npx vitest run src/lib/puzzle/generator-layers.test.js`.

## `pregenerate_layers(grid, layeringAmount, branchingAmount, avoidObvious, startLayers, reuseMinCount, onMove)`

Dispatcher over two growth strategies, both producing a single spanning tree over all sub-cells: a
`startLayers` array of the right length with at least one reusable (non-null) cell runs the
single-tree growth with island absorption (`pregenerate_layers_growthtree`, described in this
section and the reuse section below); everything else — fresh boards — runs the experimental
multi-subtree growth (`pregenerate_layers_multitree`, own section below). The single-tree strategy:

GrowingTree maze growth over cells, but the growing frontier is split by the kind of growth a cell
offers (see `branchingAmount` below). Layers variant twists:

- Moves are `(existing layer, free direction)` pairs of the source cell. Growing into an
  **unvisited** cell pushes a fresh layer there (the back direction); growing into a **visited**
  cell adds a _new layer_ to it — revisiting is how the board becomes layered (merging would close a
  cycle). Since every move attaches exactly one new leaf sub-cell to the source layer, tree shape is
  decided by the source layer's degree: growing a deadend layer (≤ 1 connection) extends a path,
  growing a busier layer (≥ 2) forks the tree.
- `layeringAmount` (default `0.6`): per-direction probability of _allowing_ a move into an
  already-visited cell. `0` ⇒ every move reaches a fresh cell ⇒ a classic single-layer tree (exactly
  one layer per playable cell). Fully plumbed: `LayeredGenerator.generate` / `uniqueIterations` take
  it as their **first** parameter, `GeneratorOptions.layeringAmount` (optional, default 0.6) flows
  through `worker-layers.js` (`generate`, `debug-start`, `growth-start`), and both UIs expose a
  slider (custom puzzle page — shown only when the Layered checkbox is on — and `/generator-debug`).
- `branchingAmount`: per-move roll selecting which frontier list to grow from (and which layer to
  grow when the picked cell hosts both kinds). The lists are capability sets: `extending` holds
  cells hosting a deadend layer, `branching` cells hosting a branched layer (≥ 2 connections), and a
  cell with both belongs to **both lists at once** (synced by `updateFrontier`; pop/demote remove
  from both). Low values pick from `extending`, so growth extends paths (long corridor-like boards).
  High values pick from `branching`, attaching leaves mid-path (Prim-like spread). If the rolled
  list is empty, the other one is used, then the demotion tiers — leftover branch fallbacks are
  expected at high values on dense boards (enclosed cells pop out on layering-gate failures,
  fully-connected-demoted cells sit in tiers), they mean no cell currently offers a good branch
  move. Picks are random in both lists (no LIFO backtracking). Measured deadend-sub-cell ratios
  (layering 0.6): square 7×7 ≈ 27% at 0 vs ≈ 40% at 1 (classic: 14%/29%), hex 5×4 ≈ 18% vs ≈ 62%
  (classic: 22%/40%); 15×15 similar (square 29%/40%, hex 20%/63%); asserted by the
  `branchingAmount knob` tests. A direct port of the classic pick rule was broken here: revisit
  moves keep cells on the frontier until all their directions are consumed, so the classic "newest
  cell" tip just ground out revisit moves in its local area instead of backtracking, and the knob
  did almost nothing (old numbers: 29% vs 36% square, 43% vs 47% hex). An earlier version of the
  split used a single list per cell ("deadend present ⇒ extending"), which hid dual cells from
  branch rolls: with pure-branched cells scarce, ~half of all branch rolls at b=1 fell back to the
  extending list.
- Direction choice is layer-independent (a free direction is free for **every** layer of the cell —
  per-cell disjointness), so directions are picked first (uniformly from the best bucket) and the
  layer is picked **afterwards**, matching the rolled growth kind, falling back to the other kind
  when the cell hosts no such layer.
- Frontier tiers, picked in order `extending/branching (by roll) > avoiding > lastResort`:
  - fully-connected moves (source or neighbour union would become `polygon.fully_connected`; skipped
    on triangular grids) and obvious moves (below) are demoted: the cell is moved out of
    `extending`/`branching` into `avoiding`/`lastResort` and other cells are tried first.
  - **Moves that would make the source or neighbour fully connected/obvious while reaching an
    already-visited cell are disregarded outright** (`continue`), not demoted. So a demoted move
    always reaches unvisited cells — demotion is pure progress, never a wasteful pure revisit. (This
    replaced an earlier design where demoted revisits competed in the same tier.)
- `avoidObvious`: forbidden union masks per border cell, computed inline from `polygon.tileTypes`
  str-groups (shape orientations forced by that cell's walls — shapes with a single wall-respecting
  orientation). Checked for both the source cell and the neighbour, and gated per move by
  `Math.random() < avoidObvious`. Not yet wired: classic's avoidStraights.
- Assertions: a neighbour never already connects back in the moved-to direction; no frontier cells
  left while unvisited cells remain. Moves into unvisited cells are never gated or disregarded
  (every skip path assumes a visited neighbour), so a frontier cell bordering one always has a legal
  move and cannot pop — the no-frontier assertion can only fire for a **disconnected playable
  region**, and that is exactly what it is for: **boards with disconnected areas are not supported**
  by the generator, the solver or the game.

Quirks: demotion re-checks a cell's moves when picked, so a demoted cell whose unions changed can
classify for the _other_ tier and moves there cleanly. Pop/demote remove the cell from **all four**
lists (primary + demotion tiers), so no stale twins or duplicate tier entries can accumulate — and a
popped tier cell leaves the frontier permanently, which is sound because a stuck cell's situation is
monotone: its own used bits never shrink and neighbour used bits only grow, so
fully-connected/obvious disregards can never turn back into legal moves. History: pop used to clear
only the primary lists, so a tier cell whose remaining moves were all disregarded was picked and
popped forever — a deterministic infinite spin (one `pop` event per iteration, board untouched) hit
on ~17% of fresh 20×20 draws with `avoidObvious > 0`; it needed `avoidObvious` because the
disregarded-move tiers only exist then, and it silently froze `pregenerate_layers` instead of
reaching the no-frontier throw (the lists never emptied). The all-lists pop fixed the spin; the
no-frontier throw remains the correct failure mode and stays unreachable on connected boards (a
frontier cell adjacent to an unvisited cell always has at least one non-gated, non-disregarded
candidate move, so it can never pop).

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

During growth: entering an unvisited island cell **absorbs** the whole island by _extending one of
the island's existing layers_ with the back direction (`layers[neighbour][0] |= back`) — pushing a
fresh layer would NOT connect to the island (layers never interconnect within a cell). Legal because
the neighbour-connects-back assertion guarantees the direction is free in every layer, and move
classification already evaluated that exact union. Absorbed cells join `liveFromBefore` (below). By
loop termination every registered island must have been absorbed (island cells leave `unvisited`
only via absorption) — deterministic assertion for tests.

**`liveFromBefore` rule**: growth moves where _both_ endpoints are reused cells (live seed or
absorbed island) are skipped — "don't break what we reused". Kept regions stay exactly as the
previous solver iteration certified them; new layers can only attach to them from outside.

If no live seed exists (fresh board or nothing keepable), the start cell is chosen uniformly at
random from `unvisited` and seeded with a zero layer.

### Multi-subtree growth of fresh boards (experiment, `pregenerate_layers_multitree`)

Runs whenever `startLayers` has no reusable cell (empty, all-null, or wrong-length).
`min(playable, max(3, floor(total / 50)))` subtrees grow simultaneously (`subtreeCountFor`: three on
small boards, one more per 50 tiles), each seeded on a distinct random cell, each growing like a
classic GrowingTree with per-subtree `extending`/`branching` frontier lists (same `branchingAmount`
roll and corridor-vs-spread semantics as the single tree) plus a per-subtree `lastResort` tier for
fully-connected demotion. Differences to the single tree:

- **Edges are exclusive across subtrees**: a subtree never carves an edge another subtree took. A
  layer bitmask bit _is_ the edge to the neighbour, so per-edge exclusivity directly yields the
  per-cell "at most one layer per direction" invariant — no separate bookkeeping needed.
- A subtree enters a cell at most once and owns **exactly one layer per cell it occupies**
  (`layerAt` map). Entering a cell another subtree occupies pushes a fresh layer (a new sub-cell for
  the entering subtree) — that is how layers form; gated per direction by `layeringAmount` like
  revisit moves above (unvisited cells are always allowed). Own cells are never re-entered (that
  would close a cycle within the subtree).
- Frontier kind is unambiguous per subtree (its single layer's degree decides), so the legacy
  layer-picking step disappears. Demotion to `lastResort` is permanent (tier cells are not re-synced
  into primary after moving), mirroring `updateFrontier`'s early return.
- **Stop condition: every playable cell visited by some subtree** — not by every subtree. Dead
  subtrees (empty frontier lists) are skipped.
- **Opening round**: right after seeding, every subtree makes one forced expansion into an unvisited
  neighbour (random order per attempt, skipped when a seed has no unvisited neighbour, on tiny
  boards). Without it a subtree could lose the opening race — never picked while its seed cell gets
  saturated by a busy co-tenant — and sit out the whole game as a never-grown mask-0 seed, easily
  sealed off from every merge connection (each expansion into an unvisited cell may spend a mixed
  cell's last in-board spare, see below). Targets are unvisited only and ungated, so
  `layeringAmount 0` keeps its meaning.
- **Spare-direction rule**: a _mixed_ cell (hosting several subtrees, tracked in `owners` aligned
  with the cell's layer indices) must always keep a **spare in-board** free direction — layering
  entries need ≥ 2 in-board free directions at the target, and non-expansion growth out of a mixed
  cell needs ≥ 2 too. Expansion into unvisited cells is always allowed (blocking it would wall off
  unvisited pockets behind frozen mixed cells). This keeps the components' free-edge graph connected
  at stop time, which is what the merge phase needs. Two failure classes remain possible on dense
  boards (an unvisited pocket walled in by frozen mixed cells; a grown subtree whose every boundary
  cell got drained to zero spares) — both are random and rare, so **a failed attempt is simply
  retried on a fresh board** (`pregenerate_layers_multitree_attempt`, up to 20 tries); only the
  successful attempt's events are reported, keeping event replays exact.
- **Merge phase**: union-find over subtrees; while more than one component exists, collect free
  edges between cells hosting different components and carve one at random, attaching the two cells'
  layers owned by the respective components. Exactly `subtreeCount − 1` merges, no loops
  (same-component pairs excluded). Each merge (except the last) is only taken if the remaining
  components stay connected through free edges — consuming a shared bridge edge could otherwise
  strand a component. Fully-connected-making merge unions are a last resort (normal candidates
  preferred, as during growth).
- `avoidObvious` and `reuseMinCount` are ignored by this strategy (no border demotion tiers, no
  islands); `layeringAmount 0` keeps the subtrees disjoint, and the merges alone turn the result
  into a classic one-layer-per-cell board. Measured (default knobs, 20 boards): 10×10 squares (3
  subtrees) end at ~1.16 sub-cells/cell (~16% multi-layer cells), hex 7×6 (3 subtrees) at ~1.50
  (~45% multi-layer), 20×20 squares (8 subtrees) at ~1.21 (~21%) — the in-board spare rule caps
  interpenetration on 4-direction cells, and smaller subtree counts mean fewer cross-tree entries.
  The `branchingAmount` knob still shifts deadend ratios (square 21%→35%, hex 19%→48% for b=0→1).

Event stream: `seed` per subtree, `move` per growth move, `merge` events (bits set on **both**
endpoints' existing layers — no layer is pushed), `demote`/`pop` bookkeeping. The merge event
carries `neighbourLayerIndex` in addition to the move fields.

### `GrowthMove` events

`onMove` callback mirrors every board mutation exactly (`seed`/`move`/`absorb`, and `merge` on the
multi-subtree strategy); `demote`/`pop` are frontier bookkeeping without board effects. `erase` is
still in the typedef (and handled by the debug page) but currently never emitted — its only emitter,
an island-dissolve fallback, was removed. Event-mirroring fidelity is asserted by tests (apply
events == returned tiles). History: the single-tree strategy's `seed` events used to pass the reused
cell's layer array **by reference** — a later push onto that cell mutated the already-emitted
payload, so replays double-counted the push (found via the multi-subtree-era replay tests; seed
events now snapshot).

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
  a `growth-move` message per `GrowthMove` event, then `growth-done`.
  `options.strategy: 'single-tree'` bypasses the dispatcher and runs the legacy growth on a fresh
  board (the debug page's strategy select — for A/B-watching the two growth algorithms; note the
  "grow from survivors" checkbox only has an effect from iteration 2 onward, the first iteration has
  no survivors by definition).

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
2. `liveFromBefore` blocks new growth between reused cells, so kept regions keep their exact
   certified shape;
3. `layeringAmount` gates revisits probabilistically (default 0.6).

4. `planReuse` carves conflicting islands around claimed cells instead of dissolving them (the H5
   fix, see `planReuse` above).

Empirically a 20×20 square now converges to unique in **3–5 iterations** (was 10–50 before the carve
fix, ~1 h of pinned iterations before the earlier growth-side fixes). Research continues on the
`/generator-debug` page:

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
| obvious avoidance | per-tile tileTypes + straights  | union-based forbidden sets; straights not ported    |
| reuse             | keepable tiles verbatim         | sub-cell components: live seed + dormant islands    |
| uniqueness loop   | patience over ambiguous counts  | + limit cap, cap-saturation rule                    |
| observability     | progress callbacks              | + `uniqueIterations` snapshots, GrowthMove events   |
