const httpSource = require('./httpSource');

const BASE_URL = 'https://remotive.com/api/remote-jobs';

const fetchJobs = async () => {
  try {
    const response = await httpSource.get('remotive', BASE_URL, {
      params: { limit: 200 },
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HirePilotBot/1.0; +https://hirepilot.app)',
        Accept: 'application/json',
      },
    });

    if (!response.data || !Array.isArray(response.data.jobs)) {
      console.warn('Remotive: Unexpected response format');
      return [];
    }

    return response.data.jobs.map((job) => ({
      external_id: job.id,
      id: job.id,
      title: job.title,
      company: job.company_name,
      company_name: job.company_name,
      company_url: job.company_logo,
      url: job.url,
      job_url: job.url,
      description: job.description,
      location: job.candidate_required_location || 'Remote',
      country: job.candidate_required_location || 'Remote',
      job_type: job.job_type,
      work_arrangement: 'remote',
      posted_at: new Date(job.publication_date),
    }));
  } catch (err) {
    console.error('Remotive API error:', err.message);
    throw err;
  }
};

module.exports = {
  fetchJobs,
};
