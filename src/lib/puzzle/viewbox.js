import { writable } from 'svelte/store';

/**
 * ViewBox represents the bounds of the visible game area
 * @typedef {Object} ViewBox
 * @property {Number} xmin
 * @property {Number} ymin
 * @property {Number} width
 * @property {Number} height
 */

/**
 * VisibleTile represents a tile within view
 * @typedef {Object} VisibleTile
 * @property {Number} index
 * @property {Number} x
 * @property {Number} y
 * @property {String} key
 */

export function createViewBox(grid) {
	const initial = {
		xmin: grid.XMIN,
		ymin: grid.YMIN,
		width: grid.XMAX - grid.XMIN,
		height: grid.YMAX - grid.YMIN
	};

	const { subscribe, set, update } = writable(initial);

	/**
	 * Make sure non-wrap view box doesn't go over puzzle bounds
	 * @param {ViewBox} box
	 * @returns {ViewBox}
	 */
	function fixBoxBounds(box) {
		if (grid.wrap) {
			return box;
		}
		let xmin = box.xmin;
		let ymin = box.ymin;
		let width = box.width;
		let height = box.height;
		const dw = box.width - (grid.XMAX - grid.XMIN);
		const dh = box.height - (grid.YMAX - grid.YMIN);
		if (dw > 0 && dh > 0) {
			// zoomed too far out, bring them back
			if (dw <= dh) {
				width = box.width - dw;
				height = box.height - (dw * box.height) / box.width;
			} else {
				height = box.height - dh;
				width = box.width - (dh * box.width) / box.height;
			}
			xmin = 0.5 * (grid.XMIN + grid.XMAX) - width / 2;
			ymin = 0.5 * (grid.YMIN + grid.YMAX) - height / 2;
		} else {
			if (dw < 0) {
				// zoomed in horizontally, don't allow bounds to leave [XMIN, XMAX]
				xmin = Math.max(grid.XMIN, xmin);
				xmin = Math.min(xmin, grid.XMAX - width);
			}
			if (dh < 0) {
				// zoomed in vertically, don't allow bounds to leave [YMIN, YMAX]
				ymin = Math.max(grid.YMIN, ymin);
				ymin = Math.min(ymin, grid.YMAX - height);
			}
		}
		return { xmin, ymin, width, height };
	}

	/** @type {NodeJS.Timer|null} */
	let visibleTilesTimeoutId = null;
	/** @type {ViewBox} */
	let lastBox;

	const visibleTiles = writable([]);

	subscribe((box) => {
		lastBox = box;
		if (visibleTilesTimeoutId === null) {
			visibleTilesTimeoutId = setTimeout(() => {
				visibleTilesTimeoutId = null;
				const visible = grid.getVisibleTiles(lastBox);
				console.log(visible.length);
				visibleTiles.set(visible);
			}, 100);
		}
	});

	/**
	 * Zoom in and out
	 * @param {Number} newWidth
	 * @param {Number} x
	 * @param {Number} y
	 */
	function zoom(newWidth, x, y) {
		update((box) => {
			// const delta = -box.width * magnitude * 0.07;
			const delta = box.width - newWidth;
			const xyScale = box.height / box.width;
			const relativeX = (x - box.xmin) / box.width;
			const relativeY = (y - box.ymin) / box.height;
			let xmin = box.xmin + relativeX * delta;
			let ymin = box.ymin + relativeY * delta * xyScale;
			let xmax = box.xmin + box.width - (1 - relativeX) * delta;
			let ymax = box.ymin + box.height - (1 - relativeY) * delta * xyScale;
			return fixBoxBounds({
				xmin,
				ymin,
				width: xmax - xmin,
				height: ymax - ymin
			});
		});
	}

	/**
	 * Move viewbox around
	 * @param {Number} dx
	 * @param {Number} dy
	 */
	function pan(dx, dy) {
		update((box) => {
			return fixBoxBounds({
				xmin: box.xmin - dx,
				ymin: box.ymin - dy,
				width: box.width,
				height: box.height
			});
		});
	}

	return {
		subscribe,
		set,
		pan,
		zoom,
		visibleTiles: { subscribe: visibleTiles.subscribe }
	};
}
