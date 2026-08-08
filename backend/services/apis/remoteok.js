const httpSource = require('./httpSource');
const { fixMojibake } = require('./textSanitizer');

const BASE_URL = 'https://remoteok.com/api';

const fetchJobs = async () => {
  try {
    const response = await httpSource.get('remoteok', BASE_URL, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HirePilotBot/1.0; +https://hirepilot.app)',
        Accept: 'application/json',
      },
    });

    if (!Array.isArray(response.data)) {
      console.warn('RemoteOK: Unexpected response format');
      return [];
    }

    // RemoteOK returns jobs in array, skip first item (metadata)
    return response.data
      .slice(1)
      .filter((job) => job.id && job.position)
      .map((job) => ({
        external_id: job.id,
        id: job.id,
        title: fixMojibake(job.position),
        company: fixMojibake(job.company),
        company_url: job.company_logo || undefined,
        url: job.url || job.apply_url,
        job_url: job.url || job.apply_url,
        description: fixMojibake(job.description),
        location: fixMojibake(job.location) || 'Remote',
        country: fixMojibake(job.location) || 'Remote',
        salary_min: job.salary_min || null,
        salary_max: job.salary_max || null,
        posted_at: job.epoch ? new Date(job.epoch * 1000) : new Date(job.date),
      }));
  } catch (err) {
    console.error('RemoteOK API error:', err.message);
    throw err;
  }
};

module.exports = {
  fetchJobs,
};
