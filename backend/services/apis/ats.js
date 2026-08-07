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
  'labelbox', 'mistral', 'neon', 'outreach', 'palantir', 'plaid',
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
/*
 * HTML -> readable plain text.
 *
 * The previous version collapsed ALL whitespace, including the block-level
 * structure, so a posting arrived as one unbroken wall of text with no
 * paragraphs or list items. That is what gets shown in the job preview and fed
 * to keyword scoring, so block tags are now converted to newlines BEFORE
 * whitespace is normalised, and list items keep a bullet.
 */
// Entities arrive double-encoded from some boards (&amp;nbsp;), so decoding
// once leaves a literal &nbsp; in the text. Two passes resolves that; the
// numeric form is handled too.
const decodeEntities = (text) => {
  const once = (t) => t
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
  return once(once(text));
};

const stripHtml = (html) =>
  decodeEntities(html || '')
    // Block boundaries become newlines so paragraphs survive.
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|section|article|h[1-6]|ul|ol|tr|blockquote)\s*>/gi, '\n\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\s*\/\s*li\s*>/gi, '')
    .replace(/<\s*(h[1-6])[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    // Normalise horizontal whitespace only - newlines are meaningful now.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
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

/*
 * GOAL 1d — bounded concurrency, because this is the largest allocation in the
 * process.
 *
 * This was Promise.all over EVERY company, so every company's HTTP response
 * and parsed JSON was resident at the same moment before being flattened.
 * Greenhouse alone returns 10,180 postings across its company list, ashby
 * 4,409 - measured on a real cycle, not estimated. The container ceiling is
 * 1 GB (Railway trial plan limit) and the service died during ingest five
 * times.
 *
 * A small window keeps the fetch parallel enough to finish quickly while
 * bounding how much is in flight. Nothing waits on ingest - it runs on a
 * timer - so throughput here is worth far less than headroom.
 */
const FETCH_WINDOW = Number(process.env.ATS_FETCH_WINDOW) || 4;

/*
 * GOAL 1d bounded how many companies are IN FLIGHT. It did not bound how many
 * postings are RESIDENT, and that is where the remaining peak was.
 *
 * Measured on a real boot with per-source instrumentation: greenhouse alone
 * took RSS from 243MB to 377MB and heap from 25MB to 158MB while adding 10,179
 * postings, because every window's rows were pushed into one array and the
 * whole array returned to the caller, which then held it while writing. ashby
 * did the same at 4,419. Peak 377MB against a 500MB budget, on an environment
 * with two users - it scales with the SOURCE, not with usage, so it only gets
 * worse.
 *
 * With an onBatch consumer nothing accumulates: each window's rows are handed
 * over, written, and unreachable before the next fetch begins. At most
 * FETCH_WINDOW companies' postings exist at once.
 *
 * The array-returning form is kept for callers that genuinely want everything
 * (and for the tests), so this is a widening rather than a breaking change.
 */
const fetchAllForPlatform = async (companies, fetchOne, platformLabel, onBatch) => {
  const all = onBatch ? null : [];
  let fetched = 0;

  for (let i = 0; i < companies.length; i += FETCH_WINDOW) {
    const window = companies.slice(i, i + FETCH_WINDOW);
    const results = await Promise.all(
      window.map(async (slug) => {
        try {
          return await fetchOne(slug);
        } catch (err) {
          console.error(`${platformLabel} (${slug}) error:`, err.message);
          return [];
        }
      })
    );

    if (onBatch) {
      // Flattened per window, not per platform. `batch` goes out of scope at
      // the end of this iteration; nothing above holds a reference to it.
      const batch = [];
      for (const rows of results) batch.push(...rows);
      fetched += batch.length;
      // Sequential await, so the next window is not fetched while this one is
      // still being written - otherwise two windows are resident after all.
      await onBatch(batch);
    } else {
      for (const rows of results) all.push(...rows);
    }
  }

  return onBatch ? { fetched } : all;
};

const fetchGreenhouseJobs = (onBatch) => fetchAllForPlatform(GREENHOUSE_COMPANIES, fetchGreenhouseCompany, 'Greenhouse', onBatch);
const fetchLeverJobs = (onBatch) => fetchAllForPlatform(LEVER_COMPANIES, fetchLeverCompany, 'Lever', onBatch);
const fetchAshbyJobs = (onBatch) => fetchAllForPlatform(ASHBY_COMPANIES, fetchAshbyCompany, 'Ashby', onBatch);

module.exports = { fetchGreenhouseJobs, fetchLeverJobs, fetchAshbyJobs, FETCH_WINDOW };
