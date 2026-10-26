/**
 * Component tracks connections between pipe nodes. Components are not
 * objects: a component is an integer id (1-based, bump-allocated, never
 * reused; 0 = none) into a struct-of-arrays registry:
 * - per-component columns: compNodeHead/Tail, compSlotHead/Tail (intrusive
 *   doubly-linked member lists), compNodeCount, compSlotCount (live member
 *   counts, read by the island checks), compTotalNodes (resolved pipe node
 *   mass, the sealed weight for island detection)
 * - member entries: nodeEntry{Key,Val,Next,Prev} (a component's resolved
 *   pipe node members: pipeNodeId => direction mask) and
 *   slotEntry{Key,Val,Next,Prev} (a component's open slots: cellIndex =>
 *   direction mask). Entries are pooled and never freed; unlinking only
 *   detaches an entry from its list.
 * - inverse indexes: nodeOwner/nodeEntry (pipeNodeId => owning
 *   component / its member entry) and slotDirect + slotCount
 *   ((cell, direction) => component, flattened by direction bit position;
 *   slotCount per cell = number of open slots; slots are iterated in
 *   numeric direction order)
 * All writes go through the helper methods; clone() slices the arrays.
 */

import { iterate_directions, popcount } from '#lib/puzzle/grids/bitmasks.js';

/**
 * Grows a typed array to newCapacity, preserving contents (the rest stays
 * zeroed, which keeps fresh component ids all-zero-initialized)
 * @param {Int32Array} arr
 * @param {Number} newCapacity
 * @returns {Int32Array}
 */
function growInt32(arr, newCapacity) {
	const grown = new Int32Array(newCapacity);
	grown.set(arr);
	return grown;
}

/**
 * Copies src into a fresh Int32Array of exactly newCapacity: truncates when
 * src is longer, zero-extends when it is shorter. A plain slice() would
 * silently return a SHORTER array when src is short, and later appends
 * inside the clone would then write out of bounds - discarded silently.
 * @param {Int32Array} src
 * @param {Number} newCapacity
 * @returns {Int32Array}
 */
function sliceCapacity(src, newCapacity) {
	const out = new Int32Array(newCapacity);
	out.set(src.subarray(0, Math.min(src.length, newCapacity)));
	return out;
}

/**
 * The component registry of a Solver: the only writer of its arrays.
 * The solver asks state questions and requests transitions; rows, lists,
 * counts are private bookkeeping.
 */
export class ComponentsRegistry {
	ND = 0;
	nodeCapacity = 0;
	slotCapacity = 0;
	compCount = 0;
	compCapacity = 0;
	nodeEntryCount = 0;
	nodeEntryCapacity = 0;
	slotEntryCount = 0;
	slotEntryCapacity = 0;
	/** @type {Int32Array} */
	nodeOwner;
	/** @type {Int32Array} */
	nodeEntry;
	/** @type {Int32Array} */
	slotDirect;
	/** @type {Int32Array} */
	cellSlotCount;
	/** @type {Int32Array} */
	compNodeHead;
	/** @type {Int32Array} */
	compNodeTail;
	/** @type {Int32Array} */
	compSlotHead;
	/** @type {Int32Array} */
	compSlotTail;
	/** @type {Int32Array} */
	compNodeCount;
	/** @type {Int32Array} */
	compSlotCount;
	/** @type {Int32Array} */
	compTotalNodes;
	/** @type {Int32Array} */
	nodeEntryKey;
	/** @type {Int32Array} */
	nodeEntryVal;
	/** @type {Int32Array} */
	nodeEntryNext;
	/** @type {Int32Array} */
	nodeEntryPrev;
	/** @type {Int32Array} */
	slotEntryKey;
	/** @type {Int32Array} */
	slotEntryVal;
	/** @type {Int32Array} */
	slotEntryNext;
	/** @type {Int32Array} */
	slotEntryPrev;
	/** @type {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} */
	grid;
	/** @type {Number} - grid.total, for turning pipe node ids back into cells */
	total;

	/**
	 *
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {Number} maxPipes
	 * @param {ComponentsRegistry|undefined} parent - clone source (internal)
	 */
	constructor(grid, maxPipes, parent = undefined) {
		this.grid = grid;
		this.total = grid.total;
		// Sizing: ND is the bit-width of the grid's DIRECTIONS (the union of
		// every direction bit any cell can use; per-cell masks are subsets of
		// it, so per-cell slot rows of width ND are enough). maxPipes comes
		// from the actual tiles, not from num_directions. Growable arrays are
		// sliced at used length + headroom in clones so their first append
		// does not immediately grow-copy.
		if (parent) {
			this.ND = parent.ND;
			this.nodeCapacity = parent.nodeCapacity;
			this.slotCapacity = parent.slotCapacity;
			this.compCount = parent.compCount;
			this.compCapacity = this.compCount + (this.compCount >> 3) + 16;
			this.nodeEntryCount = parent.nodeEntryCount;
			this.nodeEntryCapacity = this.nodeEntryCount + (this.nodeEntryCount >> 3) + 16;
			this.slotEntryCount = parent.slotEntryCount;
			this.slotEntryCapacity = this.slotEntryCount + (this.slotEntryCount >> 3) + 16;
			this.nodeOwner = parent.nodeOwner.slice();
			this.nodeEntry = parent.nodeEntry.slice();
			this.slotDirect = parent.slotDirect.slice();
			this.cellSlotCount = parent.cellSlotCount.slice();
			this.compNodeHead = sliceCapacity(parent.compNodeHead, this.compCapacity);
			this.compNodeTail = sliceCapacity(parent.compNodeTail, this.compCapacity);
			this.compSlotHead = sliceCapacity(parent.compSlotHead, this.compCapacity);
			this.compSlotTail = sliceCapacity(parent.compSlotTail, this.compCapacity);
			this.compNodeCount = sliceCapacity(parent.compNodeCount, this.compCapacity);
			this.compSlotCount = sliceCapacity(parent.compSlotCount, this.compCapacity);
			this.compTotalNodes = sliceCapacity(parent.compTotalNodes, this.compCapacity);
			this.nodeEntryKey = sliceCapacity(parent.nodeEntryKey, this.nodeEntryCapacity);
			this.nodeEntryVal = sliceCapacity(parent.nodeEntryVal, this.nodeEntryCapacity);
			this.nodeEntryNext = sliceCapacity(parent.nodeEntryNext, this.nodeEntryCapacity);
			this.nodeEntryPrev = sliceCapacity(parent.nodeEntryPrev, this.nodeEntryCapacity);
			this.slotEntryKey = sliceCapacity(parent.slotEntryKey, this.slotEntryCapacity);
			this.slotEntryVal = sliceCapacity(parent.slotEntryVal, this.slotEntryCapacity);
			this.slotEntryNext = sliceCapacity(parent.slotEntryNext, this.slotEntryCapacity);
			this.slotEntryPrev = sliceCapacity(parent.slotEntryPrev, this.slotEntryCapacity);
		} else {
			this.ND =
				32 -
				Math.clz32(
					grid.DIRECTIONS.reduce((/** @type {Number} */ a, /** @type {Number} */ b) => a | b, 0)
				);
			this.nodeCapacity = grid.total * maxPipes;
			this.slotCapacity = grid.total * this.ND;
			// components are born in addConnection (at most one per directed
			// edge) and are never freed
			this.compCapacity = this.slotCapacity + 16;
			this.compCount = 0;
			this.nodeEntryCapacity = this.nodeCapacity + 16;
			this.nodeEntryCount = 0;
			this.slotEntryCapacity = this.slotCapacity + 16;
			this.slotEntryCount = 0;
			this.nodeOwner = new Int32Array(this.nodeCapacity);
			this.nodeEntry = new Int32Array(this.nodeCapacity);
			this.slotDirect = new Int32Array(this.slotCapacity);
			this.cellSlotCount = new Int32Array(grid.total);
			this.compNodeHead = new Int32Array(this.compCapacity);
			this.compNodeTail = new Int32Array(this.compCapacity);
			this.compSlotHead = new Int32Array(this.compCapacity);
			this.compSlotTail = new Int32Array(this.compCapacity);
			this.compNodeCount = new Int32Array(this.compCapacity);
			this.compSlotCount = new Int32Array(this.compCapacity);
			this.compTotalNodes = new Int32Array(this.compCapacity);
			this.nodeEntryKey = new Int32Array(this.nodeEntryCapacity);
			this.nodeEntryVal = new Int32Array(this.nodeEntryCapacity);
			this.nodeEntryNext = new Int32Array(this.nodeEntryCapacity);
			this.nodeEntryPrev = new Int32Array(this.nodeEntryCapacity);
			this.slotEntryKey = new Int32Array(this.slotEntryCapacity);
			this.slotEntryVal = new Int32Array(this.slotEntryCapacity);
			this.slotEntryNext = new Int32Array(this.slotEntryCapacity);
			this.slotEntryPrev = new Int32Array(this.slotEntryCapacity);
		}
	}

	/**
	 * Copies all arrays at used length + headroom
	 * @returns {ComponentsRegistry}
	 */
	clone() {
		return new ComponentsRegistry(this.grid, 0, this);
	}

	// --- queries: the solver asks state questions; only the helpers below
	// write ---

	/**
	 * Whether this cell has any open slots
	 * @param {Number} cellIndex
	 * @returns {Boolean}
	 */
	hasOpenSlots(cellIndex) {
		return this.cellSlotCount[cellIndex] > 0;
	}

	/**
	 * The component holding an open slot at (cell, direction), 0 = none
	 * @param {Number} cellIndex
	 * @param {Number} direction
	 * @returns {Number}
	 */
	getSlotComponent(cellIndex, direction) {
		return this.slotDirect[cellIndex * this.ND + this.dirPos(direction)];
	}

	/**
	 * The component that owns a pipe node, 0 = none
	 * @param {Number} pipeNodeId
	 * @returns {Number}
	 */
	getNodeComponent(pipeNodeId) {
		return this.nodeOwner[pipeNodeId];
	}

	/**
	 * Direction mask a component has recorded for a pipe node, 0 when
	 * unowned. Without `component`, reads the owner; with it, asserts
	 * ownership matches first (cheap stale-id tripwire).
	 * @param {Number} pipeNodeId
	 * @param {Number|undefined} component
	 * @returns {Number}
	 */
	getNodeDirections(pipeNodeId, component = undefined) {
		const owner = this.nodeOwner[pipeNodeId];
		if (component !== undefined && owner !== component) {
			throw `Component ${component} does not own pipe node ${pipeNodeId} (owner ${owner})`;
		}
		if (owner === 0) return 0;
		return this.nodeEntryVal[this.nodeEntry[pipeNodeId]];
	}

	/**
	 * Visits every open slot of the cell exactly once, in ascending numeric
	 * direction order. The set of visited positions is fixed for the
	 * duration of the callback loop - merges mid-loop only repoint entries,
	 * never open slots. The `component` passed to the callback is read at
	 * visit time: repoints are observed as the survivor's id, never a stale
	 * absorbed id. Slots close only through resolution and merges, and only
	 * at the cell where the resolution happened - a slot the callback body
	 * resolves is closed at its own visit, an entry the loop has already
	 * read and will never revisit.
	 * @param {Number} cellIndex
	 * @param {(direction: Number, component: Number) => void} cb
	 */
	forEachSlot(cellIndex, cb) {
		const base = cellIndex * this.ND;
		for (let pos = 0; pos < this.ND; pos++) {
			const component = this.slotDirect[base + pos];
			if (component !== 0) cb(1 << pos, component);
		}
	}

	// --- mutations: the solver says what happened; the registry decides how
	// it is recorded ---

	/**
	 * Allocate a component id (bump allocator - ids are never reused, so a
	 * stale id can never alias a fresh component)
	 * @returns {Number}
	 */
	create() {
		if (this.compCount + 1 >= this.compCapacity) {
			this.compCapacity *= 2;
			const cap = this.compCapacity;
			this.compNodeHead = growInt32(this.compNodeHead, cap);
			this.compNodeTail = growInt32(this.compNodeTail, cap);
			this.compSlotHead = growInt32(this.compSlotHead, cap);
			this.compSlotTail = growInt32(this.compSlotTail, cap);
			this.compNodeCount = growInt32(this.compNodeCount, cap);
			this.compSlotCount = growInt32(this.compSlotCount, cap);
			this.compTotalNodes = growInt32(this.compTotalNodes, cap);
		}
		const c = ++this.compCount;
		this.compNodeHead[c] = 0;
		this.compNodeTail[c] = 0;
		this.compSlotHead[c] = 0;
		this.compSlotTail[c] = 0;
		this.compNodeCount[c] = 0;
		this.compSlotCount[c] = 0;
		this.compTotalNodes[c] = 0;
		return c;
	}

	/**
	 * Open one slot: `direction` becomes an unresolved half-connection of
	 * comp at the cell. Updates the cell's row entry and comp's per-cell
	 * record together, so the two indexes cannot drift.
	 * @param {Number} comp
	 * @param {Number} cellIndex
	 * @param {Number} direction
	 */
	addSlot(comp, cellIndex, direction) {
		this.slotSet(cellIndex, direction, comp);
		this.mergeSlotMask(comp, cellIndex, direction);
	}

	/**
	 * A slot resolved into a concrete pipe node: claim ownership, close the
	 * resolved slot - clear the cell's row entry and drop `direction` from
	 * comp's record for the cell (the record goes away when its mask empties;
	 * comp's other slots at the same cell survive) - append the pipe node
	 * entry, bump the cumulative pipe node count.
	 * @param {Number} comp
	 * @param {Number} pipeNodeId
	 * @param {Number} direction
	 */
	attachNode(comp, pipeNodeId, direction) {
		const cellIndex = pipeNodeId % this.total;
		this.nodeOwner[pipeNodeId] = comp;
		const entry = this.slotMember(comp, cellIndex);
		const slotsLeft = (entry !== 0 ? this.slotEntryVal[entry] : 0) & ~direction;
		if (slotsLeft === 0) {
			// nothing left at this cell - drop the end; an absent entry no-ops
			if (entry !== 0) this.unlinkSlotEntry(comp, entry);
		} else {
			this.slotEntryVal[entry] = slotsLeft;
		}
		this.nodeEntry[pipeNodeId] = this.nodeAppend(comp, pipeNodeId, direction);
		this.compTotalNodes[comp] += 1;
		this.slotRemove(cellIndex, direction);
	}

	/**
	 * Replace the recorded mask of an owned pipe node with the node's
	 * definite connections
	 * @param {Number} pipeNodeId
	 * @param {Number} directions
	 */
	setNodeDirections(pipeNodeId, directions) {
		const node = this.nodeEntry[pipeNodeId];
		if (node === 0) throw 'Component does not have pipe node that links it';
		this.nodeEntryVal[node] = directions;
	}

	/**
	 * Drop a pipe node's membership when its pipe is fully determined.
	 * Leaves the cumulative node count untouched - island deadend
	 * weights depend on it.
	 * @param {Number} comp
	 * @param {Number} pipeNodeId
	 */
	removeNode(comp, pipeNodeId) {
		const n = this.nodeEntry[pipeNodeId];
		if (n === 0) return;
		this.unlinkNodeEntry(comp, n);
		this.nodeOwner[pipeNodeId] = 0;
		this.nodeEntry[pipeNodeId] = 0;
	}

	/**
	 * Absorbs `keep` <- `absorb` after the two met at `pipeNodeId` via
	 * `direction`. First ORs `direction` into keep's record for the
	 * pipe node - the overlap validation and the absorbed's leftovers both
	 * derive from that mask (idempotent when the mask already records the
	 * direction). Then moves the absorbed's slots and node
	 * memberships to the survivor, repoints rows, closes the row entries
	 * for the directions it strips from the absorbed's record at the merge
	 * cell (clearing an already-closed entry no-ops), and accumulates the
	 * cumulative node count. All of the absorbed's members and slot
	 * ends are MOVED - the absorbed is left empty, and its id is never
	 * reused, so stale references can never alias a live component. Moving
	 * - rather than copying - is what maintains the invariant that a live
	 * component's list keys are exactly the nodes / cells its registry
	 * entries point at, which getNodeDirections and the row lookups rely
	 * on. The callbacks let the solver run its loop-avoidance logic
	 * over moved members without the registry knowing what avoidance is.
	 * Throws 'Invalid merge' when the masks don't overlap.
	 * @param {Number} keep - surviving component id
	 * @param {Number} absorb - absorbed component id
	 * @param {Number} pipeNodeId
	 * @param {Number} direction
	 * @param {(cellIndex: Number, survivor: Number) => void} onSlotMoved
	 * @param {(pipeNodeId: Number, survivor: Number) => void} onNodeMoved
	 */
	merge(keep, absorb, pipeNodeId, direction, onSlotMoved, onNodeMoved) {
		const cellIndex = pipeNodeId % this.total;
		if (this.nodeOwner[pipeNodeId] !== keep) throw 'Invalid merge';
		const keepEntry = this.nodeEntry[pipeNodeId];
		this.nodeEntryVal[keepEntry] |= direction;
		const nodeDirections = this.nodeEntryVal[keepEntry];
		const slotEntry = this.slotMember(absorb, cellIndex);
		const slotDirections = slotEntry !== 0 ? this.slotEntryVal[slotEntry] : 0;
		const slotsLeft = slotDirections & ~nodeDirections;
		if (nodeDirections === 0 || slotDirections === 0 || (slotDirections & nodeDirections) === 0) {
			throw 'Invalid merge';
		}
		if (slotsLeft === 0) {
			this.unlinkSlotEntry(absorb, slotEntry);
		} else {
			this.slotEntryVal[slotEntry] = slotsLeft;
		}
		// close the row entries the merge consumes at the merge cell: the
		// directions stripped from the absorbed's record there (its leftover
		// slots, if any, stay open and get repointed below). Manual bit loop
		// - merges are hot and a generator allocation per merge shows up in
		// the benchmark
		let stripped = slotDirections & nodeDirections;
		while (stripped) {
			const d = stripped & -stripped;
			stripped ^= d;
			this.slotRemove(cellIndex, d);
		}
		this.compTotalNodes[keep] += this.compTotalNodes[absorb];
		// move the absorbed's slots, in list order, to the survivor
		for (let n = this.compSlotHead[absorb]; n !== 0;) {
			const next = this.slotEntryNext[n];
			const joinIndex = this.slotEntryKey[n];
			const directions = this.slotEntryVal[n];
			this.unlinkSlotEntry(absorb, n);
			this.mergeSlotMask(keep, joinIndex, directions);
			for (let d of iterate_directions(directions)) {
				this.slotRepoint(joinIndex, d, keep);
			}
			onSlotMoved(joinIndex, keep);
			n = next;
		}
		// move the absorbed's pipe node entries
		for (let n = this.compNodeHead[absorb]; n !== 0;) {
			const next = this.nodeEntryNext[n];
			const joinNodeId = this.nodeEntryKey[n];
			const connections = this.nodeEntryVal[n];
			this.unlinkNodeEntry(absorb, n);
			if (this.nodeOwner[joinNodeId] === keep) {
				this.nodeEntryVal[this.nodeEntry[joinNodeId]] = connections;
			} else {
				const newNode = this.nodeAppend(keep, joinNodeId, connections);
				this.nodeOwner[joinNodeId] = keep;
				this.nodeEntry[joinNodeId] = newNode;
			}
			onNodeMoved(joinNodeId, keep);
			n = next;
		}
	}

	/**
	 * Open slots of comp - sums the per-cell record masks, so it counts
	 * slots, not records (two slots at one cell share a record and count
	 * twice). Island classification.
	 * @param {Number} comp
	 * @returns {Number}
	 */
	slotCount(comp) {
		const records = this.compSlotCount[comp];
		if (records === 0) return 0;
		const head = this.compSlotHead[comp];
		if (records === 1) return popcount(this.slotEntryVal[head]);
		let count = 0;
		for (let n = head; n !== 0; n = this.slotEntryNext[n]) {
			count += popcount(this.slotEntryVal[n]);
		}
		return count;
	}

	/**
	 * Live member nodes of comp. Island classification.
	 * @param {Number} comp
	 * @returns {Number}
	 */
	nodeCount(comp) {
		return this.compNodeCount[comp];
	}

	/**
	 * Cumulative pipe nodes ever joined by comp - deliberately not
	 * decremented by removeNode: island deadend weights depend on it.
	 * @param {Number} comp
	 * @returns {Number}
	 */
	totalNodeCount(comp) {
		return this.compTotalNodes[comp];
	}

	/**
	 * Iterates comp's slot entries
	 * @param {Number} comp
	 * @param {(cellIndex: Number, directions: Number) => void} cb
	 */
	forEachComponentSlot(comp, cb) {
		for (let n = this.compSlotHead[comp]; n !== 0; n = this.slotEntryNext[n]) {
			cb(this.slotEntryKey[n], this.slotEntryVal[n]);
		}
	}

	/**
	 * Iterates comp's live member nodes the same way
	 * @param {Number} comp
	 * @param {(pipeNodeId: Number, directions: Number) => void} cb
	 */
	forEachComponentNode(comp, cb) {
		for (let n = this.compNodeHead[comp]; n !== 0; n = this.nodeEntryNext[n]) {
			cb(this.nodeEntryKey[n], this.nodeEntryVal[n]);
		}
	}

	// --- registry helpers: the only writers of the arrays above ---

	/**
	 * Bit position of a single-bit direction mask. Throws on directions
	 * outside the grid's DIRECTIONS width - unlike a Map, a typed array
	 * write out of bounds would be silently discarded.
	 * @param {Number} direction
	 * @returns {Number}
	 */
	dirPos(direction) {
		const pos = 31 - Math.clz32(direction);
		if (pos >= this.ND) throw `Direction ${direction} outside the grid's DIRECTIONS width`;
		return pos;
	}

	/**
	 * Append a new resolved-member entry (pipeNodeId => direction bitmask)
	 * to comp's list and return the entry id. The caller registers ownership
	 * by setting nodeOwner/nodeEntry for the node. A member whose
	 * entry already exists must be updated in place through its
	 * nodeEntry back-pointer instead (never append twice).
	 * @param {Number} comp
	 * @param {Number} pipeNodeId
	 * @param {Number} directions - direction bitmask
	 * @returns {Number} entry id
	 */
	nodeAppend(comp, pipeNodeId, directions) {
		if (this.nodeEntryCount + 1 >= this.nodeEntryCapacity) {
			this.nodeEntryCapacity *= 2;
			const cap = this.nodeEntryCapacity;
			this.nodeEntryKey = growInt32(this.nodeEntryKey, cap);
			this.nodeEntryVal = growInt32(this.nodeEntryVal, cap);
			this.nodeEntryNext = growInt32(this.nodeEntryNext, cap);
			this.nodeEntryPrev = growInt32(this.nodeEntryPrev, cap);
		}
		const n = ++this.nodeEntryCount;
		this.nodeEntryKey[n] = pipeNodeId;
		this.nodeEntryVal[n] = directions;
		const tail = this.compNodeTail[comp];
		this.nodeEntryPrev[n] = tail;
		this.nodeEntryNext[n] = 0;
		if (tail === 0) this.compNodeHead[comp] = n;
		else this.nodeEntryNext[tail] = n;
		this.compNodeTail[comp] = n;
		this.compNodeCount[comp] += 1;
		return n;
	}

	/**
	 * Detach a member node entry from comp's list. The entry stays in the
	 * pool (ids are never reused) but is no longer part of any list.
	 * @param {Number} comp
	 * @param {Number} entry
	 */
	unlinkNodeEntry(comp, entry) {
		const prev = this.nodeEntryPrev[entry];
		const next = this.nodeEntryNext[entry];
		if (prev === 0) this.compNodeHead[comp] = next;
		else this.nodeEntryNext[prev] = next;
		if (next === 0) this.compNodeTail[comp] = prev;
		else this.nodeEntryPrev[next] = prev;
		this.compNodeCount[comp] -= 1;
	}

	/**
	 * Append a new slot entry (cellIndex => direction bitmask) to
	 * comp's slot list and return the entry id. An entry for a cell that
	 * already has one must be merged in place via slotMember instead
	 * (never append twice for the same cell).
	 * @param {Number} comp
	 * @param {Number} cellIndex
	 * @param {Number} direction
	 * @returns {Number} entry id
	 */
	slotNodeAppend(comp, cellIndex, direction) {
		if (this.slotEntryCount + 1 >= this.slotEntryCapacity) {
			this.slotEntryCapacity *= 2;
			const cap = this.slotEntryCapacity;
			this.slotEntryKey = growInt32(this.slotEntryKey, cap);
			this.slotEntryVal = growInt32(this.slotEntryVal, cap);
			this.slotEntryNext = growInt32(this.slotEntryNext, cap);
			this.slotEntryPrev = growInt32(this.slotEntryPrev, cap);
		}
		const n = ++this.slotEntryCount;
		this.slotEntryKey[n] = cellIndex;
		this.slotEntryVal[n] = direction;
		const tail = this.compSlotTail[comp];
		this.slotEntryPrev[n] = tail;
		this.slotEntryNext[n] = 0;
		if (tail === 0) this.compSlotHead[comp] = n;
		else this.slotEntryNext[tail] = n;
		this.compSlotTail[comp] = n;
		this.compSlotCount[comp] += 1;
		return n;
	}

	/**
	 * Detach a slot entry from comp's list (the entry is never freed)
	 * @param {Number} comp
	 * @param {Number} n
	 */
	unlinkSlotEntry(comp, n) {
		const prev = this.slotEntryPrev[n];
		const next = this.slotEntryNext[n];
		if (prev === 0) this.compSlotHead[comp] = next;
		else this.slotEntryNext[prev] = next;
		if (next === 0) this.compSlotTail[comp] = prev;
		else this.slotEntryPrev[next] = prev;
		this.compSlotCount[comp] -= 1;
	}

	/**
	 * Find comp's slot entry for a cell, 0 if absent. Linear scan; the
	 * lists are frontier-sized.
	 * @param {Number} comp
	 * @param {Number} cellIndex
	 * @returns {Number} entry id
	 */
	slotMember(comp, cellIndex) {
		let n = this.compSlotHead[comp];
		while (n !== 0) {
			if (this.slotEntryKey[n] === cellIndex) return n;
			n = this.slotEntryNext[n];
		}
		return 0;
	}

	/**
	 * Register a (cell, direction) slot for comp: one typed-array write,
	 * keeping the cell's live-slot count up to date for slotRepoint's guard.
	 * Callers iterate a cell's slots in numeric direction order over its row.
	 * @param {Number} cellIndex
	 * @param {Number} direction
	 * @param {Number} comp
	 */
	slotSet(cellIndex, direction, comp) {
		const idx = cellIndex * this.ND + this.dirPos(direction);
		if (this.slotDirect[idx] === 0) this.cellSlotCount[cellIndex] += 1;
		this.slotDirect[idx] = comp;
	}

	/**
	 * Repoint a (cell, direction) slot to comp during a merge. No-op when
	 * the cell has no open slots: a merge may only touch slots that
	 * still exist. Creating a slot here would resurrect a long-resolved
	 * end and fabricate a join that never happened.
	 * @param {Number} cellIndex
	 * @param {Number} direction
	 * @param {Number} comp
	 */
	slotRepoint(cellIndex, direction, comp) {
		if (this.cellSlotCount[cellIndex] === 0) return;
		this.slotSet(cellIndex, direction, comp);
	}

	/**
	 * Remove a direction from a cell's slot row. An all-zero row (count 0)
	 * means the cell has no open slots, the same as never having had one.
	 * @param {Number} cellIndex
	 * @param {Number} direction
	 */
	slotRemove(cellIndex, direction) {
		const idx = cellIndex * this.ND + this.dirPos(direction);
		if (this.slotDirect[idx] !== 0) {
			this.slotDirect[idx] = 0;
			this.cellSlotCount[cellIndex] -= 1;
		}
	}

	/**
	 * OR `directions` into comp's open slot entry for cellIndex — updating the
	 * existing entry in place, or appending a new entry if there is none.
	 * @param {Number} comp
	 * @param {Number} cellIndex
	 * @param {Number} directions
	 */
	mergeSlotMask(comp, cellIndex, directions) {
		const n = this.slotMember(comp, cellIndex);
		if (n !== 0) {
			this.slotEntryVal[n] |= directions;
		} else {
			this.slotNodeAppend(comp, cellIndex, directions);
		}
	}

	/**
	 * Debug-gated invariant check; called by the fuzz test, never from
	 * production code. Asserts, per component id 1..compCount (live and
	 * absorbed alike - absorbed ones simply have empty lists):
	 * 1. cellSlotCount[cell] equals the number of non-zero entries in the
	 *    cell's slotDirect row (an all-zero row is indistinguishable from
	 *    never having had slots);
	 * 2. a component's slot records are per-cell unique with non-empty
	 *    masks, every mask bit's row entry points back at the component,
	 *    and every row entry pointing at the component is covered by its
	 *    record for that cell - the "moving, not copying" membership
	 *    contract that makes the point lookups exact;
	 * 3. node list keys are exactly the pipe nodes whose nodeOwner
	 *    points at the component, with matching nodeEntry back-pointers;
	 * 4. the member counts match the live lists, and the cumulative
	 *    node count never dropped below the live members (it only
	 *    grows);
	 * 5. nodeOwner and nodeEntry are 0 together - an owned node
	 *    always has a member entry and vice versa.
	 * Note the record count (compSlotCount) is NOT a slot count - records
	 * aggregate a component's slots per cell; the public slotCount(comp)
	 * sums mask popcounts.
	 */
	validate() {
		const { ND, total } = this;
		for (let cell = 0; cell < total; cell++) {
			let count = 0;
			for (let pos = 0; pos < ND; pos++) {
				if (this.slotDirect[cell * ND + pos] !== 0) count += 1;
			}
			if (count !== this.cellSlotCount[cell]) {
				throw `validate: cellSlotCount[${cell}] = ${this.cellSlotCount[cell]}, row has ${count} open ends`;
			}
		}
		for (let comp = 1; comp <= this.compCount; comp++) {
			let records = 0;
			/** @type {Map<Number, Number>} */
			const cellMasks = new Map();
			for (let n = this.compSlotHead[comp]; n !== 0; n = this.slotEntryNext[n]) {
				const cell = this.slotEntryKey[n];
				const mask = this.slotEntryVal[n];
				if (mask === 0) {
					throw `validate: comp ${comp} has an empty slot record at cell ${cell}`;
				}
				if (cellMasks.has(cell)) {
					throw `validate: comp ${comp} has two slot records for cell ${cell}`;
				}
				cellMasks.set(cell, mask);
				for (let d of iterate_directions(mask)) {
					if (this.getSlotComponent(cell, d) !== comp) {
						throw `validate: comp ${comp} record at cell ${cell} claims direction ${d}, whose row entry points at ${this.getSlotComponent(cell, d)}`;
					}
				}
				records += 1;
			}
			for (let cell = 0; cell < total; cell++) {
				const owned = cellMasks.get(cell) || 0;
				for (let pos = 0; pos < ND; pos++) {
					if (this.slotDirect[cell * ND + pos] === comp && (owned & (1 << pos)) === 0) {
						throw `validate: row (cell ${cell}, direction bit ${pos}) points at comp ${comp}, whose record mask ${owned} does not include it`;
					}
				}
			}
			if (records !== this.compSlotCount[comp]) {
				throw `validate: compSlotCount[${comp}] = ${this.compSlotCount[comp]}, list holds ${records} records`;
			}
			let members = 0;
			for (let n = this.compNodeHead[comp]; n !== 0; n = this.nodeEntryNext[n]) {
				const id = this.nodeEntryKey[n];
				if (this.nodeOwner[id] !== comp) {
					throw `validate: comp ${comp} lists node ${id}, whose owner is ${this.nodeOwner[id]}`;
				}
				if (this.nodeEntry[id] !== n) {
					throw `validate: nodeEntry back-pointer mismatch for node ${id}`;
				}
				if (this.nodeEntryVal[n] === 0) {
					throw `validate: comp ${comp} member node ${id} has an empty direction mask`;
				}
				members += 1;
			}
			if (members !== this.compNodeCount[comp]) {
				throw `validate: compNodeCount[${comp}] = ${this.compNodeCount[comp]}, list holds ${members} members`;
			}
			if (this.compTotalNodes[comp] < members) {
				throw `validate: compTotalNodes[${comp}] = ${this.compTotalNodes[comp]} is below the ${members} live members`;
			}
		}
		for (let id = 0; id < this.nodeCapacity; id++) {
			if ((this.nodeOwner[id] === 0) !== (this.nodeEntry[id] === 0)) {
				throw `validate: node ${id} has owner ${this.nodeOwner[id]} but entry ${this.nodeEntry[id]}`;
			}
		}
	}
}
