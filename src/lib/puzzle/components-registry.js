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
	islandQLen = 0;
	/** @type {Int32Array} */
	subcellOwner;
	/** @type {Int32Array} */
	subcellNode;
	/** @type {Int32Array} */
	slotDirect;
	/** @type {Int32Array} */
	slotCount;
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
	/** @type {Int32Array} */
	islandQ;
	/** @type {Int32Array} - per component: 0 never queued, 1 queued, 2 queued
	 * before and deleted (its islandQ position is stale but reserved) */
	islandState;
	/** @type {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} */
	grid;

	/**
	 *
	 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
	 * @param {Number} maxLayers
	 * @param {ComponentsRegistry|undefined} parent - clone source (internal)
	 */
	constructor(grid, maxLayers, parent = undefined) {
		this.grid = grid;
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
			this.slotCount = parent.slotCount.slice();
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
			// the island queue starts empty in every solver; its state column
			// is per-solver, indexed by component id
			this.islandQLen = 0;
			this.islandQ = new Int32Array(16);
			this.islandState = new Int32Array(this.compCapacity);
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
			this.slotCount = new Int32Array(grid.total);
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
			this.islandQLen = 0;
			this.islandQ = new Int32Array(16);
			this.islandState = new Int32Array(this.compCapacity);
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
		return this.slotCount[cellIndex] > 0;
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
	 * Allocate a component id (bump allocator - ids are never reused, so a
	 * stale id can never alias a fresh component)
	 * @returns {Number}
	 */
	compNew() {
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
			this.islandState = growInt32(this.islandState, cap);
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
	 * Remove subcellId's membership entry from its owner's list and registry
	 * @param {Number} comp
	 * @param {Number} subcellId
	 */
	subDelete(comp, subcellId) {
		const n = this.subcellNode[subcellId];
		if (n === 0) return;
		this.unlinkSubNode(comp, n);
		this.subcellOwner[subcellId] = 0;
		this.subcellNode[subcellId] = 0;
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
		if (this.slotDirect[idx] === 0) this.slotCount[cell] += 1;
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
		if (this.slotCount[cell] === 0) return;
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
			this.slotCount[cell] -= 1;
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
	 * Queue a component for the next island check. A component is in the
	 * queue at most once per generation: a re-add while queued is a no-op,
	 * and delete + re-add reactivates the component's reserved position.
	 * @param {Number} comp
	 */
	islandAdd(comp) {
		if (this.islandState[comp] === 1) return;
		if (this.islandState[comp] === 0) {
			if (this.islandQLen >= this.islandQ.length) {
				const cap = this.islandQ.length * 2;
				this.islandQ = growInt32(this.islandQ, cap);
			}
			this.islandQ[this.islandQLen] = comp;
			this.islandQLen += 1;
		}
		this.islandState[comp] = 1;
	}

	/**
	 * Unqueue a component: its islandQ position goes stale but stays
	 * reserved for a possible re-add before the next flush
	 * @param {Number} comp
	 */
	islandDelete(comp) {
		if (this.islandState[comp] === 1) this.islandState[comp] = 2;
	}

	/** Empty the island queue and release all reserved positions */
	islandClear() {
		for (let i = 0; i < this.islandQLen; i++) {
			this.islandState[this.islandQ[i]] = 0;
		}
		this.islandQLen = 0;
	}
}
