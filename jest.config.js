/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  // Tests share one database; run files one after another.
  maxWorkers: 1,
};
