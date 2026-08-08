const httpSource = require('./httpSource');

const HN_API = 'https://hacker-news.firebaseio.com/v0';
const MAX_COMMENTS = 150; // bound latency - HN has no batch-fetch, one request per comment
const CONCURRENCY = 10;

const decodeEntities = (text) =>
  (text || '')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const stripHtml = (html) =>
  decodeEntities(html || '')
    .replace(/<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

const getItem = async (id) => {
  const res = await httpSource.get('hackernews', `${HN_API}/item/${id}.json`, { timeout: 8000 });
  return res.data;
};

// HN "Who is hiring?" comments follow a loose convention:
// "Company | Title | Location | Remote/Onsite | Salary | URL" as the first
// line, free-form description after. Parsed heuristically like a resume -
// always reviewable via the original HN thread link.
const parseComment = (comment) => {
  const rawText = stripHtml(comment.text);
  const firstLine = rawText.split('\n')[0] || '';
  const segments = firstLine.split('|').map((s) => s.trim()).filter(Boolean);

  /*
   * A7.12 — the pipe convention IS the parse. Without it there is nothing to
   * split on, and `segments[0]` became the entire first line: company_name
   * turned into a paragraph and title into its first 120 characters. HN's
   * paired "Who wants to be hired" thread reads exactly that way, which is how
   * a person's bio reached the feed with an Apply button - but 16 of 200
   * hiring posts hit it too, so this was never bio-specific.
   *
   * Returning null withholds the comment. A guessed employer is worse than a
   * missing posting.
   */
  if (segments.length < 2) return null;

  const company = segments[0];
  const title = segments[1];
  const location = segments.slice(2).find((s) => s.length < 60) || 'See posting';

  const urlMatch = rawText.match(/https?:\/\/[^\s)]+/);
  const isRemote = /remote/i.test(firstLine);

  return {
    external_id: `hn-${comment.id}`,
    id: `hn-${comment.id}`,
    title: title.slice(0, 250),
    company: company.slice(0, 250),
    url: urlMatch ? urlMatch[0] : `https://news.ycombinator.com/item?id=${comment.id}`,
    job_url: `https://news.ycombinator.com/item?id=${comment.id}`,
    description: rawText,
    location,
    country: '',
    work_arrangement: isRemote ? 'remote' : 'unknown',
    job_type: 'full-time',
    posted_at: comment.time ? new Date(comment.time * 1000) : null,
  };
};

const fetchInBatches = async (ids, batchSize, fn) => {
  const results = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.all(batch.map((id) => fn(id).catch(() => null)));
    results.push(...batchResults);
  }
  return results;
};

const fetchJobs = async () => {
  try {
    const user = await httpSource.get('hackernews', `${HN_API}/user/whoishiring.json`, { timeout: 8000 });
    const latestSubmissionId = (user.data?.submitted || [])[0];
    if (!latestSubmissionId) return [];

    const thread = await getItem(latestSubmissionId);
    if (!thread || thread.type !== 'story' || !/who is hiring/i.test(thread.title || '')) {
      return [];
    }

    const commentIds = (thread.kids || []).slice(0, MAX_COMMENTS);
    const comments = await fetchInBatches(commentIds, CONCURRENCY, getItem);

    return comments
      .filter((c) => c && !c.deleted && !c.dead && c.text)
      .map(parseComment)
      // parseComment returns null for a comment with no pipe convention -
      // there is nothing to parse, so the posting is withheld rather than
      // guessed at.
      .filter(Boolean);
  } catch (err) {
    console.error('Hacker News API error:', err.message);
    throw err;
  }
};

module.exports = { fetchJobs };
