import { sveltekit } from '@sveltejs/kit/vite';
import { svelteInspector } from './custom-plugins/inspector/plugin';

/** @type {import('vite').UserConfig} */
const config = {
  plugins: [sveltekit(), svelteInspector()],
};

export default config;
