/**
 * @typedef RotateAction
 * @property {'rotate'} kind
 * @property {Number} index
 * @property {Number} old
 * @property {Number} new
 * @property {Map<Number,String>} oldColors
 * @property {Map<Number,String>} newColors
 */

/**
 * @typedef LockAction
 * @property {'lock'} kind
 * @property {Number} index
 * @property {boolean} old
 * @property {boolean} new
 */

/**
 * @typedef EdgemarkAction
 * @property {'mark'} kind
 * @property {Number} index
 * @property {Number} direction
 * @property {String} old
 * @property {String} new
 */

/**
 * @typedef {(RotateAction|LockAction|EdgemarkAction)} Action
 */

/**
 * @typedef UndoStackData
 * @property {Action[][]} actions
 * @property {Number} index
 * @property {Number[]} checkpoints
 */

import { writable } from 'svelte/store';

export const createUndoStore = function () {
	/** @type {UndoStackData} */
	const data = {
		actions: [],
		index: -1,
		checkpoints: []
	};
	const { set, subscribe, update } = writable(data);

	/**
	 * Remember a batch of actions
	 * @param {Action[]} actions
	 */
	function add_actions(...actions) {
		update((data) => {
			if (data.index < data.actions.length - 1) {
				data.actions.splice(data.index + 1, data.actions.length);
			}
			data.actions.push(actions);
			data.index += 1;
			return data;
		});
	}

	/**
	 * Undo returns a list of actions to reverse
	 * @returns {Action[]}
	 */
	function undo() {
		/** @type {Action[]} */
		let batch = [];
		update((data) => {
			if (data.index >= 0) {
				batch = data.actions[data.index];
				data.index -= 1;
			}
			return data;
		});
		return batch;
	}

	/**
	 * Redo returns a list of actions to repeat
	 * @returns {Action[]}
	 */
	function redo() {
		/** @type {Action[]} */
		let batch = [];
		update((data) => {
			if (data.index + 1 < data.actions.length) {
				data.index += 1;
				batch = data.actions[data.index];
			}
			return data;
		});
		return batch;
	}

	function reset() {
		set(data);
	}

	/**
	 * Create a checkpoint at current undostack index
	 */
	function add_checkpoint() {
		update((data) => {
			data.checkpoints.push(data.index);
			return data;
		});
	}

	/**
	 * Remove a checkpoint at index
	 * @param {number} index
	 */
	function remove_checkpoint(index) {
		update((data) => {
			data.checkpoints = data.checkpoints.filter((x) => x !== index);
			return data;
		});
	}

	return {
		subscribe,
		add_actions,
		undo,
		redo,
		reset,
		add_checkpoint,
		remove_checkpoint
	};
};
