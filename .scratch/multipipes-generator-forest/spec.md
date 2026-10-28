# Spec: Multipipes generator rewrite — forest sharing

Status: ready-for-agent

Source design: `docs/multipipes-generator-forest.md` (vocabulary per root `GLOSSARY.md`). The
scheduled-sharing design (`docs/multipipes-generator-scheduled.md`) is the parked fallback and is
out of scope.

## Problem Statement

The multipipes generator works, more or less: it produces valid, unique puzzles with tunable
sharing. But it got there through rounds of experimental back-and-forth, and the code shows it — the
internals are a kludge where every lesson learnt lives as a patch on top of the previous patch.
Untangling that mess in place looks harder than a clean rewrite with the lessons baked in from the
start, and until one happens, every further change (new tunables, the scheduled-sharing fallback)
means fighting the mess again.

## Solution

Rewrite the generator internals around the forest-sharing design the experiments converged on — same
behavior class, same worker-facing interface, so the game and the generator debug page keep working
unchanged. Several trees start from spatially balanced seeds and grow classic-style; when a tree tip
enters a cell held by another tree it does not connect to the foreign pipe — it births a new pipe
there (a sharing event), so trees braid through each other's territory without their pipes ever
touching. A merge phase then adds plain pipe-to-pipe links until one spanning tree remains, and a
classic-style uniqueness loop with reused tiles guarantees a unique solution. The amount of sharing
becomes a single honest knob: at zero it hard-guarantees boards with one pipe per tile.

## User Stories

1. As a player, I want every generated multipipes puzzle to have a unique solution, so that solving
   it is a fair challenge.
2. As a player, I want the solved puzzle to always be a single spanning tree over all pipe nodes, so
   that the win state is actually reachable.
3. As a player, I want every non-empty cell to contain at least one pipe, so that boards look
   complete and don't have dead holes.
4. As a player, I want the sharing knob to reliably control how many pipes share tiles, so that I
   can choose calmer or busier boards.
5. As a player, I want the sharing knob at zero to guarantee exactly one pipe per tile, so that
   minimum-sharing play behaves like the classic puzzle.
6. As a player, I want no tile to ever be a fully connected tile whose pipe union contains a
   deadend, so that no spot on the board is trivially forced.
7. As a player, I want multipipes puzzles on every grid kind the game supports, including
   mixed-polygon grids, so that the variant works wherever classic does.
8. As a player, I want wrap (toroidal) boards supported with sharing, so that the extra-challenge
   mode keeps the variant.
9. As a player, I want generation to complete within the usual time budget, so that I'm not waiting
   longer than for classic boards.
10. As a player, I want the final scramble to rotate each tile's pipes together, so that the puzzle
    I receive is a pure rotation of the unique solution.
11. As a puzzle tuner, I want to watch the growth phase animate move by move, so that I can see
    trees grow, enter foreign territory, and share.
12. As a puzzle tuner, I want sharing events distinguishable in the growth animation, so that I can
    judge where sharing lands on the board.
13. As a puzzle tuner, I want to step through the uniqueness loop one iteration at a time, so that I
    can watch ambiguity counts evolve and see what got reused.
14. As a puzzle tuner, I want the true ambiguity count on demand for a debug board, so that I can
    calibrate the iteration limit.
15. As a puzzle tuner, I want tree count as an independent parameter, so that I can experiment with
    more or fewer seeds without touching the sharing knob.
16. As a puzzle tuner, I want branching to blend winding and bushy growth per tree, so that I can
    shape the texture of boards.
17. As a puzzle tuner, I want the avoid-obvious and avoid-straights knobs to keep their classic
    meaning, so that my classic intuition carries over.
18. As a puzzle tuner, I want reused tiles from earlier iterations to seed regrowth seamlessly, so
    that uniqueness iterations converge instead of thrashing.
19. As a puzzle tuner, I want a failed merge to retry cleanly rather than emit a broken board, so
    that the debug loop never shows invalid states.
20. As the game UI, I want the existing worker message contract preserved exactly, so that the
    rewrite drops in with no UI changes.
21. As the game UI, I want generation and solver progress callbacks during the uniqueness loop, so
    that long generations show progress.
22. As the game UI, I want the avoid-straights knob plumbed through for multipipes, so that it stops
    being silently dropped.
23. As a maintainer, I want union-find state and per-direction claims as separately testable units,
    so that cycle refusal and tier classification can be pinned by white-box tests.
24. As a maintainer, I want the classic generator left untouched, so that classic puzzle quality
    cannot regress from this work.
25. As a maintainer, I want the degenerate case (sharing knob at zero, K trees, no sharing, merge
    only) to be a valid puzzle in its own right, so that the knob range is continuous with no broken
    bottom end.

## Implementation Decisions

- **Scope of replacement.** The multipipes generator module is rewritten internally. Its
  worker-facing surface — the generator class, the standalone pregeneration function, the
  uniqueness-iteration generator, and their progress callbacks — is preserved as the contract. The
  classic generator and the solver are not modified. There is no bit-parity obligation between the
  two generators.
- **Atomic edge moves are the only mutation primitive.** Every move adds one locked edge across an
  adjacency and creates both of its ends at the same instant. No pipe end ever exists unlocked: no
  dangling ends, no post-hoc splicing, every pipe is born together with its first locked edge. A
  move is classified by what exists on each side:

  |                        | B has an existing pipe | B is fresh (pipe born there) |
  | ---------------------- | ---------------------- | ---------------------------- |
  | **A's pipe exists**    | link (merge/revisit)   | extend (classic grow)        |
  | **new pipe born in A** | share at A             | seed (new strand start)      |

- **Per-direction claims replace the visited/unvisited vocabulary.** Each direction of each tile is
  FREE, CLAIMED by a pipe end, or a WALL (empty cell or outside). A growth point is a pipe plus a
  FREE direction of its tile. At most one pipe per direction per tile holds structurally, by
  construction.
- **Union-find over pipe nodes with a cycle guard.** Each pipe is a node (identity stays the
  established encoding: tile index plus pipe index times grid total). Each locked edge unions its
  two pipes. A move joining two ends of the same component is refused. Component count is the
  union-find count.
- **Hard ban.** A move is refused — never, not as a last resort — if after it, either tile it
  touches would be a fully connected tile whose union contains a deadend. This outlaws the square
  T+deadend shape on creation. The newborn-pipe case (a pipe born into a fresh cell that completes
  that cell's full union with its single end) is part of the ban and explicitly checked.
- **Soft ban.** A move completing a clean fully connected tile (no deadends) is demoted to the
  last-resort tier. Classic avoid-obvious and avoid-straights demotions port as per-move tier
  demotions. Tier order: normal > share > straight-demotion > obvious-demotion > clean-full last
  resort. Triangular-grid caveats from classic port as-is.
- **Forest mechanism.** K seeds are chosen by farthest-point sampling over non-empty cells (BFS hop
  distance). K is a generator setting passed alongside the sharing and branching knobs, defaulting
  to one plus the rounded square root of the cell count; it is deliberately independent of the
  sharing knob. Trees grow independently classic-style: extend into fresh cells, add ends to their
  own pipes, never link during growth. When a tip's candidate move lands on an occupied cell, the
  share option is considered per pick with probability equal to the sharing knob; otherwise the tip
  extends elsewhere or dies as in classic. Entering a cell never merges components. A tip that
  entered foreign territory keeps growing there, sharing each cell it passes, producing trails of
  shared tiles — long crossings arise naturally in winding mode.
- **Merge phase.** After growth ends: collect cross-component link candidates (adjacent pipes, both
  facing directions free, ban-checked), shuffle, apply until the union-find reports one component. A
  link into a shared tile picks the receiving resident pipe uniformly at random; the cycle guard
  still refuses same-component picks. If no candidate exists while components remain, the
  pregeneration attempt fails and is retried (an X-tile-sealed seam is exactly this failure).
- **Termination.** One spanning tree over all non-empty cells: growth brings coverage, the merge
  phase brings the single component. Coverage alone does not end growth — sharing moves stay legal
  once every cell is occupied; the growth-stop criterion is a tunable (coverage vs frontier
  exhaustion vs post-coverage share quota).
- **Uniqueness loop.** Classic structure: solve with the solver's ambiguity marking; unique →
  scramble (random rotation per tile applied to all its pipes) and return; otherwise compute reused
  tiles — connected components of determined tiles linked by mutual pipe edges in solved
  orientation, keep the largest always plus smaller ones up to the reuse minimum count, exclude
  rotation-invariant tiles (fully connected single pipes carry no orientation info), strip pipe ends
  pointing outside the kept region (a pipe left with no ends disappears; a cell left with no pipes
  is not reused). Regrow: reused components load as some of the K trees with their pipes
  pre-unioned; fresh seeds top the count up to K; reuse yielding more than K qualifying components
  keeps them all. Reused trees grow like any tree. Patience (iterations without ambiguity decrease)
  and attempt budgets match classic. Reused seed pipes may legitimately regain stripped ends when
  growth extends them again — the invariant is "seed pipes keep their ends", not verbatim equality.
- **Interface.** Generate takes the full knob set: sharing, branching, avoid-obvious, solutions
  number, optional avoid-straights, and tree count (default formula above). Tree count flows through
  the same channel as the other knobs — worker options — and is exposed on the generator debug page
  for experiments. Standalone pregeneration takes grid, knobs, start tiles, reuse minimum count, and
  a growth-event callback receiving moves for the debug animation. Uniqueness iterations yield a
  per-iteration snapshot: attempt, iteration, tiles, marked, ambiguity count, unique flag, kept
  count, elapsed time. The worker consumes exactly this surface. The worker currently drops
  avoid-straights for multipipes — closing that gap is in scope.
- **Growth constraints.** Empty cells are walls. The avoid-obvious precompute is built once at
  growth start over all non-empty cells, and consulting already-visited cells against it is intended
  behavior. Frontier cells stay move candidates until they have no legal moves — never popped after
  a single use.
- **Internals for white-box tests.** The union-find over pipe nodes and the per-direction claim/tier
  machinery are exported as importable units so cycle refusal, tier classification, and claim
  transitions can be unit-tested directly (seam decision made with the user: public API + solver
  oracle, plus these exported internals).

## Testing Decisions

- Good tests assert external behavior, not implementation details. The public generator surface is
  tested with the existing solver as the oracle for solvability and uniqueness — connectivity and
  uniqueness checks are never reimplemented in tests.
- **Public seam tests** mirror the classic generator test structure: pregeneration invariants across
  grid kinds (including mixed-polygon grids), branching extremes, sharing knob extremes, and
  wrap/non-wrap; generation with unique-solutions setting verified to yield exactly one solution; a
  hand-built grid unit test for the ported avoid-obvious precompute.
- Behaviors pinned at the public seam: full coverage of non-empty cells; sharing knob at zero ⇒ no
  shared tiles and exactly one pipe per tile; hard-ban shapes absent across many random runs; the
  growth-event stream replays to exactly the returned tiles (each locked edge appears once);
  uniqueness snapshots report non-increasing ambiguity trends and a kept count consistent with
  reuse; the scramble preserves solvability (all pipes of a tile rotated together).
- **White-box tests** target the two exported internal units: union-find (union, find, component
  count, cycle refusal) and per-direction claims (FREE/CLAIMED/WALL transitions, tier classification
  of the four move kinds, demotion ordering).
- Prior art: the classic generator test suite — pregeneration solvability suites per branching mode,
  randomized stress loops, uniqueness verification with extended timeouts, and the exported-helper
  unit test pattern.

## Out of Scope

- The scheduled-sharing design and the two-phase stitching fallback — parked until forest boards
  disappoint on the debug page.
- Tunable calibration: the K formula, share-tier gating probability, growth-stop criterion, evenness
  statistic and threshold, and merge edge-choice strategy. The machinery and knobs are delivered;
  their tuned values are experiments on the debug page after the build.
- Any change to the classic generator, the solver, or the game rendering/interaction (the game
  already supports both variants).

## Further Notes

- Ticket ordering should front-load the aesthetic gate: once growth + merge produce viewable boards
  on the debug page, evaluate forest sharing before investing in the uniqueness loop — that is the
  decision point for switching to the scheduled fallback.
- The design doc records pitfalls found the hard way in an aborted prototype (frontier cells must
  stay candidates; X tiles seal seams; precompute-over-everything; newborn full-union ban case).
  Tickets must carry these as acceptance criteria, not rediscover them.
- Naming follows the glossary: tile, pipe, sharing, crossing, deadend, fully connected tile, reused
  tiles. "Seeds" is fine for the K starting cells but never for reused tiles.
