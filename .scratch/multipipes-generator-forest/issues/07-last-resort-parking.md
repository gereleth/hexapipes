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

**Status:** resolved

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
- **No monotonicity test — deliberately.** The argument above makes one-way parking observationally
  equivalent to re-derivation, so no seam can distinguish them; any test that tried would have to
  re-derive the engine's bucket logic (dice included) and be tautological. It is design
  documentation licensing the simpler implementation, nothing more.
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

- [x] Sharing-0 boards are statistically at classic levels: single-pipe fully-connected tiles ~0
      across grid kinds and branching extremes (baseline to beat: 0.5-18.4 per 400 cells on square;
      classic: 0.0) — measured 0.00 on square 20×20 across branching 0/0.5/1 (30 runs each), 0.0
      hex, triangular untouched at its no-demotion ~20/128
- [x] White-box replay oracle at sharing 0 with demotion knobs at 0 (deterministic tiers) —
      rewritten class-aware after the 2026-10-31 rule split: whenever a non-exempt move fires that
      completes a full union (exemptions: triangular pipe-full extends, square-cell multi-pipe
      extends), no pipe anywhere on the board had a legal fresh-cell extend that wouldn't complete a
      full union, computable from the replayed board alone, checking every pipe as a sound superset
      of alive tips. Global parking passes; per-tree parking or no parking fails; the oracle test
      also carries sharing-1 runs that keep it non-vacuous
- [x] Multi-pipe full unions (crossings) are not regressively reduced at sharing > 0 — re-baselined
      2026-10-28 (the share-pipe ban removes plus-minting shares by intent) and re-measured
      2026-10-31 after the co-tiering + square-exemption work: X tiles and full-multi rise (X
      9.1→10.4 at sharing 1 bushy, 10.1→12.9 winding; full-multi 20.5→26.1 / 23.7→31.3 per 100
      cells), X crossings form mid-growth again (pinned by the mid-growth completion test)
- [x] Triangular boards unchanged (no last-resort parking there; the triangular pipe exemption is
      the pre-existing demoteFullUnion caveat, now explicit in the spec)
- [x] Growth still terminates, coverage still holds, the event stream still replays exactly
- [x] `npx vitest run`, `npm run check`, `npm run lint` all clean

## Comments

Design settled with the user before implementation (2026-10-28):

1. **Both park tiers port.** Pick order [active, parked-obvious, parked-last-resort] mirroring
   classic's [visited, avoiding, lastResortCells]. Straight demotions stay per-move tiers — they
   never park, as in classic.
2. **Triangular:** last-resort parking off (no clean-full tier there, classic caveat); obvious
   parking on for classic parity — inert at the default avoidObvious=0, so "triangular unchanged"
   holds at defaults. The acceptance bullet's "no parking there" reads as "no last-resort parking".
3. **Pool mechanics: per-tree storage, global phase gate.** Each tree keeps three arrays of tip
   pipe-node ids (active frontier, avoiding, lastResort); each pick round the engine picks the first
   phase any tree can act in (active > avoiding > lastResort), then the usual two-level pick runs
   within that phase's array: uniform tree among trees holding tips of that phase, branching blend
   for the tip inside. "Global parking scope" is this cross-tree phase gate, not global tip lists —
   a fully-parked tree is frozen but never wedged; it resumes when the global phase reaches its
   pool.
4. **Act-on-pick semantics (classic parity).** Active tip: fire if its best bucket tier is below
   OBVIOUS; park to avoiding (best tier OBVIOUS) or lastResort (best tier CLEAN_FULL); die if no
   buckets. Tip picked from a parked pool: re-derive (fresh dice for obvious/straight/share gate),
   fire the best move whatever its tier, or die if none — **no park-deeper**: classic's avoiding
   phase fires clean-full-best moves immediately (the `visited.length > 0` guard is false whenever
   avoiding is reachable), and unconditional firing is what guarantees termination at avoidObvious=1
   (no re-roll loop). The acting tip stays parked after firing; the newborn tip is active (classic
   pushes the neighbour back onto visited). The opening round never parks: newborn single-end pipes
   cannot complete a full union, and classic's park-then-immediate-drain for obvious openings nets
   out to "fire anyway". Parking emits no event; the event stream format is untouched. Growth ends
   when all three arrays are empty across trees.
5. **New hard ban (user request, scope addition):** a share move (target tile already holds pipes)
   that would complete the **source** tile's union is refused outright — never bucketed, not a
   demotion — on all grid kinds including triangular (share moves carry no coverage, so refusing
   them cannot stall growth; triangular's carve-out stays demotion-only). Share moves completing the
   **target** (newborn-side) union stay clean-full-demoted and park. The monotone-parking argument
   absorbs this unchanged: the banned move occupies the source's last free direction, and any
   co-resident change must claim exactly that direction. Merge-phase links (ticket 03) are a
   different move kind — whether links get the same source-completion refusal is a ticket-03
   question, to be raised when that ticket lands.
6. **Acceptance #3 re-baselined:** the new ban intentionally removes source-completed full unions,
   so "not regressively reduced" now means: record before/after full-multi counts here, and assert
   newborn-side crossings (square X tiles of two straights) still appear at sharing > 0.
7. **Acceptance #1 threshold:** implement, measure, then pin the strictest robust threshold (likely
   0 or ≤1 total single-pipe full tiles across sampled runs). The plus problem is square-specific at
   sharing 0 — hex needs a 6-ended single pipe (measured ~0 already); triangular's ~20 full singles
   per 128 cells are untouchable (no demotion there).

Fresh baselines measured 2026-10-28 (30 runs each, full tiles per run, /400 or noted cells):

- square 20×20 sharing 0: full-single 0.2 (winding) / 19.2 (bushy), full-multi 0
- square 20×20 sharing 0.6: winding 17.1 single / 59.4 multi / 180.3 shared tiles; bushy 28.9 single
  / 27.4 multi / 156.8 shared
- square 20×20 sharing 1 winding: 14.2 single / 170.5 multi / 286.2 shared tiles
- hex 12×10 (120 cells) sharing 0: 0.0 (winding) / 0.1 (bushy) full-single
- triangular 10×10 (128 cells) sharing 0 bushy: 19.9 full-single — sharing-0 reference for "parking
  doesn't engage on triangular"; sharing > 0 triangular boards change via decision 5's ban, by
  intent

Rule-split follow-up agreed with the user (2026-10-31), after their debug-page experiments and the
merge phase (ticket 03) landing:

8. **Shares are co-tiered with fresh-cell moves.** The sharing knob now gates only availability per
   pick; considered share candidates rank in the normal tier with fresh-cell extends. The old share
   tier made sharing an afterthought on a classic-shaped tree (a share could only fire from a tip
   with no fresh extend left — provable from the old tier logic, and pinned by the new braiding
   test). `TIER.SHARE` and the kind floor in `moveTier` are gone; the tier order is exactly
   classic's: normal > straight > obvious > clean-full.
9. **The ban/demotion matrix is keyed on pipe vs union and fresh vs occupied target** (spec Soft ban
   / Hard ban bullets, agreed 2026-10-31): deadend-in-full banned everywhere; share completing a
   fully connected pipe banned everywhere; pipe-full extend last-resort except triangular
   (grid-level); clean multi-pipe union extend last-resort except on square cells — cell-level
   (`polygon.numDirections === 4`), chosen over grid-level so mixed grids' square cells (snub
   square, etrat, rhombitrihexa) keep their crossings, while the triangular pipe exemption stays
   grid-level because fully connected triangles would flatten etrat/snub-square difficulty (user's
   classic experience); clean multi-pipe union via share last-resort everywhere. Merge phase
   untouched (links gain no coverage, so its tiering stands as ticket 03 built it).
10. **Measured, square 10×10, 20 runs each** (before → after the 2026-10-31 work): coverage-phase
    share-move ratio 0.276→0.331 (b0.5), 0.294→0.343 (b0); X tiles 9.1→10.4 / 10.1→12.9; full-multi
    20.5→26.1 / 23.7→31.3; shared tiles ~50→53.5 / 51.5→58; full-single 0.0→0.0; sharing 0 all
    zeros. Crossings now form mid-growth (the square exemption) rather than only at drains;
    saturation stays far below the pre-parking 170/400 baseline that ticket 08 exists to cap. Knob
    calibration shifts (same sharingAmount braids more) — debug-page re-look advised.
