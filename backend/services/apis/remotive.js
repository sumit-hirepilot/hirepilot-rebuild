const axios = require('axios');

const BASE_URL = 'https://api.remotive.com/v2';

const fetchJobs = async () => {
  try {
    const jobs = [];
    let offset = 0;
    const limit = 100;

    // Remotive API is paginated
    for (let page = 0; page < 5; page++) {
      const response = await axios.get(`${BASE_URL}/jobs/`, {
        params: {
          offset,
          limit,
        },
        timeout: 10000,
      });

      if (!response.data || !Array.isArray(response.data.jobs)) {
        break;
      }

      const pageJobs = response.data.jobs.map((job) => ({
        external_id: job.id,
        id: job.id,
        title: job.title,
        company: job.company_name,
        company_name: job.company_name,
        company_url: job.company_url,
        url: job.url,
        job_url: job.url,
        description: job.description,
        location: job.location || 'Remote',
        country: 'Remote',
        job_type: job.job_type,
        work_arrangement: job.candidate_required_location === 'Remote' ? 'remote' : 'hybrid',
        posted_at: new Date(job.published_at),
      }));

      jobs.push(...pageJobs);
      offset += limit;

      // Stop if we got fewer jobs than limit
      if (pageJobs.length < limit) {
        break;
      }
    }

    return jobs;
  } catch (err) {
    console.error('Remotive API error:', err.message);
    throw err;
  }
};

module.exports = {
  fetchJobs,
};
