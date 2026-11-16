import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  cacheDir: '../node_modules/.vite',
  esbuild: { jsx: 'automatic' },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api-backend': {
        target: process.env.BACK_OFFICE_DEV_API_URL ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-backend/, ''),
      },
      '/api-ledger': {
        target: process.env.PLR_LEDGER_RPC_URL ?? 'http://127.0.0.1:8545',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-ledger/, ''),
      },
    },
  },
});
