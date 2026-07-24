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
    return response.data.slice(1).map((job) => ({
      external_id: job.id,
      id: job.id,
      title: job.title,
      company: job.company,
      company_url: job.company_url || job.url?.replace(/jobs.*/, ''),
      url: job.url,
      job_url: job.url,
      description: job.description,
      location: job.location,
      country: job.location,
      posted_at: new Date(job.date_posted * 1000), // Unix timestamp to Date
    }));
  } catch (err) {
    console.error('RemoteOK API error:', err.message);
    throw err;
  }
};

module.exports = {
  fetchJobs,
};
