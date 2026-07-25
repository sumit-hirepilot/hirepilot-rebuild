const { diffWordsWithSpace } = require('diff');
const { extractSkills } = require('./resumeParser');

const SKILLS_HEADER_RE = /^(core\s+|key\s+|technical\s+)?skills?\s*(&\s*tools)?\s*[:]?\s*$/i;

// Deterministic, explainable tailoring: never rewrites or removes anything
// from the original resume (so it can't misrepresent the candidate) - it
// only ever ADDS job-relevant keywords the resume doesn't already mention,
// either into an existing Skills section or as a new section at the end.
// This is honest ATS keyword-gap fixing, not an AI rewrite (no LLM is
// configured for this app).
function buildTailoredText(originalText, jobText) {
  const jobSkills = extractSkills(jobText);
  const resumeSkills = extractSkills(originalText);
  const missing = jobSkills.filter((s) => !resumeSkills.includes(s));
  const matched = jobSkills.filter((s) => resumeSkills.includes(s));

  if (!missing.length) {
    return { tailoredText: originalText, addedSkills: [], matchedSkills: matched };
  }

  const lines = originalText.split('\n');
  const headerIdx = lines.findIndex((line) => SKILLS_HEADER_RE.test(line.trim()));

  let tailoredText;
  if (headerIdx !== -1) {
    const insertion = `Additional relevant skills for this role: ${missing.join(', ')}`;
    tailoredText = [
      ...lines.slice(0, headerIdx + 1),
      insertion,
      ...lines.slice(headerIdx + 1),
    ].join('\n');
  } else {
    tailoredText = `${originalText.replace(/\s+$/, '')}\n\nRELEVANT SKILLS FOR THIS ROLE\n${missing.join(', ')}`;
  }

  return { tailoredText, addedSkills: missing, matchedSkills: matched };
}

// Produces a word-level diff between original and tailored text. Because
// buildTailoredText only ever adds content, every diff part is either
// unchanged or added (never removed) - each "added" part is one
// independently accept/reject-able change.
function diffTailoring(originalText, tailoredText) {
  return diffWordsWithSpace(originalText, tailoredText).map((part, index) => ({
    index,
    value: part.value,
    added: !!part.added,
    removed: !!part.removed,
  }));
}

// Reconstructs final text from a diff (as produced by diffTailoring) given
// the set of accepted "added" part indices - rejected additions are simply
// omitted, unchanged parts are always kept.
function applyAcceptedChanges(diffParts, acceptedIndices) {
  const accepted = new Set(acceptedIndices);
  return diffParts
    .filter((part) => !part.added || accepted.has(part.index))
    .map((part) => part.value)
    .join('');
}

module.exports = { buildTailoredText, diffTailoring, applyAcceptedChanges };
