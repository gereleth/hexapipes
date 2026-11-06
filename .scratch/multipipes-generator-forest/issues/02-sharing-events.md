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

Blocked by: 01 (growth engine core).

Status: resolved

- [x] Sharing knob at zero hard-guarantees no shared tiles — no tile ever holds two pipes,
      stress-tested across runs
- [x] Sharing knob above zero produces shared tiles and crossings on demand (statistical test over
      repeated runs)
- [x] Pipes in a tile never connect: a share move never merges components (union-find component
      count unchanged — white-box test)
- [x] Newborn-pipe hard-ban case covered: a pipe born into a fresh cell never completes that cell's
      full union with its single end (the case that is easy to miss because the pipe does not exist
      yet at check time)
- [x] Share tier sits in the tier order — normal > share > straight-demotion > obvious-demotion >
      clean-full last resort — pinned by white-box test
- [x] The growth-event stream replays to exactly the returned tiles (each locked edge appears
      exactly once), now including share moves
- [x] The debug animation shows braiding and crossings changing with the sharing knob
- [x] Old module and its tests still green; `npx vitest run`, `npm run check`, `npm run lint` all
      clean

## Comments

- Mechanics settled from the docs: a share move is the tip's pipe gaining the direction plus a
  newborn pipe at the occupied target, unioned with the tip (same tree, components never merge) —
  exactly what ticket 01's `applyForestMove` already encoded for kind `share`; the classify table's
  "share at A" reads with A = the cell where the newborn lands.
- User decisions (plain-text Q&A during implementation):
  - **Foreign territory only**: a share requires that no pipe of the target tile belongs to the
    tip's union-find component. Consequence: `treeCount=1` boards never share. This also gives the
    "pipes in a tile never connect" invariant teeth — two same-component pipes can never end up in
    one tile, which the replay now asserts after every move.
  - **Dormant seeds stay dormant, failed seeds are dropped**: a seed whose cell was taken by an
    earlier opening still never grows, and a seed that cannot open at all (walled in, every move
    banned) no longer creates a tree — the opening round only creates trees for seeds that open, so
    no later phase ever sees an empty tree.
- Gate semantics per the spec's wording: one `Math.random() < sharingAmount` roll per pick
  (candidateBuckets call) gates the whole share tier; failed gate = the direction is skipped for
  that pick, the tip extends elsewhere or dies.
- Calibration measured on square 8x8 (200 runs each): sharing=0.25 → shared tiles in 200/200 runs,
  mean ~14; sharing=1 → 200/200, mean ~40-45, crossings ~5-7 per run. Test thresholds sit far below
  (≥36/40 runs, mean gap > 1, > 0 crossings).
- White-box coverage: replayEvents now rebuilds the board AND a union-find from the event stream —
  per-move component delta (extend/share 0, seed +1), cycle refusal, distinct roots within every
  touched tile, per-move hard-ban check including the share newborn, and final board equality. The
  boards sweep runs sharing 0 and 1 across all 11 grid kinds; the hard-ban stress forces
  sharingAmount=1 every other run so share-birth completions are exercised on small dense boards
  too.
- Newborn-pipe hard-ban coverage proven discriminating, not just hoped for: sabotaging a scratch
  copy of the engine (newborn side of the ban returns "nothing changes") yields 1751
  fully-connected-deadend tiles across 400 stress runs — the suite's board-invariants oracle goes
  red against it; the real engine yields 0 in the same protocol. Interesting side-finding: with the
  check present, share moves that would complete the target's union never even arise (6375 shares
  across 400 runs, zero would-be completions) — the ban and the clean-full demotion shape growth so
  such tiles don't survive to be shared into. The check is load-bearing, not emergent.
- Board invariants checker generalized to multipipes: coverage (≥1 pipe per playable cell), one pipe
  end per direction per tile (both via a per-tile claimed mask and via the single-match check across
  each edge), acyclicity over pipe nodes, hard ban per tile.
- One pre-existing flake hardened: ticket 01's avoidObvious statistical test asserted
  `avoiding < plain` with zero margin over 20 runs (measured gap ~0.05 over 100 runs); now
  `avoiding < plain - 0.02`, matching the sibling tests' margin style. Suite stable over 6+ full
  runs.
- Code review (standards + spec axes) findings applied: the shadowing `pipeIndex` callback parameter
  in the foreign-territory check renamed to `otherPipeIndex`; test error messages now say "tile"
  (not "cell") where they describe tile properties, per GLOSSARY.md. Reviewed-but-kept: the exact
  `toBe(7)`/default-tree-count assertions are safe because farthest-point seeds can never sit
  adjacent with ≤ 11 seeds on 10x10, so an opening cannot land on another seed and no tree is ever
  dropped on those boards; the deadend-predicate duplication between the two test helpers stays —
  independent derivation is the point of a test oracle; the per-pick gate roll fires even on picks
  with no occupied neighbour, keeping the "one roll per pick" semantics simple.
- Debug page needed no plumbing: the sharing slider already fed the growth command, the growth
  renderer already draws multiple pipes per tile and `describeGrowthMove` already labels share
  moves; only the stale "sharing arrives in later tickets" prose changed (worker comment likewise).
