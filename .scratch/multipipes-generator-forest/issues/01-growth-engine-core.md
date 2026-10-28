# 01: Growth engine core

Source: `.scratch/multipipes-generator-forest/spec.md`, `docs/multipipes-generator-forest.md`.

**What to build:** A fresh generator engine — a new module beside the old one; the old module stays
untouched and keeps serving the worker's generate and uniqueness-stepping commands — grows K
independent trees from spatially balanced seeds (farthest-point sampling, BFS hop distance) over any
grid kind, including wrap and mixed-polygon grids, using atomic edge moves only (both pipe ends
created at the same instant, no dangling ends ever). Sharing is not implemented yet: a tip that
would enter an occupied cell simply extends elsewhere or dies, so every finished tile holds at most
one pipe. The engine's knob signatures are complete from the start — sharing, branching,
avoid-obvious, avoid-straights, tree count (default one plus rounded square root of the cell count)
— even where later tickets fill the behavior in. The generator debug page's growth animation plays
this engine through the worker's growth command: K trees visibly winding (branching 0) or bushing
(branching 1) until every non-empty cell is covered. Union-find state and the per-direction
claim/tier machinery are exported as importable units for white-box tests.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Growth from seeds covers every non-empty cell on hex, square, and at least one mixed-polygon
      grid, wrap and non-wrap; empty cells are walls
- [x] Every finished tile holds at most one pipe; no pipe end ever exists without its locked edge,
      mid-animation or at completion
- [x] Hard ban holds under randomized stress: no tile is ever a fully connected tile whose union
      contains a deadend
- [x] Classic tier demotions port: avoid-obvious precompute built once at growth start over all
      non-empty cells, avoid-straights demotion, clean-full union demoted to last resort;
      triangular-grid caveats port as-is
- [x] White-box tests pin the exported units: union-find (union, find, component count, cycle
      refusal) and per-direction claims (FREE/CLAIMED/WALL transitions, tier classification,
      demotion order)
- [x] Branching knob spans winding ↔ bushy growth per tree (both extremes visibly different on the
      debug animation)
- [x] Frontier cells stay move candidates until they have no legal moves — never popped after a
      single use (aborted-prototype pitfall)
- [x] The growth animation on the generator debug page runs the new engine via the worker's growth
      command
- [x] Old multipipes generator module and its tests untouched and green; `npx vitest run`,
      `npm run check`, `npm run lint` all clean

## Comments

Two sessions worked this ticket; the first one's report was lost. Reconstructed state on pickup: the
engine (`src/lib/puzzle/generator/generator-forest.js`), its white-box + seam tests, the worker's
`growth-start` rewiring, and the debug-page animation were already in place and green. The second
session finished:

- added the missing pin for the aborted-prototype pitfall — a test that a winding-mode tip goes
  dormant and is reused as a move actor later (verified discriminating: inserting the
  pop-after-single-use pitfall makes it fail with stalled growth)
- formatted the untracked markdown (docs, spec, tickets, AGENTS.md) so `npm run lint` is clean — the
  `.md` entry in `.prettierignore` is a no-op leftover that matches only a literal `.md` file; the
  repo convention (commit 8fb7d37a) is prettier-formatted markdown
- `generator-multi.test.js` needed a two-line adaptation: its growth-worker replay test targets the
  worker's growth command, which this ticket rewires to the forest engine (the old
  `generator-multi.js` module itself is untouched and its suite is green)
- noted for ticket 05: the debug page's "grow from viewed iteration's survivors" checkbox is
  disabled until reused-tile regrowth lands
- code review (standards + spec axes) found no hard violations; applied its judgement-call fixes:
  the worker's growth command passes the knobs straight through (defaults are owned by the engine)
  and reports failures via the worker's existing error message instead of hanging the page when a
  user-forced treeCount cannot cover the regions; a mixed-polygon wrap board (trihexagonal 7x6)
  joined the coverage suite; the debug page's grid-size clamping was deduplicated; the tier bucket
  count derives from TIER instead of a magic 5
- one full-suite run showed a single unreproduced test failure; 24 consecutive green suite runs
  since, plus a 2000-growth-per-board wrap stress with zero stall failures. If it resurfaces,
  suspect a timing-sensitive worker test first
- revision 2026-10-28 (agreed with the user): `DirectionClaims` — a mutable per-direction cache
  synced by hand with every move — was replaced by `directionState(grid, tiles, cell, direction)`, a
  pure derivation (CLAIMED = some pipe of the tile holds the bit, WALL = the neighbour is empty or
  outside). The white-box claims tests now pin the derivation, the double-claim tripwire lives in
  `applyMove`, and later mutation paths (merge links, reused-tile loading) can't fall out of sync
  with a cache that no longer exists. The spec gained a decision-provenance convention: bracketed
  `[agreed]` tags versus untagged draft statements
