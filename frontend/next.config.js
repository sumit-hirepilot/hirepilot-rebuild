const { PHASE_PRODUCTION_BUILD } = require('next/constants');

/*
 * NEXT_PUBLIC_API_URL is baked into the client bundle at build time, so the
 * build is the last moment it can be checked. After that it is a string inside
 * shipped JavaScript and no runtime setting can change it.
 *
 * This block used to read:
 *
 *   NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
 *
 * which meant the variable was never actually absent, and a PRODUCTION build
 * that forgot it shipped `http://localhost:3000` to every visitor's browser -
 * every API call going to a machine that is not ours, failing in a way that
 * looks like the user's network rather than our build. The default also made
 * the fallback in lib/apiBase.js unreachable, so the intended safety net there
 * had never once run.
 *
 * A production build now fails instead. Development keeps the local default,
 * where guessing wrong costs nothing and reaching for a config file to start
 * work is friction for no gain.
 */
module.exports = (phase) => {
  const configured = process.env.NEXT_PUBLIC_API_URL;

  if (phase === PHASE_PRODUCTION_BUILD && !configured) {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set, and this is a production build.\n\n'
      + 'It is compiled into the client bundle, so it cannot be corrected later by '
      + 'setting it on the running service. Refusing to guess: the old default was '
      + 'http://localhost:3000, which ships an app that calls the visitor\'s own '
      + 'machine, and naming a deployed backend instead would point this build at '
      + "another environment's database.\n\n"
      + 'Pass it as a build arg - docker/Dockerfile.frontend forwards it - or export '
      + 'it before running `next build`.'
    );
  }

  /** @type {import('next').NextConfig} */
  return {
    reactStrictMode: true,
    env: {
      NEXT_PUBLIC_API_URL: configured || 'http://localhost:3000',
      // Optional. Absent means the social tags are omitted rather than pointed
      // at whichever deployment happened to be written down; see lib/siteUrl.js.
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || '',
    },
  };
};
