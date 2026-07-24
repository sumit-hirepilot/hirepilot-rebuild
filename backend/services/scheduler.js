const cron = require('node-cron');
const { aggregateJobs } = require('./jobAggregator');
const { runAllActiveAgents } = require('./agentRunner');
const { runAutoApplyForAllUsers } = require('./autoApplyEngine');

let aggregationTask;

const runCycle = async (label) => {
  console.log(`${label} started at`, new Date().toISOString());
  try {
    await aggregateJobs();
  } catch (err) {
    console.error(`${label} - aggregation error:`, err);
  }

  try {
    const result = await runAllActiveAgents();
    console.log(`${label} - ran ${result.agentsRun} search agents, ${result.totalNewMatches} new matches`);
  } catch (err) {
    console.error(`${label} - search agent run error:`, err);
  }

  try {
    const result = await runAutoApplyForAllUsers();
    console.log(`${label} - auto-apply: ${result.usersProcessed} users, ${result.totalApplied} applications sent, ${result.totalFlagged} flagged for review`);
  } catch (err) {
    console.error(`${label} - auto-apply error:`, err);
  }
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
};
