const axios = require('axios');

const BASE_URL = 'https://remoteok.com/api';

const fetchJobs = async () => {
  try {
    const response = await axios.get(BASE_URL, {
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
        title: job.position,
        company: job.company,
        company_url: job.company_logo || undefined,
        url: job.url || job.apply_url,
        job_url: job.url || job.apply_url,
        description: job.description,
        location: job.location || 'Remote',
        country: job.location || 'Remote',
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
