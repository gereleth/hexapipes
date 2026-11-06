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

Blocked by: None.

Status: resolved

- [x] Obvious demotion keys on post-move tile unions — source side on every move, neighbour side on
      shares; a white-box test pins the two-deadend wall-straight case that passes today
- [x] Obvious-demoted shares are dropped at bucketing and never fire (extend-only obvious tier),
      pinned by a test at avoidObvious=1, sharing>0
- [x] The obvious-ratio helper in `generator-forest.test.js` measures tile unions, not
      `tiles[index][0]`
- [x] Effect measured on smallish non-wrap boards at sharing>0: obvious ratio before/after (via the
      union-based helper), with shared-tile counts alongside so any braiding cost stays visible
- [x] `npx vitest run`, `npm run check`, `npm run lint` all clean

## Comments

Implemented 2026-11-06, all three fixes inside `candidateBuckets` (growth phase only, merge tiers
untouched):

1. **Union-keyed demotion.** `sourceObvious` checks `union(tiles[cell]) | direction` — the tile's
   post-move union, loop-invariant, computed once per bucketing. `neighbourObvious` checks
   `union(tiles[neighbour]) | opposite` on the share path only. One `avoidObvious` roll per
   candidate guards both masks: `(sourceObvious || neighbourObvious) && roll` — one roll, never two,
   and none at all unless a mask actually hits. `computeCellObviousTiles` untouched, as predicted:
   union masks are already `pipeShapes` keys.
2. **Extend-only obvious tier.** `if (obvious && kind === SHARE) continue;` sits before the
   `moveTier` bucketing, so an obvious share is never bucketed in any tier and no pool can ever fire
   it. A tip whose whole candidate list is obvious shares dies on its next pick (`bestTier === -1`),
   exactly the "never parks carrying an unfirable move" behavior.
3. **Tests** (`Avoid-obvious union demotion (white-box)` describe): two boards built from two-cell
   reused deadend pairs via `reuseMinCount=2` (note for future white-box boards: a through-path tile
   `[N-deadend, S-deadend]` is _two_ components — pipes never join inside a tile — so the "two
   deadends in one tile" setup needs two components sharing the cell). The 4x3 board pins the
   wall-straight extend (red today: tile 4 gains E making union 11); the 3x3 board pins the dropped
   share across edge (1,4) — both directions obvious by union (source side 5|S=13 for the tips at 1,
   neighbour side the same 13 for the interior tip at 4, whose own tile has no nogo entry), and the
   tips at 1 die with the share as their only candidate. `obviousRatio` now ORs all pipes of a tile;
   the existing knob test passes unchanged on top of it.

**Measured** (union-based helper, growth prefix, sharing 0.35, branching 0.5, 20 runs/board; before
= pipe-keyed demotion, after = union-keyed + drop):

| board (non-wrap) | obvious ratio @ avoidObvious=1 | shared tiles/run @ 1 |
| ---------------- | ------------------------------ | -------------------- |
| square 8x8       | 0.107 → 0.038                  | 8.2 → 6.7            |
| hexa 6x5         | 0.117 → 0.000                  | 10.7 → 7.9           |
| trihexa 3x3      | 0.363 → 0.100                  | 2.0 → 0.8            |
| snubsquare 4x4   | 0.369 → 0.269                  | 1.1 → 0.2            |

At avoidObvious=0 before/after agree within sampling noise on every board (square ~0.63-0.66, hexa
~0.39-0.41, shared counts unchanged) — the ticket is inert there, and also inert at sharing 0 (no
shares, union == pipe).

**Braiding cost** (kept visible per the acceptance bullet): shared tiles drop 15-60% at
avoidObvious=1 — the designed consequence of refusing coverage-free shares their obvious-texture
trade (ticket 07 decision 11). The cost lands only when the player turns avoidObvious up; the engine
default avoidObvious=0 and the calibrated sharing 0.35 are untouched.
