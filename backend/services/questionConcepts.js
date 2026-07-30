/*
 * Canonical question concepts.
 *
 * Every ATS asks the same twenty-odd things in its own words. This maps those
 * wordings onto one concept each, so an answer given once is reused everywhere -
 * and, just as importantly, so that questions which merely *sound* alike are
 * kept apart.
 *
 * The discriminator problem is the whole reason this file exists rather than a
 * pure similarity score. "What is your current salary?" and "What is your
 * expected salary?" share almost every token; matching them would put the wrong
 * number on a real application. So each concept declares:
 *
 *   any    - at least one must appear (the topic)
 *   all    - every one must appear (rarely needed)
 *   none   - if any appears, this concept is ruled OUT (the discriminator)
 *
 * `none` is what separates CURRENT_SALARY from EXPECTED_SALARY, WORK_AUTH from
 * VISA_SPONSORSHIP, and CURRENT_EMPLOYER from PREVIOUS_EMPLOYER.
 */

const CONCEPTS = [
  {
    id: 'visa_sponsorship',
    label: 'Visa sponsorship',
    profileField: 'requires_sponsorship',
    // Checked before work_authorization: sponsorship questions almost always
    // also contain "work" and "authorization".
    priority: 10,
    any: [/sponsor/i, /\bh-?1b\b/i, /visa\s+support/i],
    none: [],
  },
  {
    id: 'work_authorization',
    label: 'Work authorization',
    profileField: 'authorized_countries',
    priority: 9,
    any: [/legally\s+(authori[sz]ed|entitled|eligible)/i, /authori[sz]ed\s+to\s+work/i,
      /right\s+to\s+work/i, /work\s+permit/i, /eligible\s+to\s+work/i, /work\s+authori[sz]ation/i],
    none: [/sponsor/i],
  },
  {
    id: 'expected_salary',
    label: 'Expected salary',
    profileField: 'salary_expectation',
    priority: 8,
    any: [/expect/i, /desired/i, /require[ds]?\s+(salary|compensation)/i, /asking/i, /target\s+(salary|comp)/i],
    all: [/salary|compensation|\bpay\b|\bctc\b|remuneration|package/i],
    // Must never absorb a current-salary question.
    none: [/current(ly)?\s+(salary|compensation|ctc|pay|earning)/i, /present\s+(salary|ctc)/i, /existing\s+(salary|ctc)/i],
  },
  {
    id: 'current_salary',
    label: 'Current salary',
    profileField: null,
    priority: 8,
    any: [/current/i, /present/i, /existing/i, /latest\s+drawn/i, /last\s+drawn/i],
    all: [/salary|compensation|\bpay\b|\bctc\b|remuneration|package/i],
    // ...and must never absorb an expected-salary question.
    none: [/expect/i, /desired/i, /asking/i, /target/i],
  },
  {
    id: 'notice_period',
    label: 'Notice period / start date',
    profileField: 'notice_period',
    priority: 7,
    any: [/notice\s+period/i, /when\s+(can|could|would)\s+you\s+(start|join|begin)/i,
      /earliest\s+(start|joining|available)/i, /availability\s+to\s+start/i,
      /how\s+soon\s+can\s+you/i, /start\s+date/i, /able\s+to\s+start/i, /join\s+us/i],
    none: [/salary/i],
  },
  {
    id: 'relocation',
    label: 'Willingness to relocate',
    profileField: 'willing_to_relocate',
    priority: 7,
    any: [/relocat/i, /willing\s+to\s+move/i, /move\s+to/i],
    // Travel is a different commitment entirely.
    none: [/travel/i],
  },
  {
    id: 'travel',
    label: 'Willingness to travel',
    profileField: null,
    priority: 7,
    any: [/travel/i],
    none: [/relocat/i],
  },
  {
    id: 'non_compete',
    label: 'Restrictive agreements / non-compete',
    profileField: null,
    priority: 8,
    any: [/non-?compete/i, /non-?solicit/i, /restrictive\s+covenant/i,
      /bound\s+by\s+any\s+agreement/i, /restrict\s+your\s+ability/i,
      /contractual\s+obligation/i, /\bnda\b/i, /confidentiality\s+agreement/i],
    none: [],
  },
  {
    id: 'security_clearance',
    label: 'Security clearance',
    profileField: null,
    priority: 8,
    any: [/security\s+clearance/i, /clearance\s+level/i, /\bts\/sci\b/i, /government\s+clearance/i],
    none: [],
  },
  {
    id: 'background_check',
    label: 'Background check',
    profileField: null,
    priority: 7,
    any: [/background\s+(check|screen)/i, /criminal\s+(record|history|background)/i, /convicted/i, /felony/i],
    none: [/drug/i],
  },
  {
    id: 'drug_test',
    label: 'Drug test',
    profileField: null,
    priority: 7,
    any: [/drug\s+(test|screen)/i, /substance\s+screen/i],
    none: [],
  },
  {
    id: 'years_experience',
    label: 'Years of experience',
    profileField: 'years_experience',
    priority: 6,
    any: [/years?\s+of\s+(relevant\s+)?experience/i, /how\s+many\s+years/i, /total\s+experience/i,
      /years?\s+experience/i],
    none: [],
  },
  {
    id: 'current_employer',
    label: 'Current employer',
    profileField: 'current_company',
    priority: 6,
    any: [/current\s+(\w+\s+)?(employer|company|organi[sz]ation)/i, /present\s+(\w+\s+)?(employer|company)/i,
      /who\s+do\s+you\s+work\s+for/i],
    none: [/previous/i, /former/i, /past/i, /title|role|designation/i],
  },
  {
    id: 'current_title',
    label: 'Current job title',
    profileField: 'current_title',
    priority: 6,
    any: [/current\s+(\w+\s+)?(title|role|designation|position)/i, /present\s+(\w+\s+)?(title|role)/i,
      /(job|position)\s+title/i],
    none: [/previous/i, /former/i, /company|employer/i],
  },
  {
    id: 'linkedin', label: 'LinkedIn', profileField: 'linkedin_url', priority: 9,
    any: [/linkedin/i], none: [],
  },
  {
    id: 'github', label: 'GitHub', profileField: 'github_url', priority: 9,
    any: [/github/i, /gitlab/i], none: [],
  },
  {
    id: 'portfolio', label: 'Portfolio / website', profileField: 'portfolio_url', priority: 5,
    any: [/portfolio/i, /personal\s+(site|website)/i, /dribbble/i, /behance/i, /\bwebsite\b/i, /case\s+stud/i],
    none: [/linkedin/i, /github/i, /company\s+website/i],
  },
  {
    id: 'phone', label: 'Phone', profileField: 'phone', priority: 9,
    any: [/\bphone\b/i, /\bmobile\b/i, /telephone/i, /contact\s+number/i], none: [],
  },
  {
    id: 'email', label: 'Email', profileField: 'email', priority: 9,
    any: [/e-?mail/i], none: [],
  },
  {
    id: 'full_name', label: 'Full name', profileField: 'full_name', priority: 9,
    any: [/full\s+name/i, /^name$/i, /your\s+name/i, /legal\s+name/i], none: [/company|user|file/i],
  },
  {
    id: 'location', label: 'Current location', profileField: 'current_location', priority: 4,
    any: [/current\s+location/i, /where\s+are\s+you\s+(based|located)/i, /city\s+of\s+residence/i,
      /\blocation\b/i, /\bcity\b/i],
    none: [/relocat/i, /office\s+location/i, /job\s+location/i, /preferred\s+location/i],
  },
  {
    id: 'pronouns', label: 'Pronouns', profileField: 'pronouns', priority: 9,
    any: [/pronoun/i], none: [],
  },
  {
    id: 'gender', label: 'Gender', profileField: null, priority: 9,
    any: [/\bgender\b/i], none: [/pronoun/i],
  },
  {
    id: 'race_ethnicity', label: 'Race / ethnicity', profileField: null, priority: 9,
    any: [/\brace\b/i, /ethnic/i, /hispanic/i, /latino/i], none: [],
  },
  {
    id: 'veteran', label: 'Veteran status', profileField: null, priority: 9,
    any: [/veteran/i, /military\s+service/i], none: [],
  },
  {
    id: 'disability', label: 'Disability status', profileField: null, priority: 9,
    any: [/disabilit/i, /disabled/i], none: [],
  },
  {
    id: 'education_level', label: 'Education level', profileField: null, priority: 5,
    any: [/highest\s+(level\s+of\s+)?education/i, /degree/i, /education\s+level/i,
      /university/i, /\bcollege\b/i, /\bschool\b/i, /graduat/i, /field\s+of\s+study/i, /\bmajor\b/i],
    none: [],
  },
  {
    id: 'referral_source', label: 'How you heard about the role', profileField: null, priority: 6,
    any: [/how\s+did\s+you\s+hear/i, /referr?al/i, /referred\s+by/i, /how\s+did\s+you\s+find/i,
      /where\s+did\s+you\s+(hear|find)/i], none: [],
  },
  {
    id: 'work_arrangement', label: 'Remote / hybrid / on-site', profileField: null, priority: 5,
    any: [/\bremote\b/i, /\bhybrid\b/i, /on-?site/i, /in\s+person/i, /work\s+from\s+(home|office)/i,
      /days?\s+(a|per)\s+week\s+in/i], none: [/travel/i, /relocat/i],
  },
];

const byId = new Map(CONCEPTS.map((c) => [c.id, c]));

/**
 * Classify a question into a canonical concept.
 *
 * Confidence reflects how much of the concept's signature the question carries,
 * NOT how sure we are of the answer. A high-priority exact topic hit with no
 * disqualifier is 1.0; a single weak hit is lower.
 *
 * @returns {{conceptId, label, profileField, confidence}|null}
 */
function classify(question) {
  const text = String(question || '');
  if (!text.trim()) return null;

  let best = null;
  for (const c of CONCEPTS) {
    // A disqualifier rules the concept out entirely - this is what keeps
    // "current salary" and "expected salary" apart, and it is not a score
    // penalty because a near-miss there is a wrong answer, not a weak one.
    if (c.none && c.none.some((re) => re.test(text))) continue;
    if (c.all && !c.all.every((re) => re.test(text))) continue;

    const hits = (c.any || []).filter((re) => re.test(text)).length;
    if (!hits) continue;

    // More topic hits and a more specific concept both raise confidence.
    const hitScore = Math.min(1, 0.55 + 0.2 * hits);
    const priorityBoost = (c.priority || 5) / 100;
    const confidence = Math.min(1, Number((hitScore + priorityBoost).toFixed(3)));

    if (!best || confidence > best.confidence
      || (confidence === best.confidence && (c.priority || 0) > (best.priority || 0))) {
      best = {
        conceptId: c.id,
        label: c.label,
        profileField: c.profileField || null,
        confidence,
        priority: c.priority || 5,
      };
    }
  }
  if (!best) return null;
  delete best.priority;
  return best;
}

function getConcept(id) { return byId.get(id) || null; }

module.exports = { CONCEPTS, classify, getConcept };
