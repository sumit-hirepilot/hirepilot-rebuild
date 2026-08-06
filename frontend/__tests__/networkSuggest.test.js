/*
 * A7.5 — "Find contacts" issued a request and rendered nothing.
 *
 * Found by driving it on production rather than reading it: type a company,
 * click the button, one request goes out, the page does not change and no
 * error appears. POST /api/network/suggest returns
 *   { company, areIdentifiedPeople, searches: [{key,label,url}], note }
 * and the page read `data.suggestions`, which is undefined - so it set an
 * empty array and rendered the empty branch. Both halves worked; they
 * disagreed about one field name.
 *
 * Guarded as a contract between the two, not as a line: the field the page
 * reads must be a field the endpoint actually sends.
 */

const fs = require('fs');
const path = require('path');
const { stripComments } = require('../test-utils/source');

/* Comments stripped: the comment recording WHY data.suggestions was wrong
 * otherwise fails the guard that bans it. A guard reading prose tests the
 * wrong text - the same mistake this file exists to catch one layer up. */

const page = stripComments(
  fs.readFileSync(path.join(__dirname, '..', 'pages', 'network.js'), 'utf8')
);
const route = fs.readFileSync(
  path.join(__dirname, '..', '..', 'backend', 'routes', 'network.js'), 'utf8'
);

describe('A7.5 — Find contacts renders what the endpoint returns', () => {
  it('reads the field the suggest endpoint sends', () => {
    // The response key, taken from the endpoint itself rather than assumed.
    const sends = /res\.json\(\{[\s\S]{0,400}?\bsearches\b/.test(route);
    expect(sends).toBe(true);
    expect(page).toMatch(/data\.searches/);
    expect(page).not.toMatch(/data\.suggestions/);
  });

  it('renders each search with the label and link the endpoint provides', () => {
    // key/label/url are the item shape; reading a field that is not sent is
    // how this defect looked on screen - present, functional, blank.
    for (const field of ['s.key', 's.label', 's.url']) {
      expect(page).toContain(field);
    }
  });

  it('opens external searches without handing over the opener', () => {
    // These are links to LinkedIn. target=_blank without rel=noopener gives
    // the opened page a handle on this one.
    const anchors = page.match(/<a[^>]*target="_blank"[^>]*>/g) || [];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) expect(a).toMatch(/rel="[^"]*no(opener|referrer)/);
  });

  it('still says these are searches, not people it found', () => {
    // The panel used to show generated names and mutual-connection counts.
    // They were not real. The sentence saying so is load-bearing.
    expect(page).toMatch(/not people\s*\n?\s*HirePilot has identified|searches to run/i);
  });
});
