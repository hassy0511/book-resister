import { defineConfig } from 'vitest/config';

// Firestore セキュリティルールのテスト用（npm run test:rules でエミュレータを起動してから実行される）
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // 全ファイルが同じエミュレータ（同じプロジェクト）を使うため、ファイルを並列に実行しない
    fileParallelism: false,
  },
});
