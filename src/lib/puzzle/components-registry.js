/**
 * Component tracks connections between sub-cells. Components are not
 * objects: a component is an integer id (1-based, bump-allocated, never
 * reused; 0 = none) into a struct-of-arrays registry:
 * - per-component columns: compSubHead/Tail, compSlotHead/Tail (intrusive
 *   doubly-linked member lists), compSubCount, compSlotCount (live member
 *   counts, read by the island checks), compTotalSub (resolved sub-cell
 *   mass, the sealed weight for island detection)
 * - member nodes: subNode{Key,Val,Next,Prev} (a component's resolved
 *   sub-cell members: subcellId => direction mask) and
 *   slotNode{Key,Val,Next,Prev} (a component's open slot ends: cellIndex =>
 *   direction mask). Nodes are pooled and never freed; unlinking only
 *   detaches a node from its list.
 * - inverse indexes: subcellOwner/subcellNode (subcellId => owning
 *   component / its member node) and slotDirect + slotCount
 *   ((cell, direction) => component, flattened by direction bit position;
 *   slotCount per cell = number of open slot ends; slots are iterated in
 *   numeric direction order)
 * All writes go through the helper methods; clone() slices the arrays.
 */

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
 * Iterates directions present in a layer mask
 * @param {Number} mask
 * @yields {Number}
 */
export function* iterate_directions(mask) {
	let bits = mask;
	while (bits > 0) {
		const direction = bits & -bits;
		yield direction;
		bits ^= direction;
	}
}

/**
 * Counts total directions in a mask
 * @param {Number} mask
 * @returns {Number}
 */
export function popcount(mask) {
	let count = 0;
	let bits = mask;
	while (bits > 0) {
		bits ^= bits & -bits;
		count += 1;
	}
	return count;
}

/**
 * The component registry of a LayeredSolver: the only writer of its arrays.
 * The solver asks state questions and requests transitions; rows, lists,
 * counts and queues are private bookkeeping.
 */
export class ComponentsRegistry {
	ND = 0;
	subcellCapacity = 0;
	slotCapacity = 0;
	compCount = 0;
	compCapacity = 0;
	subNodeCount = 0;
	subNodeCapacity = 0;
	slotNodeCount = 0;
	slotNodeCapacity = 0;
	/** @type {Int32Array} */
	subcellOwner;
	/** @type {Int32Array} */
	subcellNode;
	/** @type {Int32Array} */
	slotDirect;
	/** @type {Int32Array} */
	cellSlotCount;
	/** @type {Int32Array} */
	compSubHead;
	/** @type {Int32Array} */
	compSubTail;
	/** @type {Int32Array} */
	compSlotHead;
	/** @type {Int32Array} */
	compSlotTail;
	/** @type {Int32Array} */
	compSubCount;
	/** @type {Int32Array} */
	compSlotCount;
	/** @type {Int32Array} */
	compTotalSub;
	/** @type {Int32Array} */
	subNodeKey;
	/** @type {Int32Array} */
	subNodeVal;
	/** @type {Int32Array} */
	subNodeNext;
	/** @type {Int32Array} */
	subNodePrev;
	/** @type {Int32Array} */
	slotNodeKey;
	/** @type {Int32Array} */
	slotNodeVal;
	/** @type {Int32Array} */
	slotNodeNext;
	/** @type {Int32Array} */
	slotNodePrev;
	/** @type {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} */
	grid;
	/** @type {Number} - grid.total, for turning subcellIds back into cells */
	total;

	/**
	 *
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {Number} maxLayers
	 * @param {ComponentsRegistry|undefined} parent - clone source (internal)
	 */
	constructor(grid, maxLayers, parent = undefined) {
		this.grid = grid;
		this.total = grid.total;
		// Sizing: ND is the bit-width of the grid's DIRECTIONS (the union of
		// every direction bit any cell can use; per-cell masks are subsets of
		// it, so per-cell slot rows of width ND are enough). maxLayers comes
		// from the actual tiles, not from num_directions. Growable arrays are
		// sliced at used length + headroom in clones so their first append
		// does not immediately grow-copy.
		if (parent) {
			this.ND = parent.ND;
			this.subcellCapacity = parent.subcellCapacity;
			this.slotCapacity = parent.slotCapacity;
			this.compCount = parent.compCount;
			this.compCapacity = this.compCount + (this.compCount >> 3) + 16;
			this.subNodeCount = parent.subNodeCount;
			this.subNodeCapacity = this.subNodeCount + (this.subNodeCount >> 3) + 16;
			this.slotNodeCount = parent.slotNodeCount;
			this.slotNodeCapacity = this.slotNodeCount + (this.slotNodeCount >> 3) + 16;
			this.subcellOwner = parent.subcellOwner.slice();
			this.subcellNode = parent.subcellNode.slice();
			this.slotDirect = parent.slotDirect.slice();
			this.cellSlotCount = parent.cellSlotCount.slice();
			this.compSubHead = sliceCapacity(parent.compSubHead, this.compCapacity);
			this.compSubTail = sliceCapacity(parent.compSubTail, this.compCapacity);
			this.compSlotHead = sliceCapacity(parent.compSlotHead, this.compCapacity);
			this.compSlotTail = sliceCapacity(parent.compSlotTail, this.compCapacity);
			this.compSubCount = sliceCapacity(parent.compSubCount, this.compCapacity);
			this.compSlotCount = sliceCapacity(parent.compSlotCount, this.compCapacity);
			this.compTotalSub = sliceCapacity(parent.compTotalSub, this.compCapacity);
			this.subNodeKey = sliceCapacity(parent.subNodeKey, this.subNodeCapacity);
			this.subNodeVal = sliceCapacity(parent.subNodeVal, this.subNodeCapacity);
			this.subNodeNext = sliceCapacity(parent.subNodeNext, this.subNodeCapacity);
			this.subNodePrev = sliceCapacity(parent.subNodePrev, this.subNodeCapacity);
			this.slotNodeKey = sliceCapacity(parent.slotNodeKey, this.slotNodeCapacity);
			this.slotNodeVal = sliceCapacity(parent.slotNodeVal, this.slotNodeCapacity);
			this.slotNodeNext = sliceCapacity(parent.slotNodeNext, this.slotNodeCapacity);
			this.slotNodePrev = sliceCapacity(parent.slotNodePrev, this.slotNodeCapacity);
		} else {
			this.ND =
				32 -
				Math.clz32(
					grid.DIRECTIONS.reduce((/** @type {Number} */ a, /** @type {Number} */ b) => a | b, 0)
				);
			this.subcellCapacity = grid.total * maxLayers;
			this.slotCapacity = grid.total * this.ND;
			// components are born in addConnection (at most one per directed
			// edge) and are never freed
			this.compCapacity = this.slotCapacity + 16;
			this.compCount = 0;
			this.subNodeCapacity = this.subcellCapacity + 16;
			this.subNodeCount = 0;
			this.slotNodeCapacity = this.slotCapacity + 16;
			this.slotNodeCount = 0;
			this.subcellOwner = new Int32Array(this.subcellCapacity);
			this.subcellNode = new Int32Array(this.subcellCapacity);
			this.slotDirect = new Int32Array(this.slotCapacity);
			this.cellSlotCount = new Int32Array(grid.total);
			this.compSubHead = new Int32Array(this.compCapacity);
			this.compSubTail = new Int32Array(this.compCapacity);
			this.compSlotHead = new Int32Array(this.compCapacity);
			this.compSlotTail = new Int32Array(this.compCapacity);
			this.compSubCount = new Int32Array(this.compCapacity);
			this.compSlotCount = new Int32Array(this.compCapacity);
			this.compTotalSub = new Int32Array(this.compCapacity);
			this.subNodeKey = new Int32Array(this.subNodeCapacity);
			this.subNodeVal = new Int32Array(this.subNodeCapacity);
			this.subNodeNext = new Int32Array(this.subNodeCapacity);
			this.subNodePrev = new Int32Array(this.subNodeCapacity);
			this.slotNodeKey = new Int32Array(this.slotNodeCapacity);
			this.slotNodeVal = new Int32Array(this.slotNodeCapacity);
			this.slotNodeNext = new Int32Array(this.slotNodeCapacity);
			this.slotNodePrev = new Int32Array(this.slotNodeCapacity);
		}
	}

	/**
	 * Copies all arrays at used length + headroom; the island queue starts
	 * empty (clones are only created outside processDirtyCell's drain
	 * window, so the parent's queue is always empty when copying happens)
	 * @returns {ComponentsRegistry}
	 */
	clone() {
		return new ComponentsRegistry(this.grid, 0, this);
	}

	// --- queries: the solver asks state questions; only the helpers below
	// write ---

	/**
	 * Whether the cell has any open slot ends
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
	 * The component that owns a sub-cell, 0 = none
	 * @param {Number} subcellId
	 * @returns {Number}
	 */
	getSubcellComponent(subcellId) {
		return this.subcellOwner[subcellId];
	}

	/**
	 * Direction mask a component has recorded for a sub-cell, 0 when
	 * unowned. Without `component`, reads the owner; with it, asserts
	 * ownership matches first (cheap stale-id tripwire).
	 * @param {Number} subcellId
	 * @param {Number|undefined} component
	 * @returns {Number}
	 */
	getSubcellDirections(subcellId, component = undefined) {
		const owner = this.subcellOwner[subcellId];
		if (component !== undefined && owner !== component) {
			throw `Component ${component} does not own subcell ${subcellId} (owner ${owner})`;
		}
		if (owner === 0) return 0;
		return this.subNodeVal[this.subcellNode[subcellId]];
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
			this.compSubHead = growInt32(this.compSubHead, cap);
			this.compSubTail = growInt32(this.compSubTail, cap);
			this.compSlotHead = growInt32(this.compSlotHead, cap);
			this.compSlotTail = growInt32(this.compSlotTail, cap);
			this.compSubCount = growInt32(this.compSubCount, cap);
			this.compSlotCount = growInt32(this.compSlotCount, cap);
			this.compTotalSub = growInt32(this.compTotalSub, cap);
		}
		const c = ++this.compCount;
		this.compSubHead[c] = 0;
		this.compSubTail[c] = 0;
		this.compSlotHead[c] = 0;
		this.compSlotTail[c] = 0;
		this.compSubCount[c] = 0;
		this.compSlotCount[c] = 0;
		this.compTotalSub[c] = 0;
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
	 * A slot resolved into a concrete sub-cell: claim ownership, close the
	 * resolved slot - clear the cell's row entry and drop `direction` from
	 * comp's record for the cell (the record goes away when its mask empties;
	 * comp's other slots at the same cell survive) - append the sub-cell
	 * node, bump the cumulative sub-cell count.
	 * @param {Number} comp
	 * @param {Number} subcellId
	 * @param {Number} direction
	 */
	attachSubcell(comp, subcellId, direction) {
		const cellIndex = subcellId % this.total;
		this.subcellOwner[subcellId] = comp;
		const node = this.slotMember(comp, cellIndex);
		const slotsLeft = (node !== 0 ? this.slotNodeVal[node] : 0) & ~direction;
		if (slotsLeft === 0) {
			// nothing left at this cell - drop the end; an absent entry no-ops
			if (node !== 0) this.unlinkSlotNode(comp, node);
		} else {
			this.slotNodeVal[node] = slotsLeft;
		}
		this.subcellNode[subcellId] = this.subAppend(comp, subcellId, direction);
		this.compTotalSub[comp] += 1;
		this.slotRemove(cellIndex, direction);
	}

	/**
	 * Replace the recorded mask of an owned sub-cell with the cell's
	 * definite connections
	 * @param {Number} subcellId
	 * @param {Number} mask
	 */
	setSubcellDirections(subcellId, mask) {
		const node = this.subcellNode[subcellId];
		if (node === 0) throw 'Component does not have subcell that links it';
		this.subNodeVal[node] = mask;
	}

	/**
	 * Drop a sub-cell's membership when its layer is fully determined.
	 * Leaves the cumulative sub-cell count untouched - island deadend
	 * weights depend on it.
	 * @param {Number} comp
	 * @param {Number} subcellId
	 */
	removeSubcell(comp, subcellId) {
		const n = this.subcellNode[subcellId];
		if (n === 0) return;
		this.unlinkSubNode(comp, n);
		this.subcellOwner[subcellId] = 0;
		this.subcellNode[subcellId] = 0;
	}

	/**
	 * Absorbs `keep` <- `absorb` after the two met at `subcellId` via
	 * `direction`. First ORs `direction` into keep's record for the
	 * sub-cell - the overlap validation and the absorbed's leftovers both
	 * derive from that mask (idempotent when the mask already records the
	 * direction). Then moves the absorbed's slot ends and sub-cell
	 * memberships to the survivor, repoints rows, closes the row entries
	 * for the directions it strips from the absorbed's record at the merge
	 * cell (clearing an already-closed entry no-ops), and accumulates the
	 * cumulative sub-cell count. All of the absorbed's members and slot
	 * ends are MOVED - the absorbed is left empty, and its id is never
	 * reused, so stale references can never alias a live component. Moving
	 * - rather than copying - is what maintains the invariant that a live
	 * component's list keys are exactly the sub-cells / cells its registry
	 * entries point at, which getSubcellDirections and the row lookups rely
	 * on. The callbacks let the solver run its loop-avoidance heuristics
	 * over moved members without the registry knowing what avoidance is.
	 * Throws 'Invalid merge' when the masks don't overlap - validation is
	 * data-only, so it stays.
	 * @param {Number} keep - surviving component id
	 * @param {Number} absorb - absorbed component id
	 * @param {Number} subcellId
	 * @param {Number} direction
	 * @param {(cellIndex: Number, survivor: Number) => void} onSlotCellMoved
	 * @param {(subcellId: Number, survivor: Number) => void} onSubcellMoved
	 */
	merge(keep, absorb, subcellId, direction, onSlotCellMoved, onSubcellMoved) {
		const cellIndex = subcellId % this.total;
		if (this.subcellOwner[subcellId] !== keep) throw 'Invalid merge';
		const keepNode = this.subcellNode[subcellId];
		this.subNodeVal[keepNode] |= direction;
		const subCellDirections = this.subNodeVal[keepNode];
		const slotNode = this.slotMember(absorb, cellIndex);
		const slotDirections = slotNode !== 0 ? this.slotNodeVal[slotNode] : 0;
		const slotsLeft = slotDirections & ~subCellDirections;
		if (
			subCellDirections === 0 ||
			slotDirections === 0 ||
			(slotDirections & subCellDirections) === 0
		) {
			throw 'Invalid merge';
		}
		if (slotsLeft === 0) {
			this.unlinkSlotNode(absorb, slotNode);
		} else {
			this.slotNodeVal[slotNode] = slotsLeft;
		}
		// close the row entries the merge consumes at the merge cell: the
		// directions stripped from the absorbed's record there (its leftover
		// slots, if any, stay open and get repointed below). Manual bit loop
		// - merges are hot and a generator allocation per merge shows up in
		// the benchmark
		let stripped = slotDirections & subCellDirections;
		while (stripped) {
			const d = stripped & -stripped;
			stripped ^= d;
			this.slotRemove(cellIndex, d);
		}
		this.compTotalSub[keep] += this.compTotalSub[absorb];
		// move the absorbed's slot ends, in list order, to the survivor
		for (let n = this.compSlotHead[absorb]; n !== 0;) {
			const next = this.slotNodeNext[n];
			const joinIndex = this.slotNodeKey[n];
			const directions = this.slotNodeVal[n];
			this.unlinkSlotNode(absorb, n);
			this.mergeSlotMask(keep, joinIndex, directions);
			for (let d of iterate_directions(directions)) {
				this.slotRepoint(joinIndex, d, keep);
			}
			onSlotCellMoved(joinIndex, keep);
			n = next;
		}
		// move the absorbed's sub-cell entries
		for (let n = this.compSubHead[absorb]; n !== 0;) {
			const next = this.subNodeNext[n];
			const joinSubCellId = this.subNodeKey[n];
			const connections = this.subNodeVal[n];
			this.unlinkSubNode(absorb, n);
			if (this.subcellOwner[joinSubCellId] === keep) {
				this.subNodeVal[this.subcellNode[joinSubCellId]] = connections;
			} else {
				const newNode = this.subAppend(keep, joinSubCellId, connections);
				this.subcellOwner[joinSubCellId] = keep;
				this.subcellNode[joinSubCellId] = newNode;
			}
			onSubcellMoved(joinSubCellId, keep);
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
		if (records === 1) return popcount(this.slotNodeVal[head]);
		let count = 0;
		for (let n = head; n !== 0; n = this.slotNodeNext[n]) {
			count += popcount(this.slotNodeVal[n]);
		}
		return count;
	}

	/**
	 * Live member sub-cells of comp. Island classification.
	 * @param {Number} comp
	 * @returns {Number}
	 */
	subcellCount(comp) {
		return this.compSubCount[comp];
	}

	/**
	 * Cumulative sub-cells ever joined by comp - deliberately not
	 * decremented by removeSubcell: island deadend weights depend on it.
	 * @param {Number} comp
	 * @returns {Number}
	 */
	totalSubcellCount(comp) {
		return this.compTotalSub[comp];
	}

	/**
	 * Iterates comp's open-slot records (a record = the component's slots at
	 * one cell, aggregated into a direction bitmask)
	 * @param {Number} comp
	 * @param {(cellIndex: Number, directions: Number) => void} cb
	 */
	forEachComponentSlot(comp, cb) {
		for (let n = this.compSlotHead[comp]; n !== 0; n = this.slotNodeNext[n]) {
			cb(this.slotNodeKey[n], this.slotNodeVal[n]);
		}
	}

	/**
	 * Iterates comp's live member sub-cells the same way
	 * @param {Number} comp
	 * @param {(subcellId: Number, directions: Number) => void} cb
	 */
	forEachComponentSubcell(comp, cb) {
		for (let n = this.compSubHead[comp]; n !== 0; n = this.subNodeNext[n]) {
			cb(this.subNodeKey[n], this.subNodeVal[n]);
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
	 * Append a new resolved-member entry (subcellId => direction bitmask)
	 * to comp's list and return the node id. The caller registers ownership
	 * by setting subcellOwner/subcellNode for the sub-cell. A member whose
	 * entry already exists must be updated in place through its
	 * subcellNode back-pointer instead (never append twice).
	 * @param {Number} comp
	 * @param {Number} subcellId
	 * @param {Number} val - direction bitmask
	 * @returns {Number} node id
	 */
	subAppend(comp, subcellId, val) {
		if (this.subNodeCount + 1 >= this.subNodeCapacity) {
			this.subNodeCapacity *= 2;
			const cap = this.subNodeCapacity;
			this.subNodeKey = growInt32(this.subNodeKey, cap);
			this.subNodeVal = growInt32(this.subNodeVal, cap);
			this.subNodeNext = growInt32(this.subNodeNext, cap);
			this.subNodePrev = growInt32(this.subNodePrev, cap);
		}
		const n = ++this.subNodeCount;
		this.subNodeKey[n] = subcellId;
		this.subNodeVal[n] = val;
		const tail = this.compSubTail[comp];
		this.subNodePrev[n] = tail;
		this.subNodeNext[n] = 0;
		if (tail === 0) this.compSubHead[comp] = n;
		else this.subNodeNext[tail] = n;
		this.compSubTail[comp] = n;
		this.compSubCount[comp] += 1;
		return n;
	}

	/**
	 * Detach a member-subcell node from comp's list. The node stays in the
	 * pool (ids are never reused) but is no longer part of any list.
	 * @param {Number} comp
	 * @param {Number} n
	 */
	unlinkSubNode(comp, n) {
		const prev = this.subNodePrev[n];
		const next = this.subNodeNext[n];
		if (prev === 0) this.compSubHead[comp] = next;
		else this.subNodeNext[prev] = next;
		if (next === 0) this.compSubTail[comp] = prev;
		else this.subNodePrev[next] = prev;
		this.compSubCount[comp] -= 1;
	}

	/**
	 * Read comp's direction mask for subcellId, 0 if comp does not own it.
	 * Exact because of the ownership invariant: a live component's member
	 * list holds exactly the sub-cells whose subcellOwner entry points at it.
	 * @param {Number} comp
	 * @param {Number} subcellId
	 * @returns {Number}
	 */
	subGetVal(comp, subcellId) {
		if (this.subcellOwner[subcellId] === comp) {
			return this.subNodeVal[this.subcellNode[subcellId]];
		}
		return 0;
	}

	/**
	 * Append a new open-slot-end entry (cellIndex => direction bitmask) to
	 * comp's slot list and return the node id. An entry for a cell that
	 * already has one must be merged in place via slotMember instead
	 * (never append twice for the same cell).
	 * @param {Number} comp
	 * @param {Number} cellIndex
	 * @param {Number} val - direction bitmask
	 * @returns {Number} node id
	 */
	slotNodeAppend(comp, cellIndex, val) {
		if (this.slotNodeCount + 1 >= this.slotNodeCapacity) {
			this.slotNodeCapacity *= 2;
			const cap = this.slotNodeCapacity;
			this.slotNodeKey = growInt32(this.slotNodeKey, cap);
			this.slotNodeVal = growInt32(this.slotNodeVal, cap);
			this.slotNodeNext = growInt32(this.slotNodeNext, cap);
			this.slotNodePrev = growInt32(this.slotNodePrev, cap);
		}
		const n = ++this.slotNodeCount;
		this.slotNodeKey[n] = cellIndex;
		this.slotNodeVal[n] = val;
		const tail = this.compSlotTail[comp];
		this.slotNodePrev[n] = tail;
		this.slotNodeNext[n] = 0;
		if (tail === 0) this.compSlotHead[comp] = n;
		else this.slotNodeNext[tail] = n;
		this.compSlotTail[comp] = n;
		this.compSlotCount[comp] += 1;
		return n;
	}

	/**
	 * Detach a slot node from comp's list (the node is never freed)
	 * @param {Number} comp
	 * @param {Number} n
	 */
	unlinkSlotNode(comp, n) {
		const prev = this.slotNodePrev[n];
		const next = this.slotNodeNext[n];
		if (prev === 0) this.compSlotHead[comp] = next;
		else this.slotNodeNext[prev] = next;
		if (next === 0) this.compSlotTail[comp] = prev;
		else this.slotNodePrev[next] = prev;
		this.compSlotCount[comp] -= 1;
	}

	/**
	 * Find comp's slot-list node for a cell, 0 if absent. Linear scan; the
	 * lists are frontier-sized.
	 * @param {Number} comp
	 * @param {Number} cellIndex
	 * @returns {Number} node id
	 */
	slotMember(comp, cellIndex) {
		let n = this.compSlotHead[comp];
		while (n !== 0) {
			if (this.slotNodeKey[n] === cellIndex) return n;
			n = this.slotNodeNext[n];
		}
		return 0;
	}

	/**
	 * Register a (cell, direction) slot for comp: one typed-array write,
	 * keeping the cell's live-slot count up to date for slotRepoint's guard.
	 * Callers iterate a cell's slots in numeric direction order over its row.
	 * @param {Number} cell
	 * @param {Number} direction
	 * @param {Number} comp
	 */
	slotSet(cell, direction, comp) {
		const idx = cell * this.ND + this.dirPos(direction);
		if (this.slotDirect[idx] === 0) this.cellSlotCount[cell] += 1;
		this.slotDirect[idx] = comp;
	}

	/**
	 * Repoint a (cell, direction) slot to comp during a merge. No-op when
	 * the cell has no open slot ends: a merge may only touch slots that
	 * still exist. Creating a slot here would resurrect a long-resolved
	 * end and fabricate a join that never happened.
	 * @param {Number} cell
	 * @param {Number} direction
	 * @param {Number} comp
	 */
	slotRepoint(cell, direction, comp) {
		if (this.cellSlotCount[cell] === 0) return;
		this.slotSet(cell, direction, comp);
	}

	/**
	 * Remove a direction from a cell's slot row. An all-zero row (count 0)
	 * means the cell has no open slot ends, the same as never having had
	 * one.
	 * @param {Number} cell
	 * @param {Number} direction
	 */
	slotRemove(cell, direction) {
		const idx = cell * this.ND + this.dirPos(direction);
		if (this.slotDirect[idx] !== 0) {
			this.slotDirect[idx] = 0;
			this.cellSlotCount[cell] -= 1;
		}
	}

	/**
	 * OR `dirs` into comp's open-slot-end entry for cellIndex — updating the
	 * existing entry in place, or appending a new entry if there is none.
	 * @param {Number} comp
	 * @param {Number} cellIndex
	 * @param {Number} dirs - direction bitmask
	 */
	mergeSlotMask(comp, cellIndex, dirs) {
		const n = this.slotMember(comp, cellIndex);
		if (n !== 0) {
			this.slotNodeVal[n] |= dirs;
		} else {
			this.slotNodeAppend(comp, cellIndex, dirs);
		}
	}

	/**
	 * Debug-gated invariant check; called by the fuzz test, never from
	 * production code. Asserts, per component id 1..compCount (live and
	 * absorbed alike - absorbed ones simply have empty lists):
	 * 1. cellSlotCount[cell] equals the number of non-zero entries in the
	 *    cell's slotDirect row (an all-zero row is indistinguishable from
	 *    never having had ends);
	 * 2. a component's slot records are per-cell unique with non-empty
	 *    masks, every mask bit's row entry points back at the component,
	 *    and every row entry pointing at the component is covered by its
	 *    record for that cell - the "moving, not copying" membership
	 *    contract that makes the point lookups exact;
	 * 3. subcell list keys are exactly the subcells whose subcellOwner
	 *    points at the component, with matching subcellNode back-pointers;
	 * 4. the member counts match the live lists, and the cumulative
	 *    subcell count never dropped below the live members (it only
	 *    grows);
	 * 5. subcellOwner and subcellNode are 0 together - an owned subcell
	 *    always has a member node and vice versa.
	 * Note the record count (compSlotCount) is NOT a slot count - records
	 * aggregate a component's slots per cell; the public slotCount(comp)
	 * sums masks.
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
			for (let n = this.compSlotHead[comp]; n !== 0; n = this.slotNodeNext[n]) {
				const cell = this.slotNodeKey[n];
				const mask = this.slotNodeVal[n];
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
			for (let n = this.compSubHead[comp]; n !== 0; n = this.subNodeNext[n]) {
				const id = this.subNodeKey[n];
				if (this.subcellOwner[id] !== comp) {
					throw `validate: comp ${comp} lists subcell ${id}, whose owner is ${this.subcellOwner[id]}`;
				}
				if (this.subcellNode[id] !== n) {
					throw `validate: subcellNode back-pointer mismatch for subcell ${id}`;
				}
				if (this.subNodeVal[n] === 0) {
					throw `validate: comp ${comp} member subcell ${id} has an empty direction mask`;
				}
				members += 1;
			}
			if (members !== this.compSubCount[comp]) {
				throw `validate: compSubCount[${comp}] = ${this.compSubCount[comp]}, list holds ${members} members`;
			}
			if (this.compTotalSub[comp] < members) {
				throw `validate: compTotalSub[${comp}] = ${this.compTotalSub[comp]} is below the ${members} live members`;
			}
		}
		for (let id = 0; id < this.subcellCapacity; id++) {
			if ((this.subcellOwner[id] === 0) !== (this.subcellNode[id] === 0)) {
				throw `validate: subcell ${id} has owner ${this.subcellOwner[id]} but node ${this.subcellNode[id]}`;
			}
		}
	}
}
