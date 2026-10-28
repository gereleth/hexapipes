# 08: Growth-stop criterion — bounded post-coverage share quota

Source: `.scratch/multipipes-generator-forest/spec.md` (Implementation Decisions: Termination; Out
of Scope: tunable calibration — this ticket delivers the machinery, values stay experimental),
`docs/multipipes-generator-forest.md` (Termination, Open tunables),
`docs/multipipes-generator-scheduled.md` (coverage clock budget as the calibration starting point).

**What to build:** Replace pure frontier-exhaustion termination with the spec's third option: growth
stops when the board is covered AND a share quota is reached (or all tips are dead/parked, whichever
comes first). Today the sharing knob controls only a tip's _willingness_ to share per pick, while
the _amount_ is unbounded — tips keep sharing after coverage until every direction around them is
claimed. Measured on square 20x20, 30 runs: at sharing 1 winding, **186 of 400** tiles end up fully
connected (mostly multi-pipe crossings — saturation), vs ~60 at the 0.6 default. The knob should be
honestly monotone: low values calm, high values busy, but never half the board sealed.

**Why a quota and not coverage-stop:** stopping at bare coverage kills most sharing — the tier order
prefers fresh extends, so sharing fires mainly for boxed tips, which pre-coverage is too rare to
carry the variant's texture. The quota keeps a bounded post-coverage sharing tail: low-value calm
boards, high-value braided boards, ceiling included.

**Blocked by:** None technically; recommended after 07 (parking first, then this bounds the tail
that would otherwise drain the parked tips — together they drive degenerate pluses to classic's zero
AND cap saturation; re-measure the full grid of knob values after both).

**Status:** ready-for-agent

**Open design questions (decide before or while implementing):**

- **Quota formula starting point:** share-event budget `B = round(sharingAmount · 0.4 · N)` over N
  playable cells (borrowed from the scheduled design's coverage clock as an initial calibration;
  tuning lives on the debug page). Alternative shape: budget shared tiles rather than share events —
  a share can land in an already-shared tile; tiles are what the eye counts. Pick one, expose it,
  move on.
- **Stop condition composition:** stop at (coverage AND quota reached) OR (no actor left: every tip
  dead or parked). Parked tips at stop simply never move — classic's escape hatch, and the reason 07
  lands first.
- **Knob semantics after this ticket:** sharingAmount drives both the per-pick willingness gate and
  the quota (ceiling). Alternative: quota-only (drop the gate post-coverage). Keep one honest knob
  either way — willingness-only (today) fails the saturation test above.
- **Scope of the quota:** global budget vs per-tree. Trees have wildly different sizes at high
  treeCount; a global budget spent by whichever trees box first starves late seams. Per-tree budgets
  scaled by tree size are fairer but add bookkeeping. Start global, measure evenness (the spec's
  tripwire statistic), split only on evidence.
- **Interaction with treeCount:** more trees → more seams → more pre-coverage sharing; the quota
  only gates the tail, so knob monotonicity must be verified per treeCount, not just at the default.
- **Do demoted (tier-3+) share moves count against the quota?** Probably yes — they consume
  directions and fill tiles like any share; but if the goal is texture, clean shares matter most.
  Simplest: all share events count.

- [ ] sharingAmount monotonicity: mean shared tiles strictly increasing across [0, 0.25, 0.5, 0.75,
      1] at default and high treeCount (statistical test)
- [ ] Saturation cap: at sharing 1, fully-connected tiles land well below the frontier-exhaustion
      baseline (square 20x20 baseline: ~100-186/400; set the threshold from post-implementation
      measurements, justified in the ticket comments)
- [ ] Sharing 0 still hard-guarantees zero shared tiles (existing stress test stays green)
- [ ] Coverage never sacrificed for the quota; termination guaranteed; event stream still replays
      exactly (the last event is a legal move)
- [ ] The debug page growth animation shows the tail shorten as sharing drops; no plumbing beyond
      what exists
- [ ] `npx vitest run`, `npm run check`, `npm run lint` all clean
