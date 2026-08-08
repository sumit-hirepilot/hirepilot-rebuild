const httpSource = require('./httpSource');
const crypto = require('crypto');

const BASE_URL = 'https://www.workingnomads.com/api/exposed_jobs/';

const stripHtml = (html) =>
  (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const idFromUrl = (url) => crypto.createHash('md5').update(url).digest('hex').slice(0, 16);

const fetchJobs = async () => {
  try {
    const response = await httpSource.get('workingnomads', BASE_URL, {
      timeout: 10000,
      headers: { Accept: 'application/json' },
    });

    const jobs = Array.isArray(response.data) ? response.data : [];

    return jobs
      .filter((j) => j.url && j.title && j.company_name)
      .map((j) => ({
        external_id: `wn-${idFromUrl(j.url)}`,
        id: `wn-${idFromUrl(j.url)}`,
        title: j.title,
        company: j.company_name,
        url: j.url,
        job_url: j.url,
        description: stripHtml(j.description),
        location: j.location || 'Remote',
        country: '',
        work_arrangement: 'remote',
        job_type: 'full-time',
        posted_at: j.pub_date ? new Date(j.pub_date) : null,
      }));
  } catch (err) {
    console.error('Working Nomads API error:', err.message);
    throw err;
  }
};

module.exports = { fetchJobs };
