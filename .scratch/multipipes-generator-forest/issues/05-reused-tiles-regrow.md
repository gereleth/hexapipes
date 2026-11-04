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

**Status:** resolved

- [x] Reuse computation honors all rules above, pinned by white-box tests on hand-built solver
      markings (largest always kept, minimum count threshold, ~~rotation-invariant exclusion~~
      skipped per the session decision below, end stripping, disappearing pipes and cells)
- [x] Regrow respects the seed-pipes-keep-their-ends invariant: pipes fully inside a kept region are
      unchanged; only stripped boundary ends may regrow
- [x] More-than-K reuse keeps every qualifying component; fresh seeds only top the count up to K
- [x] A regrown board passes the same validity tests as ticket 03: solver-solvable, full coverage,
      hard ban holds
- [x] Foreign tips may share into reused tiles (reused tiles are trees, not absorption targets — no
      linking during growth)
- [x] `npx vitest run`, `npm run check`, `npm run lint` all clean

## Comments

Implemented 2026-11-01, forest engine only (`generator-multi` untouched — ticket 06 does the
cutover):

1. **Rotation-invariant exclusion skipped** at the user's direction (session start): no special
   handling for fully connected single pipes. They carry no orientation information, but keeping
   them is harmless — a plus lands as an inert pass-through node (all directions claimed, no legal
   moves), and an isolated one strips to nothing like any other singleton. The spec's exclusion
   bullet stays unimplemented; revisit only if reuse quality measurably suffers.
2. **Reuse computation** — `buildStartTiles(grid, tiles, marked)` (markings → solved-orientation
   start tiles, negative rotations null out) +
   `planReusedComponents(grid, startTiles, reuseMinCount)` →
   `{components: Map<cell, pipes[]>[], keptCount}`. Components are pipe-node flood fills over mutual
   locked edges (a cell can host pipes of several components; one component can revisit a cell with
   several pipes). Threshold counts **cells**, classic-style; the largest is kept unconditionally,
   smaller ones at ≥ reuseMinCount. Stripping keeps an end only when its mutual match is in the same
   component — which never disconnects a component (its defining edges are mutual), so only
   singleton components can lose pipes entirely.
3. **Regrow** — `pregenerateForest(grid, knobs, onEvent, startTiles, reuseMinCount)`. Kept
   components load as trees (pipes placed, union-find pre-unioned over intra-component edges, every
   pipe a frontier tip); fresh seeds top up to K by farthest-point sampling over the erased region
   with reused cells as distance-zero sources. More than K components all load, K caps fresh seeds
   only.
4. **Reuse events** — one `{type: 'reuse', cells: [...]}` event per kept component (not per cell: a
   component is self-contained — every end mutual-matches inside it, it joins no foreign component —
   so the replay oracle can lock it in as a unit; per-cell events would dangle until the last cell
   of a component lands). `applyForestEvent` handles it; the debug page's growth animation
   marks/highlights/describes the new type. The disabled "grow from viewed iteration's survivors"
   checkbox still waits for ticket 06's worker cutover.
5. **Invariant reading** — "only stripped boundary ends may regrow" is pinned as: every seed pipe
   keeps its ends (final mask ⊇ seed mask, asserted through the merge), pipes fully inside a kept
   region are unchanged during growth (asserted on the growth prefix for the interior pipe of a kept
   3×3 block; merge links may legitimately add ends afterwards). Boundary pipes may also take
   brand-new ends into the erased region — reused trees grow like any tree, no direction gate; that
   matches the old generator's behavior and the spec's "grow like any tree".
6. **Tests** — white-box reuse planning (7 tests on hand-built markings), buildStartTiles (2),
   regrow behaviors (5: load+top-up, more-than-K, seed-pipes-keep-ends, enclosed-pocket coverage,
   shares into reused tiles), validity parity (7 grid kinds × sharing 0/0.5/1 × BFS-patch erasure
   - a full scramble→solve→buildStartTiles→regrow chain). The replay oracle gained the reuse branch
     (component lands as exactly one new component, all ends locked) and its
     same-tile-distinct-roots check became a before/after-pairs check (reused tiles may legitimately
     load with same-component pipes; growth must merely never create a _new_ pair).
     Mutation-checked: killing the K cap and killing the pre-union both fail the suite loudly. 8×
     repeated runs clean.
7. **Code review round** (two-axis, standards + spec) folded in: the forked farthest-point samplers
   merged into one multi-source core (`farthestPointPicks`; `farthestPointSeeds` delegates to it,
   `freshSeedsAround` deleted, `bfsDistances` folded into `relaxDistances`), the largest-always-kept
   guard now keys on the sorted index instead of first-survivor (a latent trap the spec reviewer
   flagged), and the tests' repeated merge-prefix break became one `isMergeEvent` helper. Reviewer
   notes accepted as-is: `(startTiles, reuseMinCount)` stay positional params (the design doc's
   interface contract names them), `keptCount` waits for ticket 06's snapshots, `StartTiles` keeps
   the old generator's term to ease the cutover (it names the pre-plan input including nulls; the
   glossary's "reused tiles" names the post-plan survivors).
8. **Test hardened (follow-up session): the >K test now kills the K-cap mutation itself.** The
   original 1×19 board (five components, every erased cell boxed in by reused cells) masked the cap
   mutation — `seedCount === 0` passed vacuously because mutant seeds could never open (noted in
   `handoff-05.md`). The board now loads four components `[0, 4, 8, 12]` and leaves an open erased
   tail run (cells 15–18): the correct engine still adds no fresh seeds (4 > K = 3), but the mutant
   (`freshCount = min(treeCount, erased.length)` — K no longer subtracting loaded trees) places
   seeds that can open in the run. Verified empirically both ways: the mutant fails this test at the
   seed-count assertion (`expected 2 to be +0`) and the loads test; restored, the full suite is
   clean (434 passed). Trade-offs accepted: the >K margin shrinks 2 → 1 (the "load at most K"
   regression still fails loudly, 9 ≠ 12 cells) and the merge now stitches through 3 boxed bridges
   plus one open tail run instead of 4 bridges — the tail run is its own case (a region reachable
   only from one component's side).
