# 05: Reused tiles + regrow

Source: `.scratch/multipipes-generator-forest/spec.md`, `docs/multipipes-generator-forest.md` (§ The
uniqueness loop).

**What to build:** The engine learns to regrow from partial boards. Given solver markings from a
previous uniqueness iteration, compute reused tiles: connected components of determined tiles linked
by mutual pipe edges in their solved orientation; keep the largest component always plus smaller
ones up to the reuse minimum count (default 3); exclude rotation-invariant tiles (fully connected
single pipes carry no orientation information); strip pipe ends pointing outside the kept region — a
pipe left with no ends disappears, a cell left with no pipes is not reused. Regrow loads the reused
components as some of the K trees with their pipes pre-unioned, fresh seeds top the count up to K,
and the erased region grows around them. Reused trees grow like any tree: their boundary pipes
extend into the erased region, regaining stripped ends — the invariant is "seed pipes keep their
ends", not verbatim equality. Reuse yielding more than K qualifying components keeps them all (K
caps fresh seeds, not reuse).

**Blocked by:** 04 (gate — forest verdict must say proceed).

**Status:** ready-for-agent

- [ ] Reuse computation honors all rules above, pinned by white-box tests on hand-built solver
      markings (largest always kept, minimum count threshold, rotation-invariant exclusion, end
      stripping, disappearing pipes and cells)
- [ ] Regrow respects the seed-pipes-keep-their-ends invariant: pipes fully inside a kept region are
      unchanged; only stripped boundary ends may regrow
- [ ] More-than-K reuse keeps every qualifying component; fresh seeds only top the count up to K
- [ ] A regrown board passes the same validity tests as ticket 03: solver-solvable, full coverage,
      hard ban holds
- [ ] Foreign tips may share into reused tiles (reused tiles are trees, not absorption targets — no
      linking during growth)
- [ ] `npx vitest run`, `npm run check`, `npm run lint` all clean
