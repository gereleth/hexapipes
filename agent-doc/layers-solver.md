# Layers variant: solver (`LayeredSolver`)

Files: `src/lib/puzzle/solver-layers.js`. Classic counterpart: `solver.js` (`Solver`). Tests:
`solver-layers.test.js`. Consumers: `Puzzle.svelte` (solve animation + stats readout),
`LayeredGenerator` (uniqueness loop), `worker-layers.js` (progress messages to the custom page).

Boards are assumed to have a single connected playable region — grids with disconnected areas
are not supported.

## Core model: possible states

- The decision variable is the **cell rotation**: rotating a cell rotates all its layers at
  once, so a cell has `num_directions` possible states, not a free choice per layer.
- A **picture** is an equivalence class of rotations that produce the same multiset of rotated
  layer masks; `pictureId(masks)` = sorted masks joined with `-` (`'0'` for empty cells) is
  only the dedupe key. The state itself lives in `LayeredCell.possible: Map<rotation, layers[]>`:
  each surviving picture is stored as its smallest representative rotation together with the
  rotated layer masks at that rotation (`buildPossible`).
- Soundness: rotations sharing a picture are solved-equivalent — they induce the same sub-cell
  adjacency up to relabeling (a graph isomorphism). So classic's trick of deduplicating
  identical orientation masks carries over: constraints are tracked per picture and any
  representative rotation can stand in for the whole class.
- Rotations are also the uniqueness currency: `solution`/`solutions` hold representative
  rotations, ambiguity is decided per representative rotation, and Puzzle.svelte applies
  solution rotations directly with no id conversion. The `UNSOLVED`/`AMBIGUOUS` sentinels
  pass through unchanged.
- Steps yield `LayeredStep {cell, rotation, final}`; sentinels `UNSOLVED = -1`,
  `AMBIGUOUS = -2`.
- Gotcha: layer masks are plain numbers — a cell with two straight pipes is `[5, 10]`, never
  `[[5], [10]]`. Nested one-element arrays only pass tests by accident of JS bitwise coercion
  (`[[5]] & 4 === 4`), and a real multi-direction layer written nested (`[[5, 10]]`) silently
  becomes `NaN → 0` = no connections.

## Cell constraints work on the union

- `LayeredCell` keeps classic-style direction bitmasks `walls` and `connections`.
- `applyConstraints` filters pictures: the union of layer masks at the picture's rotation must
  not touch `walls` and must include all of `connections`. From the survivors it derives new
  facts: directions avoided by every surviving union become walls, directions shared by every
  surviving union become connections. Empty picture set ⇒ `NoOrientationsPossible`.
- **Deadend facts** (third derived mask): `deadends` bit d is set
  when every surviving picture connecting in direction d does so via a single-connection layer.
  Backed by the static `layerPopcounts` array (popcount per layer at rotation 0 — popcounts
  are rotation-invariant, so the array never changes and is simply rebuilt per clone). Unlike
  walls and connections the mask is _not_ monotone — the property depends on HOW a direction is
  used, not just whether — so `applyConstraints` re-derives it from scratch each pass and
  reports `addedDeadends = newDeadends & (full ^ deadends)`; a numeric subtraction would turn
  stale bits into phantom additions after wholesale picture-set replacements (short trial
  probes) and unsoundly prune true pictures (found via 20x20 boards coming back
  `solvable: false`).
  Propagation (`processDirtyCells`): when cell A's `deadends` gains bit d, the neighbour across d must not answer with its own
  deadend — two facing single-connection sub-cells would be sealed off from the tree — so
  `removeDeadendPairs(opposite)` deletes the neighbour's pictures that connect there via a
  popcount-1 layer (a layer mask equal to the single direction bit); against a pinned neighbour
  the check reads the pinned cell's only layer list directly and turns into a wall on A itself.
  This is the layered generalization of the classic deadend rule:
  classic marks whole deadend _tiles_ (rotation-invariant), here the fact is per direction and
  per layer, refined as candidate sets shrink. Cells without deadend layers (`hasDeadends`,
  static) skip the popcount scan, the mask derivation and neighbour-side pair checks entirely —
  the bulk of the per-pass cost on deadend-free boards. The propagation block is gated by
  `checkDeadendConnections` with the same rationale as classic: on tiny boards the sealed pair
  could be the entire puzzle.
- Facts live at cell level (union). Which _layer_ points where only matters at pin time and in
  the pruner, both via `findLayerWithDirection(rotation, direction)`.

## Tree constraint over sub-cells

The solved board must be one tree over all sub-cells. The solver enforces this incrementally:
when a cell pins down to a single picture, its edges become definitive facts merged into a
union-find over sub-cell ids. Dead branches are caught by three mechanisms: a loop check on
merge, a global edge budget, and an island check.

State:

- `components: Map<subCellId, Set<subCellId>>` — union-find over sub-cells of pinned cells.
  Identity is by object reference; `unionSubCells` throws `LoopDetected` when both ends already
  share a set. Gotcha: `clone()` must preserve set sharing (it maps original set → cloned set
  so cloned ids still share one Set object).
- `pendingLinks: Map<cell, {fromId, direction}[]>` — edges from already-pinned neighbours
  waiting for this cell to pin.
- `totalEdges = ½ Σ popcount(layer masks)` — every complete assignment has exactly this many
  edges (popcounts are rotation-invariant). `internalEdges + pendingCount` counts committed,
  irreversible edges and must never exceed the budget.

`pinCell` runs only after the cell has left `unsolved` — the ordering matters because the
island check reads the freshly registered component sets:

1. every layer of the cell joins `components` as a singleton;
2. pending links from earlier-pinned neighbours resolve: the pinned picture must have a layer
   pointing back in the opposite direction, missing one ⇒ throw; the ends are united;
3. directions of the pinned picture toward still-unpinned neighbours become that neighbour's
   pending links;
4. each edge is registered exactly once — at whichever endpoint pins later — so budget and
   island checks see every edge once;
5. edge budget check ⇒ `LoopDetected` (finishing would force a cycle);
6. `checkForIslands`: while unsolved cells remain, every component must hold at least one
   pending link, i.e. some way to ever connect; a sealed component ⇒ `IslandDetected`;
7. all unsolved neighbours get dirtied — pin facts can invalidate their pictures without any
   wall/connection changing (prune-only propagation).

When the last cell pins, `checkAllConnected` requires everything to be in a single component.

### Why classic's component-wall pruning is not ported

Classic `mergeComponents` adds walls wherever a merged component would touch itself again and
prunes bridge candidates with `mustHaveSomeWalls`. That is cell-level reasoning assuming a cell
connects to a given neighbour at most once — unsound here because layered boards have parallel
pipes: two layers of one cell may legally both point into the same neighbour cell (they are
different sub-cells). The only definite cycle visible at cell granularity is a **single layer**
connecting into the same pinned component twice. That narrower rule is the heart of
`pruneContradictoryPictures` (below).

## Propagation loop

For each dirty cell, `processDirtyCells` loops until stable:

1. `applyConstraints` → wall/connection deltas;
2. propagate deltas to neighbours. Into pinned neighbours: verify consistency and throw — the
   solver never resurrects pinned cells (classic re-creates solved cells via `getCell`);
3. `pruneContradictoryPictures`: delete pictures that would connect a single layer into the
   same pinned component twice (definite cycle, see above). No off-board or back-layer checks
   are needed: border walls are derived at cell init, and a pinned cell with a wall towards
   this cell already forced the opposite wall here, deleting contradicting states during wall
   propagation.

The loop is a correctness requirement, not an optimization: pruning can imply NEW
walls/connections (the deleted picture was the only one avoiding a wall), and those facts must
reach neighbours before the cell is considered for pinning. Without it, cells pinned to wrong
rotations — rare, random boards only, found by a 450-board stress loop.

`doLocalDeductions` on cell init: outer walls and invalid directions only. The classic
"connects only deadends" picture filter is not needed here — the per-direction deadend pair
rule above supersedes it. Classic's hexa/octa
`tileTypes` tricks are not ported — union masks don't classify
into tile types — one reason layered deduction is weaker (see performance).

## Search

- `solve(allSolutions)`: a stack of trials, each trial a cloned solver. Stages yielded:
  `initial`, `guess`, `aftercheck`. Backtracking = the parent deletes the guessed rotation
  and re-dirties the cell. The exception types (`LoopDetected`, `IslandDetected`,
  `NoOrientationsPossible`) simply pop the trial.
- Guessing (`makeAGuess`): MRV over possible-state counts (early exit at 2), tie-break "most
  pinned neighbours" (contradictions surface next to the pinned structure), value order
  "picture with most pinned connections" (greedy tree-growing — safe for completeness because
  every value is still tried on backtrack).
- `doShortTrials` (used by `markAmbiguousTiles` only, at the root trial): probes each candidate
  state on a clone; if processing dies, the state is deleted from the real cell.
  Round-robins the start cell via `shortTrialsIndex`.
- History: these heuristics plus the pruners took 10×10 boards from ~75% timeouts to ≤1.1 s.

## `markAmbiguousTiles(ambiguousTilesLimit, maxIterations)`

- Same contract as classic: search for solutions; cells whose representative rotation differs
  between solutions become `AMBIGUOUS` (ambiguity is reported per CELL even though matching is
  per rotation); the returned `marked` array holds rotations, with the `UNSOLVED`/`AMBIGUOUS`
  sentinels in place where applicable.
- The guess loop here is an inlined copy of `makeAGuess` that skips `AMBIGUOUS`-marked cells;
  if only ambiguous cells remain it drains `solver.unsolved` and continues instead of guessing.
- `ambiguousTilesLimit > 0` early-returns once that many ambiguities are known.
- `maxIterations` caps search iterations; hitting it returns `complete: false` with
  `unique: false` (an incomplete search must never claim uniqueness) and optimistic
  `solvable: true` so callers retry instead of trusting the result. **This parameter is an ugly
  crutch for slow search and is meant to be removed eventually** — the end goal is a solver
  fast enough on every layered board that no cap is needed. Today `LayeredGenerator` leans on
  it with a classic-style patience/regenerate loop.
- `progress_callback` reports `SolverProgress {total, solved, guessed, ambiguous}`; the
  generator forwards these as worker progress messages.

### Performance

- Fine up to 10×10 and hexa 7×6. **12×12 wrap has a heavy tail**: most runs take seconds, some
  ≫20 s. Wrong-branch detection is fundamentally weaker than classic's cell-level component
  walls (see the tree constraint section) — trial stacks grow deep before a contradiction
  surfaces.
- The generator's workaround (maxIterations + regenerate) hides the tail from users but wastes
  the work; a real fix would be cell-level pruning that stays sound with parallel pipes —
  remembering that only same-layer double connections are definite cycles.

## Differences vs classic Solver at a glance

| Aspect           | classic                       | layered                                           |
| ---------------- | ----------------------------- | ------------------------------------------------- |
| cell state       | set of orientation masks      | map of representative rotation → rotated layers   |
| identity         | cell index                    | cell for constraints, sub-cell for the tree       |
| loop detection   | component walls + merge check | union-find merge + edge budget + per-layer prune  |
| solved cells     | may be re-created via getCell | never resurrected; contradictions throw           |
| local deductions | tileTypes hexa tricks         | union masks only (weaker)                         |
| ambiguity search | uncapped                      | `maxIterations` cap + `complete` flag (to remove) |
