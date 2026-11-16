// ESLint flat config (ESLint 9). `npm run lint`. Browser-context code passed to page.evaluate is linted with browser globals.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'audit-output/', 'coverage/', 'docs/sample-report/', 'test/fixtures/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
      'no-cond-assign': ['error', 'except-parens'],
      'prefer-const': ['warn', { destructuring: 'all' }],
      eqeqeq: ['error', 'smart'],
    },
  },
];
