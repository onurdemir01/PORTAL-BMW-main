import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: { ...globals.browser },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // React-hooks v7 yeni kurallar — mevcut kodda yaygın, warn olarak bırakılır.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      // Pre-existing patterns — not actionable in this PR.
      'no-useless-escape': 'off',
      'no-regex-spaces': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      'no-irregular-whitespace': 'warn',
    },
  },
  {
    files: ['server/**/*.cjs', 'src/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': 'warn',
      'preserve-caught-error': 'off',
      'no-useless-escape': 'off',
      'no-useless-assignment': 'off',
      'no-regex-spaces': 'off',
      'no-irregular-whitespace': 'warn',
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.claude/worktrees/**',
      'server/ansible/scalex_file/scalex_app/files/**',
    ],
  },
  eslintConfigPrettier,
];
