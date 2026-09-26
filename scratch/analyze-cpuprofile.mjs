// Analyzer for V8 .cpuprofile files written by scratch/profile-driver.mjs
// (or any node --cpu-prof run - same format).
//
// Usage:
//   node scratch/analyze-cpuprofile.mjs <profile.cpuprofile> [<more.cpuprofile> ...]
//
// Prints, per profile:
//  - a phase breakdown of SELF time (innermost-matching-frame attribution:
//    samples are attributed to the nearest stack frame whose function maps
//    to a known phase, inheriting from ancestors), and
//  - the top functions by self time.
//
// Self time = wall time where the function itself was on top of the stack;
// total time = self + all callees. Phase buckets mirror
// agent-doc/solver-perf-plan.md (applyConstraints / resolve+merge /
// answering-scans / clone / short-trials / guess-scan / ...).
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** @type {Array<[String, String]>} name -> phase (single names, no line ambiguity) */
const NAME_BUCKETS = [
	['applyConstraints', 'applyConstraints'],
	['mustHaveAllWalls', 'applyConstraints'],
	['mustHaveAllConnections', 'applyConstraints'],
	['forbidLayerConnection', 'applyConstraints'],
	['forbidLayerBridge', 'applyConstraints'],
	['mustNotSealDeadends', 'applyConstraints:deadends'],
	['getDeadendWeight', 'applyConstraints:deadends'],
	['unionAt', 'unionAt'],
	['getAnsweringLayers', 'answering-scans'],
	['getAnsweringComponent', 'answering-scans'],
	['getLayerDefiniteConnections', 'answering-scans'],
	['getLayerPotentialConnections', 'answering-scans'],
	['resolveComponents', 'resolve/merge'],
	['mergeComponents', 'resolve/merge'],
	['pruneLoop', 'loop-avoidance'],
	['avoidSlotLoops', 'loop-avoidance'],
	['avoidSubcellLoops', 'loop-avoidance'],
	['processDirtyCells', 'dirty-processing'],
	['processDirtyCell', 'dirty-processing'],
	['buildPossible', 'cell-init/getCell'],
	['doLocalDeductions', 'cell-init/getCell'],
	['getCell', 'cell-init/getCell'],
	['visualId', 'cell-init/getCell'],
	['doShortTrials', 'short-trials'],
	['makeAGuess', 'guess-scan'],
	['markAmbiguousTiles', 'markAmbiguousTiles(frame)'],
	['find_neighbour', 'grid-helpers'],
	['iterate_directions', 'util:iterate_directions'],
	['popcount', 'util:popcount'],
	['pregenerate_layers', 'generator/validate (noise)'],
	['planReuse', 'generator/validate (noise)'],
	['randomRotate', 'generator/validate (noise)'],
	['applyRotations', 'generator/validate (noise)'],
	['buildStartLayers', 'generator/validate (noise)'],
	['validateLayers', 'generator/validate (noise)'],
	['(garbage collector)', 'GC'],
	['(program)', '(program)'],
	['(idle)', '(idle)']
];
const NAME_MAP = new Map(NAME_BUCKETS);

/**
 * Phase of one profile node. Class constructors appear under the class
 * name; the shared method names clone/addConnection appear in both
 * LayeredCell (source lines < 440) and LayeredSolver (>= 440)
 * @param {String} name
 * @param {Number} line - 1-based source line
 * @param {String} url
 * @returns {String|null}
 */
function bucketOf(name, line, url) {
	if (url.startsWith('node:')) return '(node/profiler)';
	if (url.includes('profile-driver') || url.includes('vite-node') || url.includes('node_modules')) {
		return '(harness)';
	}
	if (name === 'LayeredCell') return 'cell-init/getCell';
	if (name === 'LayeredSolver') return 'clone (solver)';
	if (name === 'clone' || name === 'addConnection') {
		return line < 440 ? 'cell.clone' : name === 'clone' ? 'clone (solver)' : 'applyConstraints';
	}
	return NAME_MAP.get(name) ?? null;
}

/**
 * Analyzes one .cpuprofile file
 * @param {String} path
 */
function analyze(path) {
	const profile = JSON.parse(readFileSync(path, 'utf8'));
	const durationMs = (profile.endTime - profile.startTime) / 1000;
	/** @type {Map<Number, any>} */
	const nodes = new Map();
	for (const node of profile.nodes) nodes.set(node.id, node);

	// self time per node from the sample stream (timeDeltas[i] is the gap
	// before samples[i]; the µs values are summed as-is)
	/** @type {Map<Number, Number>} */
	const selfUs = new Map();
	const samples = profile.samples ?? [];
	const deltas = profile.timeDeltas ?? [];
	let sampledUs = 0;
	for (let i = 0; i < samples.length; i++) {
		const d = deltas[i] ?? 0;
		selfUs.set(samples[i], (selfUs.get(samples[i]) ?? 0) + d);
		sampledUs += d;
	}

	// phase buckets: DFS from the root, innermost matching frame wins and
	// its subtree inherits the bucket until a deeper match overrides. This
	// makes each bucket's number inclusive of its non-matching callees
	// (native builtins, anonymous closures), which is the closest well-
	// defined analogue of "total time" - V8 dedupes nodes shared across
	// call paths, so per-node subtree sums are not a tree and mislead.
	/** @type {Map<String, Number>} */
	const bucketSelfUs = new Map();
	/** @type {Array<[any, String]>} */
	const dfs = [[profile.nodes[0], 'other']];
	while (dfs.length > 0) {
		const [node, inherited] = dfs.pop();
		if (!node) continue;
		const bucket =
			bucketOf(
				node.callFrame.functionName,
				node.callFrame.lineNumber + 1,
				node.callFrame.url ?? ''
			) ?? inherited;
		bucketSelfUs.set(bucket, (bucketSelfUs.get(bucket) ?? 0) + (selfUs.get(node.id) ?? 0));
		for (const childId of node.children ?? []) {
			const child = nodes.get(childId);
			if (child) dfs.push([child, bucket]);
		}
	}

	// percentages exclude the fixed Profiler.stop serialization cost that
	// gets sampled into '(node/profiler)' (constant ~200 ms, dilutes with
	// profile length)
	const profilerUs = bucketSelfUs.get('(node/profiler)') ?? 0;
	const baseUs = Math.max(1, sampledUs - profilerUs);
	const pct = (/** @type {Number} */ us) => ((us / baseUs) * 100).toFixed(1).padStart(5);
	const ms = (/** @type {Number} */ us) => (us / 1000).toFixed(1).padStart(9);

	console.log(`== ${basename(path)} ==`);
	console.log(
		`wall ${durationMs.toFixed(1)} ms, samples ${samples.length}, sampled ${ms(sampledUs)} ms` +
			(durationMs > 0 && Math.abs(sampledUs / 1000 - durationMs) / durationMs > 0.05
				? ` (note: sampled differs from wall by >5%)`
				: '')
	);
	console.log(`\nPhase breakdown (self time, nearest matching frame, % of non-profiler time):`);
	const buckets = [...bucketSelfUs.entries()]
		.filter(([, us]) => us > 0)
		.sort((a, b) => b[1] - a[1]);
	for (const [bucket, us] of buckets) {
		console.log(`  ${bucket.padEnd(28)} ${ms(us)} ms  ${pct(us)}%`);
	}

	/** @type {Map<String, any>} */
	const byFrame = new Map();
	for (const node of profile.nodes) {
		const key = `${node.callFrame.functionName}|${node.callFrame.url}|${node.callFrame.lineNumber}`;
		const prev = byFrame.get(key);
		if (prev) {
			prev.selfUs += selfUs.get(node.id) ?? 0;
		} else {
			byFrame.set(key, {
				name: node.callFrame.functionName || '(anonymous)',
				url: node.callFrame.url ?? '',
				line: node.callFrame.lineNumber + 1,
				selfUs: selfUs.get(node.id) ?? 0
			});
		}
	}
	console.log(`\nTop functions by self time:`);
	const top = [...byFrame.values()].sort((a, b) => b.selfUs - a.selfUs).slice(0, 30);
	for (const f of top) {
		const loc = f.url ? `${basename(f.url)}:${f.line}` : '(no url)';
		const bucket = bucketOf(f.name, f.line, f.url) ?? '';
		console.log(
			`  ${f.name.padEnd(28)} ${loc.padEnd(32)} self ${ms(f.selfUs)}  ${pct(f.selfUs)}%  ${bucket}`
		);
	}
	console.log('');
}

for (const path of process.argv.slice(2)) {
	analyze(path);
}
