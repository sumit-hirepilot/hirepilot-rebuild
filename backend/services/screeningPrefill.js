/*
 * Screening-question pre-fill.
 *
 * Maps the questions employer forms actually ask onto values the user has
 * explicitly saved in their Application Profile. The hard rule here: this
 * module NEVER invents an answer. If the profile has no value for a question,
 * the field comes back unanswered and flagged, and the review screen asks the
 * user. A guessed work-authorisation or salary answer is a misrepresentation
 * on a legally binding form, so "I don't know" has to be representable.
 *
 * Patterns are ordered most-specific-first because question text overlaps
 * heavily ("are you authorized to work" vs "will you now or in the future
 * require sponsorship" both contain "work" and "require").
 */

const { resolve: resolveFromKnowledge, ASK_THRESHOLD } = require('./questionKnowledge');

// Maps a job's location string onto a country so work-authorisation and
// sponsorship questions can be answered per posting rather than globally.
// Deliberately conservative: an unrecognised location yields null, which makes
// those questions fall through to the user instead of being answered wrongly.
const COUNTRY_HINTS = [
  ['india', 'India'], ['bengaluru', 'India'], ['bangalore', 'India'], ['mumbai', 'India'],
  ['delhi', 'India'], ['hyderabad', 'India'], ['pune', 'India'], ['chennai', 'India'],
  ['gurgaon', 'India'], ['gurugram', 'India'], ['noida', 'India'], ['kolkata', 'India'],
  ['united states', 'United States'], ['usa', 'United States'], ['u.s.', 'United States'],
  ['san francisco', 'United States'], ['new york', 'United States'], ['seattle', 'United States'],
  ['austin', 'United States'], ['boston', 'United States'], ['chicago', 'United States'],
  ['los angeles', 'United States'], ['denver', 'United States'], ['atlanta', 'United States'],
  ['united kingdom', 'United Kingdom'], ['london', 'United Kingdom'], [' uk', 'United Kingdom'],
  ['canada', 'Canada'], ['toronto', 'Canada'], ['vancouver', 'Canada'],
  ['germany', 'Germany'], ['berlin', 'Germany'], ['munich', 'Germany'],
  ['ireland', 'Ireland'], ['dublin', 'Ireland'],
  ['netherlands', 'Netherlands'], ['amsterdam', 'Netherlands'],
  ['australia', 'Australia'], ['sydney', 'Australia'], ['melbourne', 'Australia'],
  ['singapore', 'Singapore'], ['poland', 'Poland'], ['spain', 'Spain'], ['france', 'France'],
  ['brazil', 'Brazil'], ['mexico', 'Mexico'], ['japan', 'Japan'], ['uae', 'United Arab Emirates'],
  ['dubai', 'United Arab Emirates'],
];

function countryForLocation(location) {
  const t = ` ${String(location || '').toLowerCase()} `;
  if (!t.trim()) return null;
  // "Remote" with no country attached tells us nothing about where the legal
  // entity is, so it stays unresolved.
  for (const [hint, country] of COUNTRY_HINTS) {
    if (t.includes(hint)) return country;
  }
  return null;
}

function isAuthorizedIn(profile, country) {
  if (!country) return null;
  const list = (profile.authorized_countries || []).map((c) => String(c).trim().toLowerCase());
  if (!list.length) return null;
  return list.includes(country.toLowerCase());
}

// Each rule: which profile field answers it, and how to render that value for
// the field type the form is using.
const RULES = [
  {
    field: 'requires_sponsorship',
    // Checked before work_authorization: this phrasing contains "work" and
    // would otherwise be captured by the authorisation rule below.
    test: /sponsor|visa\s*sponsor|require.*sponsorship|need.*sponsorship|h-?1b/i,
    // If we know the posting's country and the user is already authorised
    // there, no sponsorship is needed regardless of the stored default.
    render: (v, p, ctx) => {
      const auth = isAuthorizedIn(p, ctx && ctx.country);
      if (auth === true) return 'No';
      if (auth === false) return 'Yes';
      return v === true ? 'Yes' : v === false ? 'No' : null;
    },
  },
  {
    field: 'work_authorization',
    test: /authoriz|authoris|legally.*(work|entitled)|right to work|work permit|eligible to work/i,
    // Answered against the posting's own country. Falls through to the user
    // when the location cannot be resolved - guessing here would put a false
    // statement on a legally binding form.
    render: (v, p, ctx) => {
      const auth = isAuthorizedIn(p, ctx && ctx.country);
      if (auth === true) return 'Yes';
      if (auth === false) return 'No';
      return null;
    },
  },
  {
    field: 'willing_to_relocate',
    test: /relocat|willing to move/i,
    render: (v) => (v === true ? 'Yes' : v === false ? 'No' : null),
  },
  {
    field: 'notice_period',
    test: /notice period|when can you (start|join)|availability to start|earliest start/i,
    render: (v) => v || null,
  },
  {
    field: 'salary_expectation',
    test: /salary|compensation expect|expected (ctc|pay)|desired (salary|compensation)|pay expect/i,
    render: (v, p) => (v ? (p.salary_currency ? `${p.salary_currency} ${v}` : String(v)) : null),
  },
  {
    field: 'years_experience',
    test: /years.*(experience|exp)|how (many|much) (years|experience)|total experience/i,
    render: (v) => (v === null || v === undefined ? null : String(v)),
  },
  {
    field: 'linkedin_url',
    test: /linkedin/i,
    render: (v) => v || null,
  },
  {
    field: 'github_url',
    test: /github|git profile/i,
    render: (v) => v || null,
  },
  {
    field: 'portfolio_url',
    test: /portfolio|website|personal site|dribbble|behance|case stud/i,
    render: (v) => v || null,
  },
  {
    field: 'phone',
    test: /phone|mobile|contact number|telephone/i,
    render: (v) => v || null,
  },
  {
    field: 'email',
    test: /e-?mail/i,
    render: (v) => v || null,
  },
  {
    field: 'full_name',
    test: /full name|your name|^name$/i,
    render: (v) => v || null,
  },
  {
    field: 'current_location',
    test: /location|city|where are you based|current residence/i,
    render: (v) => v || null,
  },
  {
    field: 'current_company',
    test: /current (company|employer)|present company/i,
    render: (v) => v || null,
  },
  {
    field: 'current_title',
    test: /current (title|role|designation)|present (title|role)/i,
    render: (v) => v || null,
  },
  {
    field: 'pronouns',
    test: /pronoun/i,
    render: (v) => v || null,
  },
];

// Questions that are legal attestations or consent. These are deliberately
// never pre-filled, even if a plausible value exists, because ticking a
// consent or certification box is the user asserting something personally.
const NEVER_PREFILL = /certif|attest|i agree|i consent|i acknowledge|terms|privacy policy|declare that|under penalty|accurate and complete|background check|drug (test|screen)/i;

// Demographic / EEO questions. Legal to decline, and pre-filling them from a
// stored value the user set once is fine, but they must never be *guessed*,
// and they are surfaced separately in review so the user sees them.
// hispanic/latino and "self-identify" phrasings come from the standard US EEO
// block and appear verbatim on Greenhouse forms; without them those questions
// fell through to "unmapped", which reads as a gap in your profile rather than
// as a question you are free to decline.
const DEMOGRAPHIC = /gender|race|ethnic|veteran|disability|sexual orientation|lgbt|hispanic|latino|self.?identif/i;

/**
 * @param {Array<{question: string, type?: string, options?: string[], required?: boolean}>} questions
 * @param {object} profile - row from application_profiles (may be {} )
 * @returns {Array} one entry per question with the resolved answer or a gap flag
 */
// A country dropdown reports 250+ options. The extension re-reads the live
// option list at fill time, so the stored copy only backs the review screen -
// cap it rather than persisting kilobytes per question on a 500MB volume.
const MAX_STORED_OPTIONS = 120;

function prefillAnswers(questions, profile, jobContext = {}) {
  const p = profile || {};
  const ctx = { ...jobContext, country: jobContext.country || countryForLocation(jobContext.location) };
  const custom = p.custom_answers || {};

  return (questions || []).map((q) => {
    const text = q.question || '';
    const allOptions = q.options || null;
    const base = {
      question: text,
      type: q.type || 'text',
      options: allOptions ? allOptions.slice(0, MAX_STORED_OPTIONS) : null,
      optionsTruncated: Boolean(allOptions && allOptions.length > MAX_STORED_OPTIONS),
      required: q.required !== false,
    };

    if (NEVER_PREFILL.test(text)) {
      return {
        ...base,
        answer: null,
        source: 'requires_user',
        reason: 'This is a legal attestation or consent - only you can answer it.',
      };
    }

    // A saved answer for this exact question wins over any pattern rule.
    const customKey = normalizeKey(text);
    const exact = custom[customKey];
    const exactAnswer = typeof exact === 'string' ? exact : (exact && exact.answer);
    if (exactAnswer !== undefined && exactAnswer !== null && exactAnswer !== '') {
      return { ...base, answer: String(exactAnswer), source: 'profile_custom' };
    }

    /*
     * Then a saved answer to the SAME question worded differently - resolved by
     * canonical concept first, token similarity second, each with a confidence.
     * Anything under ASK_THRESHOLD is handed to the user rather than filled:
     * asking one more time is cheap, a confidently wrong answer on a real
     * application is not.
     */
    const similar = resolveFromKnowledge(text, custom);
    if (similar && similar.confidence < ASK_THRESHOLD) {
      return {
        ...base,
        answer: null,
        source: 'low_confidence',
        suggestion: similar.answer,
        confidence: similar.confidence,
        matchedQuestion: similar.matchedQuestion,
        reason: `Closest saved answer is only ${Math.round(similar.confidence * 100)}% confident - confirm it rather than guess.`,
      };
    }
    if (similar) {
      // Still honour the form's own options - a reused answer that is not on
      // the list must not be silently submitted.
      if (allOptions && allOptions.length) {
        const hit = allOptions.find(
          (o) => String(o).trim().toLowerCase() === similar.answer.trim().toLowerCase()
        );
        if (!hit) {
          return {
            ...base,
            answer: null,
            source: 'requires_user',
            suggestion: similar.answer,
            /*
             * A7.4 - names the ANSWER, not the question it came from.
             *
             * This quoted matchedQuestion, which holds a stored profile key,
             * so the page read: Your saved answer to
             * "are_you_hispanic_latino" is not one of this form's options.
             * Preferring conceptLabel did not help - the stored concept labels
             * ARE those keys.
             *
             * Naming the question was the wrong idea anyway. What the user
             * needs in order to act is the answer that did not fit, so they
             * can pick the option that matches it. That is what the sibling
             * branch below already says, and now both agree.
             */
            reason: optionMismatchReason(similar.answer),
          };
        }
        return { ...base, answer: hit, source: 'profile_similar', matchedQuestion: similar.matchedQuestion,
          confidence: similar.confidence, via: similar.via, conceptLabel: similar.conceptLabel };
      }
      return {
        ...base,
        answer: similar.answer,
        source: 'profile_similar',
        matchedQuestion: similar.matchedQuestion,
        confidence: similar.confidence,
        via: similar.via,
        conceptLabel: similar.conceptLabel,
      };
    }

    if (DEMOGRAPHIC.test(text)) {
      return {
        ...base,
        answer: null,
        source: 'requires_user',
        reason: 'Demographic question - answering is optional and is your choice.',
        optional: true,
      };
    }

    for (const rule of RULES) {
      if (!rule.test.test(text)) continue;
      const raw = p[rule.field];
      // These two are derived from authorized_countries + the posting's
      // location, so an empty stored field is not itself a gap.
      const derivesFromCountry = rule.field === 'work_authorization' || rule.field === 'requires_sponsorship';
      if (!derivesFromCountry && (raw === null || raw === undefined || raw === '')) {
        return {
          ...base,
          answer: null,
          source: 'profile_gap',
          missingField: rule.field,
          reason: `Your Application Profile has no value for "${labelFor(rule.field)}".`,
        };
      }
      const rendered = rule.render(raw, p, ctx);
      if (rendered === null) {
        if (derivesFromCountry) {
          return {
            ...base,
            answer: null,
            source: 'requires_user',
            reason: ctx.country
              ? `Your profile does not say whether you are authorised to work in ${ctx.country}.`
              : "This posting's country could not be determined, so work authorisation cannot be answered automatically.",
          };
        }
        return {
          ...base, answer: null, source: 'profile_gap', missingField: rule.field,
          reason: `Your Application Profile has no value for "${labelFor(rule.field)}".`,
        };
      }
      // For a select/radio, only accept the value if it actually matches one of
      // the offered options - otherwise submitting it would either fail or pick
      // the wrong entry.
      if (allOptions && allOptions.length) {
        const hit = allOptions.find(
          (o) => String(o).trim().toLowerCase() === String(rendered).trim().toLowerCase()
        );
        if (!hit) {
          return {
            ...base,
            answer: null,
            source: 'requires_user',
            suggestion: rendered,
            reason: optionMismatchReason(rendered),
          };
        }
        return { ...base, answer: hit, source: 'profile', profileField: rule.field };
      }
      return { ...base, answer: rendered, source: 'profile', profileField: rule.field };
    }

    return {
      ...base,
      answer: null,
      source: 'unmapped',
      reason: 'No saved answer covers this question.',
    };
  });
}

function normalizeKey(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 120);
}

const LABELS = {
  full_name: 'Full name', email: 'Email', phone: 'Phone',
  current_location: 'Current location', linkedin_url: 'LinkedIn URL',
  portfolio_url: 'Portfolio URL', github_url: 'GitHub URL',
  years_experience: 'Years of experience', current_company: 'Current company',
  current_title: 'Current title', work_authorization: 'Work authorization',
  requires_sponsorship: 'Requires visa sponsorship',
  willing_to_relocate: 'Willing to relocate', notice_period: 'Notice period',
  salary_expectation: 'Salary expectation', pronouns: 'Pronouns',
};
function labelFor(field) { return LABELS[field] || field; }

// Summary the review screen uses to show, at a glance, whether an application
// can go out without the user typing anything.
function summarize(prefilled) {
  const total = prefilled.length;
  const answered = prefilled.filter((a) => a.answer !== null && a.answer !== '').length;
  const blocking = prefilled.filter(
    (a) => a.required && !a.optional && (a.answer === null || a.answer === '')
  );
  return {
    total,
    answered,
    unanswered: total - answered,
    blockingCount: blocking.length,
    blockingQuestions: blocking.map((b) => b.question),
    readyWithoutInput: blocking.length === 0,
  };
}


/*
 * A7.4b — ONE definition of this sentence.
 *
 * It was written out at two call sites, and a third copy of it is sitting in
 * every applications.screening_answers row already persisted. Correcting the
 * stored rows means regenerating the sentence, and regenerating it from a
 * second spelling is how A7.17's ranking paths drifted. Generator and
 * corrector call this.
 */
function optionMismatchReason(savedAnswer) {
  return `Your saved answer ("${String(savedAnswer ?? '').slice(0, 70)}") is not one of this form's options.`;
}

/*
 * The shape this replaces: the saved answer's QUESTION was quoted, and that
 * field holds an internal profile key, so the page read
 *   Your saved answer to "are_you_hispanic_latino" is not one of this form's
 *   options.
 * Matched here rather than in the migration so the corrector cannot look for
 * one thing while the generator emits another.
 */
const OPTION_MISMATCH_LEGACY = /^Your saved answer to "[^"]*" is not one of this form's options\.$/;

/**
 * The corrected reason for a stored question, or null if it needs no change.
 *
 * Recomputed from `suggestion` - the saved answer the generator itself uses -
 * never patched out of the old sentence. Returns null rather than guessing
 * when there is no saved answer to name.
 */
function correctedReason(question) {
  const reason = question && question.reason;
  if (typeof reason !== 'string' || !OPTION_MISMATCH_LEGACY.test(reason)) return null;
  const saved = question.suggestion;
  if (saved === null || saved === undefined || String(saved).trim() === '') return null;
  const next = optionMismatchReason(saved);
  return next === reason ? null : next;
}

module.exports = {
  prefillAnswers, summarize, normalizeKey, labelFor, LABELS,
  optionMismatchReason, correctedReason, OPTION_MISMATCH_LEGACY,
  countryForLocation, isAuthorizedIn,
};
