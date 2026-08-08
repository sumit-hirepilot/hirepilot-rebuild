/*
 * Feature 15 — interview prep (D5), from the actual JD and the user's actual
 * gaps.
 *
 * No LLM is configured for this app, so nothing here invents a "likely
 * question". What CAN be said honestly: the posting names these skills, in
 * these sentences of its own, and against the skills you recorded each one
 * is a strength to lead with or a gap to have an answer ready for. The
 * quotes are the C4 pattern - the employer's words, never a composition.
 */

const { extractSkills } = require('./resumeParser');

// A quote longer than this stops being a quote and becomes the posting.
const MAX_QUOTE = 220;

function sentencesOf(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function quoteFor(sentences, skill) {
  const needle = skill.toLowerCase();
  const hit = sentences.find((s) => s.toLowerCase().includes(needle));
  if (!hit) return null;
  return hit.length > MAX_QUOTE ? `${hit.slice(0, MAX_QUOTE - 1)}…` : hit;
}

function buildInterviewPrep({ job, userSkills = [] }) {
  const jdText = `${job.description || ''}\n${job.requirements || ''}`.trim();
  const jobText = `${job.title || ''} ${jdText}`;
  const jobSkills = extractSkills(jobText);
  const sentences = sentencesOf(jdText);

  const mine = new Set(userSkills.map((s) => String(s).toLowerCase()));

  const items = jobSkills
    .map((skill) => {
      const quote = quoteFor(sentences, skill);
      // A skill matched only in the TITLE has no sentence to quote; the item
      // still stands - the posting names it - with the title as its source.
      return {
        skill,
        hasIt: mine.has(String(skill).toLowerCase()),
        quote: quote || `Named in the role title: "${job.title}"`,
      };
    });

  const sufficientJd = items.length > 0;

  return {
    items,
    strengths: items.filter((i) => i.hasIt),
    gaps: items.filter((i) => !i.hasIt),
    sufficientJd,
    ...(sufficientJd ? {} : {
      reason: 'This posting\'s text names no skills our dictionary recognises, so there is nothing honest to prepare from here. Read the original posting - and your tracker notes - directly.',
    }),
    definitions: {
      strengths: 'Skills this posting names that are on your profile. Lead with these.',
      gaps: 'Skills this posting names that are NOT on your profile. Have an answer ready - real experience the profile misses, or how you would close it.',
    },
  };
}

module.exports = { buildInterviewPrep };
