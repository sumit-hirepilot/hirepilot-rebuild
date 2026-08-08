const httpSource = require('./httpSource');

/*
 * PAGED, because the whole-catalogue endpoint is 160MB in one response.
 *
 * `GET /api/posting` returns every posting at once. Measured on a real boot
 * with per-phase instrumentation, this one source took RSS from 106MB to 688MB
 * and heap from 28MB to 455MB: ~157MB of that is the raw body held as an
 * external Buffer, and the rest is the parsed JSON plus the dedup Map plus the
 * mapped output, all resident together. The budget is 500MB peak; the
 * container ceiling is 1GB.
 *
 * D53 measured this same step at 246MB and recorded it as "the largest single
 * step, a single API call with no pagination, inside budget, the next
 * candidate if the ceiling tightens". Their catalogue grew and it stopped
 * being inside budget - which is what a note like that is for.
 *
 * `POST /api/search/posting?limit=&page=` serves the same data a page at a time
 * and reports totalCount, so the cap below can say what it skipped.
 *
 * The parameters are NOT what they look like, and getting this wrong shipped a
 * broken source once already:
 *
 *   offset=  IGNORED. Every request returns the identical first page. The first
 *            version paged on offset, fetched the same 200 postings forty
 *            times, deduped them to 20 unique jobs, and cut this source from
 *            ~3,000 jobs to 20 - while the memory graph looked perfect. Caught
 *            by reading the ingest line, not the memory one.
 *   limit=   the number of UNIQUE JOBS in the response, not the row count:
 *            limit=250 returns ~2,080 raw postings (~16MB) carrying 250
 *            distinct jobs, because the API repeats a posting per province.
 *   page=    pages properly, and consecutive pages differ.
 */
const SEARCH_URL = 'https://nofluffjobs.com/api/search/posting';

/*
 * A cap, REPORTED rather than silent.
 *
 * Their index is ~22,000 postings carrying ~3,000 distinct jobs, nearly all
 * Polish. 3,000 matches what this source produced when it was pulled whole, so
 * the cap restores the previous yield rather than quietly shrinking it - at 250
 * unique a page that is ~12 requests instead of one 160MB response.
 *
 * When the bound bites it logs, because a silent truncation reads as "that is
 * all there was".
 */
const PAGE_UNIQUE = 250;                      // ~16MB a response
const MAX_UNIQUE = Number(process.env.NOFLUFFJOBS_MAX_UNIQUE) || 3000;
const PAGE_TIMEOUT_MS = 30000;

/*
 * One page's worth, deduped against what earlier pages already yielded.
 *
 * The API returns one entry per (job, province-it-is-visible-in) pair, so a
 * posting open to several regions appears under a dozen province-suffixed
 * URLs. The unpaged version could prefer the plain "Remote" variant because it
 * held every entry at once; paging means that variant may arrive after one is
 * already kept, so the first seen wins. That is the honest trade for not
 * holding 22,000 postings in memory, and it moves only the location field -
 * which is still read from the posting's own places either way.
 */
function mapPostings(postings, seen) {
  const out = [];
  for (const p of postings) {
    if (!p.id || !p.title || !p.name) continue;
    const key = `${p.name}|${p.title}|${p.posted}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapPosting(p));
  }
  return out;
}

function mapPosting(p) {
  const places = p.location?.places || [];
  const cityPlace = places.find((pl) => pl.city && !/remote/i.test(pl.city));
  const country = places.find((pl) => pl.country)?.country?.name || '';
  const isRemote = p.fullyRemote || places.some((pl) => /remote/i.test(pl.city || ''));
  const location = isRemote ? 'Remote' : (cityPlace?.city || country || 'Poland');

  const salaryFrom = p.salary?.from ? Math.round(p.salary.from) : null;
  const salaryTo = p.salary?.to ? Math.round(p.salary.to) : null;

  const description = [
    `${(p.category || '').replace(/-/g, ' ')} role, ${(p.seniority || []).join('/')} level.`,
    location ? `Location: ${location}.` : '',
    salaryFrom ? `Salary: ${salaryFrom}-${salaryTo || salaryFrom} ${p.salary?.currency || ''}/month.` : '',
  ].filter(Boolean).join(' ');

  return {
    external_id: `nfj-${p.id}`,
    id: `nfj-${p.id}`,
    title: p.title,
    company: p.name,
    url: `https://nofluffjobs.com/job/${p.url}`,
    job_url: `https://nofluffjobs.com/job/${p.url}`,
    description,
    location,
    country: country || 'Poland',
    salary_min: salaryFrom,
    salary_max: salaryTo,
    currency: p.salary?.currency || 'PLN',
    work_arrangement: isRemote ? 'remote' : 'on-site',
    job_type: 'full-time',
    posted_at: p.posted ? new Date(Number(p.posted)) : null,
  };
}

/**
 * @param {Function} [onBatch] called with each page's mapped rows. When given,
 *   nothing accumulates: a page is mapped, handed over and released before the
 *   next is fetched. Without it the rows are collected and returned, which is
 *   what the tests and any other caller expect.
 */
const fetchJobs = async (onBatch) => {
  try {
    const collected = onBatch ? null : [];
    // Keys only. The postings themselves are released with each page, so this
    // stays small however many pages are read.
    const seen = new Set();
    let page = 1;
    let unique = 0;
    let totalCount = null;

    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const response = await httpSource.post('nofluffjobs', 
        `${SEARCH_URL}?limit=${PAGE_UNIQUE}&page=${page}&salaryCurrency=PLN&salaryPeriod=month&region=pl`,
        { rawSearch: '' },
        {
          timeout: PAGE_TIMEOUT_MS,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        }
      );

      const postings = response.data?.postings || [];
      if (totalCount == null) totalCount = Number(response.data?.totalCount) || null;
      if (!postings.length) break;

      const rows = mapPostings(postings, seen);
      /*
       * A page that adds nothing new means paging has stopped advancing -
       * which is exactly what a wrong parameter looks like. Stopping here
       * turns that into a short run instead of an endless identical one.
       */
      if (!rows.length) break;

      unique += rows.length;
      page += 1;

      // eslint-disable-next-line no-await-in-loop
      if (onBatch) await onBatch(rows);
      else collected.push(...rows);

      if (unique >= MAX_UNIQUE) {
        if (totalCount && totalCount > unique) {
          console.log(
            `nofluffjobs: stopped at ${unique} unique jobs of ~${totalCount} postings `
            + `(NOFLUFFJOBS_MAX_UNIQUE=${MAX_UNIQUE})`
          );
        }
        break;
      }
    }

    return onBatch ? { fetched: unique } : collected;
  } catch (err) {
    console.error('NoFluffJobs API error:', err.message);
    throw err;
  }
};

module.exports = { fetchJobs, MAX_UNIQUE, PAGE_UNIQUE };
