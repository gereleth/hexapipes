# Hexapipes

This is a little static site for playing the pipes puzzle.

Made with Svelte Kit, currently deployed at [hexapipes.vercel.app](www.hexapipes.vercel.app/hexagonal/5/1).


TODO:

- save progress / init from localStorage
    - rotations, locked state, edge marks
- add a timer and save times
    - no rerunning the same puzzle over and over (!)
- avoid colors that are too similar
    - at least compare to adjacent cell colors when selecting a new color
- animation when solved - make new color flow everywhere from the last turned cell
- edge marks - change to = and x (two lines)
- improve rendering performance
    - how?
- add square grid puzzles
- add wrap variants