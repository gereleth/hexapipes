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
