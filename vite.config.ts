import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { crossOriginIsolationHeaders } from './src/lib/server/crossOriginIsolation';

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
