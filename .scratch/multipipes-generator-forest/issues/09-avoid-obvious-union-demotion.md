# 09: avoidObvious on unions, share targets, extend-only tier

Source: user review of `docs/multipipes-generator-forest.md` (Move demotions) and
`generator-forest.js` (`candidateBuckets` obvious demotion, `avoiding` pool firing); ticket 07
decisions 5 and 11 (coverage-free share bans).

**What to build:** Three fixes to the avoid-obvious demotion in the growth phase. The classic port
kept classic's single-pipe vocabulary in a multi-pipe world, and the demotion tier kept firing
coverage-free shares:

1. **Union, not the acting pipe.** The obvious check must test the tile's pipe union after the move
   (`union(tiles[cell]) | direction`), not the acting pipe alone (`pipe | direction`). Rotating a
   tile rotates every pipe in it, so the instantly-solvable object near a wall is the union mask.
   Today a square cell with a west wall holding two deadends N and S passes: neither deadend alone
   is a unique survivor of its shape class, but the union 10 (vertical straight) is.
   `computeCellObviousTiles` needs no change — `pipeShapes` enumerates every non-empty direction
   mask, so union masks are already first-class keys of the nogo sets.
2. **The neighbour side of shares only.** A share also writes an end into an occupied neighbour (a
   newborn pipe joins the tile, the union grows). The demotion must also fire when the neighbour's
   post-move union (`union(tiles[neighbour]) | opposite`) is in the neighbour's nogo set. Extends
   don't need the check: their target is fresh, and demoting the extend could only postpone a visit
   that coverage demands anyway. The precompute already covers all playable cells, so this is purely
   a second lookup on the share path of `candidateBuckets`. One `avoidObvious` roll per candidate
   guards both masks — either side landing on a forbidden orientation demotes the move.
3. **Extend-only obvious tier.** A share move demoted to the obvious tier never fires — only extends
   may come out of that tier. Shares carry no coverage, so nothing owes them an obvious-texture
   trade; extends pay for themselves in coverage (ticket 07 decision 11's rationale). Active tips
   park instead of firing obvious-tier moves anyway — such moves only fire from the parked
   `avoiding` pool — so this is the obvious-tier sibling of the share-source full-union ban. Obvious
   share candidates are dropped at bucketing time, never bucketed at all. A tip whose only candidate
   is an obvious share dies; it never parks carrying an unfirable move.

**Scope:** growth phase only — the merge phase gains no obvious tier; its tiers stay exactly as
ticket 03 built them. At sharing 0 the whole ticket is inert: shares are disabled, every tile holds
at most one pipe (the union equals the acting pipe), and the share-only neighbour check never runs.

**Blocked by:** None.

**Status:** open

- [ ] Obvious demotion keys on post-move tile unions — source side on every move, neighbour side on
      shares; a white-box test pins the two-deadend wall-straight case that passes today
- [ ] Obvious-demoted shares are dropped at bucketing and never fire (extend-only obvious tier),
      pinned by a test at avoidObvious=1, sharing>0
- [ ] The obvious-ratio helper in `generator-forest.test.js` measures tile unions, not
      `tiles[index][0]`
- [ ] Effect measured on smallish non-wrap boards at sharing>0: obvious ratio before/after (via the
      union-based helper), with shared-tile counts alongside so any braiding cost stays visible
- [ ] `npx vitest run`, `npm run check`, `npm run lint` all clean
