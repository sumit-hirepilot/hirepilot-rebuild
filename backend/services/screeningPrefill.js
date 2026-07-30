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

// Each rule: which profile field answers it, and how to render that value for
// the field type the form is using.
const RULES = [
  {
    field: 'requires_sponsorship',
    // Checked before work_authorization: this phrasing contains "work" and
    // would otherwise be captured by the authorisation rule below.
    test: /sponsor|visa\s*sponsor|require.*sponsorship|need.*sponsorship|h-?1b/i,
    render: (v) => (v === true ? 'Yes' : v === false ? 'No' : null),
  },
  {
    field: 'work_authorization',
    test: /authoriz|authoris|legally.*(work|entitled)|right to work|work permit|eligible to work/i,
    render: (v) => v || null,
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
const DEMOGRAPHIC = /gender|race|ethnic|veteran|disability|sexual orientation|lgbt/i;

/**
 * @param {Array<{question: string, type?: string, options?: string[], required?: boolean}>} questions
 * @param {object} profile - row from application_profiles (may be {} )
 * @returns {Array} one entry per question with the resolved answer or a gap flag
 */
function prefillAnswers(questions, profile) {
  const p = profile || {};
  const custom = p.custom_answers || {};

  return (questions || []).map((q) => {
    const text = q.question || '';
    const base = {
      question: text,
      type: q.type || 'text',
      options: q.options || null,
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

    // An exact custom answer the user saved for this question wins over any
    // pattern rule.
    const customKey = normalizeKey(text);
    if (custom[customKey] !== undefined && custom[customKey] !== null && custom[customKey] !== '') {
      return { ...base, answer: String(custom[customKey]), source: 'profile_custom' };
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
      if (raw === null || raw === undefined || raw === '') {
        return {
          ...base,
          answer: null,
          source: 'profile_gap',
          missingField: rule.field,
          reason: `Your Application Profile has no value for "${labelFor(rule.field)}".`,
        };
      }
      const rendered = rule.render(raw, p);
      if (rendered === null) {
        return {
          ...base, answer: null, source: 'profile_gap', missingField: rule.field,
          reason: `Your Application Profile has no value for "${labelFor(rule.field)}".`,
        };
      }
      // For a select/radio, only accept the value if it actually matches one of
      // the offered options - otherwise submitting it would either fail or pick
      // the wrong entry.
      if (q.options && q.options.length) {
        const hit = q.options.find(
          (o) => String(o).trim().toLowerCase() === String(rendered).trim().toLowerCase()
        );
        if (!hit) {
          return {
            ...base,
            answer: null,
            source: 'requires_user',
            suggestion: rendered,
            reason: `Your saved answer ("${rendered}") is not one of this form's options.`,
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

module.exports = { prefillAnswers, summarize, normalizeKey, labelFor, LABELS };
