/*
 * jsdom does not implement TextEncoder/TextDecoder, but react-dom/server needs
 * them. Without this the hydration suite fails to RUN - which reports as
 * "Tests: 0 total", the silent-null-result failure mode, rather than as a red
 * assertion.
 */
const { TextEncoder, TextDecoder } = require('util');

if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;


/*
 * GOAL 1j — the flake, precisely.
 *
 * Raising Jest's testTimeout does NOT help findBy/waitFor: testing-library has
 * its own asyncUtilTimeout, and it defaults to 1 second. Under full-suite
 * parallelism on a busy machine, a component that fetches and then renders can
 * miss that budget - which is exactly how undatedReachable.test.js failed once
 * with "Unable to find role=button" and then passed four full runs in a row.
 *
 * The test was already written correctly, with findByRole rather than
 * getByRole. The budget was the problem, so the budget is raised for every
 * async query in the suite rather than for the one test that happened to lose
 * the race.
 */
const { configure } = require('@testing-library/dom');

configure({ asyncUtilTimeout: 10000 });
