import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'dist-test/**', 'android/**', 'ios/**', 'node_modules/**', 'resources/**'],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // __BUILD__ is substituted by Vite at build time (see vite.config.js).
      globals: { ...globals.browser, ...globals.es2021, __BUILD__: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },
  {
    // The engine is one large module mid-extraction: it leans on hoisting and
    // on a shared closure, and it is the one place `window.__*` hooks are set.
    files: ['src/game/engine.js'],
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'off',
      eqeqeq: 'off',
      'prefer-const': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'vite.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    // The headless harness is CommonJS and runs in Node (see test/package.json).
    files: ['test/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: { 'no-console': 'off' },
  },
];
