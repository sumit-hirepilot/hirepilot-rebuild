// Heuristic resume parsing. No LLM is configured for this app, so this is
// honest dictionary/regex-based extraction, not true AI understanding - it
// works well on well-formatted resumes and is always presented to the user
// for review/edit before being saved, never applied silently.

const SKILL_DICTIONARY = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin',
  'React', 'React Native', 'Vue', 'Angular', 'Next.js', 'Node.js', 'Express', 'Django', 'Flask', 'Rails',
  'Spring', 'GraphQL', 'REST API', 'HTML', 'CSS', 'Sass', 'Tailwind',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'SQLite', 'DynamoDB', 'Elasticsearch',
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Jenkins', 'GitHub Actions',
  'Git', 'Linux', 'Bash', 'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'Pandas', 'NumPy',
  'Figma', 'Sketch', 'Adobe XD', 'Photoshop', 'Illustrator', 'UI Design', 'UX Design', 'UX Research',
  'Design Systems', 'Prototyping', 'Wireframing', 'User Research', 'Usability Testing',
  'Product Management', 'Agile', 'Scrum', 'Kanban', 'JIRA', 'Roadmapping', 'A/B Testing',
  'Project Management', 'Stakeholder Management', 'Data Analysis', 'SQL', 'Excel', 'Tableau', 'Power BI',
  'Sales', 'Business Development', 'Account Management', 'CRM', 'Salesforce', 'HubSpot',
  'Marketing', 'SEO', 'SEM', 'Content Marketing', 'Social Media Marketing', 'Email Marketing',
  'Recruiting', 'Talent Acquisition', 'HR', 'Onboarding', 'Payroll',
  'Customer Support', 'Customer Success', 'Technical Support',
  'Copywriting', 'Content Writing', 'Editing', 'Public Speaking', 'Negotiation', 'Leadership',
];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/*
 * Dictionary entries that are also ordinary English words.
 *
 * Word-boundary matching already stopped "Go" matching inside "Google". It
 * does nothing about the standalone verb, and the match was case-INSENSITIVE,
 * so "go" fired too. Measured on 220 live design jobs, "Go" matched 45 of
 * them (20.5%) - including:
 *
 *     "Go beyond execution to a place of thought leadership"
 *
 * That is Tsenta's "Go-Carts" failure inside our own dictionary. It inflates
 * the skills denominator on every formula, so it is fixed before the D49
 * re-score rather than after.
 *
 * The rule for these, and only these: match the dictionary's own casing, and
 * require a nearby signal that this is a technology being listed - a list
 * delimiter with another skill beside it, or an explicit qualifier. Everything
 * else in the dictionary is long enough to be unambiguous and is untouched.
 */
/*
 * 'R' and 'C' are listed for the day they are added - neither is in
 * SKILL_DICTIONARY today, so they are inert rather than doing anything. Said
 * plainly so nobody reads this set as evidence they are handled.
 */
const AMBIGUOUS = new Set(['Go', 'R', 'C', 'Excel']);

/** "Go, Rust, Python" / "Go/Kubernetes" / "· Go ·" - a list, not a sentence. */
const LIST_NEIGHBOUR = /[,/|•·;\n\t]\s*$|^\s*[,/|•·;)]/;
/** "Golang", "Go developer", "R programming", "proficient in Excel" */
const EXPLICIT = {
  Go: /\bGolang\b|\bGo\s+(?:developer|programming|programmer|engineer|lang|routines?|modules?)\b|\b(?:written|built|backend)\s+in\s+Go\b/i,
  R: /\bR\s+(?:programming|language|studio|script)\b|\bRStudio\b/i,
  C: /\bC\s+(?:programming|language|developer)\b/i,
  Excel: /\b(?:Microsoft|MS)\s+Excel\b|\bExcel\s+(?:spreadsheets?|models?|macros?|formulas?|skills)\b|\b(?:advanced|proficient|strong)\s+(?:in\s+)?Excel\b/i,
};

/**
 * Is this occurrence of an ambiguous term a technology, or just the word?
 *
 * Errs toward NOT counting it. A false negative loses one skill from one job's
 * denominator; a false positive puts "Go" on a designer's match breakdown and
 * inflates every score built on it.
 */
function ambiguousReallyMeansTheSkill(text, skill) {
  if (EXPLICIT[skill] && EXPLICIT[skill].test(text)) return true;

  // Case-SENSITIVE from here: the language is capitalised, the verb usually is
  // not. Sentence-initial "Go" is the one case this still lets through, which
  // is why the list check below has to agree as well.
  const re = new RegExp(`(?<![a-zA-Z0-9])${escapeRegExp(skill)}(?![a-zA-Z0-9])`, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    const after = text.slice(m.index + skill.length, m.index + skill.length + 30);
    if (LIST_NEIGHBOUR.test(before) || LIST_NEIGHBOUR.test(after)) return true;
  }
  return false;
}

// Word-boundary match (not plain substring) so short/common skill names like
// "Go" or "HR" don't false-positive inside unrelated words - "Go" was
// matching inside "Google", "HR" inside "through".
function extractSkills(text) {
  const t = String(text || '');
  return SKILL_DICTIONARY.filter((skill) => {
    if (AMBIGUOUS.has(skill)) return ambiguousReallyMeansTheSkill(t, skill);
    const pattern = new RegExp(`(?<![a-zA-Z0-9])${escapeRegExp(skill)}(?![a-zA-Z0-9])`, 'i');
    return pattern.test(t);
  });
}

function extractEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

function extractPhone(text) {
  const match = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  return match ? match[0] : null;
}

const MONTHS = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*';
const DATE_RANGE_RE = new RegExp(
  `(${MONTHS}\\.?\\s+\\d{4}|\\d{4})\\s*(?:-|–|—|to)\\s*(${MONTHS}\\.?\\s+\\d{4}|\\d{4}|Present|Current)`,
  'gi'
);

// Best-effort experience extraction: finds date ranges and grabs the
// surrounding lines as a title/company guess. Always meant for user review.
function extractExperience(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const entries = [];

  lines.forEach((line, i) => {
    const match = DATE_RANGE_RE.exec(line);
    DATE_RANGE_RE.lastIndex = 0;
    if (!match) return;

    // Education entries have the same "date range on a line" shape as jobs
    // (e.g. "Bachelor of Design ... 2012 - 2016") - skip lines that read as
    // a degree rather than a job.
    if (/\b(bachelor|master|ph\.?d|b\.?tech|b\.?sc|m\.?tech|m\.?sc|mba|diploma|university|college|institute)\b/i.test(line)) {
      return;
    }

    const startRaw = match[1];
    const endRaw = match[2];
    const currentlyWorking = /present|current/i.test(endRaw);

    // The title/company is usually on this line (before the dates) or the previous line
    let context = line.replace(match[0], '').trim();
    if (context.length < 3 && i > 0) context = lines[i - 1];

    const parts = context
      .split(/\s*·\s*|\s+(?:at|@|,|-|\|)\s+/i)
      .map((p) => p.trim())
      .filter(Boolean);
    const jobTitle = parts[0]?.slice(0, 150) || null;
    const companyName = parts[1]?.slice(0, 150) || null;

    entries.push({
      jobTitle,
      companyName,
      startDateRaw: startRaw,
      endDateRaw: currentlyWorking ? null : endRaw,
      currentlyWorking,
    });
  });

  return entries.slice(0, 8);
}

function parseResume(text) {
  return {
    skills: extractSkills(text),
    experience: extractExperience(text),
    email: extractEmail(text),
    phone: extractPhone(text),
  };
}

module.exports = { parseResume, extractSkills, extractExperience, SKILL_DICTIONARY };
