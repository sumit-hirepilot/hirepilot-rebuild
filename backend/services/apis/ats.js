const axios = require('axios');

// Greenhouse, Lever, and Ashby each publish a genuine public, unauthenticated
// JSON API per company specifically so the company's own career page (and
// third parties) can embed/consume their job board - this is not scraping,
// it's the documented intended use of these endpoints. There is no "search
// all companies" endpoint for any of them though, so coverage is limited to
// a maintained list of company slugs. Every slug below was verified live
// (HTTP 200 + parseable board response) on 2026-07-25 - a slug returning 0
// current postings is still kept since the board itself is real and valid,
// just quiet that day. Add more by confirming a slug resolves, then
// appending it to the array.
const GREENHOUSE_COMPANIES = [
  'adyen', 'affirm', 'airbnb', 'airtable', 'alloy', 'amplitude', 'anthropic',
  'asana', 'attentive', 'bombas', 'braze', 'brex', 'calendly', 'cameo',
  'carta', 'checkr', 'chime', 'circleci', 'clickhouse', 'cloudflare',
  'coinbase', 'coursera', 'databricks', 'datadog', 'descript', 'discord',
  'dropbox', 'duolingo', 'elastic', 'faire', 'figma', 'fivetran', 'flexport',
  'ghost', 'gitlab', 'glossier', 'grailed', 'gusto', 'harrys', 'hightouch',
  'imbue', 'instacart', 'intercom', 'iterable', 'justworks', 'khanacademy',
  'klaviyo', 'kodiak', 'labelbox', 'lattice', 'launchdarkly', 'lyft',
  'marqeta', 'masterclass', 'mercury', 'mixpanel', 'mongodb', 'monzo', 'n26',
  'netlify', 'newrelic', 'nuro', 'okta', 'outschool', 'pagerduty', 'papaya',
  'peloton', 'pinterest', 'planetscale', 'poshmark', 'postman', 'postscript',
  'pulley', 'quip', 'reddit', 'remote', 'robinhood', 'samsara', 'scaleai',
  'shield', 'smartsheet', 'sofi', 'squarespace', 'stabilityai', 'stockx',
  'stripe', 'treasuryprime', 'twilio', 'udemy', 'upstart', 'vercel',
  'voxel51', 'waymo', 'webflow',
];

const LEVER_COMPANIES = [
  'alloy', 'angellist', 'articulate', 'clari', 'imbue', 'kapwing', 'kraken',
  'labelbox', 'mistral', 'neon', 'netflix', 'outreach', 'palantir', 'plaid',
  'secureframe', 'whoop', 'zoox',
];

const ASHBY_COMPANIES = [
  'airbyte', 'airtable', 'amp', 'amplitude', 'ashby', 'away', 'baseten',
  'benchling', 'betterup', 'character', 'clerk', 'clickhouse', 'clickup',
  'cohere', 'confluent', 'cursor', 'deel', 'drata', 'elevenlabs', 'encord',
  'expensify', 'fireworks', 'ghost', 'gitbook', 'harvey', 'hightouch',
  'iterable', 'langchain', 'launchdarkly', 'linear', 'loom', 'marqeta',
  'mercury', 'miro', 'modal', 'neon', 'notion', 'oneleet', 'openai',
  'outschool', 'oyster', 'patreon', 'perplexity', 'persona', 'pinecone',
  'plaid', 'poshmark', 'posthog', 'quora', 'railway', 'ramp', 'reddit',
  'render', 'replit', 'runway', 'sardine', 'secureframe', 'sierra',
  'snowflake', 'substack', 'supabase', 'synctera', 'synthesia', 'temporal',
  'tldraw', 'unit', 'vanta', 'vercel', 'weaviate', 'webflow', 'whoop',
  'workos', 'writer', 'zapier',
];

// Greenhouse's job "content" field double-encodes: HTML tags are rendered
// as literal entity text (e.g. "&lt;h2&gt;") rather than real "<h2>", so
// entities must be decoded before tags are stripped. Lever/Ashby's plain
// text fields have no entities, so this is a harmless no-op for them.
const stripHtml = (html) =>
  (html || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const fetchGreenhouseCompany = async (slug) => {
  const res = await axios.get(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, {
    params: { content: true },
    timeout: 10000,
  });
  return (res.data?.jobs || []).map((j) => ({
    external_id: `gh-${slug}-${j.id}`,
    id: `gh-${slug}-${j.id}`,
    title: j.title,
    company: slug.charAt(0).toUpperCase() + slug.slice(1),
    url: j.absolute_url,
    job_url: j.absolute_url,
    // absolute_url points at the company's own careers domain for ~56% of
    // boards (e.g. careers.upstart.com/jobs?gh_jid=...), where the extension's
    // content script does not run. The canonical board URL always does, and
    // serves the same application form.
    apply_url: `https://job-boards.greenhouse.io/${slug}/jobs/${j.id}`,
    description: stripHtml(j.content),
    location: j.location?.name || 'Not specified',
    country: '',
    work_arrangement: /remote/i.test(j.location?.name || '') ? 'remote' : 'on-site',
    job_type: 'full-time',
    // first_published is the job's genuine original post date; updated_at
    // bumps on every edit (even a typo fix), which was making old postings
    // look freshly posted - confirmed live on a Stripe job where updated_at
    // was 7 weeks after the real first_published date.
    posted_at: j.first_published ? new Date(j.first_published) : null,
  }));
};

const fetchLeverCompany = async (slug) => {
  const res = await axios.get(`https://api.lever.co/v0/postings/${slug}`, {
    params: { mode: 'json' },
    timeout: 10000,
  });
  return (Array.isArray(res.data) ? res.data : []).map((j) => ({
    external_id: `lv-${slug}-${j.id}`,
    id: `lv-${slug}-${j.id}`,
    title: j.text,
    company: slug.charAt(0).toUpperCase() + slug.slice(1),
    url: j.hostedUrl,
    job_url: j.hostedUrl,
    description: stripHtml(j.descriptionPlain || j.description),
    location: j.categories?.location || 'Not specified',
    country: '',
    work_arrangement: /remote/i.test(j.categories?.location || '') ? 'remote' : 'on-site',
    job_type: (j.categories?.commitment || 'full-time').toLowerCase().replace(/\s+/g, '-'),
    posted_at: j.createdAt ? new Date(j.createdAt) : null,
  }));
};

const fetchAshbyCompany = async (slug) => {
  const res = await axios.get(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, {
    timeout: 10000,
  });
  return (res.data?.jobs || []).map((j) => ({
    external_id: `ash-${slug}-${j.id}`,
    id: `ash-${slug}-${j.id}`,
    title: j.title,
    company: slug.charAt(0).toUpperCase() + slug.slice(1),
    url: j.jobUrl || j.applyUrl,
    job_url: j.jobUrl || j.applyUrl,
    description: stripHtml(j.descriptionPlain || j.description),
    location: j.location || 'Not specified',
    country: '',
    work_arrangement: j.isRemote ? 'remote' : 'on-site',
    job_type: (j.employmentType || 'full-time').toLowerCase().replace(/\s+/g, '-'),
    posted_at: j.publishedAt ? new Date(j.publishedAt) : null,
  }));
};

const fetchAllForPlatform = async (companies, fetchOne, platformLabel) => {
  const results = await Promise.all(
    companies.map(async (slug) => {
      try {
        return await fetchOne(slug);
      } catch (err) {
        console.error(`${platformLabel} (${slug}) error:`, err.message);
        return [];
      }
    })
  );
  return results.flat();
};

const fetchGreenhouseJobs = () => fetchAllForPlatform(GREENHOUSE_COMPANIES, fetchGreenhouseCompany, 'Greenhouse');
const fetchLeverJobs = () => fetchAllForPlatform(LEVER_COMPANIES, fetchLeverCompany, 'Lever');
const fetchAshbyJobs = () => fetchAllForPlatform(ASHBY_COMPANIES, fetchAshbyCompany, 'Ashby');

module.exports = { fetchGreenhouseJobs, fetchLeverJobs, fetchAshbyJobs };
