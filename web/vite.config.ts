import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiProxy = {
  '/v1': {
    target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3000',
    changeOrigin: true,
  },
  '/health': {
    target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3000',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    port: 5173,
    proxy: apiProxy,
  },
});
