# 07: Last-resort parking

Source: `.scratch/multipipes-generator-forest/spec.md` (Implementation Decisions: soft ban, tier
order; Further Notes: aesthetic gate), `docs/multipipes-generator-forest.md` (Soft ban, Open
tunables), classic `generator.js` (`lastResortCells`).

**What to build:** Port classic's last-resort semantics to the forest engine: when the acting tip's
best bucket is the clean-full tier, the engine does not take the move — it parks the tip and picks
another actor. Last-resort moves fire only when no unparked tip anywhere can move, exactly like
classic drains `lastResortCells` only after `visited` is empty. Today the forest engine takes a
last-resort move as soon as _that tip_ has nothing better, and growing to frontier exhaustion
guarantees it eventually fires — which is why square boards show classic-avoided degenerate pluses
that classic never produces.

**Why now:** measured on square 20x20, 30 runs each — classic: **0.0** fully-connected tiles; forest
at sharing 0: 0.5 (winding) to 18.4 (bushy), all of them single-pipe pluses; at sharing 0.6 default:
~60 full tiles of which ~22 single-pipe pluses. Single-pipe pluses are rotation-invariant freebies
(the reason classic outlaws them and the spec excludes them from reuse). The multi-pipe full unions
(crossings) are a separate phenomenon handled by ticket 08 — this ticket must not reduce them beyond
what parking incidentally does.

**Blocked by:** None (independent of 03-06). Recommended order: 07 → 08 → evaluate boards on the
debug page → then 03 (the spec front-loads the aesthetic gate before the merge/uniqueness
investment).

**Status:** ready-for-agent

**Open design questions (decide before or while implementing):**

- **Parked unit = the tip (pipe node), not the tree, not the cell.** A cell can host tips of several
  trees, so classic's cell-lists don't map; a tree whose every tip is parked stalls naturally
  because the picker finds no actor — no explicit tree parking should be needed, but verify that a
  tree with all tips parked and later a drained last-resort move elsewhere on the board doesn't
  wedge.
- **Parking scope: global across trees vs per tree.** Classic parity says global: a degenerate plus
  anywhere on the board is equally bad, so nobody takes a last-resort move while any other tip still
  has a better one. Per-tree parking would let a cornered tree melt into pluses while fresh
  territory exists elsewhere — recommend global.
- **Parking is monotone — classic's one-way lists carry over.** The worry was that sharing makes a
  tip's options non-monotone (co-residents fatten or get born mid-growth), so parking might need
  re-evaluation. It does not: whenever a move is hard-banned or clean-full-demoted on a side, that
  tile's union is exactly `fullyConnected` minus the move's direction — the tile's only free
  direction. Any co-resident change (a deadend fattening, a share birth) must claim a free direction
  of its tile, so it consumes exactly that direction: the move dies, it is never un-banned or
  un-demoted. New moves cannot appear either: free directions only shrink, an extend's target can
  only become occupied (extend becomes share, a worse tier), and once a post-move union is full it
  stays full (unions never thin). A last-resort-parked tip therefore stays parked until drained —
  one-way semantics are safe, no re-derivation needed for the last-resort tier. The exception is the
  obvious parking tier: its demotion probability re-rolls per pick (classic's `avoiding` list has
  the same property), so that tier recomputes buckets at pick time, exactly like classic.
- **Does the obvious demotion park too?** Classic parks obvious-wanting cells in a middle list
  (`avoiding`), drained before last-resort but after normal. Parity says yes; the visible effect
  only exists at avoidObvious > 0 (default 0). Recommend porting both park tiers (obvious →
  last-resort) as pick priorities; straight demotions stay per-move tiers as in classic.
- **Drain cascade.** Taking a last-resort move births a tip that may have normal moves — classic
  just re-enters the main loop; growth resumes normally until everything parks again. Keep that.
- **Triangular grids:** the clean-full tier doesn't exist there (demoteFullUnion is off, classic
  caveat) — parking must not engage on triangular.
- **This ticket alone does not reach zero pluses:** with frontier-exhaustion termination, the
  endgame saturation tail eventually parks everything and drains anyway. Parking removes the
  during-coverage pluses; ticket 08 bounds the tail. Acceptance thresholds below assume 07 alone
  (against the measured baselines); re-measure after 08.

- [ ] Sharing-0 boards are statistically at classic levels: single-pipe fully-connected tiles ~0
      across grid kinds and branching extremes (baseline to beat: 0.5-18.4 per 400 cells on square;
      classic: 0.0)
- [ ] White-box: a last-resort move never fires while any unparked tip has a better-than-last
      -resort move (pinned however fits — event-stream ordering or an exported picker seam)
- [ ] The monotonicity argument (a banned/demoted move's tile has exactly one free direction, the
      move's own; any co-resident change consumes it) is pinned by a test that would fail if parking
      relied on re-derivation for the last-resort tier
- [ ] Multi-pipe full unions (crossings) are not regressively reduced at sharing > 0 (measure
      before/after; crossings are the variant's feature)
- [ ] Triangular boards unchanged (no parking there)
- [ ] Growth still terminates, coverage still holds, the event stream still replays exactly
- [ ] `npx vitest run`, `npm run check`, `npm run lint` all clean
