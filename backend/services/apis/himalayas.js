const axios = require('axios');
const { fixMojibake } = require('./textSanitizer');

const BASE_URL = 'https://himalayas.app/jobs/api';
const PAGE_SIZE = 20; // API silently caps page size at 20 regardless of requested limit
const PAGES_TO_FETCH = 10; // ~200 most recent postings per aggregation cycle

const stripHtml = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const fetchPage = async (offset) => {
  const response = await axios.get(BASE_URL, {
    params: { limit: PAGE_SIZE, offset },
    timeout: 10000,
    headers: { Accept: 'application/json' },
  });
  return Array.isArray(response.data?.jobs) ? response.data.jobs : [];
};

const fetchJobs = async () => {
  try {
    const pages = await Promise.all(
      Array.from({ length: PAGES_TO_FETCH }, (_, i) => fetchPage(i * PAGE_SIZE))
    );

    return pages
      .flat()
      .filter((job) => job.guid && job.title && job.companyName)
      .map((job) => ({
        external_id: job.guid,
        id: job.guid,
        title: fixMojibake(job.title),
        company: fixMojibake(job.companyName),
        company_url: job.companyLogo || undefined,
        url: job.applicationLink || job.guid,
        job_url: job.applicationLink || job.guid,
        description: stripHtml(job.description) || job.excerpt || '',
        location: (job.locationRestrictions || []).join(', ') || 'Remote',
        country: (job.locationRestrictions || [])[0] || '',
        salary_min: job.minSalary || null,
        salary_max: job.maxSalary || null,
        currency: job.currency || 'USD',
        job_type: job.employmentType || 'full-time',
        work_arrangement: 'remote',
        posted_at: job.pubDate ? new Date(job.pubDate * 1000) : new Date(),
      }));
  } catch (err) {
    console.error('Himalayas API error:', err.message);
    throw err;
  }
};

module.exports = { fetchJobs };
