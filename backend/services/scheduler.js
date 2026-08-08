const cron = require('node-cron');
const { aggregateJobs } = require('./jobAggregator');
const { runAllActiveAgents } = require('./agentRunner');
const { runAutoApplyForAllUsers } = require('./autoApplyEngine');
const { scoreJobsForUser } = require('./matchingEngine');
const { rescore, rescoreStatus } = require('./rescoreIndex');
const { query } = require('../db');
const { mem } = require('./memlog');

let aggregationTask;

/*
 * L2 — the D49a re-score had NO driver. The route comment said "the caller
 * repeats until complete" and no caller was ever built, so 1,044 old-formula
 * rows sat un-rescored for a day while the banner told every user their
 * scores "will update shortly", indefinitely. The D32 class one layer up: a
 * resumable pass nothing resumes.
 *
 * Bounded per pass (the rescore itself caps rows) and capped in passes, so a
 * pathological pass that never completes cannot hold the cycle hostage.
 */
const driveRescoreToCompletion = async (rescoreOnce, { maxPasses = 50 } = {}) => {
  let out = { complete: false };
  for (let i = 0; i < maxPasses; i += 1) {
    out = await rescoreOnce();
    if (out.complete) return out;
  }
  return out;
};

const runRescorePass = async (label) => {
  try {
    const before = await rescoreStatus(query);
    if (!before.remaining) return;
    console.log(`${label} - re-score: ${before.remaining} rows still on the old formula, driving to completion`);
    const out = await driveRescoreToCompletion(
      () => rescore(query, scoreJobsForUser, { maxRows: 2000 })
    );
    console.log(`${label} - re-score ${out.complete ? 'complete' : 'capped, resumes next cycle'}`);
  } catch (err) {
    console.error(`${label} - re-score error:`, err.message);
  }
};

const runCycle = async (label) => {
  console.log(`${label} started at`, new Date().toISOString());
  mem(`${label}:cycle start`);
  try {
    await aggregateJobs();
  } catch (err) {
    console.error(`${label} - aggregation error:`, err);
  }

  mem(`${label}:after aggregation`);
  try {
    const result = await runAllActiveAgents();
    console.log(`${label} - ran ${result.agentsRun} search agents, ${result.totalNewMatches} new matches`);
  } catch (err) {
    console.error(`${label} - search agent run error:`, err);
  }

  mem(`${label}:after agents`);
  await runRescorePass(label);

  try {
    const result = await runAutoApplyForAllUsers();
    console.log(`${label} - auto-apply: ${result.usersProcessed} users, ${result.totalApplied} applications sent, ${result.totalPendingReview} pending review, ${result.totalFlagged} flagged for dream companies`);
  } catch (err) {
    console.error(`${label} - auto-apply error:`, err);
  }
  mem(`${label}:cycle end`);
};

const startScheduler = () => {
  console.log('Starting job aggregation scheduler...');

  // Run aggregation + search agents every 6 hours (0 */6 * * *)
  aggregationTask = cron.schedule('0 */6 * * *', () => runCycle('Scheduled cycle'));

  // Also run once on startup after a delay
  setTimeout(() => runCycle('Initial cycle'), 5000);
};

const stopScheduler = () => {
  if (aggregationTask) {
    aggregationTask.stop();
    console.log('Job aggregation scheduler stopped');
  }
};

module.exports = {
  startScheduler,
  stopScheduler,
  driveRescoreToCompletion,
};
