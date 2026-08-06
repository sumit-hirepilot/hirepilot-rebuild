/*
 * GOAL 1j — a gate that fails randomly gates nothing.
 *
 * Two red runs this session could not be reproduced afterwards. Once the gate
 * started naming its failures, the culprit appeared immediately:
 *
 *   adminGrant.test.js :: refuses a normal signed-in user
 *   Error: thrown: "Exceeded timeout of 5000 ms for a test."
 *
 * It passes 3/3 in isolation and only times out under full-suite parallelism.
 * Jest's default 5s is a tight budget for a supertest round trip through
 * express when several workers are competing for CPU - and CI machines are
 * smaller and busier than this one. That is a flaky harness, not a slow
 * product: nothing in the request touches a real network or database, both
 * being mocked.
 *
 * Raised for every suite rather than for the one test that happened to lose
 * the race, because any of the ~40 supertest tests could have been the one.
 */
module.exports = {
  testEnvironment: 'node',
  testTimeout: 20000,
};
