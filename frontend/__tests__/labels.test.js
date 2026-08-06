/*
 * A7.4 — a map with a hole in it is not a map.
 *
 * Every surface but the activity feed used `LABELS[key] || key`. That reads as
 * a safe fallback and is the opposite: the day the server adds a status, the
 * raw token renders and no test fails. The inbox did not even have the map -
 * it rendered {m.category} directly.
 */

import { humanise, labelFor } from '../lib/labels';

describe('A7.4 — an unmapped key still reads as English', () => {
  it.each([
    ['phone_screen', 'Phone screen'],
    ['technical_interview', 'Technical interview'],
    ['pending_review', 'Pending review'],
    ['needs_user', 'Needs user'],
    ['application_submitted', 'Application submitted'],
    ['ready-for-review', 'Ready for review'],
    ['trackerStage', 'Tracker stage'],
    ['offer', 'Offer'],
  ])('renders %s as %s', (key, expected) => {
    expect(humanise(key)).toBe(expected);
  });

  it('never gives a separator-carrying token back unchanged', () => {
    for (const k of ['phone_screen', 'needs_user', 'a-b-c', 'someCamelKey']) {
      expect(labelFor(k)).not.toBe(k);
      expect(labelFor(k)).not.toMatch(/[_-]/);
    }
  });

  it('prefers an explicit label, because wording matters', () => {
    // "hackernews" must not become "Hackernews", and an acronym must survive.
    expect(labelFor('hackernews', { hackernews: 'HN Who’s Hiring' })).toBe('HN Who’s Hiring');
    expect(labelFor('ats_score', { ats_score: 'ATS score' })).toBe('ATS score');
  });

  it('honours a mapped empty string rather than falling through to the key', () => {
    // A label deliberately set to "" means show nothing. `map[k] || humanise(k)`
    // would ignore that and print the token instead.
    expect(labelFor('internal_only', { internal_only: '' })).toBe('');
  });

  it('returns nothing for nothing', () => {
    expect(labelFor(null)).toBe('');
    expect(labelFor(undefined)).toBe('');
    expect(labelFor('')).toBe('');
  });
});

describe('A7.4 — no surface renders a raw key', () => {
  const fs = require('fs');
  const path = require('path');
  const roots = [path.join(__dirname, '..', 'pages'), path.join(__dirname, '..', 'components')];

  function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : (e.name.endsWith('.js') ? [p] : []);
    });
  }

  it('has no LABELS[key] || key fallback anywhere', () => {
    const offenders = [];
    for (const root of roots) {
      for (const f of walk(root)) {
        const src = fs.readFileSync(f, 'utf8');
        const hits = src.match(/\w*LABELS?\[[^\]]+\]\s*\|\|\s*[a-z]\w*(\.\w+)?/g) || [];
        if (hits.length) offenders.push(`${path.basename(f)}: ${hits.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not interpolate a category or stage straight into JSX', () => {
    const offenders = [];
    for (const root of roots) {
      for (const f of walk(root)) {
        const src = fs.readFileSync(f, 'utf8');
        // `>{x.category}<` style: rendered text, not a form value or a prop.
        const hits = src.match(/>\s*\{\s*\w+\.(category|tracker_stage|stage|event_type)\s*\}/g) || [];
        if (hits.length) offenders.push(`${path.basename(f)}: ${hits.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
