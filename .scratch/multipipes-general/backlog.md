# Multipipes backlog

Various tasks and open questions about the multipipes game. Human-owned file, agents should not edit
it.

## Generator

- rename generator-forest.js to generator-multi.js
- refactor generator params passing (long lists of knobs are confusing)
- check the patience structure (do we actually rerun pregeneration if we run out of patience,
  classic as well)

## Solver

- tighten up loop avoidance logic (on merge of components A and B the avoid loops logic should run
  in cells of A that neighbour cells of B and vice-versa)
- implement the double-island-slot case

## UI

- negative mask encoding of multipipe case is hacky, find a better way
- loop highlighting should work on pipe outlines, not on tile background. Change classic as well?
- "click to orient" mode based on pipe unions is confusing, figure out a better way. Maybe use the
  pipe with the highest popcount? Needs experiments.

## Routes and pages

- how do we structure the urls? `/multi/square/5`?
- example puzzles
