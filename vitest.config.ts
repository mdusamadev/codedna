import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/ui/dashboard/**', 'src/extension.ts'],
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'test/fixtures/vscode-mock.ts'),
    },
  },
});
