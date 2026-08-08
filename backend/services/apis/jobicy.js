const httpSource = require('./httpSource');

const BASE_URL = 'https://jobicy.com/api/v2/remote-jobs';

const stripHtml = (html) =>
  (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const fetchJobs = async () => {
  try {
    const response = await httpSource.get('jobicy', BASE_URL, {
      params: { count: 100 },
      timeout: 10000,
      headers: { Accept: 'application/json' },
    });

    const jobs = response.data?.jobs || [];

    return jobs
      .filter((j) => j.id && j.jobTitle && j.companyName)
      .map((j) => ({
        external_id: `jicy-${j.id}`,
        id: `jicy-${j.id}`,
        title: j.jobTitle,
        company: j.companyName,
        company_url: j.companyLogo || undefined,
        url: j.url,
        job_url: j.url,
        description: stripHtml(j.jobDescription) || stripHtml(j.jobExcerpt),
        location: j.jobGeo || 'Remote',
        country: j.jobGeo || '',
        salary_min: j.salaryMin || null,
        salary_max: j.salaryMax || null,
        currency: j.salaryCurrency || 'USD',
        work_arrangement: 'remote',
        job_type: (j.jobType?.[0] || 'full-time').toLowerCase().replace(/\s+/g, '-'),
        posted_at: j.pubDate ? new Date(j.pubDate) : null,
      }));
  } catch (err) {
    console.error('Jobicy API error:', err.message);
    throw err;
  }
};

module.exports = { fetchJobs };
