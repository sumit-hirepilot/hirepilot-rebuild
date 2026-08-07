/*
 * Fetching one job page, on behalf of one user, once.
 *
 * The rules this operates under, all of them load-bearing:
 *
 *   - ONE URL, USER-INITIATED. Nothing here follows a link, enumerates an id,
 *     or schedules itself. A crawl is a different act with a different answer,
 *     and this must never quietly become one.
 *   - NEVER CIRCUMVENT A REFUSAL. One honest User-Agent naming the product and
 *     linking to it. No proxy, no rotation, no cookie replay, no challenge
 *     solving, no retry-to-evade. D19 drew that line for We Work Remotely and
 *     it does not move because a different board is behind it.
 *   - A REFUSAL IS AN ANSWER. 403, 401, 429 and challenge pages are reported
 *     to the user by name, with the board named, and the paste box offered.
 *     That is why this feature needs no ToS gamble: when a board says no, the
 *     product says so and the user pastes the text instead.
 *   - THE PAGE IS DATA. What comes back is parsed for fields and never obeyed,
 *     the same architecture as the pasted-JD path in feature 3.
 *
 * Every failure carries a `reason` code and a sentence written for the person
 * reading it. "Could not fetch" is the thing this file exists to never say.
 */

const axios = require('axios');
const { classifyJobUrl, assertPublicHost, isBlockedAddress } = require('./jobUrlParse');
const { PUBLIC_APP_URL } = require('./publicUrl');

/** Names the product and points at it. A bot that hides is a bot that is lying. */
const USER_AGENT = `HirePilotBot/1.0 (+${PUBLIC_APP_URL}/about-bot; job link opened by a signed-in user)`;

const TIMEOUT_MS = 12000;
const MAX_BYTES = 2 * 1024 * 1024;   // a job page that needs more than 2MB is not a job page
const MAX_REDIRECTS = 3;

/** Reads as a bot wall rather than a job page. */
const CHALLENGE_MARKERS = [
  /just a moment/i,
  /checking your browser/i,
  /cf-browser-verification|cf_chl_|__cf_chl/i,
  /enable javascript and cookies to continue/i,
  /access denied.{0,40}reference #/is,
  /px-captcha|perimeterx/i,
  /captcha/i,
];

const BOARD_LABEL = {
  linkedin: 'LinkedIn', naukri: 'Naukri', instahyre: 'Instahyre',
  indeed: 'Indeed', wellfound: 'Wellfound',
  greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby',
};

/**
 * A refusal, phrased for the person who pasted the link.
 *
 * `blocked` is the important one: it is not an error on our side or theirs, it
 * is a board declining an automated request, and the honest next step is the
 * paste box. It says so.
 */
function refusal(reason, detail, { board, canPaste = true, status } = {}) {
  return { ok: false, reason, detail, board, canPaste, status };
}

function blockedByBoard(board, status) {
  const name = BOARD_LABEL[board] || 'That site';
  return refusal(
    'blocked_by_site',
    `${name} does not allow this page to be opened by software, so we cannot read it for you. `
    + 'Open the job, copy the description, and paste it instead — that works on every board '
    + 'and gives exactly the same result.',
    { board, canPaste: true, status }
  );
}

/**
 * Fetch a URL with every bound applied. Redirects are followed MANUALLY so the
 * address can be re-validated at each hop: axios's own follower would happily
 * take a public URL's 302 into 127.0.0.1.
 */
async function fetchWithGuards(startUrl, { http = axios, resolver } = {}) {
  let url = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return refusal('bad_redirect', 'That link redirected somewhere we could not read.');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return refusal('bad_redirect', `That link redirected to a ${parsed.protocol.replace(':', '')} address, which cannot be opened.`);
    }

    // Re-checked on EVERY hop, not only the first.
    const host = await assertPublicHost(parsed.hostname, resolver);
    if (!host.ok) return refusal(host.reason, host.detail);

    let res;
    try {
      res = await http.get(url, {
        timeout: TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: MAX_BYTES,
        responseType: 'text',
        decompress: true,
        validateStatus: () => true,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-IN,en;q=0.9',
        },
      });
    } catch (err) {
      const code = err && err.code;
      if (code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')) {
        return refusal('timeout', `That site did not answer within ${TIMEOUT_MS / 1000} seconds. It may be slow or down right now.`);
      }
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        return refusal('dns_failed', `No server was found at ${parsed.hostname}. Check the address for a typo.`);
      }
      if (code === 'ECONNREFUSED' || code === 'ECONNRESET') {
        return refusal('connection_refused', `${parsed.hostname} refused the connection.`);
      }
      if (/maxContentLength/i.test(err?.message || '')) {
        return refusal('too_large', 'That page is larger than 2 MB, which is too big to read as a job posting.');
      }
      return refusal('network_error', `Could not reach ${parsed.hostname}: ${String(err?.message || 'unknown network error').slice(0, 120)}.`);
    }

    const status = res.status;

    if (status >= 300 && status < 400) {
      const location = res.headers?.location;
      if (!location) return refusal('bad_redirect', 'That link redirected without saying where to.');
      url = new URL(location, url).toString();
      continue;                                   // re-validated at the top
    }

    if (status === 401 || status === 403) return { ...blockedByBoard(null, status), status };
    if (status === 429) {
      return refusal('rate_limited', 'That site is asking us to slow down. Wait a minute and try again, or paste the description instead.', { status });
    }
    if (status === 404 || status === 410) {
      return refusal('not_found', 'That job posting no longer exists at that address — it may have been filled or taken down.', { status });
    }
    if (status >= 500) {
      return refusal('site_error', `That site returned an error (${status}). It is a problem on their side, not with the link.`, { status });
    }
    if (status !== 200) {
      return refusal('unexpected_status', `That site answered with status ${status}, which we do not know how to read.`, { status });
    }

    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
    if (body.length > MAX_BYTES) {
      return refusal('too_large', 'That page is larger than 2 MB, which is too big to read as a job posting.');
    }

    return {
      ok: true,
      status,
      finalUrl: url,
      contentType: String(res.headers?.['content-type'] || ''),
      body,
    };
  }

  return refusal('too_many_redirects', 'That link redirected too many times to follow.');
}

/**
 * The whole path: classify, refuse what must be refused, fetch, and detect a
 * challenge page so a wall is never mistaken for a posting.
 */
async function fetchJobUrl(rawUrl, deps = {}) {
  const classified = classifyJobUrl(rawUrl);
  if (!classified.ok) return refusal(classified.reason, classified.detail, { canPaste: classified.reason !== 'empty' });

  const target = classified.via === 'public_api' ? classified.apiUrl : classified.url;
  const res = await fetchWithGuards(target, deps);

  if (!res.ok) {
    // Name the board on a refusal that came from one.
    if (res.reason === 'blocked_by_site') return { ...blockedByBoard(classified.board, res.status), classified };
    return { ...res, board: classified.board, classified };
  }

  /*
   * A 200 that is a bot wall is still a refusal - and it is the one that would
   * otherwise be parsed into a job called "Just a moment...". Checked only for
   * HTML, because a JSON API response legitimately contains none of this and a
   * posting could genuinely mention the word captcha.
   */
  if (classified.via === 'html' && CHALLENGE_MARKERS.some((re) => re.test(res.body.slice(0, 4000)))) {
    return { ...blockedByBoard(classified.board, 200), classified, challenge: true };
  }

  return { ...res, board: classified.board, via: classified.via, classified };
}

/*
 * `fetchWithGuards` and `refusal` are NOT exported, deliberately.
 *
 * The guard-wiring census counts only cross-file callers - "internal use is
 * not wiring" - and it is right to. Exporting them put two guards on the
 * census with no live caller, which is indistinguishable from a guard nothing
 * runs. They are reached the only way that proves anything: through
 * fetchJobUrl, which routes/jobs.js calls.
 *
 * The redirect test drives them through fetchJobUrl too, with an injected http
 * client and resolver. That is a better test than calling fetchWithGuards
 * directly, because it exercises the path production uses.
 */
module.exports = {
  fetchJobUrl, USER_AGENT,
  TIMEOUT_MS, MAX_BYTES, MAX_REDIRECTS, CHALLENGE_MARKERS, BOARD_LABEL,
};
