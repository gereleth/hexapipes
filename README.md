# Hexapipes

This is a little static site for playing the pipes puzzle.

Made with Svelte Kit, currently deployed at [hexapipes.vercel.app](www.hexapipes.vercel.app/hexagonal/5).


WORKING ON:

- save progress / init from localStorage
    - check how solves store handles continuing puzzles. Navigating away to another size should not count as broken streak.
    - does incognito mode work with local storage?

TODO:

- allow click and drag locking multiple tiles
- avoid colors that are too similar
    - at least compare to adjacent cell colors when selecting a new color
- animation when solved - make new color flow everywhere from the last turned cell
- edge marks - change to = and x (two lines)
- improve rendering performance
    - how?
    - maybe a canvas lib like Paper.js or the like
- add square grid puzzles
- add wrap variants
    - scroll field of view
    - show wrap tiles on the edges (?)
- add on the fly generation