/*
 * Turning a fetched page into a job, without inventing any part of it.
 *
 * Order of preference, and it matters:
 *   1. the board's own public API (Greenhouse, Lever, Ashby) - structured,
 *      official, no HTML read at all
 *   2. JSON-LD JobPosting (schema.org) - what a site publishes ABOUT itself
 *      for exactly this purpose, so reading it is not scraping in any
 *      meaningful sense
 *   3. Open Graph and <title> - weak, and labelled as such
 *
 * TWO RULES THIS FILE EXISTS TO KEEP:
 *
 * `posted_at` is only ever set from a field that is genuinely a PUBLICATION
 * date. Greenhouse's `updated_at` is not one - it moves when anything on the
 * posting changes - and himalayas' pubDate turned out to be their ingest
 * clock, which is how 4,685 rows nearly got fabricated freshness. Where there
 * is no real date the answer is null, and the UI already says "Publication
 * date unavailable" rather than guessing.
 *
 * The page is DATA. Its text is stripped of markup and control characters and
 * read for fields; nothing in it is ever treated as an instruction. Same
 * architecture as the pasted-JD path, and for the same reason: this content
 * comes from wherever the user found it.
 */

const { parsePastedJobText } = require('./pastedJobText');

/** Tags whose CONTENT is not readable text and must go with the tag. */
const DROP_BLOCKS = /<(script|style|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
};

/** HTML to text, then through the same cleaner the pasted path uses. */
function htmlToText(html) {
  const stripped = String(html || '')
    .replace(DROP_BLOCKS, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ');

  // Reuses the untrusted-text cleaner rather than a second copy of it.
  return parsePastedJobText(stripped).text;
}

/** ISO string only when the value really is a date. Never "now" as a stand-in. */
function realDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  // A date in the future, or before job boards existed, is a parse artefact.
  const year = d.getUTCFullYear();
  if (year < 2000 || d.getTime() > Date.now() + 86400000) return null;
  return d.toISOString();
}

const firstString = (...vals) => {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
};

/* ------------------------------------------------------------------ *
 * Official public APIs
 * ------------------------------------------------------------------ */

function fromGreenhouse(json, { url }) {
  if (!json || !json.title) return null;
  return {
    title: String(json.title).trim(),
    company: firstString(json.company_name, json.departments?.[0]?.name),
    location: firstString(json.location?.name),
    description: htmlToText(json.content || ''),
    // NOT updated_at: that moves whenever the posting is edited.
    postedAt: realDate(json.first_published || null),
    applyUrl: firstString(json.absolute_url, url),
    via: 'greenhouse_api',
  };
}

function fromLever(json, { url }) {
  if (!json || !json.text) return null;
  return {
    title: String(json.text).trim(),
    company: firstString(json.categories?.team, json.categories?.department),
    location: firstString(json.categories?.location),
    description: htmlToText(json.descriptionPlain || json.description || ''),
    postedAt: realDate(json.createdAt || null),
    applyUrl: firstString(json.hostedUrl, json.applyUrl, url),
    via: 'lever_api',
  };
}

function fromAshby(json, { postingId, url }) {
  const list = Array.isArray(json?.jobs) ? json.jobs : [];
  const job = list.find((j) => String(j.id) === String(postingId))
    || list.find((j) => typeof j.jobUrl === 'string' && j.jobUrl.includes(String(postingId)));
  if (!job) return null;
  return {
    title: firstString(job.title),
    company: firstString(job.companyName, json.companyName),
    location: firstString(job.location),
    description: htmlToText(job.descriptionHtml || job.descriptionPlain || ''),
    postedAt: realDate(job.publishedAt || null),
    applyUrl: firstString(job.applyUrl, job.jobUrl, url),
    via: 'ashby_api',
  };
}

/* ------------------------------------------------------------------ *
 * JSON-LD, which a site publishes about itself
 * ------------------------------------------------------------------ */

function jsonLdBlocks(html) {
  const out = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      /* A malformed block is skipped, never guessed at. */
    }
  }
  return out;
}

/** Walk @graph and arrays to find a JobPosting. */
function findJobPosting(node, depth = 0) {
  if (!node || depth > 4) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findJobPosting(n, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;

  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => String(t).toLowerCase() === 'jobposting')) return node;

  if (node['@graph']) return findJobPosting(node['@graph'], depth + 1);
  return null;
}

function fromJsonLd(html, { url }) {
  for (const block of jsonLdBlocks(html)) {
    const p = findJobPosting(block);
    if (!p) continue;

    const org = p.hiringOrganization;
    const loc = p.jobLocation;
    const addr = (Array.isArray(loc) ? loc[0] : loc)?.address;

    return {
      title: firstString(p.title),
      company: firstString(typeof org === 'string' ? org : org?.name),
      location: firstString(
        addr?.addressLocality && addr?.addressRegion ? `${addr.addressLocality}, ${addr.addressRegion}` : null,
        addr?.addressLocality, addr?.addressRegion, addr?.addressCountry,
        typeof loc === 'string' ? loc : null
      ),
      description: htmlToText(p.description || ''),
      // datePosted is defined by schema.org as the publication date, so it is
      // the one HTML-side field trustworthy enough to fill posted_at.
      postedAt: realDate(p.datePosted || null),
      applyUrl: firstString(p.url, url),
      via: 'json_ld',
    };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Last resort, and labelled as weak
 * ------------------------------------------------------------------ */

function fromMeta(html, { url }) {
  const meta = (prop) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
    const alt = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
    return (html.match(re) || html.match(alt) || [])[1] || null;
  };
  const titleTag = (html.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i) || [])[1];

  const title = firstString(meta('og:title'), titleTag);
  if (!title) return null;

  return {
    title: htmlToText(title).slice(0, 200),
    company: firstString(meta('og:site_name')),
    location: null,
    description: htmlToText(firstString(meta('og:description'), meta('description')) || ''),
    // No publication date exists in this path. Null, never today's date.
    postedAt: null,
    applyUrl: url,
    via: 'page_metadata',
    weak: true,
  };
}

/**
 * Extract a job from whatever came back.
 *
 * Returns `{ ok: false, reason, detail }` on failure so the caller can say
 * something specific, which is the whole point of this feature's error path.
 */
function extractJob(fetched, classified = {}) {
  const { body, finalUrl } = fetched;
  const url = finalUrl || classified.url;

  if (classified.via === 'public_api') {
    let json;
    try {
      json = typeof body === 'string' ? JSON.parse(body) : body;
    } catch {
      return {
        ok: false,
        reason: 'api_unreadable',
        detail: `${classified.board} answered with something that was not the posting we asked for. The posting may have been removed.`,
      };
    }
    const byBoard = {
      greenhouse: () => fromGreenhouse(json, { url }),
      lever: () => fromLever(json, { url }),
      ashby: () => fromAshby(json, { postingId: classified.postingId, url }),
    };
    const job = (byBoard[classified.board] || (() => null))();
    if (!job || !job.title) {
      return {
        ok: false,
        reason: 'posting_not_in_api',
        detail: `That posting was not in ${classified.board}'s public list for this company — it is usually a job that has been closed.`,
      };
    }
    return { ok: true, job };
  }

  const html = String(body || '');
  const job = fromJsonLd(html, { url }) || fromMeta(html, { url });

  if (!job || !job.title) {
    return {
      ok: false,
      reason: 'no_job_on_page',
      detail: 'That page does not publish job details in a form we can read. '
        + 'Copy the description and paste it instead — that works on every board.',
    };
  }
  if (!job.description || job.description.length < 40) {
    return {
      ok: false,
      reason: 'description_too_thin',
      detail: `We found the title ("${String(job.title).slice(0, 60)}") but the page did not include a readable description. `
        + 'Paste the description instead and everything else will work the same.',
      partial: job,
    };
  }
  return { ok: true, job };
}

module.exports = {
  extractJob, htmlToText, fromJsonLd, fromMeta, fromGreenhouse, fromLever, fromAshby,
  realDate, jsonLdBlocks, findJobPosting,
};
