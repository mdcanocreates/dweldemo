import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget =
    env.VITE_API_PROXY_TARGET ||
    'http://rbit-dev-821417220.us-east-2.elb.amazonaws.com';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/v1': { target: apiTarget, changeOrigin: true },
        '/health': { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
