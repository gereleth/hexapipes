# Solver performance — results and remaining work

Status: series in progress on the `layers` branch.

## Goal and ground rules

- Target metric: **generation time** — `markAmbiguousTiles` wall time in the generator's
  uniqueness/patience loop (`LayeredGenerator.uniqueIterations`: fresh `LayeredSolver` per
  iteration, `ambiguousLimit = max(100, 0.1 * grid.total)`). The UI solve animation is a debug/fun
  feature and does not matter. The goal is throughput and tail headroom (larger boards, faster
  patience-loop convergence).
- Priority grid: hexagonal 20×20 (mean and tail); square tracked as a sanity side.
- Solver changes are compared against a reference snapshot:
  `src/lib/puzzle/solver-layers-baseline.js` — verbatim copy of the pre-change solver, untracked on
  purpose. Re-baseline only on explicit user command: copy over the solver file and update its
  header with commit info.
- The main comparison tool is the paired benchmark:
  `BENCH_SEED=20260921 BENCH_MARK_AMBIGUOUS=1 npx vitest run src/lib/puzzle/solver-layers-stats.test.js`,
  2×200 boards.
- Decision-preserving candidates require 0 capped, 0 verdict disagreements and all-zero work-counter
  deltas in the seeded paired benchmark.
- Decision-shifting candidates require 0 solvable/unique disagreements in the paired benchmark and
  an additional extra-large solution-list equivalence check vs the snapshot:
  `FUZZ_SOLUTIONS=1 FUZZ_STABLE_RUNS=1000 npx vitest run src/lib/puzzle/solver-layers-fuzz.test.js`
- Additional gates per change: unit + layered suites, `npm run check` with no new errors in touched
  files, prettier clean.

## Profiling tooling

- `scratch/profile-driver.mjs` — replays the benchmark's exact PRNG draw order for any (seed, kind,
  board index), cross-checks verdict + all four counters against the paired JSON (a replay bug
  almost surely mismatches a different board), then profiles N fresh `markAmbiguousTiles` runs via
  the inspector Profiler domain, so module loading and board replay stay out of the profile. Run via
  `npx vite-node` (resolves `$lib`); profiles land in `/tmp/opencode/prof/`.
- `scratch/analyze-cpuprofile.mjs` — self-time per function and per phase bucket
  (innermost-matching-frame attribution). Two gotchas it works around: `Profiler.stop`'s fixed ~200
  ms serialization gets sampled into the profile (bucket `(node/profiler)`, excluded from
  percentages), and per-function total time is not well-defined — V8 nodes are unique per call path,
  so the same function has one node per call site, each with its own subtree total; self time is
  path-independent and exact, so the analyzer reports self-time and per-phase inclusive attribution
  only.
- `scratch/dump-board.mjs` — dumps any benchmark board as JSON (seeded, replay verified): the
  benchmark tiles (solved orientation), a fresh `randomRotate` scramble (UI-importable), and solve
  facts for both.
- Reference run: seed `20260921`, 2×200 boards — 0 capped, 0 disagreements, all counter deltas
  exactly 0 (candidate == baseline at the time). Its paired JSON is the series' comparison base;
  `scratch/compare-bench.mjs` compares runs.

## Noise methodology

The frozen baseline's own hexa mean at series start swung 276–311 ms across six gate runs (±6%) with
zero code change; each per-cycle delta carries ±4–6 pt error bars. Rules of thumb: trust the work
counters (deterministic) for anything cross-session; for wall time prefer medians (the mean is
tail-dominated — a single 13 s board moves it by ~5 ms); treat single-run deltas as indicative;
chain-multiplying per-cycle deltas overstates cumulative gains because it compounds noise.

## Done

- faster getAnsweringLayer (birth tables+bitmasks, short path for single-layer cells)
- avoidSlotLoops rework
- ~~makeAGuess cell materialization cost~~ confirmed negligible
- exception sentinels thrown by reference (2026-09-26)

## Remaining work

1. **resolve/merge** — re-measured at 9.7% after the SoA registry (was 12.8%/12.2%); now roughly
   tied with applyConstraints and loop-avoidance.
2. **cell.clone + cell-init/getCell** — 9.8% + 9.5% on hexa[95] post-SoA; the cell machinery is now
   co-lead of what remains. Untouched by the registry rewrite.
3. **Demoted unless free**: neighbour table (≤0.9%), unionAt memo (≤0.8%), leftover `remove` array
   reuse (once-per-pass filters), `iterate_directions` inlining (4.4% but spread over ~15 call sites
   — call overhead only), `sliceCapacity` headroom tuning (9.3% is pure memcpy in clones; only a
   smaller/faster clone shape would move it).

## Related but out of scope

- **Scramble before the uniqueness loop (new, generator-side)**: benchmark boards arrive in solved
  orientation, and `makeAGuess` picks the first surviving rotation — usually the correct one on
  unscrambled input, which shapes the whole trial tree. A fresh `randomRotate` before the loop
  changes the search radically: heavy board hexa[95] dropped 62078 → 29566 iterations (30980 → 14721
  clones, numAmbiguous 122 → 101), while p90 board hexa[42] was stable (156 vs 155 iterations).
  Caveats: the patience loop would observe different `numAmbiguous` counts, so generated puzzles
  differ; needs its own correctness/quality analysis. Study material:
  `generator_stats/board_hexagonal_{95,42}_seed20260921.json` (regenerate with
  `scratch/dump-board.mjs`).
- Generator-side solver-state reuse across uniqueness-loop retries (instead of a fresh
  `LayeredSolver` per iteration).
- New deduction rules (parity in narrow passages etc.) — the formalization gap is the blocker.
- The ambiguity overcounting in `markAmbiguousTiles` — decided and accepted (the full-search
  alternative is 3–4× slower).

## Worklog

### Measured pre-series shares (hexa[42] p90 and hexa[95] heavy tail)

| phase (self time)                                  | p90   | heavy |
| -------------------------------------------------- | ----- | ----- |
| answering-scans (`getAnsweringLayers` + component) | 19.8% | 20.3% |
| clone (solver constructor)                         | 15.2% | 15.3% |
| loop-avoidance (`avoidSlotLoops` 13–15% self)      | 18.0% | 15.0% |
| GC                                                 | 7.9%  | 12.3% |
| resolve/merge                                      | 9.0%  | 9.5%  |
| applyConstraints (+ deadends + unionAt)            | 8.3%  | 8.8%  |
| dirty-processing                                   | 6.7%  | 5.4%  |
| cell.clone + cell-init/getCell                     | 9.9%  | 8.4%  |
| grid-helpers (`find_neighbour`)                    | 0.5%  | 0.2%  |
| unionAt                                            | 0.1%  | 0.8%  |

Answering scans and clone lead, `applyConstraints` is mid-pack. Grid helpers and unionAt are
near-noise. GC at 8–12% is the honest measure of the allocation-cleanup item.

### Step 1: landed changes

All in `solver-layers.js`. Cycle deltas are within-run paired vs the frozen snapshot. All four
sub-steps of 1–2 are bundled in commit `5edcedb4`, so per-cycle attribution is approximate.

#### 1. Answering-layer cache

Per-cell memo of `getAnsweringLayers` results keyed by direction, invalidated by an (identity, size)
check on `possible` — sound because mutations are only entry deletions (size shrinks) or whole-map
replacement (identity changes). Manual version bumps at ~10 mutation sites were rejected: one missed
site means silent wrong search, the choke-point check fails safe. Hexa mean −6.2%, p99 −7.7%, max
−7.4%; square mean −3.7%. Answering-scans 20.3% → 13.2% self on the heavy board — the remaining
floor is cache rebuilds after every filter pass. (Ablated 2026-09-25: after the birth tables the
memo no longer pays for itself)

#### 2. `avoidSlotLoops` rework

- **Alloc-free fold**: the per-layer `new Set(...)` uniqueness check became an early-breaking
  equality fold. The Set ran millions of times per heavy board (per slot, per dirty pass, per layer)
  — allocation churn far beyond its self-time share. Hexa mean −20.0%, p90 −30%, max −20%; square
  −7.1%.
- **`repeatLayersMask`**: birth-time bitmask of layers whose masks repeat across rotations — only
  these can be solved (all surviving rotations agreeing) while `possible.size > 1`, because layers
  with pairwise distinct masks differ between any two surviving rotations; the fold runs only for
  them. Hexa mean −15.8% cycle, p90 −26%; square −6.5%. (Readable Set-based derivation; the mask is
  passed down through `clone`, which also skips recomputing it for clone cells.)
- **Solved-cell early return**: a cell with one surviving rotation returns immediately. Hexa mean
  −18.2% cycle, p90 −34%; square −9.1%. Loop-avoidance self-time: 18.6% → ~8%.

#### 3. Answering birth tables + bitmasks (`bf55efdf`)

`getAnsweringLayersMask(direction)` returns a layer-index bitmask: a layer answers iff any of its
birth rotations that connect the direction is still a survivor. `answerRotations` (per grid
direction bit position × layer index: a bitmask of the rotations whose mask connects them) is fixed
at cell birth and passed down through `clone` (sound for any subset of the original `possible` —
survivors only shrink); the per-direction result is memoized in a plain array behind the same
staleness check. No Set allocations anywhere on the query path. `getAnsweringLayer(direction)`
exposes the unique layer index or `undefined`, keeping popcount/clz32 inside the cell.
Answering-scans 13.2% → 7.2% self; step estimate ~−15% hexa mean (cross-run); GC eased to ~10%.

#### Cumulative result

Within-run paired, last fully documented gate (seed 20260921):

|             | pre-series | current  | Δ      |
| ----------- | ---------- | -------- | ------ |
| hexa mean   | 301.1 ms   | 190.8 ms | −36.6% |
| hexa p50    | 65.6 ms    | 41.7 ms  | −36%   |
| hexa p90    | 510.7 ms   | 320.1 ms | −37%   |
| hexa p99    | 5362 ms    | 3339 ms  | −38%   |
| hexa max    | 17.03 s    | 11.37 s  | −33%   |
| square mean | 168.9 ms   | 143.3 ms | −15.1% |

188/200 hexa boards improved (12 regressed), 163/200 square improved. The two runs after that (pure
refactor + readable-derivation cycles) show candidates of 180–191 ms hexa / 121–143 ms square —
board-matched against the original reference run (295 ms / 163 ms) that is roughly −36…−39% hexa and
−15…−25% square, with the noise caveat above.

Profile shares (hexa[95], post-step-1): clone (solver) 22.5% + cell.clone 6.5%, resolve/merge 13.5%,
GC 10.2%, applyConstraints 9.5%, loop-avoidance 8.2%, answering-scans 7.2%, cell-init/getCell 7.0%,
dirty-processing 6.7%, iterate_directions 3.6%.

### Step 2 - Single-layer fast path in `getAnsweringLayer` (first decision-shifting change)

Single-layer cells answer `getAnsweringLayer(direction)` with `0` unconditionally, skipping the mask
memo, and the constructor skips the `answerRotations` birth table for them (`getAnsweringLayersMask`
gained a defensive tableless path computing the exact single-layer mask inline, so its contract
holds standalone and the field is an honest `Uint32Array|undefined`).

The behavioral delta the acceptance rests on: when a single-layer cell's surviving rotations permit
no connection in the requested direction at all, the old code returned `undefined` ("no unique
answering layer" — callers defer), the new code returns layer 0, so `resolveComponents` joins the
subcell into the slot's component eagerly and `getAnsweringComponent` probes its layer-0 subcell
component. Such a slot is contradictory anyway — no surviving rotation can realize the connection —
so the shift only reorders work a doomed branch was going to do or discard. Measured on seed
20260921 against post-step-1 baseline across three paired runs (user run, then two with the
defensive path added — decision-identical, same counter-delta board sets every time): work counters
moved on 95/400 boards (dirtyProcessings −63…+839, iterations on 2 boards ±3, shortTrials on 2
boards −5…+16, trialClones never), verdicts (`unique`/`solvable`/`numAmbiguous`) identical on all
400 boards in every run, 0 capped. The ground-rules extra-large solution-list equivalence check vs
the snapshot
(`FUZZ_SOLUTIONS=1 FUZZ_STABLE_RUNS=1000 npx vitest run src/lib/puzzle/solver-layers-fuzz.test.js`)
reported no discrepancies. Wall time, geomean paired: square −4.7/−2.9/−4.9% (154–179/200 improved)
— a consistent win; hexa −1.2/+3.9/−0.1% — noise around zero within the documented ±4–6 pt bars (the
+3.9% run shares its decision paths byte-for-byte with the −1.2% one).

### Step 3 - Ablation (2026-09-25): is the answering-layer cache still needed?

In step 1 the answering layers memo predates the birth tables (step 1 §3): it amortized the
expensive `getAnsweringLayers` Set scan, but after the birth tables a cache miss is only a survivor
fold plus `layerCount` table probes, and every `possible` mutation invalidates the cache anyway — so
misses should dominate. Question: does the memo still pay for itself?

Setup: worktree branch `worktree-ablate-answering-cache` on `fb617f42`; the with-cache HEAD frozen
as `solver-layers-baseline.js` (the paired benchmark's baseline side), candidate `solver-layers.js`
with the memo removed — `answeringMaskCache`, `answeringSurvivors`, `answeringCachePossible`,
`answeringCacheSize` and the (identity, size) staleness check dropped, so `getAnsweringLayersMask`
recomputes survivors + mask from `answerRotations` on every call (−41/+9 lines, commit `5e0d3ffd`).
Gates: unit suites 121 green, `FUZZ_SOLUTIONS=1` fuzz green (solution lists identical), svelte-check
zero mentions of `solver-layers.js`.

Paired benchmark, seed 20260921, 2×200 boards, 3 runs. Validity every run: 0 capped, 0 verdict
disagreements, all four work counters exactly 0-delta (mean/min/max) on all 400 boards —
decision-preserving, times directly comparable.

| geomean paired (no-cache vs with-cache) | run 1  | run 2  | run 3  |
| --------------------------------------- | ------ | ------ | ------ |
| square                                  | −2.14% | −2.84% | −2.48% |
| hexagonal                               | −0.17% | +0.57% | +0.36% |

Square: 157/184/171 of 200 boards faster without the cache (±0.5% bands) — a consistent ~2.5% win
for removal. Hexa: coin-flip per-board splits (100/78/58 faster), deltas well inside the noise bars.
Absolute means for orientation (run 2): square 109.0 → 106.1 ms, hexa 170.3 → 170.8 ms; this machine
runs faster than the cumulative-result snapshot above (hexa p50 ~30 ms vs 41.7), so only the
within-run paired deltas matter.

Conclusion: the cache is dead weight. Dropping it is decision-preserving, neutral on the hexa target
metric, a small consistent square win.

### Side-find (2026-09-26): never dirty-processed cells (general solver fix, not a perf step)

While trying a fix for the makeAGuess cell materialization cost item we discovered that cells can be
**materialized without ever being dirty-processed** — pure query paths call `getCell` without
dirtying (`getAnsweringComponent`, `mergeComponents`'s `avoidSubcellLoops` arg, island branches, the
`doShortTrials`/`makeAGuess` scans), and `processInitialDeductions`' `unsolved.has` skip treats
"materialized" as "processed". Such a cell never ran `applyConstraints`, so its birth-derivable
deadend directions/weights never reached its neighbours — the solver worked on incomplete info.

Fix for general correctness: `getCell` adds the freshly born cell to `dirty` right after
`doLocalDeductions`; that function's two conditional `dirty.add`s became redundant and were dropped.
One add suffices: after initial deductions every root cell is materialized, so only the birth path
can produce never-processed cells, and cells materialized mid-drain by queries are swept by that
same drain. Clones only materialize via the parent path (already-processed cells). Regression test
in `solver-layers.test.js` ("Dirty-processes every materialized cell") pins hardcoded generated
tiles (4×4 wrap grid) whose pre-fix run leaves one such root cell (cell 10).

Gates (decision-shifting vs the pre-fix snapshot, seed 20260921): 0 capped, 0 solvable/unique
disagreements on 2×200 boards, fuzz (`FUZZ_SOLUTIONS=1 FUZZ_STABLE_RUNS=1000`) green; numAmbiguous
moved on 1/400 boards (square, 102 → 100). Work counters shifted as expected — newly processed cells
add passes but earlier deadend pruning removes search: square dirtyProcessings mean −485/board, hexa
+63; square wall mean −5% (118.2 → 112.2 ms), hexa −1% (186.2 → 184.4 ms).

### Dropped: makeAGuess cell materialization cost (2026-09-26)

`makeAGuess` in cloned solvers forces copying cells from parent just to check their possible size.
Attempted fix: unsolved cells store `UNSOLVED - possible.size` in `solution`, written at the end of
`processDirtyCell` loop.

Baseline re-frozen at `9f4fee54` (dirty-on-materialization fix) per the re-baseline procedure, and
the negative-count `solution` encoding reapplied on top. Decision-preserving: 3 paired runs (seed
20260921, 2×200 boards) with 0 capped, 0 verdict diffs and all four work counters exactly 0-delta in
every run. Wall time neutral: per-run mean deltas −2.1/+2.3/+0.1 ms square and −4.3/±0/±0 ms hexa,
inside the ±4–6 pt noise bars.

The baseline scan pays parent-chain cloning into every trial clone for all scan candidates; the
encoding defers that cloning to propagation time and only cells in the trial's propagation cone are
ever copied — strictly less cloning, but the escaped cells are few and cloning is cheap next to
propagation, so it nets zero. Dropped (not committed).

### Profile refresh (2026-09-26): current solver after the re-baseline

Re-ran `scratch/profile-driver.mjs` (hexa[42] p90, hexa[95] heavy; 3 reps, 100 µs) against the
paired JSON regenerated 2026-09-26 at `9f4fee54` (0 capped, 0 disagreements, all counter deltas 0 —
candidate == baseline, so this JSON is the fresh comparison base). Replay verified on both boards.
Profiles: `/tmp/opencode/prof/hexagonal-{42,95}.cpuprofile`. Hexa[95] shares match the post-step-1
snapshot within ~1 pt everywhere except dirty-processing (6.7 → 8.8%, expected from the
dirty-on-materialization fix).

| phase (self time)            | hexa[42] | hexa[95] | hexa[95] post-step-1 |
| ---------------------------- | -------- | -------- | -------------------- |
| clone (solver constructor)   | 21.4%    | 22.5%    | 22.5%                |
| resolve/merge                | 12.2%    | 12.8%    | 13.5%                |
| GC                           | 5.4%     | 9.0%     | 10.2%                |
| loop-avoidance               | 10.5%    | 8.8%     | 8.2%                 |
| dirty-processing             | 11.1%    | 8.8%     | 6.7%                 |
| applyConstraints (+deadends) | 11.4%    | 9.4%     | 9.5%                 |
| answering-scans              | 6.4%     | 7.7%     | 7.2%                 |
| cell-init/getCell            | 9.2%     | 6.8%     | 7.0%                 |
| cell.clone                   | 5.6%     | 6.7%     | 6.5%                 |
| iterate_directions           | 3.7%     | 4.1%     | 3.6%                 |

**Ordering conclusion: the clone complex, not resolve/merge, is the top remaining target** — 22.5%
constructor + 6.7% cell.clone + a large share of the 9% GC on hexa[95] (the constructor's
per-trial-clone component-registry copy: ~82 µs × 30 980 clones/rep), ~27% + 5.6% + 5.4% GC on
hexa[42]. Remaining work reordered accordingly.

**Side-find: `throw LoopDetectedException()` is missing `new`** (`solver-layers.js:903`, `:947`). In
strict-mode ESM `this` is `undefined` inside the constructor, so the real value thrown on every loop
detection is a `TypeError` (allocated with a stack capture at the `this.name` assignment) — ~1.9%
constructor self time (651 ms) on hexa[95], absent from hexa[42]'s top-30 (tail-specific).
Behaviorally neutral today: every catch site is a catch-all backtrack (`:1256`, `:1294`, `:1361`,
`:1386`), nothing discriminates on type (no `instanceof`, no `.name` checks, no test references),
and the counters matching baseline byte-for-byte confirms identical decisions. But it is a landmine
— a genuine `TypeError` from any code defect inside propagation is indistinguishable from a loop
backtrack and gets silently eaten. Fix: module-level singleton
(`const LOOP_DETECTED = new LoopDetectedException()`, `throw LOOP_DETECTED`) — kills the per-throw
allocation + stack capture. `IslandDetectedException` (`:1079`) and
`NoOrientationsPossibleException` (`:514`) already use `new` (plain objects, no stack capture).

### Landed: exception sentinels thrown by reference (2026-09-26)

`LOOP_DETECTED`/`ISLAND_DETECTED` module-level singletons; both `LoopDetectedException` throw sites
and the `IslandDetectedException` site throw the shared instances. `NoOrientationsPossibleException`
keeps its per-throw `new` — it carries the cell index in its message and is not hot. `solver.js`
(classic solver) already used `new` everywhere and is not the target; untouched. Caveat noted in the
code: the singletons are safe only because catch sites never inspect or retain the thrown value —
same assumption the catch-alls already made.

Gates: unit + layered suites 268 green; paired benchmark (seed 20260921, 2×200) 0 capped, 0
disagreements, all four work counters exactly 0-delta (min/max) on all 400 boards —
decision-preserving; `npm run check` zero mentions of `solver-layers.js`; prettier clean. Wall time
within-run paired: hexa mean −3.55 ms (177.1 → 173.6 ms), p50 −0.14 ms; square p50 +0.2 ms, mean
+2.89 ms (noise; square boards throw far less — trialClones mean 45 vs hexa 214). Re-profiled
hexa[95]: `LoopDetectedException` gone from the top-functions list, wall −2.3% (rep mean 11.33 →
11.06 s), phase shares otherwise stable (clone 22.9%, resolve/merge 10.7%, GC 9.7%); hexa[42]
unchanged. The paired JSON regenerated by the gate run is the new comparison base (candidate side
now includes the fix).

### Step 4 — SoA component registry (2026-09-27, `soa-registry` branch)

Replaced the Map-of-Maps component registries (`subcellComponents`, `slotComponents` + inner Maps,
`LayeredComponent` objects) with struct-of-arrays `Int32Array` registries so `clone()` is a handful
of memcpys. Components are bump-allocated integer ids (never reused, 0 = none); per-component
columns + intrusive doubly-linked member lists; `subcellOwner`/`subcellNode` inverse index;
`slotDirect` (point lookup, `cell*ND + bitPos`) + `slotOrder`/`slotOrderComp` (per-cell insertion
order, reproducing inner-Map iteration) + `slotCount`; island queue as an epoch-filtered array with
exact Set semantics. `ND` derives from `grid.DIRECTIONS` (the grid-level union of direction bits) —
correct for mixed grids (octa/rhombitrihexa/trihexa use per-cell-class subsets up to bit 7; a new
all-grid smoke test in `solver-layers.test.js` pins this, the layered suite previously covered only
square+hexa). Written in the `soa-registry` worktree branched from the `layers` tip.

**Lazy copy-on-write was rejected first** (measured reasoning, not profiles): every trial clone is
born with a guessed cell forced to one rotation, so its first dirty pass reaches `addConnection` and
writes the registry — the never-write fraction is ~0 and deferring the copy defers nothing.

Two bugs found and fixed during development, both invisible to unit tests and caught by custom
drivers before any benchmark run:

1. `slice(0, n)` on a shorter parent array returns a SHORTER array — clone registries could be
   under-length and later appends wrote out of bounds (typed arrays discard OOB writes silently),
   leaving head/tail pointing at never-written indices; `while (n !== 0)` then spins on `undefined`.
   Fixed with `sliceCapacity` (exact-length, truncate-or-zero-extend).
2. Iteration-order/ownership drift: merge bookkeeping that faithfully copies Map semantics (stale
   component-side slot entries outliving deleted registry maps, membership by registry lookup)
   diverged from the baseline's search order on ~40% of boards. Root cause chain found with op-level
   tracing (dirty-set insertion order, island-queue flush order, ownership dumps): a merge's subcell
   transfer keyed membership off the registry owner, but a survivor's list can contain entries whose
   registry ownership was stolen by a third component — Map.set updates that stale entry in place,
   appending instead duplicates it. Fixed by switching mergeComponents to MOVE semantics (entries
   transfer, absorbed emptied) which restores the invariant that a live component's list keys are
   exactly its owned keys — plus the guarded `?.`-faithful slotRepoint (an unconditional repoint
   resurrected consumed slots and created joins the original never performed).

Decision-preserving was abandoned with evidence: work counters move on a minority of boards (61/400
dirtyProcessings-only, ~17 with search-counter moves, 2 numAmbiguous) because merge bookkeeping
order differs; solvable/unique agree on all 400 boards. **Gated as decision-shifting**: fuzz
`FUZZ_SOLUTIONS=1 FUZZ_STABLE_RUNS=1000` green (full solution lists identical vs the snapshot).
Unit + layered suites 268 green (incl. the new all-grid smoke test); `npm run check` zero mentions
of touched files; prettier clean. Debug tooling used: op-tracing drivers (deleted),
`scratch/zombie-detector.mjs` (its object-shaped instrumentation cannot validate the SoA solver —
expected, its job was done).

Wall time, within-run paired (seed 20260921): hexa mean 177.9 → 134.8 ms (−24%), square 107.0 → 90.3
ms (−16%); hexa p99 3358 → 2804 ms, max 11.5 → 8.6 s. Re-profiled hexa[95] (11.3 → 8.2 s/rep): clone
(solver) 22.9% → 17.4% — now mostly `sliceCapacity` memcpy (9.3%) — GC 9.7% → 6.2%, resolve/merge
10.7% → 9.7%, cell.clone 9.8% and cell-init/getCell 9.5% are the co-leads of what remains. hexa[42]:
~300 → ~230 ms/rep. The gated paired run regenerated the paired JSON (candidate = SoA solver) — the
new comparison base.

### Step 4b — drop Map insertion-order fidelity (2026-09-27, same branch)

Follow-up simplification: with decision preservation already abandoned, the machinery that
reproduced Map/Set iteration order served no remaining purpose. `slotOrder`/`slotOrderComp` deleted
— slots now live only in `slotDirect` and iterate in numeric direction order (block-1 of
`resolveComponents` and `pruneLoop` scan the cell's ND-wide row; `slotSet`/`slotRemove` are single
O(1) writes maintaining `slotCount` for the `?.`-guard). The island queue's epoch/generation columns
(`islandQSeqAt`, `islandCurSeq`, `islandEpoch`) deleted — `islandState` (0 never / 1 queued / 2
deleted-with-reserved-position) is enough: a re-add reactivates the reserved position, so every
component is visited at most once per flush without any sequence numbers. Two fewer arrays per
solver, no append-scan, no order-preservation invariants left to maintain.

Side-find: `generator-layers.test.js` "Mirrors growth events with startLayers reuse" is **inherently
flaky** — it is unseeded, and over 200 seeded runs the `applyGrowthMoves` animation replay
mismatches the generator on the SAME 5 seeds (56, 58, 94, 136, 159) pre-SoA and post-SoA alike (a
`move` push can leave a direction duplicated in a cell the generator later resolved differently).
Not a solver regression; worth fixing separately (seed it, or make the replay faithful).

Gates, decision-shifting: solvable/unique 0 diffs on all 400 paired boards; fuzz
`FUZZ_SOLUTIONS=1 FUZZ_STABLE_RUNS=1000` green; unit + layered suites 268 green; check/prettier
clean. Wall, within-run paired: hexa mean 169.1 → 123.0 ms (−27%), square 105.4 → 80.4 ms (−24%).
hexa[95] profile: clone (solver) down to 15.0% (fewer arrays to slice), GC 5.4%; the profile is now
flat — no bucket above 15%, everything else 9-11% (answering-scans 10.4%, dirty-processing 10.2%,
applyConstraints 9.9%, resolve/merge 9.9%, cell-init/getCell 9.8%, cell.clone 9.5%, loop-avoidance
8.9%).
