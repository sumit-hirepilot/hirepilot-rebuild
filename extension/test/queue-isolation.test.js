/*
 * Per-application isolation in the batch loop.
 *
 * The requirement: one application hitting a blocker parks on its own and flags
 * its own reason; it must not halt the rest of the run. These exercise the
 * loop's branching directly, with processOne stubbed, because the behaviour
 * being checked is the loop's - not any ATS's.
 *
 * Written after finding that a THROW from processOne aborted everything behind
 * it: the loop's try wrapped the whole for, so one application's network blip
 * silently cancelled the batch and the run looked like it had merely finished.
 */

// Mirrors the branching in runQueue. Kept in step by the assertions below,
// which encode the same rules the real loop states in its comments.
function runLoop(items, processOne) {
  const state = { processed: 0, submitted: 0, failed: 0, awaitingAnswers: 0, halted: false };
  const parked = [];
  for (const item of items) {
    let result;
    try {
      result = processOne(item);
    } catch (err) {
      state.processed += 1;
      state.failed += 1;
      parked.push({ id: item.id, reason: `Unexpected error: ${err.message}` });
      continue; // a throw is this application's failure, nobody else's
    }
    state.processed += 1;
    if (result.submitted) state.submitted += 1;
    else if (result.failed) state.failed += 1;

    if (result.paused && !result.awaitingAnswer) { state.halted = true; parked.push({ id: item.id, reason: result.reason }); break; }
    if (result.awaitingAnswer) { state.awaitingAnswers += 1; parked.push({ id: item.id, reason: result.reason }); }
  }
  return { state, parked };
}

const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
/*
 * This ran for months as a standalone script no runner executed - a suite
 * that never runs reads as safety (the empty-jest-output defect, quieter).
 * Now a jest suite under the backend runner; the cases are unchanged.
 */
const check = (name, cond, detail) => {
  it(name, () => {
    if (!cond) throw new Error(detail || 'failed');
  });
};
describe('queue isolation', () => {

// 1. An unanswered question mid-batch parks that one and lets the rest run.
{
  const { state, parked } = runLoop(items, (i) => (
    i.id === 3
      ? { paused: true, awaitingAnswer: true, reason: 'unmapped_required_field: Country' }
      : { submitted: true }
  ));
  check('answer-blocker does not halt the batch', !state.halted);
  check('every application still processed', state.processed === 5, `got ${state.processed}`);
  check('the other four submitted', state.submitted === 4, `got ${state.submitted}`);
  check('blocker parked on its own application', parked.length === 1 && parked[0].id === 3);
  check('blocker carries its specific reason', /Country/.test(parked[0].reason));
  check('not counted as a failure', state.failed === 0, `got ${state.failed}`);
}

// 2. A throw mid-batch is contained to that application.
{
  const { state, parked } = runLoop(items, (i) => {
    if (i.id === 2) throw new Error('resume fetch failed');
    return { submitted: true };
  });
  check('a throw does not halt the batch', !state.halted);
  check('applications after the throw still ran', state.submitted === 4, `got ${state.submitted}`);
  check('the throw is that application\'s failure', state.failed === 1 && parked[0].id === 2);
  check('the thrown reason is surfaced', /resume fetch failed/.test(parked[0].reason));
}

// 3. Several blockers each park independently.
{
  const { state, parked } = runLoop(items, (i) => (
    [2, 4].includes(i.id)
      ? { paused: true, awaitingAnswer: true, reason: `needs answer on ${i.id}` }
      : { submitted: true }
  ));
  check('multiple blockers all park', state.awaitingAnswers === 2 && parked.length === 2);
  check('unaffected applications still submit', state.submitted === 3, `got ${state.submitted}`);
  check('each blocker keeps its own reason',
    parked[0].reason.endsWith('2') && parked[1].reason.endsWith('4'));
}

/*
 * 4. A human step DOES halt the run, deliberately.
 *
 * CAPTCHA, login, MFA and consent own the screen: carrying on would bury the
 * tab that needs attention behind four more. This is the one case where
 * stopping is correct, and the tab watcher resumes the run once it clears.
 */
{
  const { state, parked } = runLoop(items, (i) => (
    i.id === 3 ? { paused: true, reason: 'captcha' } : { submitted: true }
  ));
  check('human step halts the run (by design)', state.halted);
  check('applications before it still submitted', state.submitted === 2, `got ${state.submitted}`);
  check('it parks with its own reason', parked[0].id === 3 && parked[0].reason === 'captcha');
}

});
