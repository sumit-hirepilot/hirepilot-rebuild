const axios = require('axios');

const BASE_URL = 'https://landing.jobs/api/v1/offers';

const stripHtml = (html) =>
  (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

// The API doesn't expose a structured company field - company slug is only
// available in the offer URL path (landing.jobs/at/{company}/{job-slug}).
const companyFromUrl = (url) => {
  const match = (url || '').match(/landing\.jobs\/at\/([^/]+)\//);
  if (!match) return 'Company on Landing.jobs';
  return match[1].split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

const fetchJobs = async () => {
  try {
    const response = await axios.get(BASE_URL, {
      timeout: 10000,
      headers: { Accept: 'application/json' },
    });

    const offers = Array.isArray(response.data) ? response.data : [];

    return offers
      .filter((o) => o.id && o.title && o.url)
      .map((o) => {
        const location = o.locations?.[0];
        const description = [
          stripHtml(o.role_description),
          o.main_requirements ? `Requirements: ${stripHtml(o.main_requirements)}` : '',
        ].filter(Boolean).join('\n\n');

        return {
          external_id: `ljobs-${o.id}`,
          id: `ljobs-${o.id}`,
          title: o.title,
          company: companyFromUrl(o.url),
          url: o.url,
          job_url: o.url,
          description,
          requirements: stripHtml(o.main_requirements),
          location: o.remote ? 'Remote' : (location?.city || 'Portugal'),
          country: location?.country_code === 'PT' ? 'Portugal' : (location?.country_code || 'Portugal'),
          salary_min: o.gross_salary_low || null,
          salary_max: o.gross_salary_high || null,
          currency: o.currency_code || 'EUR',
          work_arrangement: o.remote ? 'remote' : 'on-site',
          job_type: (o.type || 'full-time').toLowerCase().replace(/\s+/g, '-'),
          posted_at: o.published_at ? new Date(o.published_at) : new Date(),
        };
      });
  } catch (err) {
    console.error('Landing.jobs API error:', err.message);
    throw err;
  }
};

module.exports = { fetchJobs };
