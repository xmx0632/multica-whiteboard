import { defineConfig } from 'vitest/config';

/**
 * 解析层（src/lib/math/*）单测配置：纯函数、无 DOM，node 环境即可
 * （技术方案 §10 PR1：vitest 仅 devDependency，不进入运行时依赖）。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
