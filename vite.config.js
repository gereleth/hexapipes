// vite.config.js
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

/** @type {import('vitest/config').ViteUserConfig} */
const config = defineConfig({
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
});

export default config;
