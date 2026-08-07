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
 *
 * THE FALLBACK USED TO BE A DEPLOYED BACKEND, and that stopped being safe the
 * moment a second environment existed. With one environment, guessing it meant
 * "use the only API there is". With two, it means "silently read and write the
 * OTHER environment's database" - and nothing on screen would say so. A console
 * warning is not enough for that: the app would work, sign in, score jobs and
 * queue applications, all against the wrong data.
 *
 * The check that a production build HAS a value lives in next.config.js, not
 * here, and that is not a stylistic choice. next.config.js fills this variable
 * in through its `env` block, so by the time this module reads it it is never
 * empty - a guard here would sit in code that cannot run. I wrote one anyway
 * first, along with a comment claiming `next build` would catch a missing
 * value; the build passed with nothing set, which is what showed the guard was
 * unreachable and the comment untrue.
 *
 * What remains here is the local default, for development only.
 */

const DEV_FALLBACK = 'http://localhost:3000';

const configured = process.env.NEXT_PUBLIC_API_URL;

if (typeof window !== 'undefined' && !configured) {
  // eslint-disable-next-line no-console
  console.warn(
    `[HirePilot] NEXT_PUBLIC_API_URL is not set - falling back to ${DEV_FALLBACK}. `
    + 'If you meant to point at a different API, set it in frontend/.env.local and restart the dev server.'
  );
}

export const API_BASE = configured || DEV_FALLBACK;

export default API_BASE;
