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
- **Deadend facts** (third derived mask): `deadends` bit d is set when every surviving
  picture connecting in direction d does so via a layer that is _deadend-effective_: either a
  single-connection layer, or a layer whose remaining directions all face neighbour deadend
  facts (an effective deadend — this is what lets a fact travel through a bend or a corridor of
  straights). Backed by the static `layerPopcounts` array (popcount per layer at rotation 0 —
  popcounts are rotation-invariant, so the array never changes and is simply rebuilt per clone).
  Unlike walls and connections the mask is _not_ monotone — the property depends on HOW a
  direction is used, not just whether — so `applyConstraints` re-derives it from scratch each
  pass and reports `addedDeadends = newDeadends & (full ^ deadends)`; a numeric subtraction
  would turn stale bits into phantom additions after wholesale picture-set replacements (short
  trial probes) and unsoundly prune true pictures (found via 20x20 boards coming back
  `solvable: false`). Candidate directions are seeded from `full & ~walls & ~neighbourDeadends`
  and cleared by surviving layers with two or more effective directions.
  Propagation (`processDirtyCells`): when cell A's `deadends` gains bit d, the neighbour across
  d must not answer with a deadend-effective layer of its own — two facing deadend-effective
  sub-cells would seal each other off from the tree **along with every deadend hanging behind
  them**. Facts therefore carry a **sealed mass**: how many sub-cells (the sender's answering
  sub-cell included, plus the masses behind the answering layer's other directions) would be
  sealed by such an answer. `pushed mass = 1 + max over surviving pictures using d of
Σ mass(other layer directions)`; a plain deadend tile originates mass 1, each chained hop
  adds 1, so a violation at the end of a k-corridor seals k+2 sub-cells. The receiver stores
  the fact in `neighbourDeadendMass` (max on repeat — masses are upper bounds, and a stale
  loose mass only ever costs a missed pruning, never an unsound one, so facts are never
  retracted), and `applyConstraints` prunes any picture with a layer inside the received
  directions while `1 + Σ mass(layer directions) < totalSubCells` — the one exact gate. When
  the sealed area equals the whole board the answer may be the final move that completes the
  tree, so the picture must survive; this is why the old static board-size gate
  (`checkDeadendConnections`, `playable > D+1`) is gone: single-hop facts are covered by the
  mass condition on every board size (a pair seals 2, withheld exactly when `totalSubCells =
2`), and chained facts need their own accumulated mass, which no unsolved-tile count can
  express. Against a pinned neighbour there is no mutable picture set, so A reads the frozen
  pinned answer and walls itself off only when `mass + 1 < totalSubCells` (the old code walled
  unconditionally under the gate). This is the layered generalization of the classic deadend
  rule: classic marks whole deadend _tiles_ (rotation-invariant), here the fact is per
  direction, per layer, mass-carrying, refined as candidate sets shrink. The derivation skip
  condition is `hasDeadends || neighbourDeadends > 0` — cells without deadend layers can still
  become effective deadends once facts arrive (a bend between two deadend neighbours pushes
  facts out its other sides), which is the main new propagation power; deadend-free boards
  still skip all of it.
- Facts live at cell level (union). Which _layer_ points where only matters in the component
  registry's slots: born when a connection becomes certain but the answering sub-cell is not
  uniquely determined yet, resolved when it becomes unique, and re-created on the open
  neighbours at pin time (see the tree constraint section).

## Tree constraint over sub-cells

The solved board must be one tree over all sub-cells. Edges of that tree are **cell-edge
pairs** — the "at most one layer per cell+direction" invariant makes `(cell, direction)` a
unique key. The solver maintains components **eagerly**: whenever a connection between two
cells becomes certain (every surviving picture connects there — `applyConstraints` derives it
in `addedConnections`), its ends join one component immediately, not at pin time. Dead
branches are caught at that moment: a loop check on merge, a global edge budget, and an
empty-component island check.

State:

- **Member** = a resolved `subCellId` or an unresolved **slot** `{cell, direction}`. A slot
  is a promise: whichever sub-cell of `cell` ends up using `direction` will join the slot's
  component. Slot objects are immutable and shared between clones.
- `components: Map<Member, Set<Member>>` — a component set is the **open frontier** through
  which the component can still grow: resolved sub-cells of unpinned cells and unresolved
  slots. Resolved members are dropped again — slot resolution swaps the slot for the
  answerer, pinning swaps the sub-cell for slots of its certain edges — so nothing
  accumulates. Identity is by object reference for slots; `clone()` must preserve set
  sharing (it maps original set → cloned set, members copied by reference).
- `slotIndex: Map<cell, Map<direction, Slot>>` — the cell's own unresolved slot ends; the
  `(cell, direction)` pair is a unique key (one exit per cell+direction), which also makes
  repeated registrations of the same edge detectable.
- `committedEdges` — one increment per certain edge, exactly once. Every certain edge is
  part of the final tree and the tree has exactly `totalEdges = ½ Σ popcount(layer masks)`
  edges, so the count can never exceed the budget; equality at completion plus the local
  cycle checks proves connectivity (`checkAllConnected`).
- `cellsToPin` — non-empty cells still to pin; zero means the board is complete. Never use
  `unsolved.size === 0` for that: `unsolved` only contains _touched_ cells, so it is
  momentarily empty after the first empty cell pins (found via a false `IslandDetected` on
  the 7×7 "many empty cells" board).

`registerCertainEdge(cell, direction)` is called exactly when a connection fact is first
derived (the `addedConnections` delta; the slotIndex membership tells re-runs for an edge
already registered from the neighbour side apart). Per edge: both ends join one component —
directly (merge + loop check) when both answering sub-cells are uniquely determined, as a
slot on the unresolved end(s) otherwise. A fresh pair of slots forms its own component.

`resolveOwnSlots(cell)` runs during the cell's own processing pass (the cell is guaranteed
dirty whenever its picture set changed, so resolution costs no extra scans): a slot whose
answerer became uniquely determined across the surviving pictures is dropped and the
sub-cell joins in its place. Joining the component it is already in means two certain edges
of one sub-cell into one component — a cycle in every solution ⇒ `LoopDetected`; a different
component ⇒ merge. Resolutions dirty the resolved cell's unsolved neighbours: their
behind-direction resolutions changed, so their pictures may be prunable — this closes the
old "certainty arrives late" propagation gap structurally.

`mergeSets` (union, smaller re-keyed into larger) runs the **touch scan** over the freshly
absorbed members, the layered equivalent of classic's mergeComponents wall drawing: for an
absorbed sub-cell of an open cell, an open direction whose near AND far ends both resolve
uniquely into the same component is a definite wall in every solution and gets walled
(pushes the opposite wall, re-dirties). The near end must be checked too — a multi-layered
cell's membership does not tell which layer answers an arbitrary open direction; only a
unique answerer pins it down (one-layered cells always qualify).

`pinCell` (runs only after the cell has left `unsolved`):

1. the cell's own unresolved slots resolve to the pinned picture's answering layers
   (`findLayerWithDirection`), merging components and catching cycles — the certain edges
   themselves were already registered when they became certain, during the final constraint
   pass (the pin-time push invariant means no new certainty toward pinned neighbours can
   arise afterwards, so no dedicated pin-time registration is needed);
2. the pinned sub-cells are dropped from their components. A component that runs out of
   members while unpinned cells remain can never gain another edge — future certain edges
   always have at least one open end, by the same invariant — so it is sealed:
   `IslandDetected`. This replaces classic's checkForIslands with an exact local check;
3. edge budget check ⇒ `LoopDetected`;
4. all unsolved neighbours get dirtied — pin facts can invalidate their pictures without any
   wall/connection changing (prune-only propagation).

When the last cell pins, `checkAllConnected` requires `committedEdges === totalEdges`: every
solution edge becomes certain by completion, a forest would stay below the budget, and
cycles throw at registration and resolution time — equality proves connectivity.

### Components vs classic's component walls

Classic `mergeComponents` adds walls wherever a merged component would touch itself again
and prunes bridge candidates. The naive port is unsound here: multi-layered cells have
parallel pipes, and two layers of one cell may legally both touch the same component
(through different sub-cells). The slot model fixes this by choosing the granularity of
every fact per edge end: components live over resolved sub-cells and slots (not whole
cells), certain edges union eagerly with a same-set check, slot resolution catches two
certain edges of one sub-cell into one component, and the touch scan walls an open
direction only when BOTH ends resolve uniquely into the component. This covers the classic
U shape — two open cells above the ends of a pinned U cannot connect to each other — and
generalizes the previous one-hop pinned-link pruning: multi-layered neighbours participate
through their uniquely determined answerers, chains resolve transitively through slot
resolutions, and component state is maintained rather than rebuilt per pass, so there are no
propagation-order gaps.

## Propagation loop

For each dirty cell, `processDirtyCells` loops until stable:

1. `applyConstraints` → wall/connection/deadend deltas;
2. propagate wall and connection deltas to neighbours unconditionally — same as classic, by
   the pin-time push invariant (below) a delta never targets an already-pinned neighbour, so
   `getCell` never sees one and there is no guard;
3. `registerCertainEdge` for every new connection — the certain edge joins components and
   creates slots (see the tree constraint section);
4. `resolveOwnSlots` — the cell's own slots whose answerer became uniquely determined;
5. `pruneContradictoryPictures`: delete pictures where a single layer would get more than
   one NEW edge into the same component, or any new edge at all when the layer's sub-cell is
   already part of that component through committed edges. Per direction the "component
   behind" resolves via the cell's own slots (candidate-dependent), via its own certain
   committed edges (NOT candidate-dependent — they are why the sub-cell is in the component
   already, and counting them would false-flag stars of committed edges), or via a uniquely
   determined neighbour answerer (candidate-dependent). Two different layers of one cell
   both touching the same component stay legal — parallel pipes.

Pin-time push invariant (shared with classic): when a cell pins, the same processing pass has
already derived its complete final stance — with a single surviving picture every direction is
either connected or walled — and pushed it into every unpinned neighbour as mask facts.
Afterwards no dirty cell can newly derive a wall/connection fact toward a pinned neighbour:
the direction is either already known there, or contradicts a pushed connection and every
picture using it dies in `applyConstraints` first. Both solvers rely on this invariant alone:
unguarded `getCell` delta pushes never receive a solved/pinned index, and in classic the same
occupied-direction filter keeps solved cells out of `mergeComponents`' adjacent scan — the
`getCell` rebuild branch never fires in the live flow. The one live pinned-neighbour check is
the deadend pair rule: `deadends` is not part of the pin-time push (non-monotone, re-derived
from scratch each pass), so a cell can genuinely derive a new deadend direction toward a
neighbour that pinned long ago; for a pinned neighbour the check reads the frozen answer from
`solution[neighbour]` and seals the cell with a wall if that mask is a deadend AND the sealed
mass still leaves something outside (`mass + 1 < totalSubCells`), otherwise it stores the
mass-carrying fact on the still-mutable neighbour, which prunes its own pictures on its next
pass. Gotcha: `unsolved.get` cannot
distinguish "pinned" from "never touched" — cells enter `unsolved` lazily via `getCell` —
branch on `solution[neighbour] === UNSOLVED` and initialize fresh cells first (found via a
false deadend wall on a hexa board: `solution[neighbour]` was `UNSOLVED`, `rotate(layer, -1)`
produced garbage and the frozen-mask check mis-fired).

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
- Guessing (`makeAGuess`): MRV over possible-state counts (early exit at 2), first candidate
  state as the value — classic-style. Guess heuristics (pinned-links cell tie-break, pinned
  connections value order) were removed after benchmarking: worth ~15–35% typical case, but
  the effect did not reproduce reliably across board samples and the removed tail behaviour
  was calmer without them (see performance).
- `doShortTrials` (used by `markAmbiguousTiles` only, at the root trial): probes each candidate
  state on a clone; if processing dies, the state is deleted from the real cell.
  Round-robins the start cell via `shortTrialsIndex`.
- History: the pruners took 10×10 boards from ~75% timeouts to ≤1.1 s; the guess heuristics on
  top turned out not to earn their keep (see above).

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

- Fine up to 10×10 and hexa 7×6. 12×12 wrap and large boards still have a tail, but the
  eager component machinery keeps it far tighter than the pin-time-only union-find ever did.
- Fresh 20×20 non-wrap boards (layering 0.6), `solver-layers-stats.test.js` with
  `BENCH_MARK_AMBIGUOUS=1`, 100 runs per grid, no wall-clock caps —
  `generator_stats/layered_mark_ambiguous_20x20.json` (compare
  `..._a1c35ce1.json`, the pin-time-only union-find before eager components):
  square p50 693 ms vs 1185 (−41%), mean 779 vs 1521 (−49%), p90 1509 vs 2821, worst 2253 vs
  5698, iterations mean 272 vs 889 (−69%); hexagonal p50 553 vs 888 (−38%), mean 1704 vs
  2119, p90 3670 vs 4703, iterations mean 1013 vs 530 (hexa iterations rose — more certain
  edges get registered and checked — but wall time still dropped). 0 unsolvable boards.
- Deadend-fact propagation (mass semantics, 200 runs per grid, fresh boards both sides,
  before/after this change): search iterations mean 440 → 302 on square (−31%), 393 → 217 on
  hexa (−45%); worst single run 7.1 s → 5.2 s (square) and 17.1 s → 11.9 s (hexa), and the one
  hexa run that hit the 60 s cap before finished uncapped after. Wall time is roughly neutral
  (square mean 898 → 877 ms, hexa mean 1543 → 1516 ms; hexa p50 rose 433 → 490 ms within
  fresh-board noise) because each dirty-processing pass costs ~10–15% more (mass bookkeeping
  plus more derived facts) while ~10–15% fewer passes are needed — the win is in the tail and
  the trial count, exactly where the generator's patience loop feels it.
- Soundness fuzz: 4000 fresh boards across square 4×4, hexa 3×4, square 4×3 wrap,
  square 6×5, hexa 4×5 wrap, layerings 0.5–0.8, all solvable and complete
  (scratch harness, see below), plus a tiny-board brute-force fuzz (scratch): random
  1×N/2×2/2×3/3×3 boards with deadend-heavy tile pools, random layer-less cells and
  multi-layer tiles, decided by exhaustive rotation search + `validateLayers` and compared
  with the solver's verdict — 1200+ boards, 0 mismatches. This is the fuzz that guards the
  mass boundary (`sealed area == totalSubCells`), which generated boards alone never exercise.
- The generator's `maxIterations` crutch is still in place but no longer leans on the
  wall-clock tail the way it used to; removing it is future work.

## Debugging harness (scratch, uncommitted)

`scratch-debug.test.js` + `scratch-old-solver.js` (a copy of the pre-rewrite solver from git)
form an oracle fact-checker: the old solver enumerates all solutions of a board, the new
solver runs with wrappers around `registerCertainEdge` / `pinCell` / pruner /
`applyConstraints` / `addWall` / `addConnection`, and every derived
fact is verified against the solution set (registration ⇒ edge in ALL solutions; wall ⇒ edge
in NONE; picture removal ⇒ rotation in NO solution). Found every unsoundness during the
rewrite — including two that hand-tracing missed. Careful: solver clones must be wrapped too
(their constructors re-run the instrumentation), and picture-class dedup means rotation KEYS
are representatives — compare solved boards, not rotation numbers, when in doubt.

## Differences vs classic Solver at a glance

| Aspect           | classic                       | layered                                                                           |
| ---------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| cell state       | set of orientation masks      | map of representative rotation → rotated layers                                   |
| identity         | cell index                    | cell for constraints, sub-cell for the tree                                       |
| loop detection   | component walls + merge check | eager slot components: touch-scan walls, merge/resolution loop checks, edge count |
| solved cells     | no guard, never re-touched    | same; certain edges and slots read while neighbours stay open                     |
| local deductions | tileTypes hexa tricks         | union masks only (weaker)                                                         |
| ambiguity search | uncapped                      | `maxIterations` cap + `complete` flag (to remove)                                 |
