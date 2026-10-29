# 03: Merge phase

Source: `.scratch/multipipes-generator-forest/spec.md`, `docs/multipipes-generator-forest.md`.

**What to build:** After growth ends, the engine links the trees into one spanning tree: all
cross-component link candidates (adjacent pipes, both facing directions free, ban-checked) are
collected, shuffled, and applied until the union-find reports a single component; a link into a
shared tile picks its receiving resident pipe uniformly at random (directions are a per-tile
resource, so any resident can take any free direction; the cycle guard still refuses same-component
picks). This is the first end-to-end slice: the growth command on the debug page now yields a
complete, solver-valid puzzle — and at sharing zero the board degenerates to a classic-shaped,
single-pipe-per-tile puzzle. Boards that cannot be merged (a square X-tile-sealed seam between
components) fail cleanly so the caller can retry — never a malformed board.

**Blocked by:** 02 (sharing events).

**Status:** resolved

- [x] Pregeneration output is solver-solvable — a single spanning tree over all pipe nodes — across
      grid kinds including mixed-polygon, wrap and non-wrap, at sharing extremes and mid values
- [x] Sharing-zero degeneracy: every tile holds at most one pipe and the board is a valid
      single-pipe puzzle, solver-verified (the continuous bottom end of the knob)
- [x] Cycle guard refuses same-component links; resident-pipe choice in shared tiles is uniform
      (white-box or statistical test)
- [x] An unmergeable board (X-sealed seam) surfaces as a clean, identifiable failure, not a broken
      output — demonstrated by a test constructing that seam. (The constructible deterministic seam
      is the wall-sealed one; hard-ban-sealed square seams turn out to merge through fusions — see
      Resolution notes.)
- [x] Hard ban still holds across the merge phase under randomized stress
- [x] A full board (growth + merge) is inspectable from the debug page growth command
- [x] `npx vitest run`, `npm run check`, `npm run lint` all clean

## Comments

- Heads-up from ticket 02: the test helper `replayEvents` (generator-forest.test.js) currently
  asserts after every move that all pipes within a touched tile have distinct union-find roots. That
  is a growth-phase-only invariant — once links merge components, a shared tile can legitimately
  hold same-component pipes (connected via paths around the board). Drop that check after merge.
  What survives the merge is already asserted elsewhere: one pipe end per direction per tile
  (claimed mask + single match across each edge) and overall acyclicity (components = nodes −
  edges). The per-move component-delta assertion also needs a link case (delta −1, both ends
  existing nodes).

## Resolution notes

Design settled with the user before implementation (2026-10-29):

1. **Tiered merge order** (ticket 07's deferred link question): plain links → union-completing links
   (the clean-full last resort, mirroring growth) → fusion → fail. Not flat-shuffle, not outright
   refusal of single-pipe-completing links. Measured on square 8x8 (30 runs): growth-only deadend
   ratio 0.33 (winding) / 0.44 (bushy) → post-merge 0.23 / 0.28 — links eat deadends by design; K−1
   ≈ 8 links per board, ~0 fusions on plain boards.
2. **Generalized fusion** (user's addition, extended by the user mid-review of the event shape): any
   two pipes of one tile in different components fuse into one (bitwise or), not just deadend pairs
   — "I'd rather not see banned shapes after fusing" holds structurally: the tile's union is
   unchanged and the fused pipe has ≥2 ends, so deadends only disappear; a defensive ban check stays
   in the collector anyway.
3. **Fuse events** join the stream as `{type:'fuse', cell, firstPipeIndex, secondPipeIndex}` — a new
   event type beside `{type:'move', ...}` because a fusion has no direction/neighbour and shifts
   pipe indices above secondPipeIndex. `applyForestMove` handles both; the debug animation plays
   fuses inline with a 'fuse N' label; one fusion per merge round (a splice stales the collected
   indices) with the union-find rebuilt from the board after each.

Findings worth keeping:

- **Constructing an "X-sealed seam" by hand is no longer possible on square boards.** Three
  constructions were built and analyzed (crossing-X seam column; sealed island with deadend-triple
  seam tiles; tier-variant families): every one merges, because hard-ban sealing requires seam tiles
  full of deadends, and those tiles are shared with pipes of the enclosing component — fusing them
  removes the deadends, which un-bans the seam edges. The fusion tier literally eats the seam the
  docs worried about. The constructible deterministic failure is a **wall-sealed seam** (empty
  columns splitting a wrap board into two rings): no edge, no shared tile — the test builds it,
  asserts the board is a valid 2-component forest, and gets a clean `UnmergeableBoardError` with
  nothing applied. Growth-side note: such boards deterministically burn all 20 retry attempts before
  surfacing (regions seeded independently by farthest-point sampling, then merge cannot bridge
  walls) — an optimization opportunity if anyone ever feeds such grids, not fixed here.
- **White-box seam-family tests** (4x4 wrap, hand-verified): an island sealed by deadend-triple
  tiles with a joiner-pipe backbone pins tier order (plain before completing, hard-ban pairs never
  fire, completing fires only when plain is gone), and a holes-variant pins pure-fusion merging (3
  fuse events, zero links).
- **Uniform receiving resident**: 3x2 board with exactly one free-free edge whose two pipes of the
  shared tile both form valid pairs — 200 runs, first-index count 100±40 accepted (fair coin). The
  pick is uniform over valid pipe _pairs_, which induces the uniform marginal the ticket asks for;
  when both endpoints are shared tiles each resident's chance is proportional to its valid-pair
  count (the symmetric rule), which no test currently distinguishes.
- **treeCount assertions moved to the event stream**: post-merge component counts are always 1, so
  `treeCount=7` and the default-K tests now count `seed` events instead (7 / 11 on 10x10 —
  farthest-point seeds never collide there, see ticket 02).
- **Growth-texture statistics re-based on the growth prefix** of the event stream: the merge changes
  tile shapes by design (links turn deadends into bends and straights into tees, fusions remove
  pipes), which compressed the winding/bushy and avoid-straights gaps below their old thresholds.
  deadendRatio/straightRatio/obviousRatio now replay events up to the first link/fuse and measure
  there.
- `replayEvents` per the heads-up: link events (delta −1, both ends existing) and fuse events (delta
  −1, then a union-find rebuilt from the replayed board with an agreement assertion) are handled;
  the distinct-roots-within-tile check applies to growth kinds only. The parking oracle applies
  merge events to its board but judges only growth moves (post-coverage no fresh extend exists
  anyway). The share-source ban replay skips non-move events.
- Worker `growth-start` needed no rewiring (it calls `pregenerateForest`, which now ends with the
  merge); its comment and the debug page prose/labels were updated, and the page's fusion highlight
  marks just the fused tile.
- Suite stability: 5 consecutive full-file green runs; full repo `vitest run` 392 passed,
  `npm run check` 0 errors, `npm run lint` clean.
