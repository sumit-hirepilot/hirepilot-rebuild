/*
 * A7.4 — the activity feed is read by a person.
 *
 * `default: return row.event_type` put the raw key on screen, so a user saw
 * `application_submitted`. Six types reached that branch, one of which
 * (`application_queued`) A1 introduced and never mapped - a defect added by a
 * fix.
 *
 * This binds the formatter to the events the backend ACTUALLY writes, so the
 * next event type added without a sentence fails here rather than surfacing as
 * a key on the dashboard.
 */

const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '..', 'routes');
const SERVICES = path.join(__dirname, '..', 'services');

/** Every event_type string the backend inserts into activity_log. */
function writtenEventTypes() {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) files.push(full);
    }
  };
  walk(ROUTES); walk(SERVICES);

  const found = new Set();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // INSERT INTO activity_log (...) VALUES ($1, 'event_name', ...)
    for (const m of src.matchAll(/activity_log[\s\S]{0,240}?VALUES\s*\([^)]*?'([a-z_]+)'/g)) {
      found.add(m[1]);
    }
  }
  return found;
}

const activitySrc = fs.readFileSync(path.join(ROUTES, 'activity.js'), 'utf8');
const handled = new Set(
  [...activitySrc.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1])
);

describe('A7.4 — every event the backend writes has a sentence', () => {
  const written = writtenEventTypes();

  it('finds the events actually written', () => {
    // A scan that finds nothing would make the check below vacuous.
    expect(written.size).toBeGreaterThan(3);
    expect(handled.size).toBeGreaterThan(5);
  });

  it('handles every written event type explicitly', () => {
    const unmapped = [...written].filter((e) => !handled.has(e));
    expect(unmapped).toEqual([]);
  });

  it('never falls back to the raw event key', () => {
    // The whole defect: `default: return row.event_type`.
    const def = activitySrc.slice(activitySrc.indexOf('default:'));
    expect(def).not.toMatch(/return\s+row\.event_type\s*;/);
  });
});

describe('A7.4 — a line names the employer, not just the role', () => {
  // Loaded after the source checks so a syntax error surfaces as a clear
  // failure rather than a missing export.
  const { formatActivity } = require('../routes/activity');

  const row = (over = {}) => ({
    event_type: 'application_retried', metadata: {},
    job_title: 'UX Designer Senior', company_name: 'Valtech', ...over,
  });

  it('names the company on a retry', () => {
    // "Retried application to UX Designer Senior" is not actionable when the
    // user has three of those.
    expect(formatActivity(row())).toContain('Valtech');
  });

  it('names the company from metadata when the row has no join', () => {
    const out = formatActivity(row({
      job_title: null, company_name: null,
      metadata: { job_title: 'Staff Product Designer', company_name: 'Okta' },
    }));
    expect(out).toContain('Okta');
  });

  it('degrades to a readable phrase when nothing is known', () => {
    const out = formatActivity(row({ job_title: null, company_name: null }));
    expect(out).not.toMatch(/undefined|null|\[object/);
    expect(out.length).toBeGreaterThan(10);
  });
});
