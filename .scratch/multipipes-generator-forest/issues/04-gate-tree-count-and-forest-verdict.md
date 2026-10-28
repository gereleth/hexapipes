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

**Blocked by:** 03 (merge phase).

**Status:** ready-for-agent

- [ ] Tree count reaches the engine via worker options on the growth path, defaulting to the formula
      when unset
- [ ] The generator debug page exposes a tree-count control alongside the other knobs
- [ ] Boards reviewed across the knob grid on hex, square, and one mixed-polygon grid, wrap and
      non-wrap
- [ ] Verdict recorded under a `## Verdict` heading in this file: proceed on forest, or pivot to the
      scheduled fallback, with a one-line why
- [ ] `npx vitest run`, `npm run check`, `npm run lint` all clean
