import { settings } from '$lib/stores';

/**
 * Attaches mouse controls to the game area
 * @param {HTMLElement} node
 * @param {import('$lib/puzzle/game').PipesGame} game
 * @returns
 */
export function mouseControls(node, game) {
	const grid = game.grid;

	/**
	 * @type {import('./hexagrid').ViewBox}
	 */
	let viewBox;

	const unsubscribeViewBox = grid.viewBox.subscribe((box) => {
		viewBox = box;
	});

    /**
     * @type {import('$lib/stores').Settings}
     */
	let currentSettings;
	const unsubscribeSettings = settings.subscribe((s) => {
		currentSettings = s;
	});

	/**
	 * @type {'idle'|'mousedown'|'panning'|'locking'|'unlocking'}
	 */
	let state = 'idle';

	let mouseDownOrigin = {
		x: 0,
		y: 0,
		button: 0,
		tileIndex: 0
	};

	/**
	 * Compute X and Y coordinates of the event in game grid units
	 * @param {MouseEvent} event
	 * @returns {Number[]}
	 */
	function getEventCoordinates(event) {
		const { x, y, width, height } = node.getBoundingClientRect();
		const relativeX = (event.clientX - x) / width;
		const relativeY = (event.clientY - y) / height;
		const gameX = viewBox.xmin + relativeX * viewBox.width;
		const gameY = viewBox.ymin + relativeY * viewBox.height;
		return [gameX, gameY];
	}

	/**
	 *
	 * @param {MouseEvent} event
	 */
	function handleMouseDown(event) {
		const target = event.target;

		const [x, y] = getEventCoordinates(event);

		mouseDownOrigin = {
			x,
			y,
			button: event.button,
			tileIndex: -1
		};

		const maybeTile = event.target.closest('g.tile');
		if (maybeTile) {
			mouseDownOrigin.tileIndex = Number(maybeTile.getAttribute('data-index'));
		}

		state = 'mousedown';
	}

	/**
	 *
	 * @param {MouseEvent} event
	 */
	function handleMouseMove(event) {
		if (state === 'idle') {
			return;
		}
		event.preventDefault();
		const [x, y] = getEventCoordinates(event);
		const dx = x - mouseDownOrigin.x;
		const dy = y - mouseDownOrigin.y;
		const distance = Math.sqrt(dx * dx + dy * dy);
		if (state === 'mousedown') {
			if (distance >= 1) {
				state = 'panning';
			}
		}
		if (state === 'panning') {
			grid.pan(dx, dy);
		}
	}

	/**
	 *
	 * @param {MouseEvent} event
	 */
	function handleMouseUp(event) {
		if (state === 'idle') {
			return;
		}
		event.preventDefault();
		const [x, y] = getEventCoordinates(event);
		if (state === 'mousedown' && mouseDownOrigin.tileIndex !== -1) {
			// we have not moved far from the starting point
			// process this as a click
			// rotate or lock tile or draw an edge mark
            const tileIndex = mouseDownOrigin.tileIndex
            const tileState = game.tileStates[tileIndex]
            const leftButton = mouseDownOrigin.button === 0
            const rightButton = mouseDownOrigin.button === 2
			if (currentSettings.controlMode === 'rotate_lock') {
                let rotationTimes = currentSettings.invertRotationDirection ? -1 : 1;
				if (leftButton&&(!event.ctrlKey)) {
					game.rotateTile(tileIndex, rotationTimes);
                } else if (leftButton&&(event.ctrlKey)) {
                    game.rotateTile(tileIndex, -rotationTimes);
				} else if (rightButton) {
					tileState.toggleLocked();
				}
			} else if (currentSettings.controlMode === 'rotate_rotate') {
                let rotationTimes = currentSettings.invertRotationDirection ? -1 : 1;
				if (leftButton&&(event.ctrlKey)) {
					tileState.toggleLocked();
				} else if (leftButton&&(!event.ctrlKey)) {
					game.rotateTile(tileIndex, rotationTimes);
				} else if (rightButton) {
                    game.rotateTile(tileIndex, -rotationTimes);
                }
			} else if (currentSettings.controlMode === 'orient_lock') {
                if (leftButton) {
                    const [cx, cy] = grid.index_to_xy(mouseDownOrigin.tileIndex)
                    const newAngle = Math.atan2(cy-y, x-cx)
                    const oldAngle = grid.getTileAngle(tileState.data.tile)
                    const newRotations = Math.round((oldAngle - newAngle)*3/Math.PI)
                    let timesRotate = newRotations - (tileState.data.rotations%6)
                    if (timesRotate < -3.5) {timesRotate += 6}
                    else if (timesRotate > 3.5) {timesRotate -=6}
                    game.rotateTile(tileIndex, timesRotate)
                } else if (rightButton) {
                    tileState.toggleLocked()
                }
            }
		}
		state = 'idle';
	}

	/**
	 * Zoom in or out
	 * @param {WheelEvent} event
	 */
	function handleWheel(event) {
		event.preventDefault();
		const [x, y] = getEventCoordinates(event);
		grid.zoom(event.deltaY, x, y);
	}

	node.addEventListener('mousedown', handleMouseDown);
	node.addEventListener('mousemove', handleMouseMove);
	// node.addEventListener('mouseleave', handleMouseleave);
	node.addEventListener('mouseup', handleMouseUp);
	node.addEventListener('wheel', handleWheel);

	return {
		destroy() {
			node.removeEventListener('mousedown', handleMouseDown);
			node.removeEventListener('mousemove', handleMouseMove);
			node.removeEventListener('mouseup', handleMouseUp);
			node.removeEventListener('wheel', handleWheel);
			unsubscribeViewBox();
			unsubscribeSettings();
		}
	};
}
