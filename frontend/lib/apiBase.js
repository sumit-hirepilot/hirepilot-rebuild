/*
 * The API origin, in one place.
 *
 * Every page read process.env.NEXT_PUBLIC_API_URL directly, and some had a
 * fallback while others did not. When the variable was absent from the bundle,
 * the ones without it fetched `undefined/api/profile` - which resolves to
 * http://localhost:3010/undefined/api/profile, returns 404, and lands in the
 * `.catch(() => null)` every call site has. So the pages rendered their loading
 * state forever with no error, no failed request in view, and nothing thrown.
 *
 * A missing environment variable should not be able to do that quietly. One
 * module, one fallback, and a warning when the variable is missing so the next
 * person sees the cause instead of a blank screen.
 */

const FALLBACK = 'https://hirepilot-production-e70d.up.railway.app';

const configured = process.env.NEXT_PUBLIC_API_URL;

if (typeof window !== 'undefined' && !configured) {
  // eslint-disable-next-line no-console
  console.warn(
    `[HirePilot] NEXT_PUBLIC_API_URL is not set in this build - falling back to ${FALLBACK}. `
    + 'If you meant to point at a different API, set it in frontend/.env.local and restart the dev server.'
  );
}

export const API_BASE = configured || FALLBACK;

export default API_BASE;
