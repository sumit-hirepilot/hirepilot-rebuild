/*
 * Feature 9, boundary honesty — the paste preview shows what was NOT saved.
 *
 * The parser separates demographic questions and never stores them, because
 * the product must never auto-answer them and the reliable guarantee is to
 * hold no answer to fill from. A pasted block will contain them: the forms
 * people copy from contain them.
 *
 * If the page rendered only the pairs it understood, a user pasting twelve
 * answers would see ten and have no idea the other two were refused or why -
 * the same shape as preparationFailed on the Jobs page and needsConfirmation
 * on the Tailor tab, which is now three times in this codebase. Asserted as
 * the feature is built rather than swept for afterwards.
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'pages', 'resume.js'), 'utf8');
const parse = src.slice(src.indexOf('const handleParsePaste'), src.indexOf('const handleSavePaste'));
const save = src.slice(src.indexOf('const handleSavePaste'), src.indexOf('const loadHistory') > 0
  ? src.length : src.length);

describe('the refusals reach the screen', () => {
  it('renders preview.refused, not only the pairs', () => {
    expect(src).toMatch(/preview\.refused\?\.length > 0/);
    expect(src).toMatch(/preview\.refused\.map/);
  });

  it('shows the server\'s reason for each refusal', () => {
    // The question alone does not tell the user why, or what to do instead.
    expect(src).toMatch(/\{r\.detail\}/);
  });

  it('says how many were left for the user to answer', () => {
    expect(src).toMatch(/left for you to answer yourself/i);
  });

  it('surfaces the clamps too', () => {
    // A truncated paste that says nothing reads as "that is all there was".
    expect(src).toMatch(/preview\.clamped/);
    expect(src).toMatch(/preview\.truncatedPairs/);
  });
});

describe('nothing is written before it has been seen', () => {
  it('parse and save are separate actions', () => {
    expect(src).toMatch(/screening-answers\/parse/);
    expect(src).toMatch(/screening-answers\/bulk/);
  });

  it('save is only reachable once a preview exists', () => {
    expect(save).toMatch(/!preview\?\.pairs\?\.length/);
  });

  it('posts back the previewed pairs, not the raw paste', () => {
    // Saving the raw text again would re-parse server-side and could save
    // something different from what was shown.
    expect(save).toMatch(/pairs: preview\.pairs/);
  });
});

describe('the paste actions cannot be double-fired', () => {
  it('parse guards on its own in-flight flag', () => {
    expect(parse).toMatch(/if \(parsing/);
  });

  it('save guards on its own in-flight flag', () => {
    expect(save).toMatch(/if \(savingPaste/);
  });

  it('both clear their busy state even when the request throws', () => {
    expect(parse).toMatch(/finally\s*\{\s*setParsing\(false\)/);
    expect(save).toMatch(/finally\s*\{\s*setSavingPaste\(false\)/);
  });
});

describe('a failure is never an empty box', () => {
  it('falls back through detail, error, then the status code', () => {
    expect(parse).toMatch(/data\.detail \|\| data\.error \|\|/);
    expect(save).toMatch(/data\.detail \|\| data\.error \|\|/);
  });
});
