# Layers variant: solver (`LayeredSolver`)

Files: `src/lib/puzzle/solver-layers.js` (`LayeredCell`, `LayeredSolver`) and
`src/lib/puzzle/components-registry.js` (`ComponentsRegistry`, the component registry the solver
drives). Classic counterpart: `solver.js` (`Solver`). Tests: `solver-layers.test.js`; safety nets:
`solver-layers-fuzz.test.js` (solution-equivalence fuzz) and `solver-layers-stats.test.js` (paired
benchmark) — both env-gated, described in the harness section below. Consumers: `Puzzle.svelte`
(solve animation + stats readout), `LayeredGenerator` (uniqueness/patience loop), `worker-layers.js`
and `/generator-debug` (progress messages).

Boards are assumed to have a single connected playable region — grids with disconnected areas are
not supported.

## Core model: possible states

- The decision variable is the **cell rotation**: rotating a cell rotates all its layers at once, so
  a cell has `num_directions` possible states, not a free choice per layer.
- `LayeredCell.possible: Map<rotation, layers[]>` — each state is stored as its smallest
  representative rotation together with the rotated layer masks at that rotation. `buildPossible`
  deduplicates rotations that are indistinguishable up to layer relabeling (same multiset of rotated
  masks), so constraints are tracked per surviving state and any representative rotation can stand
  in for its class.
- Results and steps are expressed in these representative rotations: `solution` holds one rotation
  per cell (`UNSOLVED = -1` while the cell is undecided), `solutions` collects every found solution,
  and `markAmbiguousTiles` marks cells whose rotation differs between solutions with
  `AMBIGUOUS = -2` in its returned array. The propagation generators yield a
  `LayeredStep {index, rotation, final}` per processed cell — the cell index, a rotation that still
  fits the known facts, and whether it is the only one left.
- State sets only ever shrink: the filters delete map entries and never mutate the stored mask
  arrays, so mask arrays are freely shared between a solver and its clones. Several invariants below
  rely on this monotonicity.

## Cell constraints

- `LayeredCell` keeps classic-style direction bitmasks `walls` and `connections` (union over
  layers), same semantics as classic.
- `applyConstraints(weightLimit)` runs per dirty-cell pass:
  1. `mustHaveAllConnections(connections)` — the union of layer masks at the rotation must include
     all known connections;
  2. `mustHaveAllWalls(walls)` — no layer of the rotation may touch a wall;
  3. `mustNotSealDeadends(neighbourDeadends, weightLimit)` — see deadend facts below.

  Empty state set ⇒ `NoOrientationsPossible`.

- From the survivors it derives new facts over the per-rotation union (`unionAt`): directions
  avoided by every surviving union become walls, directions shared by every surviving union become
  connections. Both masks are monotone, so the deltas (`addedWalls`/`addedConnections`) are plain
  numeric subtractions.
- The commented-out `removedCount === 0` early return in `applyConstraints` is unsound as written:
  the deadend derivation depends on `neighbourDeadends`, which can change (an incoming deadend fact)
  without any state dying. Any future fast path must account for that.
- Per-layer helpers complement the union view: `getLayerDefiniteConnections(layerIndex)` (AND over
  surviving states, minus walls), `getLayerPotentialConnections(layerIndex)` (OR over surviving
  states, minus walls), `getAnsweringLayer(direction)` (the unique layer index, or `undefined` when
  none or several answer).
- Birth-time cell data, computed once from the constructor's `possible` and passed down through
  `clone` by reference:
  - `repeatLayersMask` — layers whose masks repeat across rotations.
  - `answerRotations` — per grid direction bit position and layer index, a bitmask of the rotations
    whose mask connects that direction through that layer.
  - `getAnsweringLayersMask` is computed from the table as survivor-mask ANDs per layer, memoized
    per direction until `possible` changes (reference if cloned or size if pruned).

## Deadend facts

The layered generalization of classic's "avoid connecting deadends", taken further: facts are per
direction, carry mass, and propagate through neighbouring cells.

- `LayeredCell` holds two derived masks, each backed by a weight map:
  - `neighbourDeadends` — directions where the neighbour can only answer a connection with a
    deadend-effective layer (or has a wall). `neighbourDeadendWeights: Map<direction, weight>` — how
    many sub-cells hide behind that neighbour's deadend portion (it might be a whole island with one
    free link left).
  - `ownDeadends` — directions where this cell can only answer with a deadend-effective layer.
    `ownDeadendWeights: Map<direction, weight>` — the mass that answering with a deadend there would
    seal; keys are single direction bits.
  - Walls fold into both masks (`addWall` ORs the full `walls` mask into both). A wall direction has
    nothing behind it, so it contributes weight 0.
- **Deadend-effective layer**: a single-connection layer (static `layerPopcounts` — popcount per
  layer at rotation 0; popcounts are rotation-invariant), or a layer whose remaining directions all
  face received `neighbourDeadends` (an effective deadend — this is what lets a fact travel through
  a bend or a corridor of straights).
- `ownDeadendDirections` (getter) derives `ownDeadends`: candidate directions seed from
  `fully_connected & ~walls & ~neighbourDeadends`; a surviving layer that still has ≥ 2 live
  directions (after removing neighbour-deadend-facing ones) clears its live directions from the
  candidate set; a layer with exactly one live direction supports the fact and records a chained
  weight `1 + Σ neighbourDeadendWeights` over its deadend-facing directions into
  `ownDeadendWeights`. The whole derivation is skipped when
  `!(hasDeadends || neighbourDeadends > 0)` — cells without deadend layers can still turn into
  effective deadends once facts arrive (a bend between two deadend neighbours pushes facts out its
  other sides, which is the main propagation power).
- `applyConstraints` re-derives the mask on every pass:
  `addedDeadends = newDeadends & ~ownDeadends & ~newWalls`, then
  `ownDeadends = newDeadends | newWalls`. The `& ~newWalls` exclusion matters: wall directions were
  already pushed to neighbours as wall facts.
- Pruning (`mustNotSealDeadends`): a rotation dies when one of its layers lies fully inside the
  received `neighbourDeadends` (every direction it uses is deadend-facing — answering with it would
  seal this sub-cell plus everything hanging behind it) while
  `getDeadendWeight(layer) = 1 + Σ weights < weightLimit`. The solver passes `totalSubcells` (the
  board's whole sub-cell count) as the limit: when the sealed area equals the whole board, the
  answer may be the final move that completes the tree, so the rotation must survive.
- Weights are upper bounds, kept with `Math.max` on repeat and never retracted — a stale loose
  weight only ever costs a missed pruning, never an unsound one. Exact weights exist in one case:
  island facts (see components below).
- Propagation: when a cell derives `addedDeadends`, the neighbour across each direction is told
  `addNeighbourDeadend(opposite, ownDeadendWeights.get(direction))` and dirtied. Two facing
  deadend-effective sub-cells would seal each other off from the tree together with every deadend
  hanging behind them — hence the ban.
- Known gap: the push can only tell neighbour deadend facts to unsolved cells — there is no way to
  tell a component that one of its slots is now facing a deadend (TODO at the push site in
  `processDirtyCell`).

## Components: slots and sub-cells

The solved board must be one tree over all sub-cells (sub-cell id = `cell + layer * grid.total`, see
`AbstractGrid.subcellId`/`cellLayerOf`). Tree edges are cell-edge pairs — the "at most one layer per
cell+direction" invariant makes `(cell, direction)` a unique key. The crux vs classic: components
often cannot say _which_ sub-cell of a cell joined, because the answering layer is not yet uniquely
determined. Hence components track two kinds of members:

- **Slot** — an unresolved `(cell, direction)` pair, a promise: whichever layer of `cell` ends up
  using `direction` will join the slot's component.
- **Sub-cell member** — resolved; its stored `directions` are the connection directions already
  accounted for in the component.

Components track only their frontier members. Once a slot is resolved to a particular layer the slot
is dropped and the sub-cell of this layer joins the component instead. Once a sub-cell's other
connections are resolved new slots get created on the corresponding neighbours. A fully resolved
sub-cell is dropped as well.

The dropping is load-bearing, not housekeeping. The island shapes below are phrased in live-member
counts (`slotCount === 0 && subcellCount === 0` sealed, `slots === 1 && subcells === 0` one opening,
`slots === 0 && subcells === 1` one member) and only hold while fully resolved members actually
leave — a sealed component would otherwise sit there with `subcellCount > 0` forever and never be
detected. The registry's hot paths also scale with the frontier: merge moves the absorbed's member
lists and fires a loop-avoidance hook per moved member, and `slotMember` scans them linearly — cheap
only while the lists stay boundary-sized. What removal no longer buys in the SoA registry is memory:
member nodes are pooled and never freed (the Map-era entry-release motivation is gone).
Correspondingly, `removeSubcell` deliberately leaves `totalSubcellCount` untouched — the cumulative
mass is what island deadend weights price — and a cleared `subcellOwner` doubles as state: it is
what the next attach decision's `getSubcellComponent === 0` arm reads.

State — the registry lives in `src/lib/puzzle/components-registry.js` (`ComponentsRegistry`, the
split of 2026-09 out of the solver; the SoA perf rewrite it extracted is documented in
`agent-doc/solver-perf-plan.md`). The solver holds it as `this.components` and only says _what
happened_ — a slot resolved, two components met — while the registry decides _how_ it is recorded:
rows, lists, counts and queues are its private bookkeeping, and it is the only writer of its arrays.
Internally it is a struct of typed arrays: a component is an integer id, bump-allocated per solver
and never reused; `0` means "no component", so all component comparisons are integer equality.

Queries (the solver asks state questions): `hasOpenSlots(cell)`,
`getSlotComponent(cell, direction)`, `getSubcellComponent(subcellId)`,
`getSubcellDirections(subcellId, component?)` (the recorded mask, with an optional ownership
assert), `forEachSlot(cell, cb)` (every open slot of the cell exactly once, in ascending numeric
direction order; entries repointed by merges mid-loop are read at visit time), `slotCount(comp)` /
`subcellCount(comp)` / `totalSubcellCount(comp)` and the per-component iterators
`forEachComponentSlot` / `forEachComponentSubcell` (island classification reads these). Beware the
vocabulary: a component's slots at one cell are aggregated into a single record with a direction
bitmask — the record count is not a slot count; `slotCount(comp)` sums masks so it counts slots.
Only `validate()` (fuzz-gated) is allowed to look at records.

Mutations (the solver requests transitions): `create()` (bump-allocated id),
`addSlot(comp, cell, direction)` (open one slot; row entry and per-cell record update together so
the two indexes cannot drift), `attachSubcell(comp, subcellId, direction)` (a slot resolved into a
concrete sub-cell: claim ownership, close the resolved slot, append the member node, bump the
cumulative count), `setSubcellDirections(subcellId, mask)`, `removeSubcell(comp, subcellId)` (fully
determined layer; leaves the cumulative count untouched — island deadend weights depend on it), and
`merge(keep, absorb, subcellId, direction, onSlotCellMoved, onSubcellMoved)`. `merge` does the
direction OR itself (idempotent when the mask already records it), validates the overlap
(`'Invalid merge'` otherwise), closes the row entries it consumes at the merge cell, and **moves**
the absorbed's slots and sub-cell memberships to the survivor — the absorbed ends up empty; its id
is never reused, so a stale reference can never alias a fresh component. (The original Map-based
version copied entries and kept the absorbed object populated; that was measurable as never
influencing decisions — see `scratch/zombie-detector.mjs` and the plan docs — and move semantics is
what keeps the registry's point lookups exact: a live component's member-list keys are exactly the
sub-cells (cells) whose registry entries point at it.) The two callbacks hand each moved member back
to the solver, which binds them once per instance (`mergedSlotCellHook`/`mergedSubcellHook`) so its
loop-avoidance heuristics follow moved members without the registry knowing what avoidance is.

Structural notes: `ND` — the bit width of `grid.DIRECTIONS`, the union of every direction bit any
cell can use — sizes the slot rows, which is what makes mixed grids (octa, rhombitrihexa, trihexa:
cells with different direction subsets of the same global orientations) safe. Watch out: typed
arrays discard out-of-bounds writes silently, so an under-sized row would corrupt lookups without an
error — `dirPos` guards the writers. `clone()` slices all arrays at used length + headroom
(`sliceCapacity`; a plain `slice` on a shorter parent array would silently under-allocate).
`validate()` (called by the fuzz test after full enumerations) asserts the invariants above: row
counts vs `cellSlotCount`, the two-way membership contract for slots and sub-cells, member counts,
and `subcellOwner`/`subcellNode` being zero together.

- `addConnection(index, direction)` runs exactly once per edge, triggered by the `addedConnections`
  delta (the connection pushed into the neighbour makes re-derivation on its side impossible): it
  pushes the opposite connection into the neighbour, dirties it, and does `create()` + two
  `addSlot`s — a fresh component holding a slot pair for the edge.
- `getAnsweringComponent(index, direction)` — the component a connection in `direction` would join:
  the cell's own slot if one is registered (`getSlotComponent`), else — when the neighbour's
  answering layer is unique across surviving states — the neighbour answerer sub-cell's component
  (`getSubcellComponent`, `0` otherwise). Callers exclude directions already known to the cell's own
  resolved sub-cells. Since state sets only shrink, a unique answerer stays unique: slots and
  resolutions are never invalidated.
- `resolveComponents(index, cell)` runs on every stabilization pass of a dirty cell:
  1. **Slot resolution**: `forEachSlot` walks the cell's open slots; each one whose answering layer
     became unique (`getAnsweringLayer`) either `attachSubcell`s (join + island queue), throws
     `LoopDetectedException` when the sub-cell is already in the same component (two certain edges
     of one sub-cell into one component is a cycle in every solution), or `merge`s when it sits in
     another one — the survivor's component, the slot's component absorbed.
  2. **Sub-cell resolution**: for each own sub-cell already in a component, newly definite per-layer
     connections (`getLayerDefiniteConnections`) are recorded via `setSubcellDirections` and create
     slots on the neighbours (`addSlot`) — same join/loop/merge trichotomy on the neighbour side
     (the `merge`'s OR is an idempotent no-op there), and the creating cell gets an immediate
     `avoidSlotLoops` rescan (a new slot can complete a bridge). A fully determined sub-cell
     (`popcount(connections) === layerPopcounts[layer]`) is dropped via `removeSubcell`.
  3. `pruneLoop` (loop-avoidance scan for this cell).
- **Loop avoidance** — facts are queued in `avoidLoopQueue` as `[cell, layerIndex|null, directions]`
  and flushed right after `resolveComponents` (prunings must not run mid-resolution, merges queue
  more of them):
  - `avoidSubcellLoops` — for a sub-cell in a component, every further direction whose answering
    component is the same one queues `forbidLayerConnection(layerIndex, direction)`: a second edge
    from one sub-cell into its own component is a loop.
  - `avoidSlotLoops` — cell-level: collects directions whose answering component is the same; with ≥
    2 of them queues `forbidLayerBridge(directions)`, deleting every rotation where a single layer
    bridges two of the directions.
- **Islands** — island checks are puzzle policy, so they stay in the solver: component ids whose
  open ends changed are queued in a plain `Set` (`this.islandChecks`, same add/delete/clear
  discipline the typed-array queue had), flushed after `resolveComponents`; the classification reads
  `slotCount`/`subcellCount`/`totalSubcellCount` and iterates members through the registry:
  - open ends exhausted (`slotCount === 0 && subcellCount === 0`) while the component's mass is
    below the board's sub-cell total ⇒ `IslandDetectedException` — a sealed component can never gain
    another edge;
  - exactly one open slot (one slot is one direction — the count subsumes the old popcount guard):
    the hosting cell gets an exact-weight deadend fact (`weight = totalSubcellCount`, exact at this
    point) — answering that direction with a deadend would seal the whole component;
  - one sub-cell member left: its cell gets the same fact per known connection direction, carrying
    `totalSubcellCount - 1` on the first direction only (don't double-count the island; it doesn't
    matter which direction carries the weight);
  - 2+ slot directions into one cell are **not handled** — one escaping strand suffices, and the
    deadend machinery treats facts as independent; implementing this is future work.
- There is no global edge counter or budget: completion relies on every cell finalizing plus the
  island check and the local loop checks.

## Propagation loop

`processDirtyCell(index)` loops `while (dirty.has(index))` — pushes can re-dirty the cell itself —
and per stabilization pass:

1. `applyConstraints(totalSubcells)` → `{addedWalls, addedConnections, addedDeadends}`;
2. wall deltas push opposite walls into neighbours unconditionally (empty neighbours skipped);
   connection deltas call `addConnection` per direction; deadend deltas push neighbour deadend facts
   (guarded, see the gap above);
3. `resolveComponents(index, cell)`;
4. flush `avoidLoopQueue` (each pruning that removed rotations re-dirties its cell), then flush the
   island queue (may throw `IslandDetectedException`); both queues cleared.

After stabilization: `final = possible.size === 1` — the winning rotation goes into `solution`, the
cell leaves `unsolved`, `totalUnsolved -= 1`; a `{index, rotation, final}` step is returned
(`processDirtyCells` yields the steps while the dirty set lasts).

`processInitialDeductions` (start of every solve/marking run) counts `totalSubcells` (Σ layer counts
over playable cells), dirties empty cells, then initializes playable cells one by one, draining
propagation between inits and skipping empty-cell steps in the yield stream. Local deductions at
cell init are outer walls and walls from empty neighbours. Every cell is dirtied at init so it can
tell its deadend facts to neighbours. Classic's hexa/octa tileTypes tricks could be applied here
too, but with layers the implementation gets more complicated — a deliberate skip for now. Classic's
deadend-only init filter is superseded by the deadend facts. Gotcha: `totalUnsolved` counts
**cells** and starts at `grid.total` (empty cells finalize during init), `totalSubcells` counts
**sub-cells** of playable cells — different quantities with similar names.

Completion is `totalUnsolved === 0` — never `unsolved.size === 0`: `unsolved` only holds touched
cells under lazy cloning (see search).

## Search

- `solve(allSolutions)`: a stack of trials, each trial a cloned solver. Stages yielded: `initial`,
  `guess`, `aftercheck`. The exception types (`NoOrientationsPossible`, `LoopDetected`,
  `IslandDetected`) pop the trial; backtracking deletes the guessed rotation from the parent cell
  and re-dirties it. `this.solution` is assigned from `solutions[0]` only after the search ends —
  during the search `this.solution` must keep its `UNSOLVED` markers for the resurrection guard and
  for guessing.
- `clone()`: copies `solution` and `totalSubcells`/`totalUnsolved`, and clones the component
  registry eagerly (`parent.components.clone()` — fixed inverse indexes whole, growable
  columns/lists at used length + headroom; a plain `slice` on a shorter parent array would silently
  under-allocate, and typed arrays discard out-of-bounds writes) — while **cells are cloned
  lazily**: the first `getCell` touch walks up the parent chain, clones the parent's cell and skips
  `doLocalDeductions` (facts are inherited). `stats` is shared by reference with the parent, so
  counters accumulate across the whole trial tree: `iterations`, `trialClones`, `shortTrials`,
  `dirtyProcessings`.
- `makeAGuess(marked)`: MRV over `solution[]` entries — **not** `unsolved`, which is incomplete
  under lazy cloning — skipping solved and `AMBIGUOUS`-marked cells, early exit at 2, first
  candidate rotation as the value. Returns `[-1, 0]` when no candidate remains.
- `doShortTrials(marked)` (root trial of `markAmbiguousTiles` only): probes each candidate rotation
  on a clone; a contradiction deletes that rotation from the real cell and re-dirties it.
  Round-robins the start cell via `shortTrialsIndex`; a `tested` set skips (cell, rotation) pairs
  already finalized by earlier probes in the same sweep.

## `markAmbiguousTiles(ambiguousTilesLimit = 0)`

- Same contract as classic: search for solutions; cells whose representative rotation differs
  between solutions become `AMBIGUOUS`. Returns `{marked, solvable, unique, numAmbiguous}`; `marked`
  holds rotations with `UNSOLVED`/`AMBIGUOUS` sentinels in place, and `solvable` is false only when
  `UNSOLVED` cells remain.
- Initial deductions first (unsolvable ⇒ early return). The root trial additionally runs
  `doShortTrials` on every iteration until it stops finding anything.
- Guessing goes through `makeAGuess(marked)`, so ambiguous cells are skipped as guess candidates.
  When only ambiguous cells remain (`index === -1`), the current solver is declared solved
  (`totalUnsolved = 0`) and fed into the solution-comparison branch. This overcounts further
  ambiguities once a first set of them is found, but the false positives never affect `unique` (they
  can only appear after the first set), and completing the full search instead is several times
  slower — a decided trade-off (see the long comment in the code).
- `ambiguousTilesLimit > 0` early-returns once that many ambiguities are known.
- `progress_callback` reports `SolverProgress {total, solved, guessed, ambiguous}`; the generator
  forwards these as worker progress messages.

## Fuzz and benchmark harnesses

Both harnesses compare the current solver against a frozen snapshot copy of this same file (their
failure messages say how to recreate the snapshot after a fresh clone); snapshot mismatches mean the
solver's behaviour changed. As of the 2026-09 SoA registry rewrite the current solver is
**intentionally decision-shifted** vs the snapshot: work counters and occasional `numAmbiguous`
values move, while `solvable`/`unique` and full solution lists still agree (gated per
`agent-doc/solver-perf-plan.md`).

- `solver-layers-fuzz.test.js` — the soundness gate for any solver change. Run with
  `FUZZ_SOLUTIONS=1` (reproducible board sequence via `FUZZ_SEED`): on fresh boards, the full
  `solve(true)` solution list must match the snapshot's, every solution must pass `validateLayers`,
  and `markAmbiguousTiles` must report unique boards exactly. The current solver's
  `ComponentsRegistry.validate()` runs after each full enumeration and each unique-board marking,
  asserting the registry's structural invariants. Failing boards are saved as JSON reproducers into
  `generator_stats/`.
- `solver-layers-stats.test.js` — paired benchmark. Run with `BENCH_MARK_AMBIGUOUS=1` (`BENCH_SEED`
  for a reproducible sequence, `BENCH_MARK_AMBIGUOUS_RUNS` / `BENCH_MARK_AMBIGUOUS_CAP_MS` tune it):
  every fresh board runs through the snapshot and the current solver back-to-back; verdict
  disagreements (`solvable`/`unique`) are soundness red flags, while work-counter and `numAmbiguous`
  mismatches are recorded as agreement flags — expected to change when the candidate intentionally
  alters solver decisions. Output lands in `generator_stats/`.
- The shared `stats` counters (`iterations`, `trialClones`, `shortTrials`, `dirtyProcessings`)
  accumulate across each trial tree and are the deterministic work metric to compare between
  variants.

## Differences vs classic Solver at a glance

| Aspect           | classic                        | layered                                                                                |
| ---------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| cell state       | set of orientation masks       | map of representative rotation → rotated layers                                        |
| identity         | cell index                     | cell for constraints, sub-cell for the tree                                            |
| deadends         | static tile-type check at init | per-direction facts with weights, chained through cells, exact-weight island facts     |
| loop detection   | component walls + merge check  | slot/sub-cell components: join-time loop checks, per-layer forbid queues, island check |
| solved cells     | eager, `unsolved` is complete  | lazy cloning, `totalUnsolved` counter, completion by count                             |
| local deductions | tileTypes hexa tricks          | outer walls only (hexa/octa tricks skipped: harder with layers, fewer useful hits)     |
