import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';

// Kurumsal SonarQube profiliyle (kurumsal is #52) ayni kurallar, commit aninda. Kurum JS ve TS icin ayri profil
// kullaniyor; her listede yalniz kurumun #52 taramasinda o dilde bulgu verdigi kurallar var (yorumda Sonar
// anahtari). Kurum *.test.js / *.test.tsx'i kaynak saymaz; test yardimcilari (__tests__ altindaki .cjs)
// kaynak sayilir. Bastirma yok; --max-warnings 0.
const KURUM_JS = {
  'sonarjs/no-unenclosed-multiline-block': 'error', // S2681
  'sonarjs/no-same-line-conditional': 'error', // S3972
  'sonarjs/no-nested-conditional': 'off', // S3358 — PR-1 icinde duzeltilip acilir
  'sonarjs/no-nested-template-literals': 'off', // S4624 — PR-1 icinde duzeltilip acilir
  'sonarjs/duplicates-in-character-class': 'off', // S5869 — PR-1 icinde duzeltilip acilir
  'sonarjs/regex-complexity': ['off', { threshold: 20 }], // S5843 (kurum esigi 20) — PR-1 icinde duzeltilip acilir
  'sonarjs/no-invariant-returns': 'error', // S3516
  'sonarjs/no-unused-collection': 'error', // S4030
  'sonarjs/no-unused-vars': 'error', // S1481
  'prefer-object-has-own': 'error', // S6653
  'prefer-promise-reject-errors': 'error', // S6671
  'no-unneeded-ternary': 'error', // S6644
};
// Tip bilgisi isteyen JS kurallari (tsconfig.eslint.json ile).
const KURUM_JS_TIPLI = {
  '@typescript-eslint/prefer-optional-chain': 'error', // S6582
  '@typescript-eslint/prefer-for-of': 'error', // S4138
  'sonarjs/no-misleading-array-reverse': 'off', // S4043 — PR-1 icinde duzeltilip acilir
  'sonarjs/function-return-type': 'error', // S3800
  'sonarjs/argument-type': 'error', // S3782
};
const KURUM_TS = {
  'sonarjs/no-unenclosed-multiline-block': 'error', // S2681
  'sonarjs/no-misleading-array-reverse': 'error', // S4043
  'sonarjs/no-inverted-boolean-check': 'error', // S1940
  'sonarjs/no-alphabetical-sort': 'error', // S2871 (bug)
};

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
      // React Compiler (babel-plugin-react-compiler) bu projede kullanilmiyor;
      // @tanstack/react-virtual useVirtualizer bekci testleriyle zorunlu.
      'react-hooks/incompatible-library': 'off',
    },
  },
  {
    // Node testleri `*.test.js` (CommonJS; klasordeki package.json "type": "commonjs").
    files: [
      'server/**/*.cjs',
      'src/**/*.cjs',
      'shared/**/*.cjs',
      'scripts/**/*.cjs',
      'server/**/*.test.js',
      'src/**/__tests__/**/*.test.js',
    ],
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
    // Gelistirici betikleri (ES modulu): Node ortami.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'gelistirme/**', '.claude/worktrees/**'],
  },
  {
    files: ['{server,src,shared,scripts}/**/*.{cjs,mjs}'],
    plugins: { sonarjs },
    rules: KURUM_JS,
  },
  {
    files: ['{server,src,shared,scripts}/**/*.cjs'],
    languageOptions: {
      parser: tsParser,
      // CommonJS kapsami: TS ayristiricisi 'commonjs' sourceType'ini bilmez; globalReturn ayni kapsami kurar
      // (yoksa ust duzeydeki `const crypto = require(...)` yerlesik geneli yeniden tanimliyor sayilir).
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { globalReturn: true },
      },
    },
    plugins: { sonarjs, '@typescript-eslint': tsPlugin },
    rules: KURUM_JS_TIPLI,
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**'],
    plugins: { sonarjs },
    rules: KURUM_TS,
  },
  eslintConfigPrettier,
];
