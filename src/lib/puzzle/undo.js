/**
 * @typedef RotateAction
 * @property {'rotate'} kind
 * @property {Number} index
 * @property {Number} old
 * @property {Number} new
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
 * @property {boolean} old
 * @property {boolean} new
 */

/**
 * @typedef {(RotateAction|LockAction|EdgemarkAction)} Action
 */

export class UndoStack {
	constructor() {
		/** @type {Action[][]} */
		this.actions = [];
		this.index = -1;
	}

	/**
	 * Remember an action
	 * @param {Action} action
	 * @param {boolean} [new_batch = true]
	 */
	add_action(action, new_batch = true) {
		if (new_batch) {
			if (this.index < this.actions.length - 1) {
				this.actions.splice(this.index + 1, this.actions.length);
			}
			this.actions.push([]);
			this.index += 1;
		}
		const batch = this.actions[this.index];
		batch.push(action);
	}

	/**
	 * Undo returns a list of actions to reverse
	 * @returns {Action[]}
	 */
	undo() {
		if (this.index >= 0) {
			const batch = this.actions[this.index];
			this.index -= 1;
			return batch;
		} else {
			return [];
		}
	}

	/**
	 * Redo returns a list of actions to repeat
	 * @returns {Action[]}
	 */
	redo() {
		if (this.index + 1 < this.actions.length) {
			this.index += 1;
			const batch = this.actions[this.index];
			return batch;
		} else {
			return [];
		}
	}
}
