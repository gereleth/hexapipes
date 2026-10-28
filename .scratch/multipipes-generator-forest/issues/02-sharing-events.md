# 02: Sharing events

Source: `.scratch/multipipes-generator-forest/spec.md`, `docs/multipipes-generator-forest.md`.

**What to build:** A growing tip that reaches a cell held by another tree may now birth a _new_ pipe
there instead of connecting to the foreign pipe — considered per pick with probability equal to the
sharing knob; otherwise the tip extends elsewhere or dies as before. A tip that entered foreign
territory keeps growing there, sharing each cell it passes, producing trails of shared tiles —
crossings arise naturally, especially in winding mode. The share move takes its place in the
per-move tier order. Boards are still multi-component when growth ends (the merge phase is ticket
03), but the sharing knob now visibly changes board texture on the debug animation: at zero nothing
shares, higher values braid trees through each other's territory.

**Blocked by:** 01 (growth engine core).

**Status:** ready-for-agent

- [ ] Sharing knob at zero hard-guarantees no shared tiles — no tile ever holds two pipes,
      stress-tested across runs
- [ ] Sharing knob above zero produces shared tiles and crossings on demand (statistical test over
      repeated runs)
- [ ] Pipes in a tile never connect: a share move never merges components (union-find component
      count unchanged — white-box test)
- [ ] Newborn-pipe hard-ban case covered: a pipe born into a fresh cell never completes that cell's
      full union with its single end (the case that is easy to miss because the pipe does not exist
      yet at check time)
- [ ] Share tier sits in the tier order — normal > share > straight-demotion > obvious-demotion >
      clean-full last resort — pinned by white-box test
- [ ] The growth-event stream replays to exactly the returned tiles (each locked edge appears
      exactly once), now including share moves
- [ ] The debug animation shows braiding and crossings changing with the sharing knob
- [ ] Old module and its tests still green; `npx vitest run`, `npm run check`, `npm run lint` all
      clean
