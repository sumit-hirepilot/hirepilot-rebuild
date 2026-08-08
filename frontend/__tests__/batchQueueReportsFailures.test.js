/*
 * Feature 6 — a batch that partly failed must not report as a batch that
 * succeeded.
 *
 * `POST /api/apply/queue` returns `preparationFailed: [{jobId, title, reason}]`
 * and the Jobs page read none of it. A batch of fifteen where three failed to
 * prepare said "Prepared 12 applications" and stopped there: the user goes to
 * Ready to send, finds twelve, and has no way to learn which three are missing
 * or why.
 *
 * Same shape as D52 - the receipt reported its own failure into a field nobody
 * read - and the same consequence: nothing on screen distinguishes a partial
 * failure from a complete success.
 *
 * Preparing is also slow (a tailored resume, a cover letter and the screening
 * answers per job, five at a time), and the button stayed live throughout, so
 * a second click re-sent the whole batch.
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'pages', 'jobs.js'), 'utf8');
const handler = src.slice(src.indexOf('const handleQueue'), src.indexOf('const handleRefresh'));

describe('the batch result is reported in full', () => {
  it('reads preparationFailed at all', () => {
    expect(handler).toMatch(/preparationFailed/);
  });

  it('puts the failures in the message the user sees', () => {
    // Not merely destructured and dropped - it has to reach the banner the
    // user sees. The message setter is flashMessage now (L6, so an error is
    // styled and scrolled into view); the anchor follows it.
    const setter = handler.includes('flashMessage(') ? 'flashMessage(' : 'setMessage(';
    const messageCall = handler.slice(handler.indexOf(setter), handler.length);
    expect(messageCall).toMatch(/failedText/);
  });

  it('names the reason, not just a count', () => {
    expect(handler).toMatch(/f\.reason/);
  });

  it('still names the job when the title is missing', () => {
    // A failure attributed to nothing is a failure nobody can chase.
    expect(handler).toMatch(/f\.title \|\|/);
  });

  it('caps the list so a wholly failed batch is not a wall of text', () => {
    expect(handler).toMatch(/slice\(0, 3\)/);
    expect(handler).toMatch(/more/);
  });
});

describe('preparing cannot be started twice', () => {
  it('returns early while a batch is in flight', () => {
    expect(handler).toMatch(/if \(queueing\) return/);
  });

  it('clears the busy state even when the request throws', () => {
    // Without the finally, one failed batch disables the button for good.
    expect(handler).toMatch(/finally\s*\{\s*setQueueing\(0\)/);
  });

  it('both queue buttons are disabled while preparing', () => {
    const disabled = [...src.matchAll(/disabled=\{queueing > 0\}/g)];
    expect(disabled.length).toBeGreaterThanOrEqual(2);
  });

  it('the bulk button says how many it is preparing', () => {
    // "Preparing 12…" is a different promise from an unlabelled spinner.
    expect(src).toMatch(/Preparing \$\{queueing\}/);
  });
});
