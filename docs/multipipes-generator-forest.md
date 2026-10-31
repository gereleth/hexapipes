# Multipipes generator design: forest sharing

One of two competing generator designs (see `multipipes-generator-scheduled.md` for the other). Both
share the same foundation and the same interface; they differ only in where sharing events come
from. This one is built first; the scheduled design is the fallback, to be tried only if forest
boards disappoint on the generator debug page.

Vocabulary comes from `GLOSSARY.md` (tile, pipe, sharing, crossing, deadend, fully connected tile,
reused tiles).

## The model in one paragraph

Several trees start from spatially balanced seeds and each grows exactly like the classic generator.
When a tree tip reaches a cell taken by another tree, it does not connect to the foreign pipe —
instead it may enter the cell by birthing a _new_ pipe there (free directions permitting). That
birth is a sharing event. Trees therefore braid through each other's territory without their pipes
ever touching. When growth ends, a merge phase adds plain pipe-to-pipe edges between the trees until
one spanning tree remains.

## Shared foundation (both designs)

**Atomic edge moves.** The only move is adding a locked edge across an adjacency: both ends are
created at the same instant (`tiles[from] |= d; tiles[to] |= OPPOSITE` — the classic primitive). A
move is classified by what exists on each side of the edge:

|                        | B has an existing pipe | B is fresh (pipe born there) |
| ---------------------- | ---------------------- | ---------------------------- |
| **A's pipe exists**    | link (merge/revisit)   | extend (classic grow)        |
| **new pipe born in A** | share at A             | seed (new strand start)      |

No pipe end ever exists unlocked, so no dangling ends and no post-hoc splicing. Every pipe is born
together with its first locked edge.

**Per-direction claims.** The visited/unvisited vocabulary is replaced by per-tile direction state:
each direction is FREE, CLAIMED by some pipe's end, or a WALL (faces an empty cell or the outside).
A growth point = a pipe in tile A plus a FREE direction of A. At most one pipe per direction per
tile is automatic. The state is derived from the pipes on demand; no claim map is stored beside the
board.

**Union-find over pipe nodes + cycle guard.** Each pipe is a node; each locked edge unions its two
pipes. A move joining two ends of the _same_ component is a cycle and is refused. Component count is
the union-find count.

**Hard ban (never, not even last resort):** a move is refused if, after it, _either tile it touches_
would be a fully connected union containing a deadend (single-ended pipe). This outlaws square
T+deadend on creation. Also refused everywhere: a share move (occupied target) whose source tile's
union would become fully connected — whatever completes, the fully connected single pipe (the
rotation-invariant freebie) or a clean multi-pipe union. Sharing gains no coverage, so neither
growth nor its drain phase has a reason to mint fully connected tiles [agreed 2026-10-31].

**Soft ban (tunable tier):** a clean (deadend-free) completion is demoted to the last-resort tier —
except where the completed shape is the payoff [agreed 2026-10-31]. On triangular grids a fully
connected pipe completed by an extend into a fresh cell is normal: a triangle's only branching (the
classic caveat, grid-level). On square cells (four directions, so including mixed grids' squares) a
multi-pipe union completed by a fresh-cell extend is normal: the union is exactly the X / L+L
crossing pair, and the move pays for itself in coverage. With share completions hard banned, the
last-resort tier exists for one purpose: an extend that completes the source's union while covering
its target cell. The classic last-resort/avoid tiers port as per-move tier demotions
(`avoidObvious`, `avoidStraights`); the tier order is normal > straight-demotion >
obvious-demotion > clean-full last resort, with no share tier — the sharing knob gates share
candidates per pick, and considered shares rank with fresh-cell moves.

**Termination.** `pregenerate_multi` returns one spanning tree over all non-empty cells: growth
brings coverage, the merge phase brings the single component. Coverage alone does not end growth —
sharing moves stay legal once every cell is occupied; where growth actually stops is a per-design
decision.

**Knobs.**

- `sharingAmount ∈ [0,1]`: 0 disables sharing events entirely (hard guarantee); higher values mean
  more events. Considered shares rank with fresh-cell moves (no share tier). Exact calibration is
  experimental.
- `branchingAmount ∈ [0,1]`: _frontier selection only_ — pick the most recent growth point (0,
  winding) vs a uniform random one (1, bushy). Classic backtracker↔Prim blend, per tree. Pipe
  end-counts stay emergent.
- `avoidObvious`, `avoidStraights`: classic ports (see pitfalls).

**Degeneracy.** At `sharingAmount=0` the design degenerates to a multi-seed classic maze (K trees,
no sharing, merge phase only) — still a valid single-pipe puzzle. Two generators coexist; there is
no bit-parity obligation with `generator.js`.

## The forest mechanism

- **Seeds.** K cells chosen by farthest-point sampling over non-empty cells (BFS hop distance). K is
  its own knob, scaling with board size and deliberately not with `sharingAmount` — starting point
  `1 + round(√N)`, tunable. During the uniqueness loop, reused components count toward K and fresh
  seeds top the count up; reuse yielding more than K qualifying components keeps them all (K caps
  fresh seeds, not reuse).
- **Trees grow independently**, classic-style: extend into fresh cells, add ends to own pipes
  (fattening), never link during growth — not even into reused tiles, which are trees here, not
  absorption targets.
- **Foreign entry.** When a tip's candidate move lands on an occupied cell, the "new pipe born
  there" option (bottom row of the table) is gated by `sharingAmount`: each pick, with probability
  `sharingAmount` share candidates join, ranked with moves into fresh cells, otherwise the tip must
  extend elsewhere (or die, like classic). Entering a cell never merges components — pipes in a tile
  never connect.
- **Braiding.** A tip that entered foreign territory keeps growing there, sharing each cell it
  passes (its own new pipes). This produces trails of shared tiles — pipes running through fields of
  other pipes. Long crossings arise naturally, especially in winding mode (two trees threading
  through each other).
- **Merge phase.** After growth ends, the engine merges the forest into one spanning tree in a tier
  order, each tier's candidates shuffled and re-validated as they apply (free directions, distinct
  roots, hard ban — and plus state, see below): (1) plain links — cross-component pipe pairs across
  free-free edges that complete no tile's pipe union; (2) clean union-completing links — the
  clean-full last resort, mirroring the growth tiers; (3) clean fusions — any two pipes of one
  shared tile in two different components combined into one pipe (the bitwise or: two deadends `[1]`
  and `[2]` become the bend `[3]`, but any pair may fuse), no free direction needed [agreed
  2026-10-29]; (4) plus links; (5) plus fusions [agreed 2026-10-30]. A **plus** is a fully connected
  single pipe — the rotation-invariant freebie growth refuses to hand out for free — so a link or
  fusion that would mint one (a tee gaining its tile's last direction, two pipes or-ing to the full
  mask) is demoted below the clean fusions: an available fusion merges the components without
  minting anything. Demoted, never banned — a board whose only merge mints a plus must still merge.
  On triangular grids the plus tiers do not exist: triangles need their full connections too often,
  mirroring growth's full-union demotion caveat (`demoteFullUnion`). The apply-time re-validation
  also catches stale pluses: two clean links collected in one sweep can stack onto the same pipe,
  and the second — which no tier would have chosen — would complete its every direction. Hard-banned
  links (completing a union that would contain a deadend) are never candidates, in any tier. A link
  into a shared tile picks the receiving resident pipe uniformly at random — directions are a
  per-tile resource, so any pipe can take any free direction (the cycle guard still refuses
  same-component picks). A fusion removes one pipe and shifts pipe indices above it, so the
  union-find is rebuilt from the board (the ground truth of locked edges) after each one. Fusions
  double as un-sealers: fusing a seam tile's deadends removes them, which un-bans the tile's edges —
  every hard-ban-sealed square seam constructed so far merges through them. If no candidate exists
  while components remain (in practice only a wall-sealed seam), the pregeneration attempt fails and
  is retried.

Expected sharing distribution: balanced seeds → balanced sharing fronts, with calmer territory cores
and busier seams. Whether that reads as texture or as clumping is an aesthetic call to make from
looking at boards. The evenness statistic (below) is the tripwire.

## The uniqueness loop (both designs)

Classic `generator.js` structure, unchanged in shape:

1. Solve with `Solver.markAmbiguousTiles(limit)` → `marked` (rotation ≥ 0, or -1 unsolved / -2
   ambiguous), `unique`, `numAmbiguous`.
2. If unique → scramble (random rotation per tile, applied to all its pipes) and return.
3. Otherwise compute **reused tiles**: connected components of determined tiles (linked by mutual
   pipe edges in their solved orientation); keep the largest always plus smaller ones ≥
   `reuseMinCount` (3). Exclude _rotation-invariant_ tiles (X tiles, fully connected single pipes —
   they carry no orientation info). Strip pipe ends pointing outside the kept region (a pipe left
   with no ends disappears; a cell left with no pipes is not reused).
4. Regrow: the reused components are loaded as some of the K trees (their pipes pre-unioned); fresh
   seeds top the count up to K, and the erased region grows around them. Reused trees grow like any
   tree: their boundary pipes extend into the erased region — regaining their stripped ends — and
   foreign tips may share into their tiles. No linking during growth; all linking happens in the
   merge phase.
5. Patience (5 iterations without ambiguity decrease) → new attempt (fresh board). Budgets as in
   classic (100 iterations / 100 attempts).

Reused seed pipes may legitimately _gain_ ends back — a stripped boundary end returns the moment the
pipe extends into the erased region, which is normal growth. The invariant is "seed pipes keep their
ends", not verbatim equality.

## Interface contract

- `MultiGenerator(grid, ...)` with
  `generate(sharingAmount, branchingAmount, avoidObvious, solutionsNumber, avoidStraights?)`,
  progress callbacks. Forest only: K is a separate `treeCount` constructor param (default
  `1 + round(√N)`, not plumbed through the worker until wanted).
- `pregenerate_multi(grid, sharing, branching, avoidObvious, startTiles, reuseMinCount, onMove)` —
  one growth pass; `onMove` receives growth events for the debug animation.
- `uniqueIterations(sharing, branching, avoidObvious, maxAmbiguousTiles)` — yields
  `IterationSnapshot {attempt, iteration, tiles, marked, numAmbiguous, unique, keptCount, elapsedMs}`
  per solver iteration.
- `worker-multi.js` consumes exactly this — keep it working.
- `worker-multi.js` currently drops `avoidStraights` for multi — close the gap.

## Known pitfalls (found the hard way in an aborted prototype)

1. **Frontier cells must stay candidates after being used.** Classic keeps visited cells in the
   list; a cell is dropped only when it has no legal moves. Popping a cell after one move kills the
   trees and cascades into stalls and unmergeable boards.
2. **Square X tiles seal seams.** An X uses all four directions — it is impassable and unlinkable. A
   seam consisting only of X tiles between two components makes the merge phase impossible; treat
   that as attempt failure and retry (it also argues for keeping the soft ban on clean full unions
   meaningful on square grids). Revision 2026-10-29: with generalized fusion such seams are rarely
   final — fusing two pipes of a seam tile removes its deadends, which un-bans the tile's edges — so
   only wall-sealed seams (empty cells splitting the playable region) deterministically fail; those
   burn the retry budget and surface as a clean `UnmergeableBoardError`.
3. **`computeCellObviousTiles` must be built once over all non-empty cells at growth start**
   (classic builds it pre-growth over everything; consulting already-visited cells against it is
   intended behavior, not a bug).
4. Growth must treat `grid.emptyCells` as walls.
5. A pipe born into a fresh cell must not complete that cell's full union with its single end — that
   case of the hard ban is easy to forget because the newborn pipe does not exist yet at check time.

## Open tunables (experiments, via the debug page)

- K (tree count) formula (`1 + round(√N)` starting point); share-gate probability (share candidates
  join the pick ranked with fresh-cell moves; the tier order is normal > straight-demotion >
  obvious-demotion > clean-full last resort).
- Growth-end criterion: stop at coverage vs run to frontier exhaustion vs a post-coverage share
  quota — sharing moves remain legal after coverage.
- Evenness statistic and threshold: e.g. shared-tile counts per board region within tolerance of
  each other.
- Whether deadend-containing unions should be discouraged even when _not_ fully connected (start
  permissive; widen the ban only on evidence).
- Merge-phase edge choice (random vs nearest-pair-first) and its effect on ambiguity counts.

## Parked fallbacks

- **Two-phase stitching**: tile the board with K unconnected strands first, then schedule every
  share with the whole board eligible (structural evenness). Only if forest sharing proves uneven.
- The scheduled-sharing design (`multipipes-generator-scheduled.md`) is the natural Plan B.
