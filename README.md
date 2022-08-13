# Hexapipes

This is a site for playing hexagonal pipes puzzle.

Made with Svelte Kit, currently deployed at [hexapipes.vercel.app](https://hexapipes.vercel.app/hexagonal/5/1).

![A half-finished example of a hexagonal pipes puzzle](/static/og_image_v1.png)

TODO:

- undo/redo stack
- zoom/pan the svg
  - will maybe help with performance on large puzzles if we only render the visible tiles when zoomed in?
- allow click and drag locking multiple tiles
- avoid colors that are too similar
  - at least compare to adjacent cell colors when selecting a new color
- animation when solved - make new color flow everywhere from the last turned cell
- edge marks - change to = and x (two lines)
- improve rendering performance
  - how?
  - maybe a canvas lib like Paper.js or the like
- add square grid puzzles
- add on the fly generation
- use css transitions instead of tweened store
