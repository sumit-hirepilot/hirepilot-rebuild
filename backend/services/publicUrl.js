/*
 * The app's public address, in one place, for the things we tell OTHER servers.
 *
 * Two outbound User-Agent strings carry it - the aggregator's and the one
 * jobUrlFetch sends when a signed-in user opens a job link. Both include a
 * `+https://…` contact URL, which is the convention for saying "this is a bot,
 * and here is where to complain about it". That only works if the address
 * resolves: a bot identifying itself with a dead domain is worse than one that
 * says nothing, because someone trying to reach us follows it and finds
 * nothing.
 *
 * Each file had its own copy of the address, so when the app moved to a new
 * Railway account both went stale independently. One module, one value, and it
 * follows the deployment through the environment.
 */

const DEFAULT_APP_URL = 'https://frontend-production-0d14b.up.railway.app';

const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || DEFAULT_APP_URL;

module.exports = { PUBLIC_APP_URL, DEFAULT_APP_URL };
