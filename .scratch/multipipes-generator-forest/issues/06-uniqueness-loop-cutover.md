# 06: Uniqueness loop + contract cutover

Source: `.scratch/multipipes-generator-forest/spec.md`, `docs/multipipes-generator-forest.md` (§ The
uniqueness loop, § Interface contract).

**What to build:** The engine gains the classic-shaped uniqueness loop and the full public surface,
then replaces the old generator. Generate runs all solutions-number modes: the unique loop (solve
with the solver's ambiguity marking; unique → scramble, rotating each tile's pipes together;
otherwise reuse-and-regrow, with patience on iterations without ambiguity decrease and the classic
attempt budgets), whatever, and multiple. Uniqueness iterations yield a per-iteration snapshot —
attempt, iteration, tiles, marked, ambiguity count, unique flag, kept count, elapsed — for the debug
page's step-through. The worker's generate and debug commands cut over to the new engine, the
avoid-straights knob stops being silently dropped for multipipes, and the old module with its tests
is deleted. End state: one multipipes generator honoring the spec's interface contract exactly.

**Blocked by:** 05 (reused tiles + regrow).

**Status:** resolved

- [x] Generate with the unique setting yields puzzles with exactly one solver solution across grid
      kinds and wrap, verifyUnique-style with extended timeouts (prior art: classic generator tests)
- [x] Scramble rotates all pipes of a tile together; a scrambled board stays solver-solvable with
      the same unique solution
- [x] Whatever and multiple modes behave per contract
- [x] Patience and attempt budgets match classic (patience 5, 100 iterations / 100 attempts); the
      ambiguity-decrease patience logic is ported
- [x] The debug page's uniqueness stepping drives the new engine; snapshot fields are complete per
      contract
- [x] The worker passes avoid-straights through for multipipes (gap closed) and tree count flows on
      the generate path
- [x] Old generator module and its tests deleted; worker, game and debug pages import the one new
      engine
- [x] `npx vitest run`, `npm run check`, `npm run lint` all clean

## Comments

1. **Watch items raised before implementation (user, 2026-11-04): regrow sharing between distinct
   reused components.** Sharing can fire between two reused cells A and B iff they host pipes of
   _different_ kept components. Two things to look for in the loop's iteration snapshots at the
   default sharing (0.35), over several multi-iteration runs:

   - **Oversharing.** Every pipe of every kept component is revived as an active frontier tip, so
     the share-exposed surface from pick one is much larger than on a fresh board: component
     perimeters facing other occupied territory. Symptom: shared-tile counts (derivable from
     `tiles`) ratcheting up iteration over iteration — the sharing knob's meaning would drift during
     the loop.
   - **Destabilization of "stable" regions.** A share into a kept cell mutates it, so a
     previously-determined cell can flip back to ambiguous, making the `numAmbiguous` trend
     non-monotone.

   If either bites, ban share moves whose source and target cells both host reused pipes. That is a
   spec change — it revisits ticket 05's "foreign tips may share into reused tiles" acceptance
   criterion and the design doc's "reused trees grow like any tree" — so land it as a decision, not
   silently.

2. **Watch-item data collected (2026-11-04, after implementation): neither symptom bites — no ban
   recommended.** Instrumented loop mirroring `MultiGenerator.uniqueIterations` exactly (same
   patience and budgets) but capturing every pregenerate's growth event stream, so share moves into
   reused cells are counted alongside the snapshot symptoms. Sharing 0.35 (the default), branching
   0.5, default tree count; 8 runs per config over square 20x20 (the debug-page default), square
   12x12, square 12x12 wrap, hex 10x8, trihexa 10x10 (mixed). All 40 runs reached a unique board,
   mean 1.4–5.0 iterations.

   - **Oversharing: a bounded one-step jump, not a ratchet.** Regrow boards carry 14–32% more shared
     tiles than fresh boards at the same knob (20x20: 90.6 → 107.6; wrap: 36.5 → 48.3), but 94–97%
     of those shared tiles sit **inside kept cells** — inherited, solver-certified shared tiles (a
     kept component legitimately owns shared cells), not new sharing. New share _events_ per regrow
     are far fewer than on a fresh board (20x20: 16.4 vs 79.0; 12x12: 5.9 vs 24.1): sharing scales
     with regrowth volume — only the erased region grows — not with the share-exposed surface, so
     the feared every-kept-pipe-is-a-tip mechanism never materializes as extra events. Within runs
     the shared count jumps at the first regrow, then plateaus (20x20: 119,120,110,120,120,121,120,
     120,120,119; wrap: 55,53,57,57,55,58,59); step up/down counts are near even (10/6, 2/4, 7/6).
     No compounding across iterations, and typical loop length (≤ 6) bounds it anyway.
   - **Into-reused sharing is small.** 4–7 of each regrow's 6–12 share events land in reused cells;
     the proposed ban case — both source and target cells reused — is 2–5 events per regrow on
     144–400-cell boards (~1–2% of cells).
   - **Destabilization: rare and absorbed.** Determined→ambiguous flips between consecutive
     iterations average 4.4 / 1.2 / 5.4 / 0.3 / 0.0 cells per pair (20x20 / 12x12 / wrap / hex /
     trihexa) — at most ~1.5% of cells, essentially zero on hex and mixed. Ambiguity counts increase
     within an attempt in 0–2 of 8 runs per config (e.g. wrap: 18,16,13,16,14,14,11,0 — wobbling yet
     converging); classic's patience machinery absorbs the wobble and everything converged well
     inside budgets.

   **Decision (proposed, per the watch item's "land it as a decision" rule): keep ticket 05's
   behavior — foreign tips may share into reused tiles, reused trees grow like any tree. No ban.**
   The shared-tile elevation's cause is inheritance from the certified region, which the both-reused
   ban would not touch, and the flip rates don't threaten convergence. Revisit only if the debug
   page shows final boards at sharing 0.35 reading busier than ticket 04's fresh-board visual
   calibration — the cheap targeted lever remains the both-reused share ban (2–5 events/regrow).

3. **Implementation notes (2026-11-04).** `MultiGenerator` lives in `generator-forest.js` with the
   classic-shaped loop:
   `uniqueIterations(sharing, branching, avoidObvious, ambiguousLimitOverride, avoidStraights, treeCount)`
   yields the contract snapshots — `keptCount` is the reuse plan's kept cell count (what the board
   actually loaded, 0 on fresh boards), not the raw non-null start-tile count.
   `generate(sharing, branching, avoidObvious, solutionsNumber, avoidStraights, treeCount)` runs the
   three modes; the unique path scrambles the unique snapshot directly (equivalent in distribution
   to classic's apply-markings-then-scramble). `randomRotate`, `applyRotations` and `validateMulti`
   moved into the forest module; solver, solver-fuzz and game-multi tests repointed; the old module
   and its test file are deleted. Worker `generate`/`debug-start` pass every knob through (unset
   ones take the engine defaults — sharing 0.35, tree count formula), `growth-start` gained optional
   `startTiles`, and the debug page's "grow from viewed iteration's survivors" checkbox is live. The
   custom page now sends `avoidStraights` for multipipes and defaults sharing to 0.35 (ticket 04's
   cutover note). The debug page's reused view shows the forest reuse model (kept components, cells
   hosting one vs several components). Worker tests moved to `worker-multi.test.js`; uniqueness-loop
   tests live in `generator-forest.test.js` under "Uniqueness loop (public seam)". One test detail:
   solved-board equality after scrambling compares per-tile pipe multisets — pipe order within a
   tile is not canonical (the solver may report rotations that reindex pipes), so strict array
   equality over-asserts.

4. **Code review round (two-axis, standards + spec) folded in (2026-11-04).** Fixes applied: the
   duplicated pregenerate+kept-count pair became `MultiGenerator.regrow`, the duplicated solver
   wiring became `makeSolver`, the ticket's double `## Comments` heading collapsed, and two stale
   spec.md lines landed as dated revisions (the "non-increasing ambiguity trends" pin → converging
   trend, per comment 2's data; the rotation-invariant exclusion → skipped, ticket 05's recorded
   agreement). Declined as judgement calls: the six-parameter positional `generate`/
   `uniqueIterations` signatures (the spec's "the worker consumes exactly this surface" keeps them
   positional; a knobs object would rewrite the contract this ticket preserves), `validateMulti`'s
   local string-key adjacency (inherited from the old module, internal to one function), and
   `keptCellCount`'s plan recompute (documented in its docblock: a cheap flood fill, the price of a
   plan-free `pregenerateForest` signature). The worker's avoid-straights pass-through stays
   smoke-tested only (the generate test sends `avoidStraights: 0.5`): the knob is a per-move
   demotion probability with no deterministic observable on the generate path, and a distribution
   test there would be flaky; the growth-path pass-through is pinned via the tree-count seed-event
   test.
