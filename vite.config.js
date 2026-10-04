// vite.config.js
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

/** @type {import('vitest/config').ViteUserConfig} */
const config = defineConfig({
	plugins: [sveltekit({ adapter: adapter() })],
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
