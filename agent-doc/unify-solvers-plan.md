# Unifying the solvers: remaining work (handoff)

Goal: retire the classic `Solver` (`solver.js`) and make `LayeredSolver` (`solver-layers.js`) the
one solver for both variants — classic boards are solved as one-layer boards. This doc records what
is already done, the evidence that the unification is safe, and the remaining steps. Companion docs:
[layers-solver.md](layers-solver.md) (the unified solver's internals), [game.md](game.md) (game +
`Puzzle.svelte` wiring).

## Done (commit af02294, 2026-10-16)

- `LayeredSolver` accepts both encodings: classic tiles (`Number[]`) are normalized in the
  constructor to one layer per cell (`Number.isInteger(tiles[0])` discriminator, same as
  `PipesGame`). Outputs needed no changes — `solution`/`solutions`/`marked`/steps are per-cell
  rotations in both cases, and both state maps keep the smallest rotation per indistinguishability
  class, so `marked` rotations convert back to classic masks losslessly via
  `grid.rotate(tiles[index], rotation, index)` (that is what the generator's `toStartTiles` does).
- The classic `Generator` uniqueness/multiple loop and `Puzzle.svelte`
  (`unleashTheSolver`/`measureSolveTime`) construct `LayeredSolver` directly; the `game.isLayered`
  branches are gone. The classic `Solver` has **no runtime consumers left** — only `Cell` (generator
  avoid-obvious precompute) and tests.

Evidence the swap is safe:

- Paired benchmark `scratch/classic-vs-layered-bench.mjs` (results:
  `generator_stats/classic_vs_layered_mark_ambiguous_paired.json`): 900 boards, **zero verdict
  disagreements** (`solvable`/`unique`/`numAmbiguous`). Marking per call (40×40 wrap): etrat
  4000→504 ms, snubsquare 1396→225, triangular 853→103, trihexagonal 199→53 (layered 4–8× faster);
  square/cube/rhombitrihexagonal par; **hexagonal 29→46 ms and octagonal 100→113 ms are the only
  regressions** (~1.5×). Marking dominates generation, so these translate ~1:1.
- All 25 behavioral assertions of `solver.test.js` (the `markAmbiguousTiles` block and the emit
  format block — exact `marked` arrays including multi-solution boards, wrap, empty cells, 2×2/3×3
  small boards, unsolvable cases, step-stream format) were verified to pass verbatim against
  `LayeredSolver` on one-layer conversions (2026-10-16, ephemeral script; made permanent by the
  ported tests, see the 2026-10-17 section).

## Done (2026-10-16, later session)

- **Hexa/octa TileType tricks ported into `doLocalDeductions`** (`doTileTypeDeductions` in
  `solver-layers.js`): the classic three init deductions, read off the shape class of each cell's
  **tile union**. Deductions 1 (middle prongs vs sharp turns) and 2 (adjacent psi-likes connect)
  reason about a single piece's prongs and are gated to classic one-layer boards via the new
  `isLayered` flag (any multi-layer cell disables them); deduction 3 (no two adjacent walls next to
  a psi-like) follows from edge adjacency alone and runs on unions for both variants. Non-hexa/octa
  grids skip the whole block (`hasTileTypeTricks`) and never collect neighbour types.
- Evidence: the fuzz harness gained octa configs and ran clean vs a fresh snapshot frozen from the
  **pre-trick** solver (`solver-layers-baseline.js`, recreated 2026-10-16 so the paired harnesses
  gate exactly this change) — identical solution lists, all solutions valid, unique boards marked
  exactly. Paired bench extended with an octagonal grid (600 boards, results in
  `generator_stats/layered_mark_ambiguous_20x20_paired.json`): zero verdict disagreements on all
  grids, square work counters byte-identical (tricks inert where disabled), hexa/octa
  `dirtyProcessings` −6.7%/−4.4%, wall-clock ≈−2% (p50 −5.5% on octa) — the tricks act at init only
  and marking on these boards is search-dominated, so this claws back a slice of the hexa/octa gap
  recorded above. Unit tests for all three tricks (with non-triggering control boards) live in
  `solver-layers.test.js`, "Test hexa/octa TileType deductions".
- `scratch/classic-vs-layered-bench.mjs` rerun after the tricks (seed 20261016, 100 boards/grid,
  results in `generator_stats/classic_vs_layered_mark_ambiguous_paired.json`): **octagonal is now at
  parity with classic** (recorded pre-trick 100→113 ms mean), hexagonal keeps the only real
  regression (~1.5×). Rerun again after the middle-prongs filter correction (both solvers now run
  `mustHaveSomeWalls`, so the deduction actually fires on 4/5-connection tiles): octagonal 71 vs 68
  ms mean — parity holds, both sides got faster; hexagonal 27 vs 41 ms, ~1.52× — the gap is
  unchanged by the correction. Treat cross-run absolute numbers as noisy (square classic moved 56→71
  ms between runs with zero code on that path) and read the within-run paired deltas: hexa ~−14 ms,
  octa ~+3 ms in both reruns. Zero `unique`/`solvable` disagreements on all 900 boards in every run.
  130 boards disagree on `numAmbiguous` only (etrat/snubsquare/triangular/ rhombitrihexagonal —
  multi-solution boards where both solvers early-return at the ambiguity limit; the exact overshoot
  is search-order heuristic), with the same per-grid counts in both reruns. A/B on the bench's own
  dumped boards proved these divergences **pre-existing**: the pre-trick snapshot and the tricks
  solver produce identical verdicts on all 400 dumped boards, so the older "zero verdict
  disagreements" evidence above holds for `unique`/`solvable` but was too broad for `numAmbiguous` —
  treat layered-vs-classic `numAmbiguous` as non-comparable once the ambiguity limit is reached. The
  snapshot-paired numbers in the previous section stay valid for the corrected solver: on the
  layering-0.6 boards it measures, every board is multi-layer, so deductions 1–2 are gated off and
  the correction cannot affect that workload (verified 30/30 boards).

## Done (2026-10-17)

- **Step 1 — classic behavioral tests ported onto the unified class.** The "Test solutions check
  and marking ambiguous tiles" (9 tests) and "Test solver emit format" (2 tests) blocks moved from
  `solver.test.js` to `solver-layers.test.js` as "(classic input)" blocks: assertions verbatim,
  only import + constructor swapped, so they pin the constructor's one-layer normalization and the
  per-cell rotation outputs through the classic encoding path. `generator.test.js`'s `verifyUnique`
  and the pregeneration solvability checks construct `LayeredSolver` now. The three remaining
  `solver.test.js` blocks (hexagrid cell constraints, cell cloning, border constraints) stay until
  the `Cell`/rename steps retire them. The two 20×20 hexagonal uniqueness tests keep their 15 s
  timeouts, though the helper swap runs them at ~4.5 s each.

## Remaining work, in suggested order

### 1. Resolve `Cell` (the last runtime dependency on `solver.js`)

`Cell`'s single runtime use is the classic generator's avoid-obvious precompute (`generator.js`,
`polygonForbidden` setup): it builds `new Cell(polygon, -1)`, adds the border-wall mask, applies
constraints, and groups the surviving orientations by `tileTypes` `str` — a shape class with exactly
one surviving orientation is "forced" by the walls, and those orientations become the ones
`avoidObvious` steers the growth away from.

Options:

1. **Standalone helper (recommended)** — the computation only needs "which orientations survive a
   given wall mask", which is a filter over `polygon.tileTypes` keys: keep orientations whose mask
   is wall-compatible, group by `str`, mark single-orientation classes. No solver class needed;
   delete `Cell` entirely.
2. **One-layer `LayeredCell`** — `new LayeredCell(polygon, [walls-mask-complement])` style
   replacement; works but drags the full layered constraint machinery into pregeneration for a
   trivial filter.

### 2. Rename and delete

- Rename `LayeredSolver` → `Solver` (the neutral end-state name, mirroring how the unified game kept
  the name `PipesGame`). Decide file naming: either keep `solver-layers.js` or move the class to
  `solver.js` and update the ~6 remaining imports. Watch the fuzz/bench harnesses: they compare the
  current `solver-layers.js` against a **frozen snapshot copy of the file** — a rename/move means
  regenerating the snapshot per the harness failure-message instructions (see `layers-solver.md`,
  harness section).
- Delete `solver.js`, `solver.test.js` (after the `Cell` step), and the paired bench
  `scratch/classic-vs-layered-bench.mjs` (sweep `scratch/` for other classic-only harnesses, e.g.
  `classic-mark-ambiguous-bench.mjs`).
- Trivial cleanups: `GeneratorComponent.svelte` and `SolverProgress.svelte` hold type-only
  `import('#lib/puzzle/solver.js').SolverProgress` references — repoint to `solver-layers.js` (which
  defines the identical typedef). No runtime effect, must not outlive `solver.js`.
- Docs: drop "(unification pending)" from the `layers-solver.md` link in `AGENTS.md`; rewrite
  `layers-solver.md`'s intro (classic-counterpart paragraph) and either delete or mark historical
  its "Differences vs classic Solver at a glance" table; `game.md` needs nothing further.

## Deliberately out of scope

Generator unification (`Generator` vs `LayeredGenerator`), worker merging (`worker.js` vs
`worker-layers.js`), and `/generator-debug` — the solver unification does not require them.

## Verification toolbox

- Full suite one-shot: `npx vitest run` (~25 s; the two hexagonal uniqueness tests carry explicit 15
  s timeouts since the swap).
- Layered suite:
  `npx vitest run src/lib/puzzle/generator-layers.test.js src/lib/puzzle/game-layers.svelte.test.js src/lib/puzzle/solver-layers.test.js`
- Soundness fuzz (any solver change):
  `FUZZ_SOLUTIONS=1 npx vitest run src/lib/puzzle/solver-layers-fuzz.test.js` — snapshot-compare
  rules in `layers-solver.md`.
- Perf: `node scratch/classic-vs-layered-bench.mjs` (delete in the rename-and-delete step; use
  `scratch/layered-mark-ambiguous-paired-bench.mjs` for solver-internal changes).
