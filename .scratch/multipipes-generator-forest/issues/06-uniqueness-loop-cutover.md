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

**Status:** ready-for-agent

- [ ] Generate with the unique setting yields puzzles with exactly one solver solution across grid
      kinds and wrap, verifyUnique-style with extended timeouts (prior art: classic generator tests)
- [ ] Scramble rotates all pipes of a tile together; a scrambled board stays solver-solvable with
      the same unique solution
- [ ] Whatever and multiple modes behave per contract
- [ ] Patience and attempt budgets match classic (patience 5, 100 iterations / 100 attempts); the
      ambiguity-decrease patience logic is ported
- [ ] The debug page's uniqueness stepping drives the new engine; snapshot fields are complete per
      contract
- [ ] The worker passes avoid-straights through for multipipes (gap closed) and tree count flows on
      the generate path
- [ ] Old generator module and its tests deleted; worker, game and debug pages import the one new
      engine
- [ ] `npx vitest run`, `npm run check`, `npm run lint` all clean
