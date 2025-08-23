// vite.config.js
import { sveltekit } from '@sveltejs/kit/vite';

/** @type {import('vite').UserConfig} */
const config = {
	plugins: [sveltekit()],
	test: {
		globals: true,
		environment: 'jsdom'
	}
	// resolve: process.env.VITEST
	// 	? {
	// 			conditions: ['browser']
	// 		}
	// 	: undefined
};

export default config;
