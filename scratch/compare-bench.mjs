// Comparison helper for the paired benchmark output
// (generator_stats/layered_mark_ambiguous_20x20_paired.json, written by
// solver-layers-stats.test.js with BENCH_MARK_AMBIGUOUS=1).
//
// One file - baseline vs candidate within the paired run:
//   node scratch/compare-bench.mjs generator_stats/layered_mark_ambiguous_20x20_paired.json
//
// Two files - candidate side of the first run vs candidate side of the
// second (e.g. before/after a solver change). The board sequences must come
// from the same BENCH_SEED:
//   node scratch/compare-bench.mjs before_paired.json after_paired.json
import { readFileSync } from 'node:fs';

const [pathA, pathB] = process.argv.slice(2);
if (!pathA) {
	console.error('usage: node scratch/compare-bench.mjs <paired.json> [<paired2.json>]');
	process.exit(1);
}

const STAT_KEYS = ['iterations', 'trialClones', 'shortTrials', 'dirtyProcessings'];
const pct = (sorted, p) =>
	sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3)) : v);

/**
 * Loads one side of a paired run file as a flat per-board record list
 * @param {String} path
 * @param {'baseline'|'candidate'} side
 */
function loadRuns(path, side) {
	const data = JSON.parse(readFileSync(path, 'utf8'));
	if (!Array.isArray(data.runs) || (data.runs[0] && !data.runs[0][side])) {
		throw new Error(`${path}: not a paired benchmark file (runs lack a "${side}" record)`);
	}
	return {
		path,
		seed: data.seed,
		runs: data.runs.map((r) => ({
			grid: r.grid,
			subCells: r.subCells,
			capped: r[side].capped,
			elapsedMs: r[side].elapsedMs,
			numAmbiguous: r[side].numAmbiguous,
			unique: r[side].unique,
			solvable: r[side].solvable,
			stats: r[side].stats
		}))
	};
}

/**
 * Compares two per-board record lists grid by grid, pairing by board index
 * @param {{path: String, seed: any, runs: Array}} before
 * @param {{path: String, seed: any, runs: Array}} after
 * @param {String} beforeLabel
 * @param {String} afterLabel
 */
function compare(before, after, beforeLabel, afterLabel) {
	if (before.seed !== after.seed) {
		throw new Error(`seed mismatch: ${before.seed} vs ${after.seed}`);
	}
	if (pathB && before.seed === null) {
		console.warn(
			'warning: both files are unseeded, the board sequences are NOT guaranteed to match - ' +
				'use BENCH_SEED for before/after comparisons\n'
		);
	}
	console.log(
		`seed ${before.seed} | before: ${beforeLabel} (${before.path}) | ` +
			`after: ${afterLabel} (${after.path})\n`
	);
	for (const kind of ['square', 'hexagonal']) {
		const b = before.runs.filter((r) => r.grid === kind);
		const a = after.runs.filter((r) => r.grid === kind);
		if (b.length === 0 && a.length === 0) continue;
		console.log(`=== ${kind} (${b.length} vs ${a.length} boards) ===`);
		if (b.length !== a.length) {
			console.log('  run count mismatch, comparing the overlapping prefix');
		}
		const n = Math.min(b.length, a.length);
		const bothUncapped = (i) => !b[i].capped && !a[i].capped;
		console.log(
			`  capped: ${beforeLabel} [${b.map((r, i) => (r.capped ? i : null)).filter((v) => v !== null)}] ` +
				`${afterLabel} [${a.map((r, i) => (r.capped ? i : null)).filter((v) => v !== null)}]`
		);

		/** @type {(key: String, pairedOnly: Boolean) => void} */
		const compareKey = (key, pairedOnly) => {
			/** @type {Number[]} */
			const deltas = [];
			/** @type {Number[]} */
			const valsB = [];
			/** @type {Number[]} */
			const valsA = [];
			let improved = 0;
			let regressed = 0;
			let ties = 0;
			for (let i = 0; i < n; i++) {
				if (pairedOnly && !bothUncapped(i)) continue;
				const vb = key === 'elapsedMs' ? b[i].elapsedMs : b[i].stats[key];
				const va = key === 'elapsedMs' ? a[i].elapsedMs : a[i].stats[key];
				valsB.push(vb);
				valsA.push(va);
				deltas.push(va - vb);
				if (va < vb * 0.995) improved++;
				else if (va > vb * 1.005) regressed++;
				else ties++;
			}
			if (valsB.length === 0) {
				console.log(`  ${key}: no comparable pairs`);
				return;
			}
			const sB = [...valsB].sort((x, y) => x - y);
			const sA = [...valsA].sort((x, y) => x - y);
			const sD = [...deltas].sort((x, y) => x - y);
			console.log(
				`  ${key}: mean ${fmt(mean(valsB))} -> ${fmt(mean(valsA))} ` +
					`(${(((mean(valsA) - mean(valsB)) / mean(valsB)) * 100).toFixed(1)}%), ` +
					`p50 ${fmt(pct(sB, 0.5))} -> ${fmt(pct(sA, 0.5))}, ` +
					`p90 ${fmt(pct(sB, 0.9))} -> ${fmt(pct(sA, 0.9))}, ` +
					`max ${fmt(sB[sB.length - 1])} -> ${fmt(sA[sA.length - 1])}`
			);
			console.log(
				`    paired deltas (${afterLabel}-${beforeLabel}): mean ${fmt(mean(deltas))}, ` +
					`p10 ${fmt(pct(sD, 0.1))}, p50 ${fmt(pct(sD, 0.5))}, p90 ${fmt(pct(sD, 0.9))} | ` +
					`improved ${improved}, regressed ${regressed}, tied ${ties}`
			);
			// most regressed / most improved boards
			const ranked = deltas
				.map((d, i) => ({ d, i, r: valsB[i] ? d / valsB[i] : 0 }))
				.sort((x, y) => y.d - x.d);
			const worst = ranked.slice(0, 3).filter((x) => x.d > 0);
			const best = ranked
				.slice(-3)
				.filter((x) => x.d < 0)
				.reverse();
			const board = (x) =>
				`#${x.i}: ${fmt(b[x.i].subCells)}sc ${fmt(valsB[x.i])}->${fmt(valsA[x.i])}`;
			if (worst.length) console.log(`    worst: ${worst.map(board).join(' | ')}`);
			if (best.length) console.log(`    best : ${best.map(board).join(' | ')}`);
		};

		for (const key of STAT_KEYS) compareKey(key, false);
		compareKey('elapsedMs', true); // wall time only pairs when uncapped on both sides

		// per-pass cost
		const uncapped = (/** @type {Array} */ arr) => arr.filter((_, i) => i < n && bothUncapped(i));
		const dpB = mean(uncapped(b).map((r) => r.stats.dirtyProcessings));
		const dpA = mean(uncapped(a).map((r) => r.stats.dirtyProcessings));
		const eB = mean(uncapped(b).map((r) => r.elapsedMs));
		const eA = mean(uncapped(a).map((r) => r.elapsedMs));
		if (dpB > 0 && dpA > 0) {
			console.log(
				`  dirtyProcessings mean ${fmt(dpB)} -> ${fmt(dpA)} ` +
					`(${(((dpA - dpB) / dpB) * 100).toFixed(1)}%), ` +
					`ms/pass ${fmt(eB / dpB)} -> ${fmt(eA / dpA)} ` +
					`(${((eA / dpA / (eB / dpB) - 1) * 100).toFixed(1)}%)`
			);
		}

		// verdict diffs: boards where the search outcome changed
		/** @type {String[]} */
		const verdictDiffs = [];
		for (let i = 0; i < n; i++) {
			const vb = b[i];
			const va = a[i];
			if (
				vb.solvable !== va.solvable ||
				vb.unique !== va.unique ||
				vb.numAmbiguous !== va.numAmbiguous ||
				vb.capped !== va.capped
			) {
				verdictDiffs.push(
					`#${i}: solvable ${vb.solvable}->${va.solvable}, unique ${vb.unique}->${va.unique}, ` +
						`numAmbiguous ${vb.numAmbiguous}->${va.numAmbiguous}, capped ${vb.capped}->${va.capped}`
				);
			}
		}
		console.log(
			`  verdict diffs: ${verdictDiffs.length}` +
				(verdictDiffs.length ? ':' : ' (identical outcomes)')
		);
		for (const line of verdictDiffs.slice(0, 10)) console.log(`    ${line}`);

		console.log();
	}
}

if (pathB) {
	compare(
		loadRuns(pathA, 'candidate'),
		loadRuns(pathB, 'candidate'),
		`candidate of ${pathA}`,
		`candidate of ${pathB}`
	);
} else {
	compare(loadRuns(pathA, 'baseline'), loadRuns(pathA, 'candidate'), 'baseline', 'candidate');
}
