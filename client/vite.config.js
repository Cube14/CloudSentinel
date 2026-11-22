import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), 'PORT');
  const port = process.env.PORT || env.PORT || 3000;
  return {
    plugins: [react()],
    build: { assetsInlineLimit: 0 },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: 'http://127.0.0.1:' + port, changeOrigin: true } }
    }
  };
});
