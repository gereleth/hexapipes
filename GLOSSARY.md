# Hexapipes

Web-based logic puzzle game: rotate every tile until all pipes form a single spanning tree. Home of
the multipipes variant where a tile may hold several independent pipes.

## Language

**Tile**: One grid cell together with the pipe(s) placed in it; the unit the player rotates.
_Avoid_: cell (a cell is the bare polygon; a tile is cell + pipes)

**Pipe**: A connected piece inside a tile, occupying some of the tile's directions. Pipes coexisting
in a tile never connect to each other. _Avoid_: layer

**Pipe node**: A pipe regarded as a single node of the puzzle's connection graph; the win condition
is stated over pipe nodes, not tiles.

**Spanning tree**: The win condition: every pipe node connected to every other, with no loops.

**Sharing**: One tile hosting two or more pipes; `sharingAmount` controls how much of it a generated
puzzle has. _Avoid_: layering, sprouting

**Crossing**: A shared tile with two pipes that each pass through it — entering one side, leaving
another — and whose end directions alternate around the tile, so the branches visually cross; on
square grids, the X of two straights. A tile whose pipes stop or merely turn corners inside it is
shared, but not a crossing. _Avoid_: overlap

**Deadend**: A pipe with a single end. _Avoid_: stub

**Fully connected tile**: A tile whose pipes together use every direction of its cell.

**Reused tiles**: Tiles kept from a previous uniqueness iteration as determined seed material for
the next attempt. Pipe ends that pointed into the discarded region are erased, so no pipe is left
pointing nowhere. _Avoid_: skeleton, seeds
