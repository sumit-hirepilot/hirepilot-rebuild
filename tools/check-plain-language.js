#!/usr/bin/env node
/*
 * The words on the surface are words the user already has.
 *
 * The target user is a job seeker in India with 1-15 years of experience, often
 * self-taught. They know "notice period" and "CTC" and "ATS score", because
 * those are the words of the thing they are doing. They do not know "indexed",
 * "facet", "unranked", "synced", or "access token", because those are the words
 * of the thing we built.
 *
 * Feature 2 replaced the instances. This stops the next one, because jargon
 * does not arrive in a rewrite - it arrives one label at a time, written by
 * someone with the implementation in their head.
 *
 * KEPT ON PURPOSE: a term the user genuinely owns stays, even when it is an
 * acronym. "ATS score" is what Indian job seekers search for; removing it would
 * cost more than it saves. The rule for those is different and is enforced
 * here too - the term never stands alone, it always carries a plain gloss.
 *
 * KNOWN LIMITS:
 *   - Only JSX text and label-ish props are scanned. Text assembled at runtime
 *     from variables is invisible to this.
 *   - The word list is a list, not an understanding of English. It catches the
 *     terms that actually turned up, and grows when a new one does.
 *
 *   node tools/check-plain-language.js
 */
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', 'frontend');

/* Implementation words that reached a user-facing string. */
const JARGON = [
  'indexed', 'indexing', 'facet', 'unranked', 'synced', 'ingest',
  'endpoint', 'payload', 'webhook', 'cron', 'schema', 'metadata',
  'boolean', 'regex', 'enum', 'dedupe', 'heuristic', 'access token',
];

/*
 * Terms the user owns. Each must appear WITH a gloss nearby - the acronym
 * never stands alone over a bare number, which is how "ATS Score" read before.
 */
const KEPT = [
  { term: 'ATS', glossWithin: 220, gloss: /wording|words|keyword|screening|resume/i },
];

/* Phrases that are legitimate English and merely contain a listed stem. */
const ALLOW = [
  /job index/i,            // /privacy, describing the database in a legal page
  /indexed\s*\*\//i,
];

const files = [];
for (const dir of ['pages', 'components']) {
  const d = path.join(FRONTEND, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter((n) => n.endsWith('.js'))) files.push(path.join(d, f));
}

const problems = [];

for (const file of files) {
  const rel = path.relative(path.join(__dirname, '..'), file);
  const src = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  /*
   * User-facing text only: JSX between tags, and the props that become labels.
   * Anything else in this file is code, and code may say "facet" all it likes.
   */
  const texts = [
    ...[...src.matchAll(/>([^<>{}]{4,160})</g)].map((m) => m[1]),
    ...[...src.matchAll(/(?:label|title|placeholder|aria-label)[=:]\s*['"]([^'"]{4,120})['"]/g)].map((m) => m[1]),
  ]
    .map((t) => t.trim())
    .filter(Boolean)
    /*
     * Prose only. The `>...<` heuristic also spans CODE between a closing and
     * an opening bracket - it reported `filter(Boolean)` as the word "boolean"
     * shown to a user. Text a person reads has no operators in it.
     */
    .filter((t) => !/[(){};=]|=>|\|\||&&/.test(t))
    .filter((t) => /[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(t));

  for (const t of texts) {
    if (ALLOW.some((re) => re.test(t))) continue;
    for (const word of JARGON) {
      if (new RegExp(`\\b${word}\\b`, 'i').test(t)) {
        problems.push({ rel, why: `"${word}" in user-facing text`, sample: t.slice(0, 70) });
      }
    }
  }

  // A kept term must be glossed where it appears.
  for (const { term, glossWithin, gloss } of KEPT) {
    for (const m of src.matchAll(new RegExp(`\\b${term}\\b`, 'g'))) {
      const around = src.slice(m.index, m.index + glossWithin);
      // Only labels shown to a person, not a variable named atsScore.
      /*
       * This was a regex LITERAL containing `${term}` - which never
       * interpolates, so it tested for the characters "${term}" and matched
       * nothing. The gloss rule was silently inert.
       */
      const near = src.slice(Math.max(0, m.index - 120), m.index + 60);
      const isLabel = new RegExp(`>\\s*[^<>{}]*\\b${term}\\b`).test(near)
        || /className/.test(near);
      if (!isLabel) continue;
      if (!gloss.test(around)) {
        problems.push({ rel, why: `"${term}" shown without a plain gloss beside it`, sample: around.replace(/\s+/g, ' ').slice(0, 70) });
      }
    }
  }
}

if (problems.length) {
  console.error('IMPLEMENTATION WORDS ON A USER-FACING SURFACE:\n');
  for (const p of problems.slice(0, 20)) console.error(`  ${p.rel}\n    ${p.why}\n    ${p.sample}\n`);
  console.error('Say it in the words the user already has. A term they genuinely own may stay,');
  console.error('but it never stands alone - add the gloss, or add it to KEPT with one.');
  process.exit(1);
}

console.log(`plain language holds across ${files.length} pages and components`);
