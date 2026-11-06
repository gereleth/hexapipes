# 04: Gate — tree count control + forest verdict

Source: `.scratch/multipipes-generator-forest/spec.md`, `docs/multipipes-generator-forest.md` (§
Open tunables, § Parked fallbacks).

**What to build:** Two parts. Code: tree count joins the worker-passed knob set on the growth path
(default one plus rounded square root of the cell count when unset) and gets a control on the
generator debug page alongside the other knobs, so K can be experimented with live. Human: generate
boards across the knob grid — sharing × branching × tree count, on at least hex, square and one
mixed-polygon grid, wrap and non-wrap — and judge the sharing texture: are sharing fronts even, do
crossings read as texture or clumping, are territory cores calm and seams busy. Record the verdict
in this file: forest proceeds (tickets 05–06 start), or forest disappoints (05–06 stay parked and
the scheduled-sharing design becomes the plan). The evenness statistic from the design doc is
deliberately out of scope — this is a looked-at-the-boards call.

Blocked by: 03 (merge phase).

Status: resolved

- [x] Tree count reaches the engine via worker options on the growth path, defaulting to the formula
      when unset
- [x] The generator debug page exposes a tree-count control alongside the other knobs
- [x] Boards reviewed across the knob grid on hex, square, and one mixed-polygon grid, wrap and
      non-wrap
- [x] Verdict recorded under a `## Verdict` heading in this file: proceed on forest, or pivot to the
      scheduled fallback, with a one-line why
- [x] `npx vitest run`, `npm run check`, `npm run lint` all clean

## Comments

Defaults decided with the user (2026-11-01), informed by the ticket-08 sweep
(`generator_stats/forest-sharing-sweep-20x20-wrap.csv`) and the √N-scaling discussion it prompted:

1. **Default K = `max(3, floor(N/20))`** — constant tree size (~20 cells, linear scaling),
   superseding the `1 + round(√N)` starting point (which had no recorded derivation anywhere and, as
   it turns out, diverged from the old generator's constant-subtree scaling
   `max(3, floor(total/50))` by accident). Why linear: sharing material is seam length per cell ∝
   √(K/N), so constant tree size keeps the sharing knob's meaning size-invariant across board sizes;
   √N made bigger boards mildly calmer at the same setting. Numbers: identical at 20×20 (20 trees vs
   today's 21 — the user's visual calibration happened there), diverging elsewhere — 40×40 gets 80
   small trees instead of 41, a 10×10 gets 5 bigger ones instead of 11.
2. **Default sharing = 0.35** — visually calibrated by the user across the grid kinds, inside the
   linear part of the knob response (0.1–0.5 on every grid kind, per the sweep). Applies to the
   forest path when it becomes the game default (ticket 06 cutover); today's 0.6 default belongs to
   the old generator.
3. **Plumbing already done:** treeCount reaches the engine via worker options on the growth path
   (`worker-multi.js growthStart` passes knobs as-is; defaults live in the engine) and the debug
   page exposes the control — acceptance bullets 1–2 checked.
4. **Implemented the same day**, forest engine only (`generator-multi` untouched):
   `defaultTreeCount` returns `max(3, floor(N/20))`, the engine's unset `sharingAmount` now defaults
   to 0.35 (an explicit 0 keeps its hard zero-sharing guarantee), the seed-count test pins the new
   formula, and the debug page's sharing slider starts at 0.35. `npx vitest run`, `npm run check`,
   `npm run lint` all clean after the change.

## Verdict

Proceed on forest — at the settled defaults (K = `max(3, floor(N/20))`, sharing 0.35) boards read as
braided texture rather than clumping (user's debug-page review across the grid kinds), and the knob
response is linear and monotone across all nine grid kinds (ticket-08 sweep), so nothing needs the
scheduled fallback. Tickets 05–06 unblocked.
