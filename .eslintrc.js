module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    node: true,
    es2020: true,
  },
  rules: {
    // Enforce no console - use @satvaaah/logger instead
    'no-console': 'warn',
    // Allow 'any' in specific cases (Prisma raw queries, JWT payloads)
    '@typescript-eslint/no-explicit-any': 'warn',
    // Never allow unused variables
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // Require async functions to either await or return promise
    '@typescript-eslint/no-floating-promises': 'error',
    // Enforce PAISE rule - no floating point for monetary values
    // (Enforced by code review, not lint)
    // No require() - use import (except dynamic require in config package)
    '@typescript-eslint/no-var-requires': 'warn',
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    '*.js',
    'apps/mobile/',
  ],
};
