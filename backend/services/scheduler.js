const cron = require('node-cron');
const { aggregateJobs } = require('./jobAggregator');

let aggregationTask;

const startScheduler = () => {
  console.log('Starting job aggregation scheduler...');

  // Run aggregation every 6 hours (0 */6 * * *)
  aggregationTask = cron.schedule('0 */6 * * *', async () => {
    console.log('Scheduled job aggregation started at', new Date().toISOString());
    try {
      await aggregateJobs();
    } catch (err) {
      console.error('Scheduled aggregation error:', err);
    }
  });

  // Also run once on startup after a delay
  setTimeout(async () => {
    console.log('Initial job aggregation...');
    try {
      await aggregateJobs();
    } catch (err) {
      console.error('Initial aggregation error:', err);
    }
  }, 5000);
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
