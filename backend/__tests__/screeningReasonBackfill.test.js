/*
 * A7.4b — the reasons already written to the database.
 *
 * A7.4 fixed the generator and verified it at the API. The page kept showing
 * the old sentence, because PATCH /api/apply/queue/:id/questions PERSISTS each
 * reason into applications.screening_answers, so every row written before the
 * fix carries its own frozen copy. Reproduced on production:
 * GET /api/apply/blockers returns 8 affected questions across 6 applications.
 *
 * Recomputed, not patched. The stored question carries `suggestion` - the
 * saved answer, which is exactly what the generator names - so the corrected
 * sentence is built by the same function the generator calls. Pattern-matching
 * the old text to edit it in place would be surgery on user data that no test
 * could verify.
 */

const fs = require('fs');
const path = require('path');
const {
  correctedReason, optionMismatchReason, OPTION_MISMATCH_LEGACY,
} = require('../services/screeningPrefill');

describe('A7.4b — the corrected sentence is regenerated, not edited', () => {
  const legacy = { reason: 'Your saved answer to "gender" is not one of this form\'s options.',
    suggestion: 'Decline To Self Identify', answer: null };

  it('rebuilds the reason from the saved answer', () => {
    expect(correctedReason(legacy)).toBe(optionMismatchReason('Decline To Self Identify'));
    expect(correctedReason(legacy)).not.toMatch(/gender/);
    expect(correctedReason(legacy)).not.toMatch(/_/);
  });

  it('uses the generator\'s own builder, so the two cannot diverge', () => {
    // If the generator's wording changes, the corrector produces the new
    // wording without being touched.
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'screeningPrefill.js'), 'utf8');
    const literals = src.match(/`Your saved answer \([^`]*`/g) || [];
    expect(literals).toHaveLength(1); // only inside optionMismatchReason
    expect(src).toMatch(/reason: optionMismatchReason\(similar\.answer\)/);
    expect(src).toMatch(/reason: optionMismatchReason\(rendered\)/);
  });

  it('leaves every other reason alone', () => {
    for (const reason of [
      'No saved answer covers this question.',
      'This is a legal attestation or consent - only you can answer it.',
      'Closest saved answer is only 43% confident - confirm it rather than guess.',
    ]) {
      expect(correctedReason({ reason, suggestion: 'x' })).toBeNull();
    }
  });

  it('declines to guess when there is no saved answer to name', () => {
    // Better a stale sentence than an invented one.
    expect(correctedReason({ ...legacy, suggestion: null })).toBeNull();
    expect(correctedReason({ ...legacy, suggestion: '  ' })).toBeNull();
  });

  it('is idempotent, so a redeploy changes nothing', () => {
    const once = correctedReason(legacy);
    expect(correctedReason({ ...legacy, reason: once })).toBeNull();
  });

  it('matches the legacy shape exactly, not merely loosely', () => {
    // Anchored. An unanchored match would also fire on a sentence that merely
    // contains this one, and rewrite something it was never meant to touch.
    expect(OPTION_MISMATCH_LEGACY.test('Your saved answer to "x" is not one of this form\'s options.')).toBe(true);
    expect(OPTION_MISMATCH_LEGACY.test('Note: Your saved answer to "x" is not one of this form\'s options. Also...')).toBe(false);
  });
});

describe('A7.4b — the backfill records before it changes, and touches only reasons', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'migrations.js'), 'utf8');

  it('exists and is wired into the boot path', () => {
    expect(src).toMatch(/backfillScreeningReasons/);
    expect(src).toMatch(/await backfillScreeningReasons\(\)/);
  });

  it('records what it changed before changing it', () => {
    // A5's lesson, and A7.2's: a corrector that keeps no record makes who was
    // affected unknowable - and A7.2's own record was the only reason we
    // learned that correction had never applied.
    const fn = src.slice(src.indexOf('const backfillScreeningReasons'));
    const record = fn.indexOf('data_corrections');
    const update = fn.search(/UPDATE applications/);
    expect(record).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(-1);
    expect(record).toBeLessThan(update);
    expect(fn).toMatch(/a7\.4b-screening-reason/);
  });

  it('writes back only screening_answers', () => {
    const fn = src.slice(src.indexOf('const backfillScreeningReasons'));
    const upd = fn.slice(fn.search(/UPDATE applications/), fn.search(/UPDATE applications/) + 260);
    expect(upd).toMatch(/SET screening_answers/);
    expect(upd).not.toMatch(/status|answer\s*=|is_active|DELETE/);
  });
});
