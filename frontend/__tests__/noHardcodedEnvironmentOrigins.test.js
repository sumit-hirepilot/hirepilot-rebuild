/*
 * No frontend source file names a deployed environment.
 *
 * Two of them did, and both survived a migration to a new Railway account
 * without looking wrong on screen:
 *
 *   lib/apiBase.js   fell back to a specific deployed BACKEND, so a build with
 *                    NEXT_PUBLIC_API_URL missing would sign users in, score
 *                    jobs and queue applications against another environment's
 *                    database, with only a console warning
 *   pages/index.js   carried its own second copy of that fallback for the
 *                    landing stats, and named a specific deployed FRONTEND in
 *                    og:url and og:image, so links shared from the new site
 *                    pointed people back at the old one
 *
 * The shape of the defect is that a hostname is correct on exactly one
 * deployment and silently wrong on every other, and nothing renders an error.
 * Configuration belongs in the environment; this fails if it goes back in the
 * source.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.next', '__tests__', 'coverage', 'public']);

/* Deployed hosts, not URLs in general: docs links, schema.org ids and
 * job-board URLs are content, not configuration. */
const DEPLOYED_HOST = /https?:\/\/[a-z0-9-]+\.(?:up\.railway\.app|railway\.app|vercel\.app)/gi;

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('a deployed environment is never named in frontend source', () => {
  it('no page, component or lib hardcodes a Railway host', () => {
    const offenders = [];

    for (const file of sourceFiles(ROOT)) {
      const src = fs.readFileSync(file, 'utf8');
      const hits = src.match(DEPLOYED_HOST);
      if (hits) {
        offenders.push(`${path.relative(ROOT, file)}: ${[...new Set(hits)].join(', ')}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the only fallback API origin is a local one', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'apiBase.js'), 'utf8');
    const fallback = src.match(/DEV_FALLBACK\s*=\s*'([^']+)'/);

    expect(fallback).not.toBeNull();
    expect(fallback[1]).toMatch(/^https?:\/\/localhost/);
  });

  it('a production build refuses to run without NEXT_PUBLIC_API_URL', () => {
    /*
     * Asserted against next.config.js because that is where the check can
     * actually fire. The `env` block fills the variable in, so it is never
     * empty by the time lib/apiBase reads it - a guard there is unreachable,
     * which is exactly what a first attempt at this got wrong.
     *
     * Behaviour, not text: the exported config is called with the build phase
     * and has to throw.
     */
    const { PHASE_PRODUCTION_BUILD, PHASE_DEVELOPMENT_SERVER } = require('next/constants');
    const config = require('../next.config.js');
    const before = process.env.NEXT_PUBLIC_API_URL;

    try {
      delete process.env.NEXT_PUBLIC_API_URL;

      expect(() => config(PHASE_PRODUCTION_BUILD)).toThrow(/NEXT_PUBLIC_API_URL/);

      // ...and development still starts, or this would just be friction.
      const dev = config(PHASE_DEVELOPMENT_SERVER);
      expect(dev.env.NEXT_PUBLIC_API_URL).toMatch(/^https?:\/\/localhost/);

      // A production build WITH a value is fine.
      process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test';
      expect(config(PHASE_PRODUCTION_BUILD).env.NEXT_PUBLIC_API_URL).toBe('https://api.example.test');
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_API_URL;
      else process.env.NEXT_PUBLIC_API_URL = before;
    }
  });
});
