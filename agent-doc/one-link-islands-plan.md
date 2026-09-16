# One-link islands for `LayeredSolver` — execution plan

Status: **code landed, fuzz-verified, benchmarked** (Designs A–D implemented; the
oracle fuzz (4000 boards) and the tiny brute-force fuzz (~1180 boards) both pass
clean, the layered test suite is green, and the paired-seed benchmark has run —
results below). Still open: the dedicated unit tests below and the docs move into
`layers-solver.md`. Written at commit `f63f0d57` ("Propagate deadend facts with
sealed masses in the layered solver"). Line numbers refer to that commit and will
drift — function names are the stable reference.

Implementation findings that changed the design are folded into Design C and the
Soundness/Lessons sections below — read those, not the original sketch.

## Paired-seed benchmark results (2026-09-16)

Protocol as specified below: `BENCH_SEED=20260916`, 200 runs per grid, 20×20
non-wrap, wall-clock cap 60 s; before = worktree at `f63f0d57`, after = this change;
per-board pairing by run index (`scratch-compare-bench.mjs`, JSONs under
`/tmp/opencode/*-seed.json`, per-board data now included in the stats JSON plus a
`seed` marker). A second back-to-back pair (seed 777, 40 runs, minutes apart) was
used for wall-time numbers because cross-session wall times proved noise-dominated
(identical deterministic work moved ±12% between sessions).

- **Search work (deterministic, noise-free)**: square iterations mean 252 → 193
  (−23.5%, 178/200 boards improved); hexa mean −14.6% with **0 boards regressed**
  (139 improved, 8 tied, n=40 probe; 200-run session: −21.5% mean incl. the capped
  board 100.5k → 84.5k iterations). Square max iterations 3016 → 1469.
- **Per-pass cost**: the hot prune path got more expensive: ms per dirtyProcessing
  square 0.040 → 0.045 (+13%), hexa 0.073 → 0.081 (+11%). The first implementation
  allocated a dedup array per layer per picture in `massBehind` (+38% per pass on
  hexa, +34% hexa wall time) — fixed with a module-level scratch array; keep that
  path allocation-free.
- **Wall time**: square mean −3.2% (n=40 back-to-back; max 4.6 s → 3.3 s), hexa mean
  +4.8% (p50 delta +75 ms on a 916 ms median, 33/40 boards slightly slower, but max
  42.8 s → 41.3 s). Same board capped on both sides wherever capping occurred.
- **Verdict**: the feature reliably buys search-work reduction (iterations, trial
  count — what the generator's patience loop leans on) and tail max, at a ~10–13%
  per-pass premium that nets out to roughly neutral wall time (slightly negative on
  square, slightly positive on hexa). Consistent with the plan's honest scope note:
  judge by work counters and the tail, not by mean wall time.

## Goal

When a component's open frontier is reduced to a **single link**, that link's far end
must not answer with a deadend-effective layer: doing so would seal the whole component
(plus the answerer) away from the tree. This ports and generalizes the alt solver's
`avoidIslandQueue` ideas (`solver-layers-alt.js`, the `component.slots.size === 1` and
`component.subCells.size === 1` branches) onto the main solver's mass pipeline from
`f63f0d57`.

Two fact kinds, one hook family:

1. **Slot-frontier fact**: frontier = one unresolved `Slot {cell, direction}`. The cell
   must not answer `direction` with a deadend-effective layer. Mass = component mass
   (exact — see soundness). Direct prune is real here (no exclusivity conflict on the
   receiver).
2. **Member fact**: frontier = one resolved sub-cell of an unpinned cell. Push
   `ND(definite directions of that layer)` into the member's **own** cell. The direct
   prune is provably vacuous (see soundness); the value is entirely in feeding the
   `ownDeadendDirections` derivation — the cell learns its known directions are
   "sealed behind", so its remaining directions become effective deadends and chain
   outward. This is the component analog of the bend trick, and the reason the alt
   solver's `subCells.size === 1` branch was useful despite never pruning directly
   (initially mis-analysed as a no-op; see Lessons).

## Background: what exists after `f63f0d57`

- `LayeredCell.neighbourDeadends` (bitmask) + `neighbourDeadendMass`
  (`Map<direction, mass>`), monotone max-on-set, never retracted.
- `sealsNeighbourDeadends(layers, totalSubCells)`: prunes pictures with a layer inside
  the ND mask while `1 + Σ mass(layer directions) < totalSubCells`.
- `ownDeadendMass(direction)`: `1 + Σ mass(other directions of the answering layer)` —
  the pushed mass for derived facts; feeds the tile-level push block in
  `processDirtyCells` (the `deltas.addedDeadends` branch).
- `applyConstraints(totalSubCells)` runs the prune and the effective-deadend derivation
  (candidates seeded from `full & ~walls & ~neighbourDeadends`).
- Components: `Map<ComponentMember, Set<ComponentMember>>` where the set is the **open
  frontier** (unresolved slots + resolved sub-cells of unpinned cells). `Slot` is
  `{cell, direction}`; `ComponentMember` = `Slot | number` (sub-cell id =
  `cell + layer * grid.total`).

## Design

### A. Component mass — `componentMass: Map<Set<ComponentMember>, Number>`

Monotone count of sub-cells that have ever joined each component set (never decremented
— pinned sub-cells stay in the sealed area). Exact sealed size for one-link facts,
because a one-link frontier means the component's only growth path is that link.

Bookkeeping per mutation site:

| Site                                                              | Mutation                                                                 | `componentMass` action                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `componentOf(member)`                                             | fresh singleton `{subCellId}` (numbers only, from `registerCertainEdge`) | init `1`                                                                                                               |
| `createSlot(cell, direction, undefined)`                          | fresh 2-slot component                                                   | init `0`                                                                                                               |
| `createSlot(cell, direction, set)`                                | slot added to existing set                                               | unchanged                                                                                                              |
| `resolveSlot(slot, answerer)` join branch (`other === undefined`) | slot swapped for sub-cell                                                | `+1`                                                                                                                   |
| `resolveSlot` merge branch (`other !== set`)                      | `mergeSets(set, other)`                                                  | handled inside `mergeSets`                                                                                             |
| `mergeSets(a, b)`                                                 | target absorbs source                                                    | `target += source`, delete source key                                                                                  |
| `pinCell` delete loop                                             | resolved sub-cells of the pinned cell leave the frontier                 | **unchanged**                                                                                                          |
| `clone()`                                                         | sets cloned via `clonedSets` mapping                                     | rebuild beside the existing two-pass loop: `clone.componentMass.set(clonedSet, self.componentMass.get(original) ?? 0)` |

Note the `resolveSlot` merge branch must **not** `+1`: the answerer already lives in the
surviving set and is counted there. Verified by trace: two leaf-pinned slots resolving
into one T sub-cell yields mass `1 + 1 = 2` before the T joins, `3` after — exactly the
member count.

### B. ND values carry a component reference

`neighbourDeadendMass` values become `{ mass, ref }` where `ref` is:

- the component `Set` for component-origin facts (slot-frontier and member facts), or
- `undefined` for tile-chain facts (each direction's behind-mass is a distinct unit).

Summation sites — `sealsNeighbourDeadends` and `ownDeadendMass` — sum **once per
distinct ref** (undefined refs always distinct). Rationale: components are disjoint, so
distinct-ref sums are sound; equal refs mean the same mass hangs behind two directions
of one layer and must not double-count. Stale refs after merges only cause a missed
dedup → conservative (larger) sum → sound, never unsound. `addNeighbourDeadend` keeps
max-by-mass and stores whichever ref came with the winning value.

Worked example (the flagship scenario below): T with known `E,N` into a component of
mass 3 (including the T) and a deadend neighbour at `W`. Without dedup the derived W
fact would be `1 + M + M`; with dedup (both directions carry the same merged ref) it is
`1 + M` — exact.

### C. Hook sites for `checkOneLinkIsland(set)`

`O(1)`: `set.size === 1` plus one member inspection. Call from:

1. `mergeSets` — end, on the surviving target (covers the `registerCertainEdge`
   both-ends-resolved branch and `resolveSlot`'s merge branch; the target can be a
   single sub-cell when a `{slot}` set merges into a `{subCell}` set).
2. `resolveSlot` join branch — after `set.add(answerer)`.
3. `pinCell` — after the delete loop, for each touched set that is now non-empty
   (mirror the existing size-0 `IslandDetectedException` check; skip everything when
   `cellsToPin === 0`, same guard as the island check).

Do **not** hook `componentOf`/`createSlot` fresh-singleton paths: the fact would be the
weakest possible (mass 1, one known direction) on the hottest path, and it still fires
later at resolve/merge/pin time when it matters.

`checkOneLinkIsland(set)` (as implemented — the guards marked ★ were found necessary
during implementation; without them the facts are unsound, see Soundness):

```
if cellsToPin === 0: return
if set.size !== 1: return
mass = componentMass(set)
if mass + 1 >= totalSubCells: return                     # final-move case
member = the single member
if member is a Slot:
    receiver = unsolved.get(member.cell)                   # always defined, see invariants
    if slotIndex(member.cell).size > 1: return             # ★ other slots => merge, not seal
    for candidate of answererCandidates(member.cell, member.direction):
        if components.get(candidate) not in {undefined, set}: return   # ★ answerer drags its comp in
    receiver.addNeighbourDeadend(member.direction, { mass, ref: set })
    dirty.add(member.cell)
else (number member):
    cell = member % grid.total; layer = floor(member / grid.total)
    cellObj = unsolved.get(cell)
    if cellObj === undefined: return                       # transient pinned member, see below
    known = cellObj.getLayerDefiniteConnections(layer) & cellObj.connections
    #                       ★^^^^^^^^^^^^^^^^^ inward only - see Soundness
    if known === 0: return
    for direction of slotIndex(cell).keys():               # ★ member may yet answer an own slot
        if any surviving picture's layer uses direction: return   #  => merge, not seal
    cellObj.addNeighbourDeadend(known, { mass, ref: set })
    dirty.add(cell)
```

Slot cells are always unpinned here: `pinCell` resolves the pinned cell's own slots
before deleting its sub-cells, and `resolveSlot` removes slotIndex entries, so a
surviving slot never belongs to a pinned cell.

The member branch **cannot** rely on that invariant, though: hook sites 1–2 fire
inside `pinCell`'s slot-resolution phase, where the answerer is a sub-cell of the
cell **currently being pinned** — which has already left `unsolved`
(`processDirtyCells` deletes it before calling `pinCell`). If the resolved slot was
alone in its set — exactly the one-link frontier this feature targets, produced e.g.
by a leaf neighbour pinning first and reducing the set to `{slot(B, W)}` — the
join/merge branch leaves the set at a single member and `checkOneLinkIsland` runs
with a _pinned_ member. Hence the `cellObj === undefined` guard: no fact is owed
there (the pinned cell's stance was already pushed at pin time, and `pinCell`'s
delete loop drops the member moments later), so returning is both safe and sound.
Crash trace without the guard: deadend leaf A—B; A pins, its sub-cell leaves the
shared set → `{slot(B, W)}`; B pins → `resolveSlot(slot, B/L0)` → join branch →
`{B/L0}`, size 1 → hook fires → TypeError in `getLayerDefiniteConnections`.

### D. New `LayeredCell.getLayerDefiniteConnections(layerIndex)`

```js
let connections = polygon.fully_connected & ~self.walls;
for (let layers of self.possible.values()) connections &= layers[layerIndex];
return connections;
```

(Per-layer intersection over surviving pictures — the main-solver equivalent of the alt
solver's helper of the same name.)

## Soundness arguments

- **Slot-frontier fact**: the component's only growth path is the slot edge (all other
  members finalized; frontier = exactly that slot), so a deadend-effective answer seals
  exactly `componentMass + 1` sub-cells. Prune condition `mass + 1 < totalSubCells`
  excludes only the case where the sealed area is the whole tree — the valid final move.
  Two preconditions discovered in implementation (the ★ guards): the claim "answering
  seals this component" is false when (a) the cell owns another unresolved slot in a
  different component — one layer answering both slots merges the components instead
  (the OR-semantics case is not just an unimplemented refinement, it is a correctness
  guard); or (b) some answerer candidate of the slot direction already belongs to
  another component — its answer drags that component in via the merge at resolution.
- **Member fact**: `known` directions are definite (per-picture intersection) **and**
  inward: intersected with `connections`, the registration marker of a certain edge.
  Definite alone is NOT enough — a direction can be definite while its edge is not yet
  registered (the cell has not processed since), and then it is the component's own
  growth path: marking it sealed is exactly backwards (this crashed the 7×1 corridor
  test: the straight's full mask was definite, the outward side got ND-marked, and the
  only picture was pruned). Registered edges join both ends into one component, and a
  certain edge's far end is always in the member's component, so
  `definite & connections` is exactly the inward set; it is also exact (no inward
  direction is missed: an inward direction is a certain edge, hence connected in every
  picture, hence definite). Two more seal-claim preconditions (★ guards): the member
  must not be able to answer any of its own cell's pending slots — its layer covering a
  slot direction in some surviving picture means answering could pull that slot's
  component in (this was the hexa 4×3 failure: `slot(6,1)` pending in another component
  while the fact claimed direction 1 sealed). The direct prune stays sound when the
  layer fits inside the (inward-only) mask: all its edges then go into its own
  component, so completing it empties the frontier — the existing island contradiction
  — and the pushed mass over-counts by one (the answerer is the frontier member,
  already inside `componentMass`), keeping the gate conservative. Sibling layers can
  never fit inside `known` (direction exclusivity per cell, and masks are nonzero). The
  fact's value is entirely in the derivation: ND-marked inward directions stop counting
  as free exits, so remaining directions become effective deadends and chain outward.

- **Mass semantics**: component masses are exact member counts (disjoint by
  construction; merges sum; pins never decrement because pinned sub-cells are part of
  the sealed area). Ref-dedup is sound because distinct components are disjoint; stale
  refs degrade to conservative sums.
- **Monotonicity**: ND facts are never retracted; component facts pushed before a later
  merge keep their (possibly stale) refs, which only weakens dedup. A fact pushed under
  a guess stays inside the trial clone (whole-solver clone isolation, unchanged).
- **Completion interaction**: everything gated by `cellsToPin === 0` skip + `mass + 1 <
totalSubCells`; at completion the final component's frontier legitimately empties
  (size 0) and the existing `IslandDetectedException` path already guards `cellsToPin`
  — the one-link check mirrors that guard.

## Lessons (do not re-derive these wrong)

- ND facts have **two** effects: the direct `sealsNeighbourDeadends` prune (the alt
  solver's `mustNotSealDeadends`), and feeding the effective-deadend derivation in
  `applyConstraints` (the alt solver's `ownDeadendDirections`). A fact can be vacuous
  for the first and valuable for the second (member facts are exactly this). When
  analysing a push, check both data flows.
- Component sets in the main solver shrink **only** in `pinCell`, but a size-1 frontier
  can also _appear_ via `resolveSlot` swapping a slot for a sub-cell inside a set that
  pins had already reduced to one slot — hence hook sites 1–3 above, not just pinCell.
- `resolveSlot`'s merge branch must not increment mass (answerer already counted in the
  surviving set).
- Hook sites 1–2 also fire inside `pinCell`'s slot-resolution phase, where the answerer
  is a sub-cell of the cell **currently being pinned** (already deleted from
  `unsolved`). A set that pins had reduced to `{slot}` becomes `{pinnedSubCell}` —
  size 1 — after the swap, so `checkOneLinkIsland` must guard
  `unsolved.get(cell) === undefined` in its member branch instead of assuming
  "unpinned by invariant"; without the guard, a deadend leaf A—B where A pins first
  crashes with a TypeError when B pins.
- **Definite ≠ inward.** A per-picture-definite direction is not necessarily a
  registered certain edge: the member cell may not have processed since the direction
  became definite. Unregistered directions point outward — they ARE the component's
  growth path — so the member fact must mask `known` with `connections` (the edge
  registration marker). Found via the 7×1 corridor: the straight's full E|W mask was
  definite, the outward side got ND-marked with the whole corridor's mass, and the
  corridor's own solution was pruned (17 false-unsolvable tests).
- **A one-link frontier does not seal the component if pending slots elsewhere can
  still pull it in.** The seal claim "answering this link seals `componentMass`
  sub-cells" silently assumes the component can grow ONLY through that link — but a
  slot in ANOTHER component whose answerer may be this component's member (or another
  sub-cell of the slot's cell) is a hidden merge path: answering can merge the
  components instead of sealing. Guards: slot branch skips when the cell owns another
  unresolved slot or when any answerer candidate already belongs to another component;
  member branch skips when the member's layer covers any own-cell pending slot
  direction. Found via a hexa 4×3 board where `slot(6,1)` (other component) coexisted
  with a member fact at `1|4` — the board's only solution was pruned.

## Implementation steps

1. `LayeredCell` (solver-layers.js, cell factory): add
   `getLayerDefiniteConnections(layerIndex)` (design D).
2. Change `neighbourDeadendMass` to `Map<Number, {mass, ref}>`; update
   `addNeighbourDeadend(direction, fact)` (max-by-mass, keep winning ref),
   `sealsNeighbourDeadends` and `ownDeadendMass` (sum once per distinct `ref`;
   `undefined` refs always count). Update the tile-level push site in
   `processDirtyCells` (`deltas.addedDeadends` branch) to pass `{ mass, ref: undefined }`
   — via `cellObj.ownDeadendMass`, which returns a plain number, so wrap there.
3. Solver: `componentMass` map + bookkeeping per the table in Design A; rebuild in
   `clone()` (second `components.forEach` pass already iterates original sets — copy
   masses there); delete the entry when a set empties in `pinCell`.
4. Solver: `checkOneLinkIsland(set)` + hook calls (Design C).
5. Tests (below), then fuzz + benchmark + docs.

## Test plan

Unit tests (extend `solver-layers.test.js`, "Test deadend pair facts" describe or a new
"Test one-link island facts" describe). Rotate mapping is `1→8→4→2→1` for +1 steps
(E→S→W→N).

**Recipe, not a fixed board**: hand-authored layered boards in this effort have
repeatedly failed on dangling edges into empty cells and deadend tiles declaring before
the chain they are supposed to feed. Construct each test with the established loop:
author tiles → `validateLayers` the intended solution on a probe → trace with wrapped
`addNeighbourDeadend`/`applyConstraints`/`pinCell` → pin asserts. Leave the untouched
filler cells empty (register them in `grid.emptyCells`) — a tile-less neighbour is not
a wall, but a tile pointing _at_ it makes the board invalid (validateLayers rejects,
Σ popcounts go odd).

1. **Member fact fires with exact mass and ref**: 3×3, centre = T `[7]`, two leaf
   neighbours manually pinned onto deadend rotations (the established
   `getCell(n).possible = new Map([[0, [mask]]])` + dirty + drain pattern), the T's
   third side facing a cell that can answer non-deadend (e.g. `[3, 8]` two-layer — a
   plain deadend tile there would self-declare early and ND-exclude the direction, see
   Gotchas). Processing the centre forces connections, resolves the two slots, merges
   to mass 3 with frontier `{T sub-cell}`, and the hook must push
   `ND(E|N, {mass: 3, ref: mergedSet})` into the centre. Assert the ND entries
   (directions, mass, ref identity) and `centre.deadends` gaining the third direction.
2. **Slot-frontier fact**: pin a single leaf; assert its component reduces to
   `{slot}` and the fact lands on the slot cell with `mass 1` and the component set as
   ref (superseded later by the member fact via max-by-mass when the centre resolves).
3. **Final-move boundary**: shrink a frontier to one link with
   `componentMass + 1 === totalSubCells` (small corridor with empty cells for headroom
   accounting) — assert NO fact is pushed and the board still solves.
4. **Pinned-region voice (necessity probe)**: a pinned chain of k tiles whose only
   exit is one slot — assert the fact carries `mass k` where the plain tile chain would
   have carried only the exit tile's own mass 1. Pinned cells never derive or push
   tile facts, so component facts are their only voice; this is where the feature earns
   anything the `f63f0d57` chain cannot reach.
5. **Clone**: non-trivial `componentMass` survives the rebuild; mutating the clone's
   map leaves the original untouched.
6. **Regression**: both scratch fuzzes (`scratch-debug.test.js` — oracle 4000 boards +
   tiny brute-force) stay at 0 failures / 0 mismatches. Component facts act solely
   through `addNeighbourDeadend` → `applyConstraints`, which the oracle's
   picture-loss wrapper already guards, so unsound facts surface as false-unsolvable
   boards.
7. Full layered suite per AGENTS.md; `npm run check` must add no new errors in touched
   files; prettier clean.

Honest scope note: because the `f63f0d57` tile chain already propagates through bends
and corridors of unpinned cells, minimal boards where the component fact is strictly
necessary are hard to isolate — the plain chain usually reaches the same conclusion
with slightly wrong (under-counted) masses. The feature's value is exactness at the
`mass + 1 === totalSubCells` boundary and coverage of pinned/silent regions; judge it
by the paired-seed benchmark, not by minimal units.

### Gotchas discovered while designing the tests

- **A deadend tile as the third neighbour self-declares early**: its own fact makes the
  direction an ND key at the T, and ND-keyed directions are _excluded from the
  derivation candidates_ (`full & ~walls & ~neighbourDeadends` seeding) — the derived
  fact at that direction can then never fire. The exclusion is load-bearing (deriving
  "deadend at d" for an ND-keyed d would be unsound: the neighbour's connection plus
  the T's remaining free exit is a legal, unsealed configuration), so design tests
  around it rather than removing it.
- **Pushed mass depends on pass order** within the stabilization loop: slot-frontier
  facts (small masses) may fire before the member fact overwrites them (max-by-mass),
  so a derived fact computed from small masses can be one member short of exact. Sound
  (underestimate → prune withheld, never wrong), order-dependent, self-corrects on
  re-derivation. Assert prunes, not exact masses, across stabilization boundaries.
- **Do not point tiles at empty cells** in hand-authored boards: validateLayers
  rejects them and Σ popcounts go odd, surfacing as confusing `IslandDetected` /
  `NoOrientationsPossible` far from the actual mistake.

## Benchmark protocol (paired seeds)

- `solver-layers-stats.test.js`: when `BENCH_SEED` is set, replace `Math.random` with a
  seeded mulberry32 PRNG for the duration of the run (this also controls
  `pregenerate_layers` internals — single-threaded test, restored in `afterAll`;
  **landed**, the per-board `runs` records plus a `seed` marker are part of the stats
  JSON). Default stays truly random.
- Protocol: two runs with identical `BENCH_SEED` (before/after the change, i.e. via
  worktree at the base commit) → paired per-board comparison by run index; report
  per-board deltas and the distribution summary, not just aggregates
  (`scratch-compare-bench.mjs`). 200 runs per grid.
- Wall-time caveat learned on the first run: cross-session wall comparisons are
  noise-dominated (identical deterministic work drifted ±12%) — take wall numbers
  from back-to-back runs and trust the deterministic counters (iterations,
  prunedPictures) across sessions.
- Metrics of interest: iterations (mean/p90/max), elapsedMs paired deltas,
  `prunedPictures`, capped counts, ms per dirtyProcessing.

## Docs

- `agent-doc/layers-solver.md`: new "One-link islands" subsection under the tree
  constraint section (fact kinds, hook sites, exact-mass argument, the T trace),
  a pointer from the deadend facts section (component facts reuse the mass pipeline),
  and a row update in the differences table.
- Update this file's Status header to "landed at commit …" or delete it after landing,
  folding anything durable into `layers-solver.md`.

## Out of scope

- The "2+ island connections into the same cell" refinement (a frontier with several
  slots into one cell needs OR-semantics, not independent deadend facts — the alt
  solver punted on it too; its comment block documents the difficulty).
- Frontier = one open sub-cell with **multiple** uncertain directions (no fact exists
  there beyond the member fact's known-directions push).
- Reworking `markAmbiguousTiles`' pre-existing `solvable` quirk on deduction-pinned
  degenerate boards (surfaced by the tiny fuzz; unrelated to islands).
