
import { browser } from '$app/env';
import {writable, derived} from 'svelte/store'

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

/**
 * A hexagonal grid
 * @constructor
 * @param {Number} width
 * @param {Number} height
 * @param {Boolean} wrap
 */
export function HexaGrid(width, height, wrap=false) {
	let self = this;

	const EAST = 1;
	const NORTHEAST = 2;
	const NORTHWEST = 4;
	const WEST = 8;
	const SOUTHWEST = 16;
	const SOUTHEAST = 32;
	
	this.YSTEP = Math.sqrt(3) / 2;
	
	this.DIRECTIONS = [EAST, NORTHEAST, NORTHWEST, WEST, SOUTHWEST, SOUTHEAST];
	// Only use these directions for edge marks because they should be
	// rendered above tiles
	// Since the order of rendering is right to left, top to bottom
	// these directions are "looking back" 
	// and edge marks won't be overlapped by previous tiles
	this.EDGEMARK_DIRECTIONS = [NORTHEAST, NORTHWEST, WEST]

	this.OPPOSITE = new Map([
		[NORTHEAST, SOUTHWEST],
		[SOUTHWEST, NORTHEAST],
		[EAST, WEST],
		[WEST, EAST],
		[NORTHWEST, SOUTHEAST],
		[SOUTHEAST, NORTHWEST]
	]);
	
	this.XY_DELTAS = new Map([
		[EAST, [1, 0]],
		[WEST, [-1, 0]],
		[NORTHEAST, [0.5, this.YSTEP]],
		[NORTHWEST, [-0.5, this.YSTEP]],
		[SOUTHEAST, [0.5, -this.YSTEP]],
		[SOUTHWEST, [-0.5, -this.YSTEP]]
	]);
	

	this.width = width;
	this.height = height;
	this.total = width * height;
	this.wrap = wrap

	this.RC_DELTA = new Map([
		[
			EAST,
			[
				[0, 1],
				[0, 1]
			]
		],
		[
			NORTHEAST,
			[
				[-1, 0],
				[-1, 1]
			]
		],
		[
			NORTHWEST,
			[
				[-1, -1],
				[-1, 0]
			]
		],
		[
			WEST,
			[
				[0, -1],
				[0, -1]
			]
		],
		[
			SOUTHWEST,
			[
				[1, -1],
				[1, 0]
			]
		],
		[
			SOUTHEAST,
			[
				[1, 0],
				[1, 1]
			]
		]
	]);

	this.XMIN = -0.6 - (self.wrap ? 1 : 0)
	this.XMAX = self.width + 0.1 + (self.wrap ? 1 : 0)
	this.YMIN = - self.YSTEP*(1 + (self.wrap ? 1 : 0))
	this.YMAX = self.YSTEP*(self.height + (self.wrap ? 1 : 0))

	this.viewBox = writable({
		xmin: this.XMIN,
		ymin: this.YMIN,
		width: this.XMAX - this.XMIN,
		height: this.YMAX - this.YMIN,
	})

	/**
	 * Makes sure non-wrap view box doesn't go over puzzle bounds
	 * @param {ViewBox} box
	 * @returns {ViewBox}
	 */
	function fixBoxBounds(box) {
		if (self.wrap) {
			return box
		}
		let {xmin, ymin} = box
		let xmax = xmin + box.width
		let ymax = ymin + box.height
		if (xmin < self.XMIN) {
			xmax = xmax + (self.XMIN - xmin)
		}
		if (xmax > self.XMAX) {
			xmin = xmin - (xmax - self.XMAX)
		}
		if (ymin < self.YMIN) {
			ymax = ymax + (self.YMIN - ymin)
		}
		if (ymax > self.YMAX) {
			ymin = ymin - (ymax - self.YMAX)
		}
		xmin = Math.max(self.XMIN, xmin)
		ymin = Math.max(self.YMIN, ymin)
		xmax = Math.min(self.XMAX, xmax)
		ymax = Math.min(self.YMAX, ymax)
		return {
			xmin: xmin,
			ymin: ymin,
			width: xmax - xmin,
			height: ymax - ymin,
		}
	}

	/**
	 * 
	 * @param {Number} magnitude 
	 * @param {Number} x 
	 * @param {Number} y 
	 */
	this.zoom = function(magnitude, x, y) {
		// TODO increase delta if called often (?)
		self.viewBox.update(box => {
			const delta = - box.width * magnitude * 0.07
			const relativeX = (x - box.xmin) / box.width
			const relativeY = (y - box.ymin) / box.height
			let xmin = box.xmin + relativeX * delta
			let ymin = box.ymin + relativeY * delta * self.YSTEP
			let xmax = box.xmin + box.width - (1 - relativeX) * delta
			let ymax = box.ymin + box.height - (1 - relativeY) * delta * self.YSTEP
			return fixBoxBounds({
				xmin: xmin,
				ymin: ymin,
				width: xmax - xmin,
				height: ymax - ymin,
			})
		})
	}

	/**
	 * Move viewbox around
	 * @param {Number} dx 
	 * @param {Number} dy 
	 */
	this.pan = function(dx, dy) {
		self.viewBox.update(box => {
			const newBox = fixBoxBounds({
				xmin: box.xmin - dx,
				ymin: box.ymin - dy,
				width: box.width,
				height: box.height,
			})
			return newBox
		})
	}

	/**
	 * @param {Number} index
	 */
	this.index_to_xy = function (index) {
		const c = index % self.width
		const r = Math.round((index - c) / self.width)
		const x = c + (r%2===0 ? 0.0 : 0.5)
		const y = r*self.YSTEP
		return [x, y];
	};
	/**
	 * @param {Number} index
	 * @param {Number} direction
	 */
	this.find_neighbour = function (index, direction) {
		let c = index % self.width;
		let r = (index - c) / self.width;
		let wrapped = false
		let neighbour = -1

		const [dr, dc] = self.RC_DELTA.get(direction)[r % 2];
		r += dr;
		c += dc;
		if (self.wrap) {
			if (r == -1) {
				r = self.height - 1
				c += 1
				wrapped = true
			}
			if (r == self.height) {
				r = 0
				c -= (1 - self.height % 2)
				wrapped = true
			}
			if ((c < 0)||(c=== self.width)) {
				c = (c + self.width) % self.width
				wrapped = true
			}
		}
		if (r < 0 || r >= self.height) {
			neighbour = -1;
		}
		else if (c < 0 || c >= self.width) {
			neighbour = -1;
		} else {
			neighbour = self.width * r + c
		}
		return {
			neighbour,
			wrapped,
		};
	};

	/**
	 * Compute tile orientation after a number of rotations
	 * @param {Number} tile 
	 * @param {Number} rotations 
	 * @returns 
	 */
	this.rotate = function(tile, rotations) {
		let rotated = tile
		rotations = rotations % 6
		while (rotations > 0) {
			rotations -= 6
		}
		while (rotations < 0) {
			rotated = (rotated*2) % 64 + Math.floor(rotated/32)
			rotations += 1
		}
		return rotated
	}

	/**
	 * Computes angle for drawing the tile guiding dot
	 * @param {Number} tile 
	 * @returns {Number}
	 */
	this.getTileAngle = function(tile) {
		const tileDirections = self.getDirections(tile)
    	const deltas = tileDirections.map(direction => self.XY_DELTAS.get(direction))

        let dx = 0, dy=0
        for (let [deltax, deltay] of deltas) {
            dx += deltax
            dy += deltay
        }
        dx /= tileDirections.length
        dy /= tileDirections.length
        if ((Math.abs(dx) < 0.001)&&(Math.abs(dy) < 0.001)) {
            dx = deltas[0][0]
            dy = deltas[0][1]
        }
        return Math.atan2(dy, dx)
	}

	/**
	 * 
	 * @param {Number} tile 
	 * @param {Number} rotations 
	 * @returns {Number[]}
	 */
	this.getDirections = function (tile, rotations=0) {
		const rotated = self.rotate(tile, rotations)
		return self.DIRECTIONS.filter((direction) => (direction & rotated) > 0);
	};

	/**
	 * @param {ViewBox} box 
	 * @returns {VisibleTile[]}
	 */
	const getVisibleTiles = function(box) {
		let rmin = Math.floor(box.ymin / self.YSTEP) - 1
		let rmax = Math.ceil((box.ymin + box.height) / self.YSTEP)
		if (!self.wrap) {
			rmin = Math.max(0, rmin)
			rmax = Math.min(self.height-1, rmax)
		}
		let cmin = Math.floor(box.xmin - (rmin%2===0 ? 0 : 0.5) )
		let cmax = Math.ceil(box.xmin + box.width - (rmin%2===0 ? 0 : 0.5) )
		if (!self.wrap) {
			cmin = Math.max(0, cmin)
			cmax = Math.min(self.width-1, cmax)
		}
		const visibleTiles = []
		for (let r=rmin; r<=rmax; r++) {
			for (let c=cmin; c<=cmax; c++) {
				const x = c + (r%2===0 ? 0.0 : 0.5)
				const y = r*self.YSTEP
				const key = `${Math.round(10*x)}_${Math.round(10*y)}`
				visibleTiles.push({
					index: self.rc_to_index(r, c),
					x,
					y,
					key,
				})
			}
		}
		return visibleTiles
	}

	// TODO debounce this
	this.visibleTiles = derived(this.viewBox, getVisibleTiles)

	/**
	 * 
	 * @param {Number} r 
	 * @param {Number} c 
	 * @returns {Number}
	 */
	this.rc_to_index = function (r, c) {
		if (self.wrap) {
			while (r < 0) {
				const evenRow = (r%2 === 0)
				r += self.height
				if (self.height % 2 !== 0) {
					c += evenRow ? 0 : 1
				} else {
					c += 1
				}
			}
			while (r >= self.height) {
				const evenRow = (r%2 === 0)
				r -= self.height
				if (self.height % 2 !== 0) {
					c -= evenRow ? 1 : 0
				} else {
					c -= 1
				}
			}
			c = c % self.width
			if (c < 0) {
				c += self.width
			}
		}
		return self.width * r + c
	}

	this.tilePath = '';
	for (let p = 0; p < 6; p++) {
		const angle = (Math.PI * (2 * p + 1)) / 6;
		const dx = (0.49 * Math.cos(angle)) / self.YSTEP;
		const dy = (-0.49 * Math.sin(angle)) / self.YSTEP;
		if (this.tilePath === '') {
			this.tilePath += ` m ${dx - 0.49} ${dy + 0.98*self.YSTEP}`;
		}
		this.tilePath += ` l ${dx} ${dy}`;
	}
	this.tilePath += ' z';
	return this;
}
