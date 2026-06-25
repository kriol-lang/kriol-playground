import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { crossOriginIsolationHeaders } from './cross-origin-isolation.js';

const headers = crossOriginIsolationHeaders(process.env);

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    headers
  },
  preview: {
    headers
  }
});
