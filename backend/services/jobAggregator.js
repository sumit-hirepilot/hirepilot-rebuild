const { query } = require('../db');
const remoteOKClient = require('./apis/remoteok');
const motiveClient = require('./apis/remotive');

const normalizeJob = (job, source) => {
  const normalized = {
    source,
    external_id: job.external_id || job.id || job.jobId,
    title: job.title || job.jobTitle,
    company_name: job.company || job.companyName,
    company_url: job.company_url || job.companyUrl,
    job_url: job.url || job.job_url || job.jobUrl,
    description: job.description || job.jobDescription,
    requirements: job.requirements || '',
    salary_min: job.salary_min || job.salaryMin,
    salary_max: job.salary_max || job.salaryMax,
    currency: job.currency || 'USD',
    job_type: job.job_type || job.jobType || 'full-time',
    work_arrangement: job.work_arrangement || job.workArrangement || 'remote',
    location: job.location || job.city || '',
    country: job.country || '',
    posted_at: job.posted_at || job.postedAt || new Date(),
  };

  return normalized;
};

const storeJob = async (jobData) => {
  try {
    // Check if job already exists
    const existing = await query(
      'SELECT id, posted_at, fetched_at FROM jobs WHERE source = $1 AND external_id = $2',
      [jobData.source, jobData.external_id]
    );

    if (existing.rows.length > 0) {
      // Update only fetched_at, never reset posted_at (CRITICAL for staleness bug fix)
      const result = await query(
        'UPDATE jobs SET fetched_at = CURRENT_TIMESTAMP, is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id',
        [existing.rows[0].id]
      );
      return { id: existing.rows[0].id, isNew: false };
    }

    // Insert new job
    const result = await query(
      `INSERT INTO jobs (
        source, external_id, title, company_name, company_url, job_url,
        description, requirements, salary_min, salary_max, currency,
        job_type, work_arrangement, location, country, posted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (source, external_id) DO UPDATE
      SET fetched_at = CURRENT_TIMESTAMP, is_active = true, updated_at = CURRENT_TIMESTAMP
      RETURNING id`,
      [
        jobData.source, jobData.external_id, jobData.title, jobData.company_name,
        jobData.company_url, jobData.job_url, jobData.description, jobData.requirements,
        jobData.salary_min, jobData.salary_max, jobData.currency,
        jobData.job_type, jobData.work_arrangement, jobData.location, jobData.country,
        jobData.posted_at,
      ]
    );

    return { id: result.rows[0].id, isNew: true };
  } catch (err) {
    console.error('Error storing job:', err);
    throw err;
  }
};

const aggregateJobs = async () => {
  console.log('Starting job aggregation...');
  const results = {
    total: 0,
    new: 0,
    updated: 0,
    errors: [],
  };

  // Fetch from RemoteOK
  try {
    console.log('Fetching from RemoteOK...');
    const remoteOKJobs = await remoteOKClient.fetchJobs();
    for (const job of remoteOKJobs) {
      const normalized = normalizeJob(job, 'remoteok');
      const stored = await storeJob(normalized);
      results.total++;
      if (stored.isNew) results.new++;
      else results.updated++;
    }
    console.log(`RemoteOK: ${remoteOKJobs.length} jobs`);
  } catch (err) {
    console.error('RemoteOK error:', err);
    results.errors.push({ source: 'remoteok', error: err.message });
  }

  // Note: We Work Remotely is not fetched here - their API/RSS endpoints are
  // behind Cloudflare bot protection and cannot be scraped server-side.

  // Fetch from Remotive
  try {
    console.log('Fetching from Remotive...');
    const motiveJobs = await motiveClient.fetchJobs();
    for (const job of motiveJobs) {
      const normalized = normalizeJob(job, 'remotive');
      const stored = await storeJob(normalized);
      results.total++;
      if (stored.isNew) results.new++;
      else results.updated++;
    }
    console.log(`Remotive: ${motiveJobs.length} jobs`);
  } catch (err) {
    console.error('Remotive error:', err);
    results.errors.push({ source: 'remotive', error: err.message });
  }

  // Mark jobs as inactive if not updated in last 7 days
  try {
    await query(
      "UPDATE jobs SET is_active = false WHERE fetched_at < CURRENT_TIMESTAMP - INTERVAL '7 days'",
      []
    );
  } catch (err) {
    console.error('Error marking stale jobs as inactive:', err);
  }

  console.log('Aggregation complete:', results);
  return results;
};

module.exports = {
  aggregateJobs,
};
