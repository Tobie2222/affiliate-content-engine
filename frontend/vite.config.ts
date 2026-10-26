import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Backend mặc định chạy ở cổng 3001. Đổi bằng biến môi trường VITE_API_TARGET nếu cần.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Cùng một origin với trang web nên không vướng CORS; cũng proxy được luồng SSE và Swagger (/api/docs).
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
