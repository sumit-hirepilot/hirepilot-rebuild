/*
 * A7.25 — the landing page must be true, and it must be finishable.
 *
 * Every claim below was reproduced against the live page before it was
 * written:
 *   - Layout renders <a href="/#features">Features</a>; the only id on the
 *     landing page is "pipeline", so the one nav link goes nowhere.
 *   - <title> says "Job Search on Autopilot"; og:title says "job search with
 *     the numbers shown". One page, two products.
 *   - The hero says "actually on autopilot" while the tracker section says
 *     applications sit "in your review queue waiting for your approval".
 *   - The FAQ asks "Is there a cost?" and there is no pricing page.
 *   - The footer has a tagline and a copyright line. No privacy policy, no
 *     terms, no refund policy, no contact.
 */

const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const pages = path.join(__dirname, '..', 'pages');
const exists = (f) => fs.existsSync(path.join(pages, f));

/*
 * Comments stripped before any copy assertion.
 *
 * The first version of this file matched raw source, so the comment explaining
 * WHY "actually on autopilot" was removed made the guard fail as if the phrase
 * were still on screen - and the checkout guard tripped on the word "receipt"
 * inside a comment saying a receipt must never be rendered. A guard that reads
 * prose is testing the wrong text; these read what a user sees.
 */
const stripComments = (src) => src
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

const layout = stripComments(read('components', 'Layout.js'));
const landing = stripComments(read('pages', 'index.js'));

describe('A7.25 — every anchor lands somewhere', () => {
  it('has no nav link pointing at an id the target page does not define', () => {
    /*
     * The rule, not the instance: collect every in-page anchor the shared
     * layout renders and require the landing page to define that id. A nav
     * item that scrolls nowhere is a dead control, which is the A7.1 class.
     */
    const anchors = [...layout.matchAll(/href="\/?#([a-z0-9-]+)"/g)].map((m) => m[1]);
    const ids = new Set([...landing.matchAll(/id="([a-z0-9-]+)"/g)].map((m) => m[1]));
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) expect([...ids]).toContain(a);
  });

  it('labels the link with what it actually reaches', () => {
    // The destination heading is "Four honest stages", and the page's own CTA
    // for the same target reads "See how it works". Two labels, one place.
    expect(layout).not.toMatch(/>Features</);
  });
});

describe('A7.25 — one product, one claim', () => {
  it('states the same product in the title and the social card', () => {
    const title = (landing.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const og = (landing.match(/property="og:title" content="([^"]*)"/) || [])[1] || '';
    const tw = (landing.match(/name="twitter:title" content="([^"]*)"/) || [])[1] || '';
    const norm = (s) => s.replace(/HirePilot|[—\-–|]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    expect(norm(title)).toBe(norm(og));
    expect(norm(tw)).toBe(norm(og));
  });

  it('does not promise autopilot on a page that also says you approve every send', () => {
    /*
     * Both statements are on the page today. The product genuinely parks
     * drafts in a review queue for approval, so the copy is what has to move -
     * never the product, and never the honest sentence.
     */
    const saysReview = /review queue|waiting for your approval/i.test(landing);
    const claimsAutopilot = /\bactually on autopilot\b/i.test(landing);
    expect(saysReview).toBe(true);
    expect(claimsAutopilot).toBe(false);
  });
});

describe('A7.25 — the questions the page raises have somewhere to go', () => {
  it('has a pricing page, because the FAQ asks about cost', () => {
    expect(landing).toMatch(/Is there a cost\?/i);
    expect(exists('pricing.js')).toBe(true);
  });

  it('prices in INR first, with USD available', () => {
    // Target user is in India. INR as an afterthought is a currency toggle;
    // INR first is a product decision.
    const pricing = stripComments(read('pages', 'pricing.js'));
    expect(pricing).toMatch(/₹/);
    expect(pricing).toMatch(/INR/);
    expect(pricing).toMatch(/USD/);
    expect(pricing.indexOf('₹')).toBeLessThan(pricing.indexOf('$'));
  });

  it('offers Free, Pilot and Copilot', () => {
    const pricing = stripComments(read('pages', 'pricing.js'));
    for (const tier of ['Free', 'Pilot', 'Copilot']) {
      expect(pricing).toMatch(new RegExp(`['"\`>]${tier}\\b`));
    }
  });

  it('never meters per application, and never charges for a score', () => {
    /*
     * The product's whole argument is that the scoring is visible and
     * explainable. Charging per application would price the thing the user
     * cannot verify and meter the thing they can.
     */
    const pricing = stripComments(read('pages', 'pricing.js'));
    expect(pricing).toMatch(/never .{0,30}per application|not .{0,20}per application/i);
    expect(pricing).toMatch(/scor\w+ .{0,60}(free|every tier)/i);
  });

  it('says how to cancel, on the page that takes the money', () => {
    const pricing = stripComments(read('pages', 'pricing.js'));
    expect(pricing).toMatch(/cancel/i);
    expect(pricing).toMatch(/one click|single click|1 click/i);
  });

  it('does not imply a charge occurred at a checkout that cannot charge', () => {
    // Constraint 1 at its sharpest: a fake receipt is a fabricated record.
    const pricing = stripComments(read('pages', 'pricing.js'));
    expect(pricing).toMatch(/not (yet )?(live|active|available)|no payment|nothing (has been |was )?charged/i);
    expect(pricing).not.toMatch(/payment (successful|received)|thank you for your purchase|receipt/i);
  });
});

describe('A7.25 — the footer carries the pages a real product needs', () => {
  it.each([
    ['privacy policy', 'privacy.js'],
    ['terms of service', 'terms.js'],
    ['refund and cancellation', 'refund-policy.js'],
    ['contact', 'contact.js'],
  ])('links %s and the page exists', (_label, file) => {
    expect(exists(file)).toBe(true);
    const route = `/${file.replace(/\.js$/, '')}`;
    expect(layout).toMatch(new RegExp(`href="${route}"`));
  });

  it('writes real content, not a placeholder', () => {
    for (const f of ['privacy.js', 'terms.js', 'refund-policy.js', 'contact.js']) {
      const src = stripComments(read('pages', f));
      expect(src).not.toMatch(/lorem ipsum|TODO|coming soon|placeholder/i);
      // Text, not a stub: strip JSX and require real prose.
      const text = src.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
      expect(text.length).toBeGreaterThan(1200);
    }
  });
});

describe('A7.25 — mobile is described as what it is', () => {
  it('links no app store, because there is no app', () => {
    /*
     * BACKLOG_MOBILE.md is explicit: nothing mobile has been built, and
     * surfacing store links would be "a claim the product cannot keep".
     * WEAKENED against "surface it" - see DECISIONS.md - because the
     * full-strength version of surfacing a nonexistent app is a lie.
     */
    for (const f of fs.readdirSync(pages).filter((n) => n.endsWith('.js'))) {
      const src = stripComments(read('pages', f));
      expect(src).not.toMatch(/apps\.apple\.com|play\.google\.com|App Store|Google Play/i);
    }
  });

  it('says plainly that it runs in a mobile browser', () => {
    expect(landing).toMatch(/mobile browser|works on your phone|phone browser/i);
  });
});
