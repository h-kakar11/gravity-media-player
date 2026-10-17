import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

// The production CSP is injected at build time only: the dev server needs inline scripts for HMR.
const csp: Plugin = {
  name: 'gravity-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' gravity: data: blob:",
          "media-src 'self' gravity: blob:",
          "font-src 'self' data:",
          "connect-src 'self' gravity:",
          "frame-src 'self' gravity:",
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'"
        ].join('; ')
      },
      injectTo: 'head-prepend'
    }
  ]
};

export default defineConfig({
  root: 'src/renderer',
  base: '/',
  plugins: [react(), csp],
  resolve: { alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
  build: { outDir: '../../dist/renderer', emptyOutDir: true, target: 'chrome140', sourcemap: true, chunkSizeWarningLimit: 1200 },
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  clearScreen: false
});
