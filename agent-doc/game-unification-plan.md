# Plan: unify the classic and layered pipes game (game/UI layer)

Status: **planned, not implemented** (refreshed 2026-10-11, branch `layers`).

Prerequisite, **landed 2026-10-11**: solver steps and `solutions` are rotation counts for both
variants, and both game classes expose the same rotation-based `setTileRotation` (the plan file for
that change was deleted after landing; see git history). Nothing in this plan depends on solver emit
formats.

Scope: the player-facing game — `PipesGame`/`LayeredPipesGame`, `Tile.svelte`/`LayeredTile.svelte`,
`Puzzle.svelte` wiring. Solver and generator dedup remains a separate future discussion.

Line references are against the files as of 2026-10-11 and will drift once work starts.

## Current state

- `src/lib/puzzle/game.svelte.js` — classic `PipesGame` + `NewTileState`, 949 lines.
- `src/lib/puzzle/game-layers.svelte.js` — layered `LayeredPipesGame` + `LayeredTileState`, 1002
  lines. ~85% of the two files is 1:1 logic:
  - byte-identical: `toggleLocked`, `toggleEdgeMark`, `setTileRotation` (same modulo the empty-cell
    test: `tiles[index] === 0` vs `layers.length === 0`, which coincide once classic input is
    normalized to the one-layer shape), the two `$derived.by` stroke blocks
    (`disconnectStrokeWidthScale`/`disconnectStrokeColor`), tile-state `rotate`/`toggleLocked`;
  - identical modulo id codec and scalar-vs-per-layer writes: constructor skeleton, `startOver`,
    `rotateToMatchMarks` (one line differs), `setTileDisconnects`, `mergeComponents`,
    `disconnectComponents`, `detectLoops` (incl. the copy-pasted `pruneTile`/`pruneDeadEnds`/
    `traceLoopPath` closures), `findConnectedTiles`;
  - structurally divergent: `initializeBoard`, `rotateTile`, `handleConnections`, `isSolved`.
- `src/lib/puzzle/Puzzle.svelte` — 511 lines, 5 classic/layered branch sites left (the solution
  buttons already collapsed into one `game.setTileRotation` call, `9ca431f3`): construction `:55`
  (`Number.isInteger(tiles[0])`), `saveProgress` `:203`, `unleashTheSolver` `:250` (arms `:257-327`
  are verbatim-identical except the solver constructor), `measureSolveTime` `:335`, template tile
  choice `:447-457` (with a redundant `{:else if}` at `:456`).
- `Tile.svelte` (140) / `LayeredTile.svelte` (142) — parallel renderers; the geometric divergence is
  real (classic `get_pipes_path` draws straight segments from the cell center, the negative-mask
  layered mode draws bent pipes from per-layer centers, `polygonutils.js:199-249`, plus
  `pipeWidth * 0.7` and offset sinks). **They stay separate.**
- Persistence surfaces: size pages (`/hexagonal/10`, `/square/7`, …) save via
  `PuzzleInstanceWrapper.svelte` (one localStorage key per page, classic-shaped saves), `/daily`
  saves classic-shaped via its own key. `/custom` (the only layered-playable page) does not persist;
  `/generator-debug` renders static previews (`LayeredPipesGame` at `:7,100,628`) and is not
  interactive. No layered progress has ever been saved.
- Other class references: JSDoc unions in `EdgeMarks.svelte:6` and `controls.js:19`;
  `generator-layers.js` only shares the `LayeredTiles` typedef, no class dependency.

### The essential differences

1. **Tile shape**: one bitmask per cell vs `layers: Number[]` (a rotation turns all layers of a cell
   together). Classic is the `layers.length === 1` case.
2. **Identity**: cell index vs sub-cell id `cell + layer * grid.total`. For one layer,
   `subcellId(cell, 0) === cell` (`abstractgrid.js:94-96`) — the encodings coincide numerically.
3. **Connection storage invariant**: classic stores one-sided links ("I point at you") and re-checks
   mutuality at ~7 sites; layered stores mutual edges only and replaces every re-check with one
   geometric query, `findBackLayer(cell, direction)`.
4. **Status flags**: scalars per tile (`color`, `isPartOfLoop`, `isPartOfIsland`, `hasDisconnects`)
   vs arrays per layer, plus the `cell*` aggregators (`cellHasDisconnects`/`cellIsPartOfLoop`/
   `cellIsPartOfIsland`, `game-layers.svelte.js:232-252`) for the UI.
5. **Counts**: `totalTiles` (playable cells) vs `totalSubCells` (Σ layers) — equal for classic.

## Decisions

- **One class.** `PipesGame` accepts `Number[] | Number[][]` and normalizes classic input to a
  one-layer `LayeredTiles` shape (`[mask]` per playable cell, `[]` for empty cells).
  `game-layers.svelte.js` is deleted. The only variant bit left is `game.isLayered`, set from the
  input shape at construction, and it selects the renderer and the solver class — nothing else.
- **Sub-cell ids everywhere.** `components`/`connections`/`openEnds` are keyed by sub-cell id; for
  classic input the keys are numerically identical to today's cell indices, so the classic public
  API (component maps keyed by cell index) survives unchanged.
- **Save format: one field, two shapes, no migration.** The persisted field stays named `color`. The
  unified writer stores the colors array under it; the reader accepts `String | String[]`
  (`Array.isArray(saved.color) ? saved.color : [saved.color]`, with the existing fall-back-to-white
  for missing). Old string saves on size pages and `/daily` keep working forever; no route or
  wrapper code changes; failure-free by construction because the old name is still read.
- **Rendering: pixel-identical.** Both tile components stay. `Tile.svelte` switches its state reads
  to the unified forms (`data.colors[0]`, the per-layer flag arrays or the `cell*` aggregators);
  `data.tile` already works — it is the layer-union getter on the unified tile state. Paths, widths,
  sinks, animations unchanged.
- **Sequencing.** Steps 1–2 are behavior-preserving on classic and gate everything after them; each
  later step keeps the full suite green.

## Step 1 — Characterization tests for classic (before any behavior-affecting change)

`game.svelte.test.js` (173 lines) covers `initializeBoard` and `setTileRotation`. Add tests pinning
current classic behavior on a small hex grid: rotate→merge (shared component + color),
rotate-away→split + `openEnds` + `hasDisconnects`, loop formation via rotation → `isPartOfLoop`,
`isSolved` true/false paths, off-board stub → `hasDisconnects`, `rotateToMatchMarks` with conn/wall
marks and a locked neighbour, `toggleLocked` assistant, `startOver` reset, and a save/restore
round-trip (string `color` in → restore → state) for the step-3 save change. The game pins above
must survive steps 2–3 unchanged. Full suite green on current code before proceeding.

## Step 2 — Classic adopts mutual-only storage (behavior-preserving, classic only)

- Add `pointsBack(cell, direction)`: the opposite bit is present in the neighbour's rotated mask
  (`grid.getDirections(state.tile, state.rotations, cell)`), the single-layer analogue of
  `findBackLayer`.
- `initializeBoard`: seed a link only when the neighbour points back; `hasDisconnects` when
  off-board/empty or no back-link. Empty cells stop getting singleton components and empty
  connection entries — unobservable: nothing reads them, `totalTiles` already excludes empties,
  `tileStates` still exist for empty cells so the UI is untouched.
- `handleConnections`: dirIn adds both sides only when mutual (else disconnect flag; include
  layered's "already connected" guard — harmless for classic); dirOut deletes both sides.
- `isSolved`: adopt layered's shape — `openEnds.size > 0` fast-fail + first-component coverage +
  pure BFS.
- `setTileDisconnects` recompute and the `rotateToMatchMarks` locked-neighbour probe switch to
  geometric `pointsBack`. Equivalence argument for the probe: stored links are always ⊆ the current
  mask directions (init seeds the current mask; dirIn adds on entry, dirOut deletes on exit), and
  the probe only consults _locked_ neighbours, whose stored set therefore equals "current mask
  directions with an in-board neighbour" — exactly what `pointsBack` answers.
- Behavior-preservation notes for `isSolved`: the mutuality re-check exists only to catch one-sided
  links; once storage is mutual-only, every stored link is mutual by invariant and the same unsolved
  boards are rejected earlier by the `openEnds` fast-fail (any non-mutual direction sets
  `hasDisconnects` → joins `openEnds`). Net behavior is equal or strictly more correct — see
  dead-code item below about the off-board hole.

### Dead code / dead weight inventory (classic — all removed in this step)

| Item                               | Location                                     | Status                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-1` stub check in `isSolved`      | `game.svelte.js:585-590`                     | dead today: no add site can store `-1` (both guarded by `!empty`, and `find_neighbour` returns `neighbour: -1` exactly when `empty` — `squaregrid.js:86`) |
| `-1` guard in `findConnectedTiles` | `game.svelte.js:916-920`                     | same                                                                                                                                                      |
| `startCheckAtIndex` writes         | `game.svelte.js:588, 599, 606` (decl `:567`) | write-only; the variable is read exactly once (L568, BFS seed)                                                                                            |
| mutuality re-check                 | `game.svelte.js:591-601`                     | **live today** (catches one-sided links); becomes unreachable only after the storage flip                                                                 |
| `$derived` writes in `startOver`   | `game.svelte.js:276-277`                     | pointless: `initializeBoard()` recomputes `shareDisconnectedTiles` before `startOver` returns; layered already omits them                                 |
| stray `this.initializes`           | `game.svelte.js:133`                         | typo of `initialized`, never read (grep: only occurrence in `src/`)                                                                                       |

Side note recorded for completeness: because the `-1` check is dead and classic `isSolved` never
consults `openEnds`/`hasDisconnects`, classic can in principle return true for a hand-made board
with an off-board stub on an otherwise fully merged component. Generator-shaped boards can't hit
this. The unified `openEnds` fast-fail closes the hole.

Gate: step-1 game characterization tests pass unchanged.

## Step 3 — One class, one state model

- `game.svelte.js` exports a single `PipesGame` taking `Number[] | Number[][]`; the constructor
  normalizes classic input (`[mask]` per cell, `[]` for empty) and sets `this.isLayered`.
  `game-layers.svelte.js` is deleted; no separate core module — with one class the shared
  implementations are just methods.
- One tile-state class (today's `LayeredTileState`): `layers`, per-layer `colors`/`isPartOfLoop`/
  `isPartOfIsland`/`hasDisconnects`, scalar `locked`/`rotations`/`edgeMarks`, `tile` union getter,
  the `cell*` aggregators. Classic = one layer per cell; empty cells keep a state (edge marks, UI)
  but no sub-cell ids, components, or connections — matches post-step-2 classic exactly.
- Single implementations replace the dual arms: `initializeBoard`, `rotateTile` (per-layer
  dirIn/dirOut), `handleConnections`, `computeLayerDisconnects`/`setTileDisconnects`, `isSolved`,
  `mergeComponents`, `disconnectComponents`, `detectLoops` (the in-component filter reduces to
  `tilesSet.has(x)` under the mutual-only invariant), `findConnectedTiles`, `toggleLocked`,
  `toggleEdgeMark`, `rotateToMatchMarks` (the locked-neighbour probe is `findBackLayer !== -1`,
  which reduces to `pointsBack` for one layer), `setTileRotation` (shared as-is), `startOver`.
- Counts/ids: `totalSubCells` (equals classic's old `totalTiles`), `firstValidId`.
- Save: one `Progress` typedef, `tiles[].color: String | String[]`; writer emits the array, reader
  accepts both shapes (see Decisions). `LayeredProgress` typedef goes away.
- Parity fix while touching the constructor: restore-branch fallbacks
  (`locked: savedTile.locked ?? false`, `edgeMarks: savedTile.edgeMarks || defaults`) matching
  classic's `edgeMarks || default` safety net.
- Consumer updates, all mechanical: `EdgeMarks.svelte:6` and `controls.js:19` type unions → single
  class; `generator-debug/+page.svelte:7,100` imports/constructs `PipesGame` with layered tiles
  (behavior identical via input shape); `Tile.svelte` reads (`colors[0]`, per-layer flags or
  aggregators); `LayeredTile.svelte:4` type import; test assertions that read scalar
  `color`/`hasDisconnects` move to the array forms; both game test files run against the one class
  with their existing input shapes.

Target: `game.svelte.js` ~1100 lines (from 1955 across two files), `game-layers.svelte.js` deleted.

Gate: full suite green — classic tests via normalized input, layered tests unchanged; classic
characterization tests from step 1 still passing unchanged (the storage model changed in steps 2–3,
the observable behavior did not).

## Step 4 — Puzzle.svelte collapse

With one game class and rotation-based steps everywhere:

- Construction `:55`: one `new PipesGame(grid, tiles, savedProgress)`.
- `unleashTheSolver` `:250-329` and `measureSolveTime` `:335`: the arms are already
  verbatim-identical except the solver constructor → one shared body with a
  `game.isLayered ? new LayeredSolver(...) : new Solver(...)` choice.
- Solution buttons: done already (`9ca431f3`) — one call, `game.setTileRotation(index, rotation)`.
- `saveProgress` `:203`: one mapper (`color: data.colors`).
- Template `:447-457`: renderer choice via `game.isLayered`; the redundant `{:else if}` goes away
  with the rewrite.

## Step 5 — Docs

- `layers-game.md`: the differences-vs-classic table shrinks to the tiles input shape and the
  renderer; record that classic is mutual-only and that both variants share the one class (the
  rotation-based `setTileRotation` note is already in place from the rename). Keep the
  `findBackLayer` gotcha.
- `AGENTS.md`: unchanged (the layers-variant description is about rules, not implementation).

## Out of scope

- Solver and generator dedup (`Solver` vs `LayeredSolver` internals, `GeneratorComponent`, workers)
  — future discussion.
- Layered `isSolved` popcount simplification (documented as "discussed, not applied"; needs test
  fixture rework, e.g. the `[[9],[12],[3],[6]]` loop fixture).
- Any rendering change; any route/wrapper (`PuzzleInstanceWrapper`, `/daily`) change.

## Verification

After each step: `npx vitest run` (full suite, ~25 s), `npm run check` (expect 0 errors and only
pre-existing warnings), `npm run lint`. Step gates are listed per step. After step 4, a manual smoke
pass: play a size page (`/hexagonal/10`, `/square/7`) including save → reload → restore (old saves
have string `color`), `/daily` restore, `/custom` layered play, and `/generator-debug` previews.
