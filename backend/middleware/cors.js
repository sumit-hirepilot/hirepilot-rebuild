/*
 * Who is allowed to read this API's responses from a browser.
 *
 * This was `app.use(cors())`, which answers `Access-Control-Allow-Origin: *`
 * on every route, authenticated ones included. That tells every browser that
 * any page on any domain may read any response it can provoke.
 *
 * Scale of it, stated honestly: auth here is a Bearer token out of local
 * storage, not a cookie, so a browser does not attach credentials to a
 * cross-site request on its own and a drive-by page cannot borrow a signed-in
 * session. The wildcard was therefore not a live CSRF hole, and this is
 * defence in depth rather than an incident fix. It is still wrong to ship: the
 * wildcard is what turns "an attacker got a token" or "the app moved to
 * cookies" from a contained problem into a general one, and it costs nothing
 * to name the one origin that actually needs access.
 *
 * The list comes from FRONTEND_URL, which already existed in .env.example and
 * was read nowhere. It takes a comma-separated list because more than one
 * frontend is live during the Railway migration.
 *
 * Two deliberate choices:
 *
 * 1. A refused origin gets a normal response with NO allow header, not a 403.
 *    The browser is the thing enforcing this, and it enforces by refusing to
 *    hand the response to the calling page. Rejecting server-side instead would
 *    turn every non-browser caller - curl, the health probe, the extension's
 *    service worker - into a failure, and would buy nothing, since anyone able
 *    to set an Origin header at will is not being restrained by CORS anyway.
 *
 * 2. Matching is exact, on the parsed origin. Substring, prefix and suffix
 *    matching are the usual way an allowlist like this is walked around:
 *    `startsWith(FRONTEND_URL)` also accepts `https://<app>.attacker.com`.
 */
const cors = require('cors');

// Loopback in dev only. A port is required to be optional here because Next
// picks 3001 whenever the API already holds 3000.
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/*
 * Reduce a configured value to a bare origin. Env vars get pasted with a
 * trailing slash, a path, or stray whitespace, and an entry that silently never
 * matches is the kind of thing that is discovered in production by the frontend
 * being down.
 */
function normaliseOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // Without this, `localhost:3000` parses with protocol `localhost:` and an
    // origin of the STRING "null", which would then match a sandboxed frame's
    // `Origin: null`.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function allowedOrigins(env = process.env) {
  return String(env.FRONTEND_URL || '')
    .split(',')
    .map(normaliseOrigin)
    .filter(Boolean);
}

function isAllowedOrigin(origin, env = process.env) {
  if (!origin) return false;
  if (allowedOrigins(env).includes(origin)) return true;
  return env.NODE_ENV !== 'production' && LOOPBACK.test(origin);
}

const corsOptions = {
  /*
   * Read at request time, not at module load, so the deployed process picks up
   * a corrected FRONTEND_URL on restart rather than on redeploy - and so this
   * is testable without re-importing the whole app per case.
   */
  origin(origin, callback) {
    // No Origin header: not a browser cross-origin request at all. The health
    // probe and the extension's service worker both land here.
    if (!origin) return callback(null, true);
    callback(null, isAllowedOrigin(origin));
  },
  /*
   * Not `credentials: true`. Auth is a Bearer header the frontend attaches
   * itself; no cookie is set and none should be sent. Turning this on would
   * also be the thing that makes the old wildcard genuinely dangerous, so it
   * stays off until something actually needs it.
   */
};

module.exports = {
  corsMiddleware: cors(corsOptions),
  corsOptions,
  isAllowedOrigin,
  allowedOrigins,
  normaliseOrigin,
};
