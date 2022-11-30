import adapter from '@sveltejs/adapter-auto';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter()
	},
  vitePlugin: {
    experimental: {
      nvim_inspector: true,
    },
  },
};

export default config;
