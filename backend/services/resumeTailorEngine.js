const { diffWordsWithSpace } = require('diff');
const { extractSkills } = require('./resumeParser');

const SKILLS_HEADER_RE = /^(core\s+|key\s+|technical\s+)?skills?\s*(&\s*tools)?\s*[:]?\s*$/i;

// Deterministic, explainable tailoring: never rewrites or removes anything
// from the original resume (so it can't misrepresent the candidate) - it
// only ever ADDS job-relevant keywords the resume doesn't already mention,
// either into an existing Skills section or as a new section at the end.
// This is honest ATS keyword-gap fixing, not an AI rewrite (no LLM is
// configured for this app).
//
// mode:
//   'off'        - no changes at all, tailoredText === originalText
//   'honest'     - (default) only add skills the job mentions that the
//                  resume doesn't already contain
//   'aggressive' - also restates skills the resume already has that the job
//                  cares about, increasing their keyword prominence/density
//                  for ATS scanning - still never invents anything the
//                  candidate doesn't actually have
function buildTailoredText(originalText, jobText, mode = 'honest') {
  const jobSkills = extractSkills(jobText);
  const resumeSkills = extractSkills(originalText);
  const missing = jobSkills.filter((s) => !resumeSkills.includes(s));
  const matched = jobSkills.filter((s) => resumeSkills.includes(s));

  if (mode === 'off') {
    return { tailoredText: originalText, addedSkills: [], matchedSkills: matched };
  }

  const toAdd = mode === 'aggressive' ? [...missing, ...matched] : missing;

  if (!toAdd.length) {
    return { tailoredText: originalText, addedSkills: [], matchedSkills: matched };
  }

  const lines = originalText.split('\n');
  const headerIdx = lines.findIndex((line) => SKILLS_HEADER_RE.test(line.trim()));
  const label = mode === 'aggressive' ? 'Key skills for this role' : 'Additional relevant skills for this role';

  let tailoredText;
  if (headerIdx !== -1) {
    const insertion = `${label}: ${toAdd.join(', ')}`;
    tailoredText = [
      ...lines.slice(0, headerIdx + 1),
      insertion,
      ...lines.slice(headerIdx + 1),
    ].join('\n');
  } else {
    tailoredText = `${originalText.replace(/\s+$/, '')}\n\n${label.toUpperCase()}\n${toAdd.join(', ')}`;
  }

  return { tailoredText, addedSkills: mode === 'aggressive' ? toAdd : missing, matchedSkills: matched };
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
