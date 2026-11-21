import { defineConfig } from 'vite';

// Dev server only. The playable build is index.html, produced by `npm run build`.
export default defineConfig({
  base: './',
  server: { host: true, open: '/dev.html' },
});
