/*
 * next/jest wires up the SWC transform, CSS-module stubbing and path aliases
 * the same way the dev server does, so a test renders the component the build
 * actually produces rather than a hand-rolled approximation of it.
 */
const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

module.exports = createJestConfig({
  testEnvironment: 'jsdom',
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
});
