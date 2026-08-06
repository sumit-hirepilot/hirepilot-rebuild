#!/usr/bin/env node
/*
 * A3-b — prove every guard red on a violating input.
 *
 * "The tests pass" is not evidence a guard works; it is evidence the code is
 * currently clean OR that the guard cannot detect anything. Those look
 * identical from the outside, and this project has hit the second case three
 * separate ways: an assertion satisfied by an unrelated earlier match, a runner
 * exiting with zero executed tests, and an assertion reading the wrong argument.
 *
 * The source-scan guards are the ones most at risk, because they share the
 * exact regex mechanism that produced the H4 false positive. They also defend
 * the no-fabricated-numbers claim, so a false green there is the expensive kind.
 *
 * This mutates one file, runs one named test, and requires it to FAIL. Every
 * mutation is reverted in a finally block, including on crash or Ctrl-C.
 *
 *   node scripts/prove-guards-red.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');          // frontend/
const REPO = path.join(ROOT, '..');              // repo root
const DIRS = { frontend: ROOT, backend: path.join(REPO, 'backend') };

/** file, a mutation applied to its text, and the test name that must catch it. */
const CASES = [
  // ---- landingHonesty (9) — the no-invented-figures claim ----
  { suite: 'landingHonesty', test: 'renders no "Illustrative example" label',
    file: 'pages/index.js', mutate: (s) => s + '\nconst __v = <p>Illustrative example</p>;\n' },
  { suite: 'landingHonesty', test: 'renders no hardcoded count with a + or k suffix',
    file: 'pages/index.js', mutate: (s) => s + "\nconst __v = '180+';\n" },
  { suite: 'landingHonesty', test: 'renders no hardcoded percentage as a display string',
    file: 'pages/index.js', mutate: (s) => s + "\nconst __v = '87%';\n" },
  { suite: 'landingHonesty', test: 'declares no example/mock/sample/fake data constant',
    file: 'pages/index.js', mutate: (s) => s + '\nconst MATCH_EXAMPLE = { score: 1 };\n' },
  { suite: 'landingHonesty', test: 'shows scoring weights that sum to 100 and match the engine',
    file: 'pages/index.js', mutate: (s) => s.replace(/weight:\s*40/, 'weight: 41') },
  { suite: 'landingHonesty', test: 'computes the copyright year rather than hardcoding it',
    file: 'components/Layout.js', mutate: (s) => s.replace(/\{new Date\(\)\.getFullYear\(\)\}/, '2026') },
  { suite: 'landingHonesty', test: 'has OG and Twitter card tags',
    file: 'pages/index.js', mutate: (s) => s.replace(/og:image/g, 'og:imagex') },
  { suite: 'landingHonesty', test: 'does not lead the homepage with what the product lacks',
    file: 'pages/index.js', mutate: (s) => s + '\nconst __v = <h2>NO FAKE AUTO-SUBMIT</h2>;\n' },
  { suite: 'landingHonesty', test: 'does not claim it cannot submit, which is no longer true',
    file: 'pages/index.js', mutate: (s) => s + '\nconst __v = <p>HirePilot does not currently submit applications.</p>;\n' },

  // ---- noFabricatedZero (3 detecting + 1 self-check) ----
  { suite: 'noFabricatedZero', test: 'initialises no count-like state to 0',
    file: 'pages/tracker.js', mutate: (s) => s + '\nconst __v = () => { const [fooCount, setFooCount] = useState(0); return fooCount; };\n' },
  { suite: 'noFabricatedZero', test: 'never coerces an absent count from a response into 0',
    file: 'pages/tracker.js', mutate: (s) => s + '\nconst __v = (data) => { setFooCount(data.total || 0); };\n' },
  { suite: 'noFabricatedZero', test: 'writes a literal 0 to a count only where the zero is measured',
    file: 'pages/tracker.js', mutate: (s) => s + '\nconst __v = () => { setFooCount(0); };\n' },

  // ---- the A3 guards ----
  { suite: 'cssClassResolution', test: 'resolves every styles.x reference in the sheet that file imports',
    file: 'pages/tracker.js', mutate: (s) => s + '\nconst __v = styles.__definitelyNotAClass;\n' },
  { suite: 'dynamicClassBinding', test: 'defines a class for every state the code can produce',
    file: 'pages/auto-apply.js', mutate: (s) => s.replace("state: 'partial'", "state: 'bogus'") },
  { suite: 'dynamicClassBinding', test: 'defines a class for every pipeline status',
    file: 'styles/ApplyQueue.module.css', mutate: (s) => s.replace('.s_submitting', '.s_submittingX') },
  { suite: 'adapterStatus', test: 'shows a full-status dot only for adapters the server will run',
    file: 'pages/auto-apply.js', mutate: (s) => s.replace("atsKey: 'lever', state: 'none'", "atsKey: 'lever', state: 'full'") },
  { suite: 'hydration', test: 'renders identical markup signed-out and signed-in',
    file: 'components/Layout.js', mutate: (s) => s.replace('const isAuthenticated = mounted && hasToken;',
      "const isAuthenticated = typeof window !== 'undefined' && !!localStorage.getItem('token');") },
  { suite: 'localVerification', test: 'attaches a React root that renders real content',
    file: 'pages/applications.js', mutate: (s) => s.replace('export default function Applications() {',
      'export default function Applications() {\n  if (true) return null;') },

  /* ---- A6: invented figures, every page not just the landing page ---- */
  { suite: 'noFabricatedZero', test: 'renders no hardcoded count with a + or k suffix',
    file: 'pages/tracker.js', mutate: (s) => s + "\nconst __v = '180+';\n" },
  { suite: 'noFabricatedZero', test: 'renders no hardcoded percentage as a display string',
    file: 'pages/tracker.js', mutate: (s) => s + "\nconst __v = '87%';\n" },
  { suite: 'noFabricatedZero', test: 'declares no example/mock/sample/fake data constant',
    file: 'pages/tracker.js', mutate: (s) => s + '\nconst MATCH_EXAMPLE = {};\n' },
  // The justification marker must be load-bearing, not decorative.
  { suite: 'noFabricatedZero', test: 'renders no hardcoded count with a + or k suffix',
    file: 'components/NotificationBell.js',
    mutate: (s) => s.replace(/ \{\/\* derived-figure:[^}]*\*\/\}/, '') },

  /* ---- A7.17: one ranking path; the index is the universe ---- */
  { suite: 'jobsRanking', dir: 'backend', base: true,
    test: 'LEFT JOINs the match store so score is a sort key, not a membership test',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace('LEFT JOIN job_matches jm', 'JOIN job_matches jm') },
  { suite: 'jobsRanking', dir: 'backend', base: true,
    test: 'scopes the per-source cap to the unfiltered feed',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace('!hasIndexFilter && rankByScore', 'rankByScore') },
  { suite: 'rankingShape', dir: 'backend', base: true,
    test: 'always carries the ranking object',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace('      ranking,\n', '      ranking: datePosted ? undefined : ranking,\n') },

  { suite: 'jobsRanking', dir: 'backend', base: true,
    test: 'counts the universe without the diversity cap',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace('FROM ranked ${countWhere}`, scoreParams)', 'FROM ranked ${where}`, scoreParams)') },

  { suite: 'labelsParity', dir: 'backend', base: true,
    test: 'still humanises a bare key wherever one is displayed',
    file: 'backend/services/labels.js',
    mutate: (s) => s.replace('return /\\s/.test(q) ? q : humanise(q);', 'return q;') },
  { suite: 'labelsParity', dir: 'backend', base: true,
    test: 'names the answer that did not fit, not the question key it came from',
    file: 'backend/services/screeningPrefill.js',
    mutate: (s) => s.replace('reason: optionMismatchReason(similar.answer),',
      'reason: `Your saved answer to \"${similar.matchedQuestion}\" is not one of this form\'s options.`,') },
  { suite: 'labelsParity', dir: 'backend', base: true,
    test: 'shares the transformation, character for character',
    file: 'backend/services/labels.js',
    mutate: (s) => s.replace(".replace(/[_-]+/g, ' ')", ".replace(/[_]+/g, ' ')") },

  /* ---- A7.20: every job a user sees carries a score ---- */
  { suite: 'scoreOnDemand', dir: 'backend', base: true,
    test: 'date filter reports unscoredInPage 0',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace('if (rankByScore && userId) {', 'if (false) {') },
  { suite: 'scoreOnDemand', dir: 'backend', base: true,
    test: 'scores only the unscored rows on this page',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace('const needScore = jobs.filter(isUnscored).map((j) => j.id);',
      'const needScore = jobs.map((j) => j.id);') },
  { suite: 'scoreOnDemand', dir: 'backend', base: true,
    test: 'orders by the new scores, not by the nulls they replaced',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace('      jobs.sort(orderFor(sort));\n', '') },
  { suite: 'scoreOnDemand', dir: 'backend', base: true,
    test: 'never renders an unscored job in a ranked view',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace('jobs = jobs.filter((j) => !isUnscored(j));', '') },
  { suite: 'scoreOnDemand', dir: 'backend', base: true,
    test: 'does not score, nor withhold, when the user opted out of ranking',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace('if (rankByScore && userId) {', 'if (userId) {') },
  { suite: 'jobOrder', dir: 'backend', base: true,
    test: 'compares numerics as numbers, not as the strings pg returns',
    file: 'backend/services/jobOrder.js',
    mutate: (s) => s.replace('  const n = Number(v);\n  return Number.isNaN(n) ? String(v) : n;', '  return v;') },
  { suite: 'jobOrder', dir: 'backend', base: true,
    test: 'builds the SQL clause from the declared fields',
    file: 'backend/services/jobOrder.js',
    mutate: (s) => s.replace("return (ORDER_FIELDS[sort] || ORDER_FIELDS.score).join(', ');",
      "return 'match_tier ASC, id DESC';") },

  /* ---- A7.4b: the reasons already written to the database ---- */
  { suite: 'screeningReasonBackfill', dir: 'backend', base: true,
    test: 'rebuilds the reason from the saved answer',
    file: 'backend/services/screeningPrefill.js',
    mutate: (s) => s.replace('const saved = question.suggestion;',
      'const saved = question.matchedQuestion;') },
  { suite: 'screeningReasonBackfill', dir: 'backend', base: true,
    test: 'declines to guess when there is no saved answer to name',
    file: 'backend/services/screeningPrefill.js',
    mutate: (s) => s.replace("if (saved === null || saved === undefined || String(saved).trim() === '') return null;", '') },
  { suite: 'screeningReasonBackfill', dir: 'backend', base: true,
    test: 'records what it changed before changing it',
    file: 'backend/services/migrations.js',
    mutate: (s) => s.replace("'a7.4b-screening-reason'", "'a7.4b-other'") },
  { suite: 'screeningReasonBackfill', dir: 'backend', base: true,
    test: 'matches the legacy shape exactly, not merely loosely',
    file: 'backend/services/screeningPrefill.js',
    mutate: (s) => s.replace('/^Your saved answer to "[^"]*" is not one of this form\'s options\\.$/',
      '/Your saved answer to "[^"]*" is not one of this form\'s options/') },

  /* ---- A7.4: no key reaches a user as a key ---- */
  { suite: 'labels',
    test: 'has no LABELS[key] || key fallback anywhere',
    file: 'pages/analytics.js',
    mutate: (s) => s.replace('labelFor(s.status, STATUS_LABELS)',
      'STATUS_LABELS[s.status] || s.status') },
  { suite: 'labels',
    test: 'does not interpolate a category or stage straight into JSX',
    file: 'pages/inbox.js',
    mutate: (s) => s.replace('>{labelFor(m.category, CATEGORY_LABELS)}<', '>{m.category}<') },
  { suite: 'labels',
    test: "never gives a separator-carrying token back unchanged",
    file: 'lib/labels.js',
    mutate: (s) => s.replace('return humanise(key);', 'return key;') },
  { suite: 'labels',
    test: 'honours a mapped empty string rather than falling through to the key',
    file: 'lib/labels.js',
    mutate: (s) => s.replace(
      'if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];',
      'if (map[key]) return map[key];') },

  /* ---- A7.2 second half: the legacy rows the guard was written after ---- */
  { suite: 'legacyBadCompany', dir: 'backend', base: true,
    test: 'nulls a company that is a field-name token rather than an employer',
    file: 'backend/services/migrations.js',
    mutate: (s) => s.replace('SET company_name = NULL', "SET company_name = 'Unknown'") },
  { suite: 'legacyBadCompany', dir: 'backend', base: true,
    test: 'records what it changed before changing it',
    file: 'backend/services/migrations.js',
    mutate: (s) => s.replace("'values', COALESCE(jsonb_agg(DISTINCT company_name), '[]'::jsonb),", '') },
  { suite: 'legacyBadCompany', dir: 'backend', base: true,
    test: 'uses the same vocabulary as the ingest guard, not a second list',
    file: 'backend/services/migrations.js',
    mutate: (s) => s.replace('${NOT_PARSED_SQL}', "ARRAY['name']") },
  { suite: 'renderState',
    test: 'never interpolates a raw company field into JSX',
    file: 'pages/dashboard.js',
    mutate: (s) => s.replace("{parsedOr(m.company_name, 'Company not stated')}", '{m.company_name}') },

  { suite: 'legacyBadCompany', dir: 'backend', base: true,
    test: 'counts a stored garbage token separately from a missing value',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace('WHERE company_name IS NOT NULL\n                  AND LOWER',
      'WHERE TRUE\n                  AND LOWER') },
  { suite: 'legacyBadCompany', dir: 'backend', base: true,
    test: 'reports what the correction actually did',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace("FROM data_corrections", 'FROM jobs') },

  { suite: 'legacyBadCompany', dir: 'backend', base: true,
    test: 'drops NOT NULL before trying to write NULL into it',
    file: 'backend/services/migrations.js',
    mutate: (s) => s.replace('`ALTER TABLE jobs ALTER COLUMN company_name DROP NOT NULL`,\n', '') },

  /* ---- A7.5: a filter control that changes nothing ---- */
  { suite: 'filterControlsApply',
    test: 'applies the date window when it is chosen',
    file: 'pages/jobs.js',
    mutate: (s) => s.replace("onChange={(e) => applyFilter(setDatePosted, 'datePosted', e.target.value)}",
      'onChange={(e) => setDatePosted(e.target.value)}') },
  { suite: 'filterControlsApply',
    test: 'applies the experience level when it is chosen',
    file: 'pages/jobs.js',
    mutate: (s) => s.replace("onChange={(e) => applyFilter(setExperience, 'experience', e.target.value)}",
      'onChange={(e) => setExperience(e.target.value)}') },
  { suite: 'filterControlsApply',
    test: 'resets the page state, so the next page is 2 and not 4',
    file: 'pages/jobs.js',
    mutate: (s) => s.replace('    setter(value);\n    setPage(1);', '    setter(value);') },

  /* ---- A7.9: the URL is the state, in both directions ---- */
  { suite: 'urlRoundTrip',
    test: 'round-trips sort',
    file: 'pages/jobs.js',
    mutate: (s) => s.replace('    if (srt) q.sort = srt;\n', '') },
  { suite: 'urlRoundTrip',
    test: 'reads every key it writes, with nothing left over',
    file: 'pages/jobs.js',
    mutate: (s) => s.replace(
      "const srt = q.sort === 'recent' || q.sort === 'score' ? q.sort : null;",
      'const srt = null;') },

  /* ---- A7.11: a fifth of the index sorts last; say so and make it reachable ---- */
  { suite: 'undatedJobs', dir: 'backend', base: true,
    test: 'accepts datePosted=unknown and asks for exactly the undated rows',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace("if (datePosted === 'unknown') {", 'if (false) {') },
  { suite: 'undatedJobs', dir: 'backend', base: true,
    test: 'reports how many rows carry no publication date when sorting by recency',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace("if (sort === 'recent') undatedTotal = undated;", '') },
  { suite: 'undatedJobs', dir: 'backend', base: true,
    test: 'never fabricates a date to make them sortable',
    file: 'backend/services/apis/himalayas.js',
    mutate: (s) => s.replace('posted_at: null,', 'posted_at: new Date(job.pubDate * 1000),') },
  { suite: 'undatedReachable',
    test: 'reaches them in one click',
    file: 'pages/jobs.js',
    mutate: (s) => s.replace("onClick={() => applyFilter(setDatePosted, 'datePosted', 'unknown')}",
      "onClick={() => setDatePosted('unknown')}") },
  { suite: 'undatedReachable',
    test: 'says nothing when nothing is buried',
    file: 'pages/jobs.js',
    mutate: (s) => s.replace('ranking?.undatedTotal > 0', 'true') },

  /* ---- A7.13: the empty state names a cause and stops contradicting itself ---- */
  { suite: 'emptyStateCause', dir: 'backend', base: true,
    test: 'names the filter it is most reasonable to relax, not the largest recovery',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace('(a.relaxOrder - b.relaxOrder) || (b.withoutIt - a.withoutIt)',
      '(b.withoutIt - a.withoutIt)') },
  { suite: 'emptyStateCause', dir: 'backend', base: true,
    test: 'does not run the diagnosis when there is nothing to diagnose',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace('if (total === 0) {', 'if (true) {') },
  { suite: 'emptyStateCopy',
    test: 'never claims nothing matches while showing a related job',
    file: 'pages/jobs.js',
    mutate: (s) => s.replace('? `No exact matches \u00b7 ${relatedTotal} related`',
      "? 'No jobs match these filters'") },
  { suite: 'emptyStateCopy',
    test: 'names the responsible filter and the count behind it',
    file: 'pages/jobs.js',
    mutate: (s) => s.replace('const cause = emptyReason?.primary',
      'const cause = false && emptyReason?.primary') },

  /* ---- A7.17 perf: the index is the universe, so index it ---- */
  { suite: 'hotPathIndexes', dir: 'backend', base: true,
    test: 'indexes the selective path, which is the one A7.17 unlocked',
    file: 'backend/services/migrations.js',
    mutate: (s) => s.replace('ON jobs (is_active, posted_at DESC NULLS LAST)', 'ON jobs (is_active)') },
  { suite: 'hotPathIndexes', dir: 'backend', base: true,
    test: 'does not carry indexes no plan names',
    file: 'backend/services/migrations.js',
    mutate: (s) => s.replace('`DROP INDEX IF EXISTS idx_jobs_source`,',
      '`CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs (source)`,') },
  { suite: 'hotPathIndexes', dir: 'backend', base: true,
    test: 'exposes the indexes actually present, not the ones we meant to create',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace('FROM pg_indexes', 'FROM pg_class') },

  /* ---- A7.6: the bulk control has a name, and it works when clicked ---- */
  { suite: 'jobsBulkSelect',
    test: 'gives every job checkbox an accessible name carrying that job',
    file: 'pages/jobs.js',
    mutate: (s) => s.replace(
      "          aria-label={`Select ${job.title} at ${parsedOr(job.company_name, 'Company not stated')}`}\n", '') },
  { suite: 'jobsBulkSelect',
    test: 'names the company too, so two roles at different companies are distinct',
    file: 'pages/jobs.js',
    mutate: (s) => s.replace(
      "`Select ${job.title} at ${parsedOr(job.company_name, 'Company not stated')}`", '`Select job`') },
  { suite: 'jobsBulkSelect',
    test: 'clearing deselects everything, not just the last one',
    file: 'pages/jobs.js',
    mutate: (s) => s.replace('onClick={() => setSelectedIds(new Set())}',
      'onClick={() => setSelectedIds(new Set(Array.from(selectedIds).slice(1)))}') },

  /* ---- A7.14: a fetch is not a publication; status is not row count ---- */
  { suite: 'sourceStatus', dir: 'backend', base: true,
    test: 'reports a deliberately unfetched source as not connected, never as live',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace("if (!FETCHED_SOURCES.has(key)) return 'not_connected';",
      "if (!FETCHED_SOURCES.has(key)) return 'live';") },
  { suite: 'sourceStatus', dir: 'backend', base: true,
    test: 'does not call a source live just because rows exist',
    file: 'backend/routes/jobs.js',
    mutate: (s) => s.replace("return lastRun.success ? 'live' : 'failing';", "return 'live';") },
  { suite: 'renderState',
    test: 'never describes a missing fetch time in publication vocabulary',
    file: 'lib/format.js',
    mutate: (s) => s.replace('return relativeTime(value) ?? NEVER_FETCHED;',
      'return relativeTime(value) ?? NO_DATE;') },
  { suite: 'renderState',
    test: 'does not infer liveness from the row count',
    file: 'pages/jobs.js',
    mutate: (s) => s.replace("s.status === 'live'", 's.count > 0') },

  /* ---- A7.12: non-job content must never be stored or made applyable ---- */
  { suite: 'notAJob', dir: 'backend', base: true,
    test: 'rejects a bio indexed as a job',
    file: 'backend/services/parsedField.js',
    mutate: (s) => s.replace('function notAJobReason({ title',
      'function notAJobReason(__u) { return null; }\nfunction __disabled({ title') },
  { suite: 'notAJob', dir: 'backend', base: true,
    test: 'requires the pipe convention rather than guessing an employer',
    file: 'backend/services/apis/hackernews.js',
    mutate: (s) => s.replace('  if (segments.length < 2) return null;', '') },
  { suite: 'notAJob', dir: 'backend', base: true,
    test: 'calls notAJobReason before storing',
    file: 'backend/services/jobAggregator.js',
    mutate: (s) => s.replace('const rejection = notAJobReason(normalized);', 'const rejection = null;') },

  /* ---- A7.4: the activity feed is read by a person ---- */
  { suite: 'activityVocabulary', dir: 'backend', base: true,
    test: 'handles every written event type explicitly',
    file: 'backend/routes/activity.js',
    mutate: (s) => s.replace("    case 'application_queued':", "    case '__gone':") },
  { suite: 'activityVocabulary', dir: 'backend', base: true,
    test: 'never falls back to the raw event key',
    file: 'backend/routes/activity.js',
    mutate: (s) => s.replace('      return `Activity on ${where(row, meta)}`;', '      return row.event_type;') },
  { suite: 'activityVocabulary', dir: 'backend', base: true,
    test: 'names the company on a retry',
    file: 'backend/routes/activity.js',
    mutate: (s) => s.replace('  if (title && company) return `${title} at ${company}`;', '  if (title && company) return title;') },

  /* ---- A7.3: one date formatter, one no-date string, no fake time window ---- */
  { suite: 'noFabricatedZero', test: 'defines timeAgo exactly once, in lib/format.js',
    file: 'pages/tracker.js',
    mutate: (s) => s + '\nfunction timeAgo(dateStr) { return dateStr; }\n' },
  { suite: 'noFabricatedZero', test: 'uses one string for a missing publication date',
    file: 'pages/tracker.js', mutate: (s) => s + "\nconst __v = 'date unavailable';\n" },
  { suite: 'noFabricatedZero', test: 'never labels a capped list as a time-bounded count',
    file: 'pages/tracker.js', mutate: (s) => s + "\nconst __v = <p>Today's Matches</p>;\n" },

  /* ---- A7.2: a field that did not parse must not be stored ---- */
  { suite: 'parsedField', dir: 'backend', base: true,
    test: 'withholds an unparsed row rather than storing it',
    file: 'backend/services/parsedField.js',
    // Drop 'name' from the placeholder list: the literal that started A7.2.
    mutate: (s) => s.replace("'name', 'title',", "'title',") },
  { suite: 'parsedField', dir: 'backend', base: true,
    test: 'holds exactly the same placeholders on both sides',
    file: 'frontend/lib/renderState.js',
    mutate: (s) => s.replace("'nan',", "'nan', 'tbd',") },

  /* ---- A3-c: superstring mutations ----
   * Each renames an identifier to a SUPERSTRING of itself. An unanchored
   * assertion (`toContain('og:image')`, `/HP_EXECUTE/`) stays green against
   * these, so the thing could be renamed into non-existence unnoticed. These
   * cases exist to prove the anchoring, not the identifier.
   */
  { suite: 'landingHonesty', test: 'has OG and Twitter card tags',
    file: 'pages/index.js', mutate: (s) => s.replace(/og:image"/g, 'og:imagex"') },
  { suite: 'extensionWhitelist', dir: 'backend', base: true,
    test: 'the queue-run path refuses an unsupported adapter',
    file: 'extension/background.js', mutate: (s) => s.replace(/HP_EXECUTE/g, 'HP_EXECUTE_X') },
  { suite: 'appliedRequiresSubmission', dir: 'backend', base: true,
    test: 'adds a CHECK constraint binding applied to a submission record',
    file: 'backend/services/migrations.js',
    mutate: (s) => s.replace(/applications_applied_requires_submission/g, 'applications_applied_requires_submissionX') },
  { suite: 'jobsRanking', dir: 'backend', base: true,
    test: 'ranks by score without being asked to',
    file: 'backend/routes/jobs.js', mutate: (s) => s.replace(/JOIN job_matches\b/g, 'JOIN job_matchesX') },
];

/*
 * `jest -t` takes a REGEX, not a literal. A test named "...with a + or k
 * suffix" contains `+`, which became a quantifier, matched nothing, ran ZERO
 * tests and exited 0 - which this script first read as GREEN. The instrument
 * had the exact defect it exists to find. Escape the name.
 */
function escapeForJestT(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runTest(suite, test, dir = 'frontend') {
  const cwd = DIRS[dir];
  /*
   * --runInBand --no-cache: one audit run reported DID_NOT_RUN for a case that
   * fails correctly in isolation, and did not reproduce. The verdict logic was
   * verified correct, so the remaining variable was jest's workers and its
   * transform cache. An instrument that is right most of the time is not an
   * instrument. Slower, deterministic.
   */
  const args = ['jest', `__tests__/${suite}.test.js`, '--runInBand', '--no-cache',
    '-t', escapeForJestT(test)];
  let out;
  let failed = false;
  try {
    out = String(execFileSync('npx', args, { cwd, stdio: 'pipe' }));
  } catch (err) {
    failed = true;
    out = String(err.stdout || '') + String(err.stderr || '');
  }

  // Checked on BOTH paths. A run that executed nothing is a null result, and
  // on the success path it would otherwise be counted as the guard passing.
  if (/Test suite failed to run/.test(out)) return 'DID_NOT_RUN';
  const executed = out.match(/Tests:.*?(\d+) total/);
  if (!executed || Number(executed[1]) === 0) return 'DID_NOT_RUN';
  if (/matched\s+0\s+test/i.test(out)) return 'DID_NOT_RUN';
  const ran = out.match(/Tests:[^\n]*/);
  if (ran && /(\d+) skipped/.test(ran[0]) && !/failed|passed/.test(ran[0])) return 'DID_NOT_RUN';

  return failed ? 'RED' : 'GREEN';
}

/*
 * The audit spans BOTH trees, and CI runs it from the frontend job, which
 * installs only frontend deps. Every backend case then came back DID_NOT_RUN
 * and the step failed - the gate catching my own wiring, on its second commit.
 *
 * It installs what it needs rather than relying on the job's setup, so the
 * audit is correct under any CI layout and on a fresh clone.
 *
 * Installing, never skipping. Skipping an uninstalled suite would silently
 * narrow the audit to whichever tree happened to be present and report the
 * smaller denominator as success - the exact "green means nothing" failure
 * this script exists to prevent.
 */
function ensureRunnable() {
  const needed = new Set(CASES.map((c) => c.dir || 'frontend'));
  for (const name of needed) {
    const dir = DIRS[name];
    if (!dir) throw new Error(`unknown suite dir: ${name}`);
    if (fs.existsSync(path.join(dir, 'node_modules', '.bin', 'jest'))) continue;
    process.stdout.write(`installing ${name} dependencies so its guards can run...\n`);
    execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
    if (!fs.existsSync(path.join(dir, 'node_modules', '.bin', 'jest'))) {
      throw new Error(`${name}: jest still missing after install - refusing to run a partial audit`);
    }
  }
}

ensureRunnable();

const results = [];
for (const c of CASES) {
  const abs = path.isAbsolute(c.file) ? c.file : path.join(c.base ? REPO : ROOT, c.file);
  const original = fs.readFileSync(abs, 'utf8');
  let verdict;
  try {
    const mutated = c.mutate(original);
    if (mutated === original) {
      verdict = 'MUTATION_NO_OP'; // the anchor moved; the case proves nothing
    } else {
      fs.writeFileSync(abs, mutated);
      verdict = runTest(c.suite, c.test, c.dir || 'frontend');
    }
  } finally {
    fs.writeFileSync(abs, original);
  }
  results.push({ ...c, verdict });
  process.stdout.write(`${verdict === 'RED' ? '  ok  ' : 'FAIL  '}${c.suite} :: ${c.test}\n`);
  if (verdict !== 'RED') process.stdout.write(`        -> ${verdict}\n`);
}

const bad = results.filter((r) => r.verdict !== 'RED');
process.stdout.write(`\n${results.length - bad.length}/${results.length} guards proven red on a violating input\n`);
if (bad.length) {
  process.stdout.write('\nNOT PROVEN — these guards did not detect their own violation:\n');
  for (const b of bad) process.stdout.write(`  ${b.suite} :: ${b.test}  (${b.verdict})\n`);
  process.exit(1);
}
