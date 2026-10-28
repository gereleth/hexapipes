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

**Status:** ready-for-agent

- [ ] Pregeneration output is solver-solvable — a single spanning tree over all pipe nodes — across
      grid kinds including mixed-polygon, wrap and non-wrap, at sharing extremes and mid values
- [ ] Sharing-zero degeneracy: every tile holds at most one pipe and the board is a valid
      single-pipe puzzle, solver-verified (the continuous bottom end of the knob)
- [ ] Cycle guard refuses same-component links; resident-pipe choice in shared tiles is uniform
      (white-box or statistical test)
- [ ] An unmergeable board (X-sealed seam) surfaces as a clean, identifiable failure, not a broken
      output — demonstrated by a test constructing that seam
- [ ] Hard ban still holds across the merge phase under randomized stress
- [ ] A full board (growth + merge) is inspectable from the debug page growth command
- [ ] `npx vitest run`, `npm run check`, `npm run lint` all clean

## Comments

- Heads-up from ticket 02: the test helper `replayEvents` (generator-forest.test.js) currently
  asserts after every move that all pipes within a touched tile have distinct union-find roots. That
  is a growth-phase-only invariant — once links merge components, a shared tile can legitimately
  hold same-component pipes (connected via paths around the board). Drop that check after merge.
  What survives the merge is already asserted elsewhere: one pipe end per direction per tile
  (claimed mask + single match across each edge) and overall acyclicity (components = nodes −
  edges). The per-move component-delta assertion also needs a link case (delta −1, both ends
  existing nodes).
