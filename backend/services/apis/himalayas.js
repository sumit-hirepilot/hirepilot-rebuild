const httpSource = require('./httpSource');
const { fixMojibake } = require('./textSanitizer');

const BASE_URL = 'https://himalayas.app/jobs/api';
const PAGE_SIZE = 20; // API silently caps page size at 20 regardless of requested limit
const PAGES_TO_FETCH = 10; // ~200 most recent postings per aggregation cycle

const stripHtml = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const fetchPage = async (offset) => {
  const response = await httpSource.get('himalayas', BASE_URL, {
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
        // Himalayas's public pubDate field does not reliably reflect the
        // job's true original publish date - confirmed live: multiple
        // unrelated companies' postings all carried a pubDate clustered
        // within the same ~hour window HirePilot happened to fetch them,
        // while the same job's own Himalayas page showed a "Posted on"
        // date up to 2 months earlier. It reads as a last-synced/bumped
        // timestamp on Himalayas's side, not an original-post date, and
        // their public API exposes no other date field to fall back to.
        posted_at: null,
      }));
  } catch (err) {
    console.error('Himalayas API error:', err.message);
    throw err;
  }
};

module.exports = { fetchJobs };
