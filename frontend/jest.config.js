/*
 * next/jest wires up the SWC transform, CSS-module stubbing and path aliases
 * the same way the dev server does, so a test renders the component the build
 * actually produces rather than a hand-rolled approximation of it.
 */
const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

module.exports = createJestConfig({
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  /*
   * GOAL 1j — a gate that fails randomly gates nothing.
   *
   * This suite went red once with two failures and could not be reproduced
   * across ten subsequent runs, leaving no record of which tests they were.
   * Its tests use waitFor, whose default budget is 1s, and userEvent, which
   * advances real time - both lose races under parallel workers on a busy
   * machine, and CI machines are smaller and busier than this one.
   *
   * Raised globally rather than per test: the two that failed were never
   * identified, so any of them could be next.
   */
  testTimeout: 20000,
});
