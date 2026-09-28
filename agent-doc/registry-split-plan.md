# Splitting a components registry out of the layered solver

The SoA rewrite (`d284c714`) put the component registry inside `LayeredSolver` as a block of
typed arrays plus helper methods. The solver's deduction logic and the registry's bookkeeping
are now interleaved: `resolveComponents` writes `subcellOwner` by hand, does inline row
arithmetic (`neighbour * this.ND + (31 - Math.clz32(opposite))`), and orbits every mutation
with `islandAdd`/`islandDelete` calls. This plan extracts a `ComponentsRegistry` class with a
higher-level API so the solver says _what_ happened (a slot resolved into a subcell, two
components met) and the registry decides _how_ it is recorded (rows, lists, counts, queues).

Target shape:

```js
this.components = new ComponentsRegistry(grid, maxLayers);
```

All line references below point at `src/lib/puzzle/solver-layers.js` in this worktree as of
`e59c047c`.

## Principles

1. **The registry owns state and transitions; the solver owns policy.** Loop detection
   (`LOOP_DETECTED`), island completion rules, deadend weights, `getAnsweringLayer`, and the
   avoid-loop heuristics stay in the solver. Litmus test: if a method needs cells, layers, or
   the grid's neighbour topology to decide something, it is not registry code.
2. **The registry is the only writer of its arrays** (this is already the stated contract at
   line 769) — the refactor just makes it true across a class boundary.
3. **Stale-id safety stays structural.** Component ids are never reused, `0` means "no
   component", merges leave absorbed ids empty. The registry documents this once.
4. **Behavior must not change observably.** The cross-solver fuzz test
   (`solver-layers-fuzz.test.js`) and the benchmark against the frozen
   `solver-layers-baseline.js` gate every step.
5. **Hot paths stay allocation-free.** Where the current code scans a typed-array row, the
   registry API is a callback (`forEachSlot`), not an iterator or array builder. Per-event
   object allocation is acceptable only on cold paths (island events).

## Registry API

**Vocabulary.** A **slot** is one `(cell, direction)` pair — an unresolved half-connection of
a component (`slotDirect` row entries, `slotCount[cell]`, the "two open ends" of
`addConnection`). That is the only slot concept the solver sees. Internally the registry
aggregates a component's slots at one cell into a single list record holding a direction
bitmask (`slotNode*`, `compSlotHead/Tail`) — a component can have two slots at one cell, and
they share one record. The distinction stays inside the registry: the record count and the
public `slotCount(comp)` differ (the latter sums record masks, so it counts slots), and the
only place aware of that is `validate()`.

### Lifecycle

| Method | Returns | Notes |
| --- | --- | --- |
| `constructor(grid, maxLayers)` | — | Sizes every array from `grid.DIRECTIONS` (ND), `grid.total`, `maxLayers`, and direction counts. The solver derives `maxLayers` from tiles and passes it in — tiles are solver domain. Absorbs constructor lines 710–752. |
| `clone()` | `ComponentsRegistry` | Slices all arrays at used length + headroom (lines 676–709). Called from the solver's clone path. |
| `validate()` | `void` | Debug-gated invariant check (see "Invariants"); called by the fuzz test, not from production code. |

### Queries

| Method | Returns | Notes |
| --- | --- | --- |
| `hasOpenSlots(cellIndex)` | `boolean` | `slotCount[cellIndex] > 0`. Guards the first half of `resolveComponents`. |
| `getSlotComponent(cellIndex, direction)` | `compId` | Row read (`0` = none). Replaces every inline `slotDirect[i * ND + (31 - Math.clz32(d))]`. `dirPos` still throws on directions outside the grid's width — a typed-array write out of bounds would otherwise be silently discarded. |
| `getSubcellComponent(subcellId)` | `compId` | `0` = none. |
| `getSubcellDirections(subcellId, component?)` | `mask` | Direction mask the component has recorded for this subcell; `0` when unowned. With `component` passed, asserts ownership matches (cheap stale-id tripwire); without, reads the owner. Covers `subGetVal` (line 870) and the `subcellOwner`+`subNodeVal` read in `avoidSlotLoops` (1206–1207). |
| `forEachSlot(cellIndex, cb(direction, component))` | `void` | See iteration contract below. Replaces the ND-wide row scans in `pruneLoop` and `resolveComponents`. |
| `slotCount(comp)` | `number` | Open slots of comp — sums the record masks, so it counts slots, not records (two slots at one cell count twice). Island classification; the per-cell internal array renames to `cellSlotCount` to avoid the method-name collision. |
| `subcellCount(comp)` | `number` | Live member subcells of comp (`compSubCount`). Island classification. |
| `totalSubcellCount(comp)` | `number` | Cumulative subcells ever joined (`compTotalSub`) — deliberately not decremented by `removeSubcell`; island deadend weights depend on it. |
| `forEachComponentSlot(comp, cb(cellIndex, directions))` | `void` | Iterates comp's open-slot records. Island shapes read their single member through it. |
| `forEachComponentSubcell(comp, cb(subcellId, directions))` | `void` | Iterates comp's live member subcells the same way. |

**Subcell ids are not registry vocabulary.** `idOf(cell, layer) = cell + layer * total` is the
shared encoding of the whole layers family — game, generator, and solver each define a
private copy today. The registry merely consumes ids; claiming the codec would make game and
generator depend on the registry for a one-liner. Instead, `AbstractGrid` gains
`subcellId(cell, layer)` and `cellLayerOf(id)` — it already owns `total` and is layer-aware —
and the three modules drop their private copies. Callers convert at the boundary
(`this.grid.subcellId(...)`); the registry stores `total` from the grid and does the modulo
inline where its internals need the cell of a subcellId (`attachSubcell`, `merge` validation).

### Mutations

| Method | Returns | Notes |
| --- | --- | --- |
| `create()` | `compId` | Bump-allocated id (`compNew`); ids are never reused. |
| `addSlot(comp, cellIndex, direction)` | `void` | Open one slot: add `direction` to comp's record for the cell (creating the record if absent) **and** set the cell's row entry, bumping `slotCount` when the direction was closed. Fuses `slotSet` + `mergeSlotMask` (1332–1333) and `slotNodeAppend` + `slotSet` (1140–1143) — the two indexes can no longer drift. |
| `attachSubcell(comp, subcellId, direction)` | `void` | A slot resolved into a concrete subcell. One call replaces branch A of `resolveComponents` (1281–1297) plus the deferred cleanup pass (1308–1310): claim ownership, close the resolved slot — clear the cell's row entry **and** drop `direction` from comp's record for that cell (the record goes away when its mask empties; comp's other slots at the same cell survive) — append the subcell node, bump the cumulative subcell count. |
| `setSubcellDirections(subcellId, mask)` | `void` | Replace the recorded mask with the cell's definite connections (1326; also used inside `merge`). |
| `removeSubcell(comp, subcellId)` | `void` | Drop membership when the layer is fully determined (`subDelete`, 1346). Leaves the cumulative subcell count untouched — island deadend weights depend on it. |
| `merge(keep, absorb, subcellId, direction, onSlotCellMoved?, onSubcellMoved?)` | `void` | Absorbs `keep` ← `absorb` after they met at `subcellId` via `direction` (replaces the pre-OR at 1301 plus `mergeComponents`, 1364). First ORs `direction` into keep's record for `subcellId` — `mergeComponents` reads that mask for its overlap validation and to compute the absorbed's leftovers, which is exactly why the current code has to do the OR before calling it. Then moves the absorbed component's slots and subcell memberships to the survivor, repoints rows, closes the row entries for the directions it strips from the absorbed's record at the merge cell (the deferred loop's job today, 1308–1310; clearing an already-closed entry no-ops, so both `merge` call sites can do it unconditionally), accumulates the cumulative subcell count. The two optional callbacks — `onSlotCellMoved(cellIndex, survivor)`, `onSubcellMoved(subcellId, survivor)` — let the solver run `avoidSlotLoops`/`avoidSubcellLoops` for moved members (1393, 1410) without the registry knowing what avoidance is; the survivor is passed back so the solver binds its closures once instead of allocating them per merge (principle 5). Throws `'Invalid merge'` when masks don't overlap — validation is data-only, so it stays. |

### Island checks stay in the solver

Islands are puzzle policy: which components to inspect, what their shapes mean, and what to do
about them. The registry only answers state questions (the count getters and per-component
iterators above). The solver keeps its own worklist — a plain `Set`, in the idiom of `dirty`
and `avoidLoopQueue` — which also deletes the `islandState` 0/1/2 reserved-position machinery
(it existed only because typed arrays cannot delete):

```js
// starts empty in every solver (same as today's islandQ): clones are only
// created from makeAGuess/doShortTrials, outside processDirtyCell's drain
// window, so the parent's set is always empty when copying would happen
this.islandChecks = new Set();
```

Queue discipline is explicit at the same call sites as today: `islandChecks.add(component)`
after `attachSubcell` (1297) and after each `merge` (the survivor, 1303/1340);
`islandChecks.delete(absorbed)` after merges (1304/1341); `islandChecks.clear()` where
`islandClear()` runs today (1531). `addConnection` adds nothing — fresh two-slot components
were never queued. The classification block (1483–1531) stays in `processDirtyCell`:

```js
for (const component of this.islandChecks) {
    const slots = this.components.slotCount(component);
    const subcells = this.components.subcellCount(component);
    if (slots === 0 && subcells === 0) {
        // a sealed component holding every subcell is just the finished puzzle
        if (this.components.totalSubcellCount(component) < this.totalSubcells) {
            throw ISLAND_DETECTED;
        }
    } else if (slots === 1 && subcells === 0) {
        // exactly one opening left; slotCount === 1 subsumes the popcount === 1
        // guard at 1497 - one slot is one direction
        this.components.forEachComponentSlot(component, (cellIndex, directions) => {
            const c = this.getCell(cellIndex);
            const before = c.neighbourDeadends;
            c.addNeighbourDeadend(directions, 0);
            c.neighbourDeadendWeights.set(
                directions,
                this.components.totalSubcellCount(component)
            );
            if (c.neighbourDeadends !== before) this.dirty.add(cellIndex);
        });
    } else if (slots === 0 && subcells === 1) {
        this.components.forEachComponentSubcell(component, (subcellId, directions) => {
            const [index] = this.grid.cellLayerOf(subcellId);
            const c = this.getCell(index);
            const before = c.neighbourDeadends;
            let weight = this.components.totalSubcellCount(component) - 1;
            for (let direction of iterate_directions(directions)) {
                c.addNeighbourDeadend(direction, weight);
                c.neighbourDeadendWeights.set(direction, weight);
                weight = 0; // only the first direction carries the count
            }
            if (c.neighbourDeadends !== before) this.dirty.add(index);
        });
    }
}
this.islandChecks.clear();
```

Two slots at one cell hit no branch (`slotCount === 2`) — today's silent case (1507–1511),
preserved by counting slots instead of records.

### Iteration contract

This is the cryptic comment at 1269–1271, promoted into the one place that owns it:

> `forEachSlot(cellIndex, cb)` visits every open slot of the cell exactly once, in ascending
> numeric direction order. The set of visited positions is fixed for the duration of the
> callback loop — merges mid-loop only repoint entries, never open slots. The `component`
> passed to the callback is read at visit time: repoints are observed as the survivor's id,
> never a stale absorbed id. Slots close only through `attachSubcell` and `merge`, and only at
> the cell where the resolution happened — a slot the callback body resolves is closed at its
> own visit, an entry the loop has already read and will never revisit.

Both backends honor this — the Map version via live Map iteration plus in-place `.set` on
existing keys, the SoA version via a fixed row re-read per position — but only the registry
has to state it, and only the registry's tests have to pin it.

## Solver methods → registry calls

### `constructor` / `clone()` (647, 1638)

- `new ComponentsRegistry(grid, maxLayers)` in the root constructor; `this.components =
  parent.components.clone()` in the parent branch. The ~40 lines of array sizing/slicing
  (676–752) leave the solver entirely.

### `addConnection(index, direction)` (1130)

Purpose: a definite edge between two cells — register it as a new component with two open
ends.

```js
const component = this.components.create();
this.components.addSlot(component, index, direction);
this.components.addSlot(component, neighbour, opposite);
```

Replaces `compNew` + 2×(`slotNodeAppend` + `slotSet`). Cell-side work (`getCell`,
`neighbourCell.addConnection`, dirtying) stays.

### `resolveComponents(index, cell)` (1264)

First half — slots whose layer resolved:

- `hasOpenSlots(index)` — skip the whole scan when the cell has no open slots.
- `forEachSlot(index, ...)` — walk the cell's open slots.
- `cell.getAnsweringLayer(direction)` — solver policy, unchanged.
- `getSubcellComponent(subcellId)` — the three-way decision. Every arm closes the resolved
  slot (row entry + record) inside its registry call; there is no separate cleanup pass and
  no `removedDirections` bookkeeping:
  - none → `attachSubcell(component, subcellId, direction)` (then `avoidSubcellLoops` and
    `islandChecks.add`).
  - same → `throw LOOP_DETECTED` (solver policy).
  - different → `merge(otherComponent, component, subcellId, direction, hooks)` — the merge
    records `direction` into the survivor's record itself, then validates and absorbs.

Second half — subcells with new definite connections create new slots:

- `getSubcellComponent(subcellId)`, `getSubcellDirections(subcellId)` — what does this
  subcell's component already know?
- `setSubcellDirections(subcellId, connections)` — record the full definite mask.
- `getSlotComponent(neighbour, opposite)` — replaces the inline row arithmetic at 1330; the
  same three-way decision follows:
  - none → `addSlot(component, neighbour, opposite)` + `islandChecks.add(component)` +
    `avoidSlotLoops`.
  - same → `throw LOOP_DETECTED`.
  - different → `merge(component, otherComponent, subcellId, direction, hooks)` (the OR is an
    idempotent no-op here — `setSubcellDirections` already recorded the full mask).
- `removeSubcell(component, subcellId)` when `popcount(connections) === layerPopcounts[layer]`
  — the subcell is fully determined and leaves membership.
- `pruneLoop(index, cell)` — unchanged, solver-side.

### `mergeComponents` → `merge` (1364)

Becomes a registry method. The solver supplies callbacks so the avoidance heuristics follow
moved members. The registry passes the survivor back, so the solver creates its closures once
(in the constructor — they live per solver instance, and clones already slice a dozen typed
arrays, so two closures are noise) instead of allocating them per merge — merges are hot:

```js
// once per solver instance, in the constructor
this.mergedSlotCellHook = (cellIndex, component) =>
    this.avoidSlotLoops(cellIndex, component);
this.mergedSubcellHook = (subcellId, component) => {
    const [index, layer] = this.grid.cellLayerOf(subcellId);
    this.avoidSubcellLoops(index, layer, this.getCell(index), component);
};

// at each merge call site
this.components.merge(
    keep, absorb, subcellId, direction,
    this.mergedSlotCellHook, this.mergedSubcellHook
);
```

Note the callbacks fire into solver code that itself uses only registry queries — no reentrancy
into mutations.

### `pruneLoop(index, cell)` (1244)

- `forEachSlot(index, (direction, component) => this.avoidSlotLoops(index, component))` —
  replaces the manual ND scan (1246–1250); no `slotCount` guard needed since closed entries
  are skipped.
- `getSubcellComponent(subCellId)` per layer → `avoidSubcellLoops` when owned.

### `avoidSubcellLoops` (1178) / `avoidSlotLoops` (1195)

- `getSubcellDirections(subcellId, component)` — the already-known mask subtracted from
  potential connections (1181).
- `getSubcellDirections(subcellId)` — single-arg form for `avoidSlotLoops`' "subtract what
  this cell's subcells already contribute" (1206–1207).
- `getAnsweringComponent(index, direction)` — still solver-level (see below).

### `getAnsweringComponent(index, direction)` (1153)

Stays in the solver — it asks cells and layers, which is exactly the dependency direction the
registry must not have. It shrinks to a composition:

```js
const slotComp = this.components.getSlotComponent(index, direction);
if (slotComp !== 0) return slotComp;
const layerIndex = neighbourCell.getAnsweringLayer(opposite);
if (layerIndex !== undefined) {
    return this.components.getSubcellComponent(this.grid.subcellId(neighbour, layerIndex));
}
return 0;
```

### `processDirtyCell` island block (1483–1531)

Stays in the solver, nearly shape-identical to today: the `islandQ`/`islandState` reads become
iteration over `this.islandChecks`, and the `compSlotCount`/`compSubCount`/`compTotalSub`/
head-node reads become `slotCount`/`subcellCount`/`totalSubcellCount` and the per-component
iterators. See "Island checks stay in the solver" for the full block. The `popcount === 1`
guard on the single-slot shape disappears for real: `slotCount(comp) === 1` already means one
direction. Dirtying, `addNeighbourDeadend`, and the weights map are cell machinery and stay.

Untouched by design: `makeAGuess`, `doShortTrials`, `markAmbiguousTiles`, `getCell`,
`processDirtyCells` — they touch no registry state directly (cloning flows through the
constructor).

## Invariants the registry must preserve

`validate()` (fuzz-gated) should assert the ones the current comments promise:

1. `slotCount[cell]` equals the number of non-zero entries in the cell's row; an all-zero row
   is indistinguishable from never having had ends.
2. A live component's slot list keys are exactly the cells whose row entries point at it, and
   its subcell list keys are exactly the subcells whose `subcellOwner` points at it (the
   "moving, not copying" contract documented on `mergeComponents`, 1354–1359).
3. `slotRepoint`'s guard: a merge never creates a row entry — it may only repoint ends that
   still exist (creating one would resurrect a resolved edge and fabricate a join).
4. Ids are never reused; `0` is "no component"; `compTotalSub` only grows.
5. Per-component slot records aggregate a component's slots per cell, so the record count
   (`compSlotCount`) is not a slot count; the public `slotCount(comp)` sums masks. Nothing
   outside `validate()` may treat the record count as a slot count.

## Implementation order

Each step ends with: full test suite, the cross-solver fuzz, and the benchmark vs
`solver-layers-baseline.js` (workflow, exact commands, and gates in
`agent-doc/solver-perf-plan.md`; harnesses in `scratch/`).

0. **Grid codec.** Add `subcellId`/`cellLayerOf` to `AbstractGrid`; switch game, generator,
   and solver to them and delete the three private `idOf` copies. Independent of everything
   else, no behavior change.
1. **Extract, verbatim.** New `src/lib/puzzle/components-registry.js` holding the arrays, the
   constructor/clone sizing, and the existing helpers (`compNew`, node ops, island ops, slot
   ops, `dirPos`). The solver delegates one-to-one; no signature changes yet. Pure code
   motion — fuzz should be byte-identical.
2. **Queries.** Add the query methods; rewrite the read sites (`pruneLoop`, both halves of
   `resolveComponents`, `avoidSlotLoops`, `getAnsweringComponent`) to kill every inline row
   expression. `getAnsweringComponent` is the readability jackpot.
3. **Compound mutations.** `addSlot`, `attachSubcell`, `setSubcellDirections`, `removeSubcell`;
   rewrite `addConnection` and `resolveComponents` around the three-way decisions.
4. **`merge` with hooks** — absorb `mergeComponents`; delete it from the solver.
5. **Island checks to the solver.** Add the count getters and per-component iterators;
   replace the `islandQ`/`islandState` machinery with the solver's `islandChecks` Set; the
   1483–1531 block stays in `processDirtyCell`, reading the getters.
6. **`validate()`** wired into the fuzz test; update the registry section of
   `agent-doc/layers-solver.md` to describe the class instead of the raw arrays.

Steps 1–2 are safe and most of the win; steps 3–5 are where the solver's `resolveComponents`
collapses from ~90 lines of bookkeeping to a readable decision tree.

## Alternatives considered

- **Iterator instead of `forEachSlot`** (`for (const { direction, component } of ...)`) —
  nicer at call sites, but allocates an iterator plus an object per slot in the hottest loops
  (`pruneLoop` runs per dirty cell). The codebase already tolerates `iterate_directions`
  generators, so this is reversible if benchmarks say the callback form doesn't matter.
- **`getAnsweringComponent` inside the registry** — rejected: it would make the registry
  depend on `LayeredCell`, inverting the dependency direction for one convenience.
- **Registry-owned island worklist and classification (`queueIslandCheck`/`drainIslands`)** —
  rejected: islands are solver policy, and the worklist is just a deduped set of component
  ids. It became a plain `Set` on the solver (the idiom of `dirty`/`avoidLoopQueue`), which
  also deletes the `islandState` reserved-position machinery; the count getters came back for
  the solver's classification, in slot terms. One deliberate de-optimization: the typed-array
  queue becomes a `Set` — the benchmark gate will say whether that matters.
- **`merge` choosing its own survivor** — rejected: which side survives is currently
  meaningful (the subcell's component absorbs the slot's component in one call site, vice
  versa in the other), and the solver's island/loop handling is phrased in terms of the
  survivor. Keeping `keep` explicit costs nothing.
- **A standalone `removeSlot` on the public API** — dropped: `slotRemove` has exactly one
  caller, the deferred cleanup loop in `resolveComponents`, and every direction it removes has
  just gone through attach or merge. Closing a slot is part of the operation that resolves it,
  so `attachSubcell` and `merge` do it themselves and the cleanup pass disappears along with
  the `removedDirections` bookkeeping.
- **`addSubcellDirections` as a public method** — dropped: its only caller was the pre-OR at
  1301, needed solely so `merge`'s own overlap validation could pass — solver-visible
  bookkeeping in service of a registry-internal check. `merge` takes the meeting `direction`
  and does the OR itself; the second-half call site passes a direction that
  `setSubcellDirections` already recorded, where the OR is an idempotent no-op.
