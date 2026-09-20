# Layers variant: solver (`LayeredSolver`)

Files: `src/lib/puzzle/solver-layers-alt.js` (`LayeredCell`, `LayeredSolver`). Classic
counterpart: `solver.js` (`Solver`). Tests: `solver-layers-alt.test.js`; safety nets:
`solver-layers-alt-fuzz.test.js` (solution-equivalence fuzz) and
`solver-layers-stats.test.js` (paired benchmark) — both env-gated, described in the
harness section below. Consumers: `Puzzle.svelte` (solve animation +
stats readout), `LayeredGenerator` (uniqueness/patience loop), `worker-layers.js` +
`/generator-debug` (progress messages).

Boards are assumed to have a single connected playable region — grids with disconnected
areas are not supported.

## Core model: possible states

- The decision variable is the **cell rotation**: rotating a cell rotates all its layers at
  once, so a cell has `num_directions` possible states, not a free choice per layer.
- `LayeredCell.possible: Map<rotation, layers[]>` — each state is stored as its smallest
  representative rotation together with the rotated layer masks at that rotation.
  `buildPossible` deduplicates rotations that are indistinguishable up to layer relabeling
  (same multiset of rotated masks), so constraints are tracked per surviving state and any
  representative rotation can stand in for its class.
- Results and steps are expressed in these representative rotations: `solution` holds one
  rotation per cell (`UNSOLVED = -1` while the cell is undecided), `solutions` collects
  every found solution, and `markAmbiguousTiles` marks cells whose rotation differs
  between solutions with `AMBIGUOUS = -2` in its returned array. The propagation
  generators yield a `LayeredStep {index, rotation, final}` per processed cell — the cell
  index, a rotation that still fits the known facts, and whether it is the only one left.
- State sets only ever shrink: the filters delete map entries and never mutate the stored
  mask arrays, so mask arrays are freely shared between a solver and its clones. Several
  invariants below rely on this monotonicity.

## Cell constraints

- `LayeredCell` keeps classic-style direction bitmasks `walls` and `connections` (union
  over layers), same semantics as classic.
- `applyConstraints(weightLimit)` runs per dirty-cell pass:
  1. `mustHaveAllConnections(connections)` — the union of layer masks at the rotation must
     include all known connections;
  2. `mustHaveAllWalls(walls)` — no layer of the rotation may touch a wall;
  3. `mustNotSealDeadends(neighbourDeadends, weightLimit)` — see deadend facts below.

  Empty state set ⇒ `NoOrientationsPossible`.

- From the survivors it derives new facts over the per-rotation union
  (`unionAt`): directions avoided by every surviving union become walls, directions shared
  by every surviving union become connections. Both masks are monotone, so the deltas
  (`addedWalls`/`addedConnections`) are plain numeric subtractions.
- The commented-out `removedCount === 0` early return in `applyConstraints` is unsound as
  written: the deadend derivation depends on `neighbourDeadends`, which can change (an
  incoming deadend fact) without any state dying. Any future fast path must account for
  that.
- Per-layer helpers complement the union view: `getLayerDefiniteConnections(layerIndex)`
  (AND over surviving states, minus walls), `getLayerPotentialConnections(layerIndex)` (OR
  over surviving states, minus walls), `getAnsweringLayers(direction)` (candidate layer
  indices across all surviving states).

## Deadend facts

The layered generalization of classic's "avoid connecting deadends", taken further: facts
are per direction, carry mass, and propagate through neighbouring cells.

- `LayeredCell` holds two derived masks, each backed by a weight map:
  - `neighbourDeadends` — directions where the neighbour can only answer a connection with
    a deadend-effective layer (or has a wall). `neighbourDeadendWeights:
Map<direction, weight>` — how many sub-cells hide behind that neighbour's deadend
    portion (it might be a whole island with one free link left).
  - `ownDeadends` — directions where this cell can only answer with a deadend-effective
    layer. `ownDeadendWeights: Map<direction, weight>` — the mass that answering with a
    deadend there would seal; keys are single direction bits.
  - Walls fold into both masks (`addWall` ORs the full `walls` mask into both). A wall
    direction has nothing behind it, so it contributes weight 0.
- **Deadend-effective layer**: a single-connection layer (static `layerPopcounts` —
  popcount per layer at rotation 0; popcounts are rotation-invariant), or a layer whose
  remaining directions all face received `neighbourDeadends` (an effective deadend — this
  is what lets a fact travel through a bend or a corridor of straights).
- `ownDeadendDirections` (getter) derives `ownDeadends`: candidate directions seed from
  `fully_connected & ~walls & ~neighbourDeadends`; a surviving layer that still has ≥ 2
  live directions (after removing neighbour-deadend-facing ones) clears its live
  directions from the candidate set; a layer with exactly one live direction supports the
  fact and records a chained weight `1 + Σ neighbourDeadendWeights` over its
  deadend-facing directions into `ownDeadendWeights`. The whole derivation is skipped when
  `!(hasDeadends || neighbourDeadends > 0)` — cells without deadend layers can still turn
  into effective deadends once facts arrive (a bend between two deadend neighbours pushes
  facts out its other sides, which is the main propagation power).
- `applyConstraints` re-derives the mask on every pass:
  `addedDeadends = newDeadends & ~ownDeadends & ~newWalls`, then
  `ownDeadends = newDeadends | newWalls`. The `& ~newWalls` exclusion matters: wall
  directions were already pushed to neighbours as wall facts.
- Pruning (`mustNotSealDeadends`): a rotation dies when one of its layers lies fully
  inside the received `neighbourDeadends` (every direction it uses is deadend-facing —
  answering with it would seal this sub-cell plus everything hanging behind it) while
  `getDeadendWeight(layer) = 1 + Σ weights < weightLimit`. The solver passes
  `totalSubcells` (the board's whole sub-cell count) as the limit: when the sealed area
  equals the whole board, the answer may be the final move that completes the tree, so the
  rotation must survive.
- Weights are upper bounds, kept with `Math.max` on repeat and never retracted — a stale
  loose weight only ever costs a missed pruning, never an unsound one. Exact weights exist
  in one case: island facts (see components below).
- Propagation: when a cell derives `addedDeadends`, the neighbour across each direction is
  told `addNeighbourDeadend(opposite, ownDeadendWeights.get(direction))` and dirtied. Two
  facing deadend-effective sub-cells would seal each other off from the tree together with
  every deadend hanging behind them — hence the ban.
- Known gap: the push can only tell neighbour deadend facts to unsolved cells — there is
  no way to tell a component that one of its slots is now facing a deadend (TODO at the
  push site in `processDirtyCell`).

## Components: slots and sub-cells

The solved board must be one tree over all sub-cells (sub-cell id =
`cell + layer * grid.total`, see `idOf`/`indexLayerOf`). Tree edges are cell-edge pairs —
the "at most one layer per cell+direction" invariant makes `(cell, direction)` a unique
key. The crux vs classic: components often cannot say _which_ sub-cell of a cell joined,
because the answering layer is not yet uniquely determined. Hence components track two
kinds of members:

- **Slot** — an unresolved `(cell, direction)` pair, a promise: whichever layer of `cell`
  ends up using `direction` will join the slot's component.
- **Sub-cell member** — resolved; its stored `directions` are the connection directions
  already accounted for in the component.

Components track only their frontier members. Once a slot is resolved to a particular
layer the slot is dropped and the sub-cell of this layer joins the component instead. Once
a sub-cell's other connections are resolved new slots get created on the corresponding
neighbours. A fully resolved sub-cell is dropped as well.

State:

- `LayeredComponent {subCells: Map<subCellId, directions>, slots: Map<cellIndex,
directions>, totalSubcells}` — `totalSubcells` counts resolved sub-cell members only
  (the sealed mass for island checks).
- `slotComponents: Map<cell, Map<direction, component>>` — the cell's open slot ends.
- `subcellComponents: Map<subCellId, component>` — resolved memberships.
- `addConnection(index, direction)` runs exactly once per edge, triggered by the
  `addedConnections` delta (the connection pushed into the neighbour makes re-derivation
  on its side impossible): it pushes the opposite connection into the neighbour, dirties
  it, and creates a fresh component holding a slot pair for the edge.
- `getAnsweringComponent(index, direction)` — the component a connection in `direction`
  would join: the cell's own slot if one is registered, else — when the neighbour's
  answering layer is unique across surviving states — the neighbour answerer sub-cell's
  component (`undefined` otherwise). Callers exclude directions already known to the
  cell's own resolved sub-cells. Since state sets only shrink, a unique answerer stays
  unique: slots and resolutions are never invalidated.
- `resolveComponents(index, cell)` runs on every stabilization pass of a dirty cell:
  1. **Slot resolution**: each own slot whose answering layer became unique swaps the slot
     for the answering sub-cell — join (register + `totalSubcells += 1` + island queue),
     `LoopDetectedException` when the sub-cell is already in the same component (two
     certain edges of one sub-cell into one component is a cycle in every solution), or
     `mergeComponents` when it sits in another one.
  2. **Sub-cell resolution**: for each own sub-cell already in a component, newly definite
     per-layer connections (`getLayerDefiniteConnections`) create slots on the neighbours
     — same join/loop/merge trichotomy on the neighbour side, and the creating cell gets
     an immediate `avoidSlotLoops` rescan (a new slot can complete a bridge).
  3. `pruneLoop` (loop-avoidance scan for this cell).
- `mergeComponents(subcellComponent, slotComponent, subCellId)` — merges the slot-side
  component into the sub-cell-side one (argument order matters; the sub-cell component
  survives): consumes the shared slot directions, adds up `totalSubcells`, re-keys all
  absorbed slots and sub-cells, and rescans loop avoidance locally (`avoidSlotLoops` per
  absorbed slot end, `avoidSubcellLoops` per absorbed sub-cell).
- **Loop avoidance** — facts are queued in `avoidLoopQueue` as
  `[cell, layerIndex|null, directions]` and flushed right after `resolveComponents`
  (prunings must not run mid-resolution, merges queue more of them):
  - `avoidSubcellLoops` — for a sub-cell in a component, every further direction whose
    answering component is the same one queues
    `forbidLayerConnection(layerIndex, direction)`: a second edge from one sub-cell into
    its own component is a loop.
  - `avoidSlotLoops` — cell-level: collects directions whose answering component is the
    same; with ≥ 2 of them queues `forbidLayerBridge(directions)`, deleting every rotation
    where a single layer bridges two of the directions. Solved layers (same mask across
    all surviving rotations) and directions already known for own resolved sub-cells are
    subtracted first, so a forced direction of a solved layer can never be forbidden (that
    would kill all rotations of a cell whose neighbour is already solved).
- `pruneLoop` skips cells with a single surviving rotation.
- **Islands** — components are queued in `avoidIslandQueue` when their open ends change,
  flushed after `resolveComponents`:
  - open ends exhausted (`slots.size === 0 && subCells.size === 0`) while the component's
    mass is below the board's sub-cell total ⇒ `IslandDetectedException` — a sealed
    component can never gain another edge;
  - one slot end left with a single direction: the hosting cell gets an exact-weight
    deadend fact (`weight = component.totalSubcells`, exact at this point) — answering
    that direction with a deadend would seal the whole component;
  - one sub-cell member left: its cell gets the same fact per known connection direction,
    carrying `totalSubcells - 1` on the first direction only (don't double-count the
    island; it doesn't matter which direction carries the weight);
  - 2+ slot directions into one cell are **not handled** — one escaping strand suffices,
    and the deadend machinery treats facts as independent; implementing this is future
    work.
- There is no global edge counter or budget: completion relies on every cell finalizing
  plus the island check and the local loop checks.

## Propagation loop

`processDirtyCell(index)` loops `while (dirty.has(index))` — pushes can re-dirty the cell
itself — and per stabilization pass:

1. `applyConstraints(totalSubcells)` → `{addedWalls, addedConnections, addedDeadends}`;
2. wall deltas push opposite walls into neighbours unconditionally (empty neighbours
   skipped); connection deltas call `addConnection` per direction; deadend deltas push
   neighbour deadend facts (guarded, see the gap above);
3. `resolveComponents(index, cell)`;
4. flush `avoidLoopQueue` (each pruning that removed rotations re-dirties its cell), then
   flush `avoidIslandQueue` (may throw `IslandDetectedException`); both queues cleared.

After stabilization: `final = possible.size === 1` — the winning rotation goes into
`solution`, the cell leaves `unsolved`, `totalUnsolved -= 1`; a
`{index, rotation, final}` step is returned (`processDirtyCells` yields the steps while
the dirty set lasts).

`processInitialDeductions` (start of every solve/marking run) counts `totalSubcells`
(Σ layer counts over playable cells), dirties empty cells, then initializes playable cells
one by one, draining propagation between inits and skipping empty-cell steps in the yield
stream. Local deductions at cell init are outer walls from empty neighbours only. Classic's
hexa/octa tileTypes tricks could be applied here too, but with layers the implementation
gets more complicated while the set of boards where they yield useful conclusions shrinks —
a deliberate skip for now. Classic's deadend-only init filter is superseded by the deadend
facts. Gotcha:
`totalUnsolved` counts **cells** and starts at `grid.total` (empty cells finalize during
init), `totalSubcells` counts **sub-cells** of playable cells — different quantities with
similar names.

Completion is `totalUnsolved === 0` — never `unsolved.size === 0`: `unsolved` only holds
touched cells under lazy cloning (see search).

## Search

- `solve(allSolutions)`: a stack of trials, each trial a cloned solver. Stages yielded:
  `initial`, `guess`, `aftercheck`. The exception types
  (`NoOrientationsPossible`, `LoopDetected`, `IslandDetected`) pop the trial; backtracking
  deletes the guessed rotation from the parent cell and re-dirties it.
  `this.solution` is assigned from `solutions[0]` only after the search ends — during the
  search `this.solution` must keep its `UNSOLVED` markers for the resurrection guard and
  for guessing.
- `clone()`: copies `solution`, `totalSubcells`/`totalUnsolved` and rebuilds the component
  registry eagerly (two passes over `subcellComponents` then slot-only components; fresh
  Maps everywhere, nothing shared with the parent), while **cells are cloned lazily**: the
  first `getCell` touch walks up the parent chain, clones the parent's cell
  (`new Map(cell.possible)` around the same mask arrays) and skips `doLocalDeductions`
  (facts are inherited). This is what keeps short trials and deep trial trees cheap.
  `stats` is shared by reference with the parent, so counters accumulate across the whole
  trial tree: `iterations`, `trialClones`, `shortTrials`, `dirtyProcessings`.
- `makeAGuess(marked)`: MRV over `solution[]` entries — **not** `unsolved`, which is
  incomplete under lazy cloning — skipping solved and `AMBIGUOUS`-marked cells, early exit
  at 2, first candidate rotation as the value. Returns `[-1, 0]` when no candidate
  remains. Materializing candidate cells via `getCell` is a known cost of the lazy model.
- `doShortTrials(marked)` (root trial of `markAmbiguousTiles` only): probes each candidate
  rotation on a clone; a contradiction deletes that rotation from the real cell and
  re-dirties it. Round-robins the start cell via `shortTrialsIndex`; a `tested` set skips
  (cell, rotation) pairs already finalized by earlier probes in the same sweep.

## `markAmbiguousTiles(ambiguousTilesLimit = 0)`

- Same contract as classic: search for solutions; cells whose representative rotation
  differs between solutions become `AMBIGUOUS`. Returns `{marked, solvable, unique,
numAmbiguous}`; `marked` holds rotations with `UNSOLVED`/`AMBIGUOUS` sentinels in
  place, and `solvable` is false only when `UNSOLVED` cells remain.
- Initial deductions first (unsolvable ⇒ early return). The root trial additionally runs
  `doShortTrials` on every iteration until it stops finding anything.
- Guessing goes through `makeAGuess(marked)`, so ambiguous cells are skipped as guess
  candidates. When only ambiguous cells remain (`index === -1`), the current solver is
  declared solved (`totalUnsolved = 0`) and fed into the solution-comparison branch. This
  overcounts further ambiguities once a first set of them is found, but the false
  positives never affect `unique` (they can only appear after the first set), and
  completing the full search instead is several times slower — a decided trade-off (see the
  long comment in the code).
- `ambiguousTilesLimit > 0` early-returns once that many ambiguities are known.
- `progress_callback` reports `SolverProgress {total, solved, guessed, ambiguous}`; the
  generator forwards these as worker progress messages.

## Fuzz and benchmark harnesses

Both harnesses compare the current solver against a frozen snapshot copy of this same file
(their failure messages say how to recreate the snapshot after a fresh clone); snapshot
mismatches mean the solver's behaviour changed.

- `solver-layers-alt-fuzz.test.js` — the soundness gate for any solver change. Run with
  `FUZZ_SOLUTIONS=1` (reproducible board sequence via `FUZZ_SEED`): on fresh boards, the
  full `solve(true)` solution list must match the snapshot's, every solution must pass
  `validateLayers`, and `markAmbiguousTiles` must report unique boards exactly. Failing
  boards are saved as JSON reproducers into `generator_stats/`.
- `solver-layers-stats.test.js` — paired benchmark. Run with `BENCH_MARK_AMBIGUOUS=1`
  (`BENCH_SEED` for a reproducible sequence, `BENCH_MARK_AMBIGUOUS_RUNS` /
  `BENCH_MARK_AMBIGUOUS_CAP_MS` tune it): every fresh board runs through the snapshot and
  the current solver back-to-back; verdict disagreements are soundness red flags, and
  work-counter mismatches fail in-run, so behaviour-preserving changes get a free
  regression test. Output lands in `generator_stats/`.
- The shared `stats` counters (`iterations`, `trialClones`, `shortTrials`,
  `dirtyProcessings`) accumulate across each trial tree and are the deterministic work
  metric to compare between variants.

## Differences vs classic Solver at a glance

| Aspect           | classic                        | layered                                                                                |
| ---------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| cell state       | set of orientation masks       | map of representative rotation → rotated layers                                        |
| identity         | cell index                     | cell for constraints, sub-cell for the tree                                            |
| deadends         | static tile-type check at init | per-direction facts with weights, chained through cells, exact-weight island facts     |
| loop detection   | component walls + merge check  | slot/sub-cell components: join-time loop checks, per-layer forbid queues, island check |
| solved cells     | eager, `unsolved` is complete  | lazy cloning, `totalUnsolved` counter, completion by count                             |
| local deductions | tileTypes hexa tricks          | outer walls only (hexa/octa tricks skipped: harder with layers, fewer useful hits)     |
