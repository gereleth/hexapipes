
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

	this.xmin = this.XMIN
	this.xmax = this.XMAX
	this.ymin = this.YMIN
	this.ymax = this.YMAX

	this.zoom = function(magnitude, relativeX, relativeY) {
		const delta = magnitude > 0 ? -0.1 : 0.1
		self.xmin = self.xmin + relativeX * delta
		self.ymin = self.ymin + relativeY*delta*self.YSTEP
		self.xmax = self.xmax - (1 - relativeX)*delta
		self.ymax = self.ymax - (1 - relativeY)*delta*self.YSTEP
		if (!self.wrap) {
			self.xmin = Math.max(self.XMIN, self.xmin)
			self.ymin = Math.max(self.YMIN, self.ymin)
			self.xmax = Math.min(self.XMAX, self.xmax)
			self.ymax = Math.min(self.YMAX, self.ymax)
		}
		return self
	}

	/**
	 * @param {Number} index
	 */
	this.index_to_xy = function (index) {
		let q = 2 * self.width;
		let a = index % q;
		let b = (index - a) / q;
		let x, y;
		if (a < self.width) {
			x = a;
			y = self.YSTEP * (1 + 2 * b);
		} else {
			x = a - self.width + 0.5;
			y = self.YSTEP * (2 + 2 * b);
		}
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
	 * 
	 * @param {Number} tile 
	 * @param {Number} rotations 
	 * @returns {Number[]}
	 */
	this.getDirections = function (tile, rotations=0) {
		const rotated = self.rotate(tile, rotations)
		return self.DIRECTIONS.filter((direction) => (direction & rotated) > 0);
	};

	this.getVisibleTiles = function() {
		// console.log(self.xmin, self.xmax, self.ymin, self.ymax)
		let rmin = Math.floor(self.ymin / self.YSTEP) - 1
		let rmax = Math.ceil(self.ymax / self.YSTEP)
		if (!self.wrap) {
			rmin = Math.max(0, rmin)
			rmax = Math.min(self.height-1, rmax)
		}
		let cmin = Math.floor(self.xmin - (rmin%2===0 ? 0 : 0.5) )
		let cmax = Math.ceil(self.xmax - (rmin%2===0 ? 0 : 0.5) )
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
