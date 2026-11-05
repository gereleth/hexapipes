# Multipipes generator design: forest sharing

Generator for multipipes puzzles. Vocabulary comes from `GLOSSARY.md` (tile, pipe, sharing,
crossing, deadend, fully connected tile, reused tiles).

## The model in one paragraph

Several trees start from spatially balanced seeds and each grows exactly like the classic generator.
When a tree tip reaches a cell taken by another tree, it may enter the cell by birthing a _new_ pipe
there (free directions permitting). That birth is a sharing event, and the target cell now holds
pipes of two separate trees. Trees therefore braid through each other's territory. When growth ends,
a merge phase connects all trees until one spanning tree remains.

## Core mechanics

**Atomic edge moves.** The only move is adding a connection across an adjacency: both pipe ends are
created at the same instant (`tiles[from] |= d; tiles[to] |= OPPOSITE` — the classic primitive). No
pipe end ever exists disconnected. A move is classified by which pipes gain new ends on each side of
the edge A->B:

- new pipe in A, new pipe in B: seed (new tree start)
- existing pipe in A, new pipe in B where B has no pipes yet: extend (classic grow)
- existing pipe in A, new pipe in B where B has some other pipes: share
- existing pipe in A, existing pipe in B: link (in merge phase only)

**Per-direction claims.** The visited/unvisited vocabulary is replaced by per-tile direction state:
each direction is FREE, CLAIMED by some pipe's end, or a WALL (faces an empty cell or the outside).
A growth point = a pipe in tile A plus a FREE direction of A. At most one pipe per direction per
tile is automatic.

**Union-find over pipe nodes + cycle guard.** Each pipe is a node; each locked edge unions its two
pipes. A move joining two ends of the _same_ component is a cycle and is refused. Component count is
the union-find count.

**Termination.** `pregenerate_multi` returns one spanning tree over all non-empty cells: growth
brings coverage, the merge phase brings the single component. Coverage alone does not end growth —
sharing moves stay legal once every cell is occupied; growth runs until no tip has any legal move
left (frontier exhaustion).

**Knobs.**

- `sharingAmount ∈ [0,1]`: 0 disables sharing events entirely (hard guarantee); higher values mean
  more events. Default value 0.35 was calibrated to produce a satisfying texture.
- `branchingAmount ∈ [0,1]`: _frontier selection only_ — pick the most recent growth point (0,
  winding) vs a uniform random one (1, bushy). Classic backtracker↔Prim blend, per tree. Pipe
  end-counts stay emergent.
- `avoidObvious`, `avoidStraights`: classic ports.
- `treeCount`: K = number of trees to seed.

**Degeneracy.** At `sharingAmount=0` the design degenerates to a multi-seed classic maze (K trees,
no sharing, merge phase only) — still a valid single-pipe puzzle. Two generators coexist; there is
no bit-parity obligation with `generator.js`.

## Forest growth

- **Seeds.** K cells are chosen by farthest-point sampling over non-empty cells (BFS hop distance).
- **Trees grow independently**: they extend into fresh cells, share into _other trees'_ cells (never
  their own). A tree to grow is picked randomly at every turn.
- **Branching** (classic-like) a `branchingAmount` roll picks which frontier node to grow from.
- **Candidate moves**. Extend moves are always considered, share moves are only considered if a
  `sharingAmount` roll is successful. If the node has no valid moves (no fresh neighbours and failed
  the sharing roll) then it leaves the frontier and doesn't grow any more.
- **Hard banned moves** - they are never used
  - any move after which the source tile or the target tile becomes a fully connected union
    containing a deadend.
  - any _share_ move that makes the source tile fully connected.
- **Soft banned moves**
  - an _extend_ move that makes the source tile fully connected but deadend free is demoted to
    last-resort tier. Such a move will only be taken if there's no other way to reach an unvisited
    cell. Two exceptions are made to this rule:
    - on triangular grids fully connected tiles are the only way to achieve branching, so this soft
      ban is inactive
    - in square cells (on any grid that has them) multitiles like I+I or L+L are also considered
      acceptable because they are visually interesting.
- **avoidObvious** knob steers away from creating tiles for which outer walls or empty cells force a
  single possible rotation. A single roll per candidate move decides if obvious checks are made. The
  obvious check looks at the union of the tile's pipes. _Share_ moves additionally check if the
  neighbour's union would become obvious. Obvious-making share moves are dropped and never taken. If
  a pipe node's best move is an obvious-making extend then the node gets parked in avoidObvious
  tier.
- **avoidStraights** works like in classic - demotes a move that creates a straight pipe.

## Forest merge

After growth ends, the engine merges the forest into one spanning tree in a tier order, each tier's
candidates shuffled and re-validated as they apply:

1. plain links — cross-component pipe pairs across free-free edges that complete no tile's pipe
   union;
2. clean union-completing links — the clean-full last resort, mirroring the growth tiers;
3. clean fusions — in a shared tile two pipes belonging to two different components are combined
   into one pipe - no free directions necessary
4. links that create fully connected pipes
5. fusions that create fully connected pipes.

## The uniqueness loop

Classic `generator.js` structure, unchanged in shape:

1. Solve with `Solver.markAmbiguousTiles(limit)` → `marked` (rotation ≥ 0, or -1 unsolved / -2
   ambiguous), `unique`, `numAmbiguous`.
2. If unique → scramble (random rotation per tile, applied to all its pipes) and return.
3. Otherwise compute **reused tiles** - connected components of determined tiles. Keep components
   sized ≥ `reuseMinCount`. Strip pipe ends pointing outside the kept region (a pipe left with no
   ends disappears; a tile left with no pipes is not reused).
4. Regrow: the reused components are loaded as some of the K trees (their pipes pre-unioned); fresh
   seeds top the count up to K, capped by the erased region's own density and the growth phase
   proceeds from this point. Reused trees grow like any tree with one caveat: sharing moves between
   two reused cells are forbidden. This prevents destabilization of kept areas and excessive sharing
   forming iteration by iteration.
5. Patience (5 iterations without ambiguity decrease) → new attempt (fresh board). Budgets as in
   classic (100 iterations / 100 attempts).

Pipes in reused tiles may legitimately _gain_ ends back — a stripped boundary end returns the moment
the pipe extends into the erased region, which is normal growth. The invariant is "reused pipes keep
their ends", not verbatim equality.

## Interface contract

- `MultiGenerator(grid, ...)` with
  `generate(sharingAmount, branchingAmount, avoidObvious, solutionsNumber, avoidStraights?, treeCount?)`,
  progress callbacks
- `pregenerateForest(grid, knobs, onEvent, startTiles, reuseMinCount)` — one growth pass; `onEvent`
  receives growth events for the debug animation
- `uniqueIterations(sharing, branching, avoidObvious, maxAmbiguousTiles, avoidStraights?, treeCount?)`
  — yields
  `IterationSnapshot {attempt, iteration, tiles, marked, numAmbiguous, unique, keptCount, elapsedMs}`
  per solver iteration.
- `worker-multi.js` consumes exactly this

## Tunables

Default values of sharing (0.35) and tree count (`max(3, floor(N/20))`) are calibrated and
user-approved.
