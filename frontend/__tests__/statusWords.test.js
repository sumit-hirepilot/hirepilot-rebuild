/*
 * Wave C — every status reads as something a person would say.
 */

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

  it('is plain about a failure and says it can be retried', () => {
    expect(statusWord('failed')).toBe('Did not send');
    expect(statusHint('failed')).toMatch(/nothing reached the employer/i);
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
