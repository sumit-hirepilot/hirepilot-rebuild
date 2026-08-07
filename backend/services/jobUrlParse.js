/*
 * Reading a pasted job URL: which board is it, and is it safe to fetch at all.
 *
 * A7.19 reshaped the source strategy: crawling boards is a ToS question this
 * product does not want and cannot answer, so coverage comes from the user
 * instead. One person pastes one link to a page they are already looking at.
 * That is not a crawl and never becomes one - nothing here follows a link,
 * enumerates an id, or adds a row to the shared index.
 *
 * TWO SEPARATE JOBS, and they must not be confused:
 *
 *   1. WHICH BOARD. Greenhouse, Lever and Ashby publish official public
 *      posting APIs, already used by the aggregator. A pasted URL for those
 *      becomes an API call for that one posting - there is no scraping in the
 *      path at all, and no ToS question to defer.
 *
 *   2. WHETHER TO FETCH. A URL from a request is an instruction to make this
 *      server open a socket to an address the user chose. Left unchecked that
 *      is SSRF: `http://169.254.169.254/latest/meta-data/` returns Railway's
 *      own credentials, and `http://127.0.0.1:5432` reaches the database.
 *      Blocked here by ADDRESS, after DNS resolution, because a hostname that
 *      looks public can resolve to a private one - and re-checked on every
 *      redirect, because a public URL can 302 into a private address.
 *
 * What this file will NOT do, and it is the same line D19 drew for We Work
 * Remotely: nothing here disguises the request. One honest User-Agent that
 * names the product, no proxy, no rotation, no challenge solving. If a board
 * says no, that is an answer, and the caller's job is to say so plainly and
 * offer the paste box instead.
 */

const dns = require('dns').promises;
const net = require('net');

/** Boards with an official public posting API - no HTML is ever read for these. */
const API_BOARDS = {
  greenhouse: {
    // job-boards.greenhouse.io/acme/jobs/12345, boards.greenhouse.io/acme/jobs/12345
    match: /^(?:job-boards|boards)\.greenhouse\.io$/i,
    parse: (u) => {
      const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
      return m ? { slug: m[1], postingId: m[2] } : null;
    },
    api: ({ slug, postingId }) =>
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(postingId)}`,
  },
  lever: {
    // jobs.lever.co/acme/uuid
    match: /^jobs\.lever\.co$/i,
    parse: (u) => {
      const m = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{8,})/i);
      return m ? { slug: m[1], postingId: m[2] } : null;
    },
    api: ({ slug, postingId }) =>
      `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}/${encodeURIComponent(postingId)}`,
  },
  ashby: {
    // jobs.ashbyhq.com/acme/uuid
    match: /^jobs\.ashbyhq\.com$/i,
    parse: (u) => {
      const m = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{8,})/i);
      return m ? { slug: m[1], postingId: m[2] } : null;
    },
    // Ashby's public board API returns the whole board; the posting is picked
    // out by id after the fetch.
    api: ({ slug }) =>
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
  },
};

/**
 * Boards with no public posting API, named so the failure can be specific.
 *
 * Being listed here is NOT permission to work around anything. It means: if a
 * plain request is refused, the user is told which board refused it and why,
 * rather than getting "could not fetch".
 */
const KNOWN_HTML_BOARDS = {
  linkedin: { match: /(^|\.)linkedin\.com$/i, label: 'LinkedIn' },
  naukri: { match: /(^|\.)naukri\.com$/i, label: 'Naukri' },
  instahyre: { match: /(^|\.)instahyre\.com$/i, label: 'Instahyre' },
  indeed: { match: /(^|\.)indeed\.(com|co\.in)$/i, label: 'Indeed' },
  wellfound: { match: /(^|\.)wellfound\.com$/i, label: 'Wellfound' },
};

/**
 * Ranges that must never be reachable from a user-supplied URL.
 *
 * Written as explicit checks rather than a regex on the string: `0177.0.0.1`,
 * `2130706433` and `::ffff:127.0.0.1` are all localhost, and none of them look
 * like it. net.isIP plus numeric comparison is what actually decides.
 */
function isBlockedAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 0) return true;                       // "this network"
    if (a === 10) return true;                      // private
    if (a === 127) return true;                     // loopback
    if (a === 169 && b === 254) return true;        // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true;        // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true;          // protocol assignments
    if (a >= 224) return true;                      // multicast, reserved, broadcast
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    // IPv4-mapped: ::ffff:127.0.0.1 is loopback wearing a v6 hat.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    if (/^f[cd]/.test(lower)) return true;          // unique local
    if (/^fe[89ab]/.test(lower)) return true;       // link-local
    return false;
  }
  return true;                                      // not an IP we understand
}

/**
 * Classify a pasted URL. Pure and synchronous - no network, so it can be
 * exercised exhaustively without one.
 *
 * Returns `{ ok: false, reason, detail }` rather than throwing, because every
 * failure here has to reach the user as a SPECIFIC sentence and a thrown
 * Error collapses them all into one.
 */
function classifyJobUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, reason: 'empty', detail: 'No link was given.' };
  if (text.length > 2048) {
    return { ok: false, reason: 'too_long', detail: 'That link is longer than 2,048 characters, which no job posting needs.' };
  }

  let u;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, reason: 'not_a_url', detail: 'That does not look like a web address. It should start with https://' };
  }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return {
      ok: false,
      reason: 'bad_scheme',
      detail: `Only http and https links can be opened, and that one is ${u.protocol.replace(':', '')}.`,
    };
  }

  // A literal private address needs no DNS to be refused.
  if (net.isIP(u.hostname) && isBlockedAddress(u.hostname)) {
    return { ok: false, reason: 'private_address', detail: 'That address is on a private network, so it cannot be opened from here.' };
  }
  if (/^localhost$/i.test(u.hostname)) {
    return { ok: false, reason: 'private_address', detail: 'That address is on a private network, so it cannot be opened from here.' };
  }

  for (const [board, def] of Object.entries(API_BOARDS)) {
    if (def.match.test(u.hostname)) {
      const parts = def.parse(u);
      if (!parts) {
        return {
          ok: false,
          reason: 'unrecognised_posting_url',
          detail: `That is a ${board} link, but not a link to a single posting. Open the job itself and copy the address from there.`,
        };
      }
      return { ok: true, board, via: 'public_api', url: u.toString(), apiUrl: def.api(parts), ...parts };
    }
  }

  for (const [board, def] of Object.entries(KNOWN_HTML_BOARDS)) {
    if (def.match.test(u.hostname)) {
      return { ok: true, board, label: def.label, via: 'html', url: u.toString() };
    }
  }

  return { ok: true, board: 'generic', via: 'html', url: u.toString() };
}

/**
 * Resolve a hostname and refuse if any address behind it is private.
 *
 * EVERY address, not the first: a host that returns one public and one private
 * address would otherwise be reachable on a retry.
 */
async function assertPublicHost(hostname, resolver = dns) {
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      return { ok: false, reason: 'private_address', detail: 'That address is on a private network, so it cannot be opened from here.' };
    }
    return { ok: true, addresses: [hostname] };
  }

  let addresses;
  try {
    const records = await resolver.lookup(hostname, { all: true });
    addresses = records.map((r) => r.address);
  } catch {
    return {
      ok: false,
      reason: 'dns_failed',
      detail: `No server was found at ${hostname}. Check the address for a typo.`,
    };
  }

  if (!addresses.length) {
    return { ok: false, reason: 'dns_failed', detail: `No server was found at ${hostname}.` };
  }
  if (addresses.some((a) => isBlockedAddress(a))) {
    return {
      ok: false,
      reason: 'private_address',
      detail: `${hostname} points at a private network address, so it cannot be opened from here.`,
    };
  }
  return { ok: true, addresses };
}

module.exports = {
  classifyJobUrl, assertPublicHost, isBlockedAddress, API_BOARDS, KNOWN_HTML_BOARDS,
};
