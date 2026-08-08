/*
 * Feature 14 — the referral finder assembles PATHS, never people.
 *
 * The network module's founding rule: a fabricated name is not a smaller
 * version of a real one. A referral path for a job is exactly three honest
 * ingredients - the user's own tracked contacts at that company, the contact
 * addresses the employer published in the posting text, and LinkedIn
 * searches into the real index. Empty baskets stay empty and say so.
 */

/*
 * Moved here from routes/jobs.js (one definition; a service must not require
 * a route file - the experienceBands precedent). Behaviour unchanged:
 * only addresses genuinely present in the source text, noise filtered,
 * never a first.last@company.com construction.
 */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_NOISE = /(noreply|no-reply|donotreply|privacy|legal|abuse|security|unsubscribe|support@(wordpress|wixpress))/i;

function extractContactEmails(description) {
  if (!description) return [];
  const found = String(description).match(EMAIL_RE) || [];
  const seen = new Set();
  return found
    .map((e) => e.replace(/[.,;:)\]]+$/, '').toLowerCase())
    .filter((e) => {
      if (EMAIL_NOISE.test(e) || seen.has(e)) return false;
      seen.add(e);
      return true;
    })
    .slice(0, 3);
}

// Exact-equality company matching, the feature-12 lesson one module over:
// "Adyen B.V." is a judgement call the user makes, not a substring the code
// makes for them.
const normalizeCompany = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Same search shapes the network page offers, built per job.
const SEARCH_ROLES = [
  { key: 'recruiter', label: 'Recruiters & talent partners', terms: 'recruiter OR "talent acquisition" OR "talent partner"' },
  { key: 'hiring_manager', label: 'Hiring managers & team leads', terms: '"hiring manager" OR "design lead" OR "engineering manager" OR director' },
  { key: 'peer', label: 'People already in this kind of role', terms: null },
];

const linkedInPeopleUrl = (company, terms) =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${company} ${terms || ''}`.trim())}`;

function buildReferralPath({ job, contacts = [] }) {
  const companyStated = Boolean(job.company_name);
  const companyKey = normalizeCompany(job.company_name);

  return {
    job: {
      id: job.id,
      title: job.title,
      company_name: job.company_name || null,
      companyStated,
    },
    yourContacts: companyStated
      ? contacts.filter((c) => normalizeCompany(c.company_name) === companyKey)
      : [],
    postedContacts: extractContactEmails(job.description),
    searches: companyStated
      ? SEARCH_ROLES.map((r) => ({
        key: r.key,
        label: r.label,
        url: linkedInPeopleUrl(job.company_name, r.key === 'peer' ? (job.title || '') : r.terms),
      }))
      : [],
    ...(companyStated ? {} : {
      searchesUnavailableReason: 'This posting does not state a company, so there is nobody to search for. Open the original posting to find the employer.',
    }),
    // Explicit, as everywhere in the network module: these are paths to real
    // people, not people HirePilot has identified.
    areIdentifiedPeople: false,
  };
}

module.exports = { buildReferralPath, extractContactEmails };
