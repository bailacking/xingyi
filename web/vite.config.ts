import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const PORT = Number(process.env.XINGYI_PORT ?? 7388);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://127.0.0.1:${PORT}`, changeOrigin: true },
      '/ws': { target: `ws://127.0.0.1:${PORT}`, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
