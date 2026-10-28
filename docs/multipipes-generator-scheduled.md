# Multipipes generator design: scheduled sharing

One of two competing generator designs (see `multipipes-generator-forest.md` for the other). Both
share the same foundation and the same interface; they differ only in where sharing events come
from. The forest design is built first; this one is the fallback, to be tried only if forest boards
disappoint.

Vocabulary comes from `GLOSSARY.md` (tile, pipe, sharing, crossing, deadend, fully connected tile,
reused tiles).

## The model in one paragraph

One tree grows exactly like the classic generator (plus reused-tile seeds during the uniqueness
loop). Ordinary growth never shares: a strand entering an occupied tile always adds its end to an
_existing_ pipe there. Sharing happens only through a **scheduler**: share events fire as the board
fills up, each picking its tile for spatial balance and executing atomically. A final merge phase
consolidates any leftover components.

The "Shared foundation" section of `multipipes-generator-forest.md` applies verbatim: atomic edge
moves, per-direction claims, union-find cycle guard, hard ban (fully connected union + deadend on
either touched tile), soft ban tier, termination conditions, knob semantics (`branchingAmount` =
frontier selection only), the uniqueness loop with reused tiles, the interface contract, and
pitfalls 1–5. What follows is only what differs.

## The scheduler

**No incidental sharing.** The "new pipe in an occupied tile" move (bottom row of the move table) is
reserved to the scheduler. Strands passing through occupied tiles extend existing pipes instead.
Tile age therefore never accrues sharing chances — the historical "growth origin gets all the
sharing" failure mode has no trigger.

**Coverage clock.** The share budget is a target event count `B = f(sharingAmount, N)` (starting
point `round(sharingAmount · 0.4 · N)`, tunable). Event _i_ fires when the occupied-cell count
crosses `i/B · N` — events spread over board coverage, not over move count, so early-filling regions
and late-filling regions both see events.

**Balanced target selection.** At each event, eligible tiles are those that are occupied, have
enough FREE directions, pass the ban checks, and admit a legal share (below). Pick the tile
maximizing distance to the nearest already-shared tile (multi-source BFS hop distance over the grid;
O(N) per event, fine at these board sizes; random tie-breaks). The picker never looks at tile age —
only at where shares are currently sparse.

**Two share types, both atomic:**

- **Crossing share** (preferred): birth + departure in one event. A new pipe R is born in the chosen
  tile with one end locked across direction d1 (the neighbour's pipe gains its answering end — that
  neighbour gets fatter, e.g. a straight turning into a T). Then, as part of the same event, R
  immediately gains its second end d2 and extends into fresh territory — d2 chosen so that R's
  direction pair _alternates_ around the tile with the resident pipes' directions (on square that is
  the perpendicular pair: the X look, never the L look). The tile's crossing is complete at that
  instant; the strand departing from R wanders off under the normal selection policy and rejoins the
  network wherever the tree knits — with winding growth that is far away, which is the transversal
  quality.
- **Leaf share** (fallback): birth only. R is born one-ended, locked to the neighbour, and that
  single end is the whole intent — a leaf node, finished. This needs no fresh territory (only an
  occupied neighbour with a free answering direction), so it works in dense endgame regions where
  crossing shares cannot. It is also the source of the deadend family: deadend+straight,
  deadend+bend, deadend+deadend.

**Why atomicity matters** (a hard-won lesson): a share born "lazy" — one end now, the second
whenever the loop gets around to it — can strand as a permanent sprout (the loop may never pick it
again), loses the alternating-direction choice (the good perpendicular direction may be claimed
meanwhile), and can be trapped by the hard ban (union completes to fully connected while R is still
one-ended, with no free direction left to grow). Deliberate one-endedness (leaf share) is fine;
accidental one-endedness is not.

**Feasibility and requeue.** An event whose share cannot legally complete right now is not forced
somewhere awful — it requeues to the next coverage tick. Leftover budget at growth end may fire as
leaf shares; what still fails is dropped.

**New components are welcome.** A crossing share whose birth locks into a fresh cell creates a
brand-new small component (R + the newborn across). That is legal and desirable — strands get born
_from_ shared tiles. The merge phase at the end consolidates everything (cross-component links,
cycle-guarded, exactly as in the forest design).

## Why one design per knob value still works

- `branchingAmount=0` (winding): shares depart as new winding strands — long crossings.
  `branchingAmount=1` (bushy): shared strands interleave quickly.
- `sharingAmount=0`: scheduler disabled, single seed, pure classic-style growth.

## Extra known pitfalls (specific to this design)

1. **Predict before you mutate.** Feasibility of a crossing share (birth pair + alternating
   departure) must be computed against the _hypothetical_ post-birth state — e.g. a departure link
   is only legal if the answering pipe's component differs from R's component _after_ the birth
   union. Check with `uf.find` before committing anything.
2. The balancer's distance metric is hop distance, not Euclidean — mixed-polygon grids have no
   reliable per-cell coordinates from the grid API; BFS over `findNeighbour` works everywhere.
3. The coverage clock assumes growth eventually fills everything; keep classic stall handling — tips
   die when out of moves, a failed merge retries the attempt.

## Open tunables (experiments, via the debug page)

- Budget formula (`sharingAmount → B`) and the events-per-coverage spacing.
- Crossing/leaf mix ratio (start: crossing preferred, leaf as fallback only).
- Alternation heuristic strictness (must the departure alternate, or merely differ from the resident
  pair?).
- Evenness statistic and threshold — same tripwire as the forest design; the residual risk here is
  _late regions are only eligible late_, so evenness is an equilibrium the balancer steers toward,
  not a structural guarantee. If it trips, the parked two-phase stitching variant makes it
  structural.

## Parked fallbacks

- **Two-phase stitching**: grow K unconnected strands to full coverage first, then schedule every
  share with the entire board eligible. Structural evenness at the cost of a less organic growth
  story.
- The forest design (`multipipes-generator-forest.md`) is the primary; this design is its Plan B.
