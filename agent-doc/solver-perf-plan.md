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

- `scratch-profile-driver.mjs` — replays the benchmark's exact PRNG draw order for any (seed, kind,
  board index), cross-checks verdict + all four counters against the paired JSON (a replay bug
  almost surely mismatches a different board), then profiles N fresh `markAmbiguousTiles` runs via
  the inspector Profiler domain, so module loading and board replay stay out of the profile. Run via
  `npx vite-node` (resolves `$lib`); profiles land in `/tmp/opencode/prof/`.
- `scratch-analyze-cpuprofile.mjs` — self-time per function and per phase bucket
  (innermost-matching-frame attribution). Two gotchas it works around: `Profiler.stop`'s fixed ~200
  ms serialization gets sampled into the profile (bucket `(node/profiler)`, excluded from
  percentages), and per-function total time is not well-defined — V8 nodes are unique per call path,
  so the same function has one node per call site, each with its own subtree total; self time is
  path-independent and exact, so the analyzer reports self-time and per-phase inclusive attribution
  only.
- `scratch-dump-board.mjs` — dumps any benchmark board as JSON (seeded, replay verified): the
  benchmark tiles (solved orientation), a fresh `randomRotate` scramble (UI-importable), and solve
  facts for both.
- Reference run: seed `20260921`, 2×200 boards — 0 capped, 0 disagreements, all counter deltas
  exactly 0 (candidate == baseline at the time). Its paired JSON is the series' comparison base;
  `scratch-compare-bench.mjs` compares runs.

## Noise methodology

The frozen baseline's own hexa mean at series start swung 276–311 ms across six gate runs (±6%) with
zero code change; each per-cycle delta carries ±4–6 pt error bars. Rules of thumb: trust the work
counters (deterministic) for anything cross-session; for wall time prefer medians (the mean is
tail-dominated — a single 13 s board moves it by ~5 ms); treat single-run deltas as indicative;
chain-multiplying per-cycle deltas overstates cumulative gains because it compounds noise.

## Remaining work

1. **makeAGuess** cell materialization cost
2. **resolve/merge** — profile-guided
3. **Solver clone cost** — Options in ascending effort: copy-on-write component registry (share the
   Maps until first write; `resolveComponents`/`mergeComponents` are the only writers), lazy
   registry clone on first mutation, mutation journal (highest risk, strictly gated on a fresh
   profile).
4. **Demoted unless free**: neighbour table (≤0.9%), unionAt memo (≤0.8%), leftover `remove` array
   reuse (once-per-pass filters).

## Related but out of scope

- **Scramble before the uniqueness loop (new, generator-side)**: benchmark boards arrive in solved
  orientation, and `makeAGuess` picks the first surviving rotation — usually the correct one on
  unscrambled input, which shapes the whole trial tree. A fresh `randomRotate` before the loop
  changes the search radically: heavy board hexa[95] dropped 62078 → 29566 iterations (30980 → 14721
  clones, numAmbiguous 122 → 101), while p90 board hexa[42] was stable (156 vs 155 iterations).
  Caveats: the patience loop would observe different `numAmbiguous` counts, so generated puzzles
  differ; needs its own correctness/quality analysis. Study material:
  `generator_stats/board_hexagonal_{95,42}_seed20260921.json` (regenerate with
  `scratch-dump-board.mjs`).
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
