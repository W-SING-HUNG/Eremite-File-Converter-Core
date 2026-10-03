import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// DEV/QA ONLY harness frontend — deliberately NOT the Eremite design system.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5198,
    proxy: { '/api': { target: 'http://127.0.0.1:5199', changeOrigin: true } },
  },
  build: { outDir: 'dist' },
});
