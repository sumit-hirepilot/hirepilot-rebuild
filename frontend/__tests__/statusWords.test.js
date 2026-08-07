/*
 * Wave C — every status reads as something a person would say.
 */

import fs from 'fs';
import path from 'path';
import { STATUS_WORDS, statusWord, statusHint } from '../lib/statusWords';

describe('status words', () => {
  it('never shows the stored key to a user', () => {
    for (const key of Object.keys(STATUS_WORDS)) {
      expect(statusWord(key)).not.toMatch(/[_]/);
      expect(statusWord(key)).not.toBe(key);
    }
  });

  it('humanises a status nobody wrote a line for', () => {
    // A new status must not surface as `some_new_state`.
    expect(statusWord('some_new_state')).toBe('Some new state');
    expect(statusWord('')).toBe('');
  });

  it('says who the next move belongs to, for the two that need it', () => {
    expect(statusWord('needs_user')).toMatch(/you/i);
    expect(statusWord('pending_review')).toMatch(/you/i);
  });

  it('does not claim an employer saw it before they did', () => {
    // "submitted" is about us; "waiting for the company" is about them, which
    // is the thing the user is actually asking.
    expect(statusWord('submitted')).toBe('Waiting for the company');
    expect(statusWord('applied')).toBe('Waiting for the company');
  });

  it('claims only what the failed branch actually knows', () => {
    /*
     * This required the hint to say "nothing reached the employer", and was
     * green while routes/apply.js set 'failed' in exactly one place: the
     * branch with no confirmation id and no success message - "Could not
     * verify submission ... Not marked as applied." The form may have gone
     * through. The test was pinning a certainty the code never had, and the
     * words it pinned invite a retry that can duplicate a real application.
     *
     * Grounded on the setter itself, so the words cannot outrun it again.
     */
    const apply = fs.readFileSync(
      path.join(__dirname, '..', '..', 'backend', 'routes', 'apply.js'), 'utf8'
    );
    const setter = apply.slice(apply.indexOf("SET status = 'failed'") - 400,
      apply.indexOf("SET status = 'failed'") + 400);
    expect(setter).toMatch(/!verified|Could not verify/);

    // So the words say "unconfirmed", never "did not happen".
    expect(statusWord('failed')).toBe('Not confirmed');
    expect(statusHint('failed')).toMatch(/no confirmation|not recorded as applied/i);
    expect(statusHint('failed')).not.toMatch(/nothing reached the employer|did not send/i);
  });

  it('never uses submitted, queued or pending as the word a user reads', () => {
    const jargon = /\b(submitted|queued|pending|needs_user|approved)\b/i;
    for (const key of Object.keys(STATUS_WORDS)) {
      // "Ready to send" is fine; "Approved" is not.
      expect(statusWord(key)).not.toMatch(jargon);
    }
  });
});

describe('Wave C — the surfaces use the shared words, not their own', () => {
  const fs = require('fs');
  const path = require('path');
  const { stripComments } = require('../test-utils/source');
  const read = (f) => stripComments(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));

  it('the pipeline columns come from statusWord', () => {
    const src = read('pages/applications.js');
    expect(src).toMatch(/key: 'applied', label: statusWord\('applied'\)/);
    // No hand-written column label that could drift from the queue's wording.
    expect(src).not.toMatch(/key: 'phone_screen', label: 'Phone Screen'/);
  });

  it('the queue uses statusWord rather than its own map', () => {
    expect(read('pages/apply-queue.js')).toMatch(/statusWord\(item\.status\)/);
  });

  it('the nav says plain words', () => {
    const nav = read('components/DashboardLayout.js');
    for (const jargon of ['Apply Queue', 'Search Agents', "label: 'Analytics'", "label: 'Tracker'"]) {
      expect(nav).not.toContain(jargon);
    }
    for (const plain of ['Apply for me', 'Ready to send', 'My applications', 'Saved searches']) {
      expect(nav).toContain(plain);
    }
  });
});

describe('Wave C — the page a nav item opens is titled the same thing', () => {
  const fs = require('fs');
  const path = require('path');
  const { stripComments } = require('../test-utils/source');
  const dir = path.join(__dirname, '..', 'pages');

  it('no page heading still carries the old internal name', () => {
    /*
     * The rename covered the nav and stopped there, so a tester clicking
     * "Ready to send" landed on a page titled "Apply Queue" and "Saved
     * searches" opened "Search Agents". A destination whose title contradicts
     * the label it was reached by is the A7.5 defect, one layer in.
     */
    const banned = ['Apply Queue', 'Search Agents'];
    const offenders = [];
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const src = stripComments(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const b of banned) if (src.includes(b)) offenders.push(`${f}: ${b}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('Wave C — the tab title matches the heading', () => {
  const fs = require('fs');
  const path = require('path');
  const { stripComments } = require('../test-utils/source');

  it.each([
    ['apply-queue.js', 'Ready to send'],
    ['agents.js', 'Saved searches'],
    ['analytics.js', 'How it is going'],
    ['tracker.js', 'My applications'],
  ])('%s titles the tab %s', (file, name) => {
    // A tab saying "Analytics" over a page headed "How it is going" is the
    // same contradiction as the nav mismatch, one surface further out.
    const src = stripComments(fs.readFileSync(path.join(__dirname, '..', 'pages', file), 'utf8'));
    expect(src).toMatch(new RegExp(`<title>${name} - HirePilot</title>`));
  });
});
