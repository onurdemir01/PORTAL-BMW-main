import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['src/**/__tests__/**/*.test.js', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      // Yalniz lcov.info (HTML rapor YOK): kurumsal tarayici calisma alaninin tamamini kaynak
      // sayar; HTML raporun JS/CSS dosyalari kaynak kod gibi taranirdi (ADR 0004).
      reporter: ['lcovonly', 'text-summary'],
      reportsDirectory: './coverage/vitest',
      include: ['src/**/*.{ts,tsx}', 'shared/**/*.cjs'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/test/**',
        'src/**/*.d.ts',
      ],
    },
  },
});
