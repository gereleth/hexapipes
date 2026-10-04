import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// adapter-vercel 4.x auto-detects only Node 18/20, so pin the runtime
		// explicitly to keep builds working on Vercel's Node 22/24 build images
		adapter: adapter({ runtime: 'nodejs24.x' })
	}
};

export default config;
