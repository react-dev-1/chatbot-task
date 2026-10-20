// ESLint loads this file directly, so it stays CommonJS JavaScript.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tseslint = require('typescript-eslint')

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'data/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.js'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      semi: ['error', 'never'],
      quotes: ['error', 'single', { avoidEscape: true }],
      indent: ['error', 2, { SwitchCase: 1 }]
    }
  }
]
