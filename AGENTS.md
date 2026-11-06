# Hexapipes

Web-based logic puzzle game, SvelteKit + Svelte 5.

## Puzzle

Classic rules: every grid cell has a rotatable tile with a pipe piece. Rotate all tiles so that
pipes form a single spanning tree - everything connected, no loops.

Current branch focuses on developing the multipipes variant where every tile may hold not one but
several independent pipes:

- pipes don't connect to each other within a tile
- at most one pipe can use any of the tile's directions
- rotating a tile rotates all its pipes simultaneously
- win condition is still a single spanning tree made from all the pipe pieces.

Multiple grid kinds are supported including grids with mixed polygon kinds. Wrap mode offers the
game on toroidal topology for extra challenge.

## Status overall

- **generator** - multipipes generator is implemented, separate from the classic one.
- **solver** - already solves both variants by treating classic mode puzzles as single-pipe
  multipipes. Could use some search logic tightening but nothing urgent.
- **game** - rendering and player interaction. Already supports both variants.

## Encodings

- Grid directions are encoded as bits (square: E=1 N=2 W=4 S=8)
- Pipes are bitmasks (square 5=1|4 - a straight pipe that connects E-W)
- Grids number their cells 0..grid.total-1. A grid cell is a polygon; index determines its type,
  position and neighbours in all directions.
- Classic puzzle input is `grid, tiles=Number[]` - a single pipe per grid cell, 0=empty
- Multipipes input is `grid, tiles=Number[][]` - a list of pipes per grid cell, []=empty
- Tile is the main puzzle object - a combo of grid cell + pipe(s) in it.
- Different pipe pieces in the same tile act as different nodes in the puzzle's connected graph. We
  use `pipeNodeId = tileIndex + pipeIndex * grid.total` to track connections.

## Tests and checks

`npx vitest run`, `npm run check`, `npm run lint` - keep them all clean

## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature>/`. See
`docs/agents/issue-tracker.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`, created lazily by /domain-modeling. See
`docs/agents/domain.md`.
