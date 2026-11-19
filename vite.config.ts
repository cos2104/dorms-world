import { defineConfig } from 'vite';

// 도름스(dorms.school/world) 아래에서 열리므로 모든 주소의 밑동을 /world/ 로 둔다.
export default defineConfig({
  base: '/world/',
  build: { outDir: 'dist/world', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000 },
  server: { port: 5310 },
});
