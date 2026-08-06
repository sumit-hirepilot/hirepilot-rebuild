/*
 * Every value read from a request is unbounded until proven otherwise.
 *
 * GET /api/jobs?limit=100&page=250 is OFFSET 24,900 over a CTE that ranks the
 * whole index. Three of those took production down for eight minutes, and it
 * needed a redeploy to come back. `page` and `limit` were read off the query
 * string and used directly - no ceiling, no validation, nothing between a URL
 * bar and the database.
 *
 * That was not a paging bug. It was a denial of service, and it was one
 * instance of a class: minScore, free-text search, limits on five other
 * endpoints, all read the same way. So the bound lives here, once, and every
 * endpoint uses it - fixing the instance in routes/jobs.js would have left the
 * other six exactly as they were.
 *
 * Two rules throughout:
 *
 *   CLAMP, DO NOT REFUSE. A 400 on limit=1000 teaches a caller nothing and
 *   breaks a client that was working; a clamped 200 keeps working and is
 *   honest about what it did.
 *
 *   STATE THE CLAMP. A response that silently hands back 100 rows when 1,000
 *   were asked for is indistinguishable from a database with only 100 rows,
 *   and a client will page forever into results it will never be given.
 */

/** Ceilings. Deliberately in one place so they cannot drift per endpoint. */
const LIMITS = {
  maxLimit: 100,      // rows per page, any endpoint
  maxOffset: 5000,    // deepest row reachable by paging
  maxTextLength: 200, // free-text search, company, location
};

/**
 * A whole number inside [min, max], with the default used for anything
 * unparseable. NaN, Infinity, '1e9', arrays and objects all land on the
 * default rather than propagating into SQL.
 */
/*
 * An ABSENT parameter is not the number zero. `?limit=` and a missing `limit`
 * both mean "not supplied", but Number('') and Number(null) are both 0, which
 * is finite - so an empty parameter clamped to the minimum and `?limit=` served
 * one row per page. Caught by the test for unparseable input, which is the
 * argument for listing the junk values explicitly rather than assuming.
 */
const absent = (v) => v === '' || v === null || v === undefined;

function boundInt(raw, { def, min = 1, max }) {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const n = absent(first) ? NaN : Math.floor(Number(first));
  const usable = Number.isFinite(n);
  const value = usable ? Math.min(Math.max(n, min), max) : def;
  return {
    value,
    requested: usable ? n : def,
    clamped: usable && (n > max || n < min),
  };
}

/** A number inside [min, max] - scores and ratios rather than counts. */
function boundFloat(raw, { def, min = 0, max = 1 }) {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const n = absent(first) ? NaN : Number(first);
  const usable = Number.isFinite(n);
  const value = usable ? Math.min(Math.max(n, min), max) : def;
  return { value, requested: usable ? n : def, clamped: usable && (n > max || n < min) };
}

/**
 * Free text, truncated rather than dropped.
 *
 * An unbounded search string becomes an unbounded LIKE pattern and an
 * unbounded tiering expression. Truncating keeps the query the user meant;
 * refusing throws away a search because it was long.
 */
function boundText(raw, { max = LIMITS.maxTextLength } = {}) {
  const s = String(Array.isArray(raw) ? raw[0] : (raw ?? ''));
  const value = s.slice(0, max);
  return { value, clamped: s.length > max, requestedLength: s.length };
}

/**
 * A repeated parameter: ?region=a&region=b. Bounded on COUNT as well as on each
 * value's length - the same name repeated a thousand times builds a
 * thousand-branch predicate from one URL, which is the page/limit lesson in a
 * different shape.
 */
function boundList(raw, { maxItems = 25, maxLength = 80 } = {}) {
  const arr = Array.isArray(raw) ? raw : (raw == null || raw === '' ? [] : [raw]);
  const value = arr.slice(0, maxItems).map((v) => boundText(v, { max: maxLength }).value).filter(Boolean);
  return { value, requested: arr.length, clamped: arr.length > maxItems };
}

/** One of a known set, or the default. Never the caller's string. */
function boundEnum(raw, allowed, def) {
  const s = String(Array.isArray(raw) ? raw[0] : (raw ?? ''));
  const ok = allowed.includes(s);
  return { value: ok ? s : def, requested: s, clamped: Boolean(s) && !ok };
}

/**
 * page + limit together, because the ceiling on page depends on the limit -
 * what has to be bounded is the OFFSET, which is the product.
 */
function boundPaging(rawPage, rawLimit, { defLimit = 20, maxLimit = LIMITS.maxLimit, maxOffset = LIMITS.maxOffset } = {}) {
  const limit = boundInt(rawLimit, { def: defLimit, min: 1, max: maxLimit });
  const maxPage = Math.max(1, Math.floor(maxOffset / limit.value));
  const page = boundInt(rawPage, { def: 1, min: 1, max: maxPage });

  return {
    page: page.value,
    limit: limit.value,
    offset: (page.value - 1) * limit.value,
    maxPage,
    requestedPage: page.requested,
    clamped: page.clamped,
    limitClamped: limit.clamped,
  };
}

/**
 * Collapse a set of bound results into what the response should say. Only the
 * ones that actually clamped, so a normal request carries no noise and a
 * clamped one cannot be mistaken for a normal one.
 */
function clampReport(entries) {
  const out = {};
  for (const [name, r] of Object.entries(entries)) {
    if (r && r.clamped) out[name] = { requested: r.requested ?? r.requestedLength, applied: r.value };
  }
  return Object.keys(out).length ? out : null;
}

module.exports = {
  LIMITS, boundInt, boundFloat, boundText, boundEnum, boundList, boundPaging, clampReport,
};
