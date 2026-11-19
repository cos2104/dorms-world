import { defineConfig } from 'vitest/config';

// 시험은 tests/ 아래 것만 돈다. 팩 폴더(packs/)는 남이 보낸 자료라 그 안의 어떤 파일도 실행하지 않는다.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], exclude: ['packs/**', 'node_modules/**', 'dist/**', 'design-lab/**'] },
});
