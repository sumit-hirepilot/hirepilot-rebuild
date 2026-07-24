const axios = require('axios');

const BASE_URL = 'https://weworkremotely.com/api/v3';

const fetchJobs = async () => {
  try {
    const response = await axios.get(`${BASE_URL}/remote_jobs`, {
      timeout: 10000,
    });

    if (!response.data || !Array.isArray(response.data.remote_jobs)) {
      console.warn('We Work Remotely: Unexpected response format');
      return [];
    }

    return response.data.remote_jobs.map((job) => ({
      external_id: job.id,
      id: job.id,
      title: job.title,
      company: job.company_name,
      company_name: job.company_name,
      company_url: job.company_url,
      url: job.url,
      job_url: job.url,
      description: job.description,
      location: job.location,
      country: job.country,
      posted_at: new Date(job.published_on),
    }));
  } catch (err) {
    console.error('We Work Remotely API error:', err.message);
    throw err;
  }
};

module.exports = {
  fetchJobs,
};
