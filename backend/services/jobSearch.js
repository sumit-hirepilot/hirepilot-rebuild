// Heuristic, curated role-family synonyms - not an AI/semantic model (none is
// configured for this app). Small and honest: covers common title variants
// so "Software Engineer" also surfaces "Software Developer"/"SWE" postings
// at the same relevance tier, without silently expanding into unrelated
// roles. Extend this list as real gaps are found.
const ROLE_SYNONYMS = {
  'product designer': ['ux designer', 'ui designer', 'ui/ux designer', 'product design'],
  'ux designer': ['product designer', 'ui designer', 'ui/ux designer', 'user experience designer'],
  'ui designer': ['ux designer', 'product designer', 'ui/ux designer', 'visual designer'],
  'ux/ui designer': ['product designer', 'ux designer', 'ui designer'],
  'software engineer': ['software developer', 'swe', 'backend engineer', 'full stack engineer', 'fullstack engineer', 'application engineer'],
  'software developer': ['software engineer', 'developer', 'programmer'],
  'frontend engineer': ['front end engineer', 'front-end engineer', 'frontend developer', 'ui engineer'],
  'backend engineer': ['back end engineer', 'back-end engineer', 'backend developer', 'server engineer'],
  'full stack engineer': ['fullstack engineer', 'full-stack engineer', 'full stack developer'],
  'product manager': ['pm', 'associate product manager', 'senior product manager', 'technical product manager'],
  'project manager': ['program manager', 'delivery manager'],
  'data scientist': ['machine learning engineer', 'ml engineer', 'data science', 'applied scientist'],
  'data analyst': ['business analyst', 'analytics engineer', 'reporting analyst'],
  'devops engineer': ['site reliability engineer', 'sre', 'platform engineer', 'infrastructure engineer'],
  'marketing manager': ['growth marketing manager', 'digital marketing manager'],
  'customer success manager': ['customer success', 'account manager', 'client success manager'],
  'recruiter': ['talent acquisition', 'technical recruiter', 'talent partner'],
};

const escapePgRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Postgres's "advanced regular expression" flavor supports \m / \M as
// word-boundary anchors (start/end of word) - critical for short synonyms
// like "pm" or "sre", which as a plain ILIKE '%pm%' substring would match
// inside "develoPMent", "shipMent", etc. Every word/phrase match in this
// module goes through this so short tokens can never false-positive inside
// unrelated words.
const wordBoundaryPattern = (text) => `\\m${escapePgRegex(text)}\\M`;

const normalizePhrase = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// Given a raw search string, return the ordered list of phrase variants to
// search for: the phrase itself first, then any known synonyms.
function expandSearchPhrases(rawSearch) {
  const normalized = normalizePhrase(rawSearch);
  const phrases = [normalized];
  const synonyms = ROLE_SYNONYMS[normalized];
  if (synonyms) {
    for (const syn of synonyms) {
      if (!phrases.includes(syn)) phrases.push(syn);
    }
  }
  return phrases;
}

// Builds a WHERE fragment (and appends bind params) that classifies each job
// into a relevance tier across one or more keyword "chips" (OR'd together -
// a job matching any chip at tier 1 is tier 1 overall):
//   1 = a chip's phrase appears verbatim, word-bounded (best match)
//   2 = every word of a chip's phrase appears in the scoped field(s)
//       (words may be scattered, e.g. "Product Designer (Senior)")
//   3 = every word of a chip's phrase appears somewhere across title/
//       description per the scope (broad/related match)
// `scope` controls which field(s) are searched: 'title' (title only),
// 'description' (description only), or 'title_description' (default -
// tier 1/2 match the title, tier 3 also allows the description).
function buildSearchTiering(rawSearchInput, params, options = {}) {
  const scope = options.scope === 'title' || options.scope === 'description' ? options.scope : 'title_description';
  const keywords = (Array.isArray(rawSearchInput) ? rawSearchInput : [rawSearchInput])
    .filter((k) => k && k.trim());

  const tier1Conditions = [];
  const tier2Conditions = [];
  const tier3Conditions = [];

  const primaryField = scope === 'description' ? 'description' : 'title';

  for (const rawSearch of keywords) {
    const phrases = expandSearchPhrases(rawSearch);

    for (const phrase of phrases) {
      const words = phrase.split(' ').filter(Boolean).slice(0, 6);
      if (!words.length) continue;

      params.push(wordBoundaryPattern(phrase));
      tier1Conditions.push(`${primaryField} ~* $${params.length}`);

      const titleWordConds = words.map((w) => {
        params.push(wordBoundaryPattern(w));
        return `${primaryField} ~* $${params.length}`;
      });
      tier2Conditions.push(`(${titleWordConds.join(' AND ')})`);

      const anyWordConds = words.map((w) => {
        if (scope === 'title_description') {
          params.push(wordBoundaryPattern(w), wordBoundaryPattern(w));
          return `(title ~* $${params.length - 1} OR description ~* $${params.length})`;
        }
        params.push(wordBoundaryPattern(w));
        return `${primaryField} ~* $${params.length}`;
      });
      tier3Conditions.push(`(${anyWordConds.join(' AND ')})`);
    }
  }

  const tier1Expr = tier1Conditions.length ? `(${tier1Conditions.join(' OR ')})` : 'FALSE';
  const tier2Expr = tier2Conditions.length ? `(${tier2Conditions.join(' OR ')})` : 'FALSE';
  const tier3Expr = tier3Conditions.length ? `(${tier3Conditions.join(' OR ')})` : 'FALSE';

  const tierCaseExpr = `CASE WHEN ${tier1Expr} THEN 1 WHEN ${tier2Expr} THEN 2 WHEN ${tier3Expr} THEN 3 ELSE 4 END`;

  return {
    tierCaseExpr,
    narrowCondition: `(${tier1Expr} OR ${tier2Expr})`, // exact + word matches only
    relatedOnlyCondition: `(${tier3Expr} AND NOT (${tier1Expr} OR ${tier2Expr}))`, // strictly the "related" tier
    broadCondition: `(${tier1Expr} OR ${tier2Expr} OR ${tier3Expr})`,
  };
}

// Builds a "NOT present" condition for a list of excluded terms (e.g. "Hide
// jobs mentioning..."). A job is excluded if ANY term word-boundary-matches
// its title or description.
function buildExcludeCondition(excludeTerms, params) {
  const terms = (excludeTerms || []).filter((t) => t && t.trim());
  if (!terms.length) return null;

  const conds = terms.map((term) => {
    params.push(wordBoundaryPattern(term.trim()), wordBoundaryPattern(term.trim()));
    return `(title ~* $${params.length - 1} OR description ~* $${params.length})`;
  });

  return `NOT (${conds.join(' OR ')})`;
}

module.exports = { expandSearchPhrases, buildSearchTiering, buildExcludeCondition, normalizePhrase };
