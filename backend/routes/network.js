const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);

// Search entry points for finding real people at a company.
//
// This previously returned invented contacts: a first name, surname and job
// title each picked at random from hardcoded lists, plus a fabricated
// "N mutual connections" count, all seeded by company name so the same
// fiction reappeared consistently. It rendered as an identified hiring
// manager - "Grace Chen · Engineering Manager · 6 mutual connections" - when
// no person had been identified at all. Acting on it meant contacting nobody,
// or worse, contacting a real namesake about a role they have no part in.
//
// It now returns searches the user runs themselves against LinkedIn's real
// index. No names, no titles, no counts are asserted by HirePilot.
const SEARCH_ROLES = [
  { key: 'recruiter', label: 'Recruiters & talent partners', terms: 'recruiter OR "talent acquisition" OR "talent partner"' },
  { key: 'hiring_manager', label: 'Engineering & design leadership', terms: '"engineering manager" OR "design lead" OR "head of design" OR director' },
  { key: 'peer', label: 'People already in this kind of role', terms: null },
];

const linkedInPeopleUrl = (company, terms) =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${company} ${terms || ''}`.trim())}`;

router.post('/suggest', async (req, res) => {
  try {
    const { company, roleTitle } = req.body;
    if (!company || !company.trim()) {
      return res.status(400).json({ error: 'company is required' });
    }
    const name = company.trim();

    const searches = SEARCH_ROLES.map((r) => ({
      key: r.key,
      label: r.label,
      // The peer search uses the target job title when one was passed, which
      // is the user's own real context rather than an assumption.
      url: linkedInPeopleUrl(name, r.key === 'peer' ? (roleTitle || '') : r.terms),
    }));

    res.json({
      company: name,
      // Explicit so the client cannot mistake these for identified people.
      areIdentifiedPeople: false,
      searches,
      note: 'These are searches to run, not people HirePilot has identified. Add a contact below once you find a real one.',
    });
  } catch (err) {
    console.error('Build contact searches error:', err);
    res.status(500).json({ error: 'Failed to build contact searches' });
  }
});

// List tracked contacts, optionally filtered by job
router.get('/', async (req, res) => {
  try {
    const { jobId } = req.query;
    const params = [req.user.id];
    let where = 'WHERE r.user_id = $1';

    if (jobId) {
      params.push(jobId);
      where += ` AND r.job_id = $${params.length}`;
    }

    const result = await query(
      `SELECT r.*, j.title as target_job_title, j.company_name as job_company_name
       FROM referrals r
       LEFT JOIN jobs j ON r.job_id = j.id
       ${where}
       ORDER BY r.created_at DESC`,
      params
    );

    res.json({ contacts: result.rows });
  } catch (err) {
    console.error('List contacts error:', err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// Track a contact (from a suggestion, or manually)
router.post('/', async (req, res) => {
  try {
    const {
      jobId, companyName, firstName, lastName, email, linkedinUrl,
      jobTitle, relationshipType, notes,
    } = req.body;

    if (!companyName) {
      return res.status(400).json({ error: 'companyName is required' });
    }

    if (jobId) {
      const jobCheck = await query('SELECT id FROM jobs WHERE id = $1', [jobId]);
      if (!jobCheck.rows.length) return res.status(404).json({ error: 'Job not found' });
    }

    const result = await query(
      `INSERT INTO referrals (
         user_id, job_id, company_name, first_name, last_name, email,
         linkedin_url, job_title, relationship_type, status, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'identified', $10) RETURNING *`,
      [
        req.user.id, jobId || null, companyName, firstName || null, lastName || null,
        email || null, linkedinUrl || null, jobTitle || null,
        relationshipType || 'employee', notes || null,
      ]
    );

    await query(
      `INSERT INTO activity_log (user_id, event_type, metadata)
       VALUES ($1, 'contact_added', $2)`,
      [req.user.id, JSON.stringify({ name: `${firstName || ''} ${lastName || ''}`.trim(), company: companyName })]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add contact error:', err);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { firstName, lastName, email, linkedinUrl, jobTitle, relationshipType, status, notes } = req.body;

    const existingResult = await query('SELECT * FROM referrals WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!existingResult.rows.length) return res.status(404).json({ error: 'Contact not found' });
    const existing = existingResult.rows[0];

    const result = await query(
      `UPDATE referrals SET first_name = $1, last_name = $2, email = $3, linkedin_url = $4,
       job_title = $5, relationship_type = $6, status = $7, notes = $8, updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 AND user_id = $10 RETURNING *`,
      [
        firstName ?? existing.first_name, lastName ?? existing.last_name, email ?? existing.email,
        linkedinUrl ?? existing.linkedin_url, jobTitle ?? existing.job_title,
        relationshipType ?? existing.relationship_type, status ?? existing.status,
        notes ?? existing.notes, req.params.id, req.user.id,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update contact error:', err);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM referrals WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Contact deleted' });
  } catch (err) {
    console.error('Delete contact error:', err);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

/* ------------------------------------------------------------------ *
 * Outreach bundles (PRD 3.6)
 *
 * The PRD asks for "contacts + drafted outreach messages" per company. The
 * drafts are real; the contacts are not invented. This module will happily
 * write the message, and will not tell you who to send it to - the searches
 * above hand that to LinkedIn's own index, where the people actually are.
 *
 * The distinction matters because a fabricated name is not a smaller version of
 * a real one. Sending a warm note to a person who does not work there, or to a
 * real namesake with no part in the role, is worse than sending nothing.
 * ------------------------------------------------------------------ */

const DAILY_LOOKUP_CAP = Number(process.env.OUTREACH_DAILY_CAP || 15);

async function lookupsToday(userId) {
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM outreach_lookups
      WHERE user_id = $1 AND looked_up_on = CURRENT_DATE`,
    [userId]
  );
  return r.rows[0]?.n || 0;
}

/*
 * Draft an outreach message.
 *
 * Templated from the user's own profile rather than generated free-form, for
 * the same reason the cover-letter generator is: an LLM asked to sell someone
 * invents the specifics it is missing, and a claim about your experience that
 * you did not make is one you then have to defend in an interview.
 *
 * Placeholders stay visible as [First name] so an unedited send is obviously
 * unedited, rather than quietly going out addressed to nobody.
 */
function draftOutreach({ company, roleTitle, tone = 'direct', profile = {} }) {
  const me = profile.full_name || 'I';
  const title = profile.current_title ? `a ${profile.current_title}` : 'a designer';
  const years = profile.years_experience ? `${profile.years_experience} years of ` : '';
  const portfolio = profile.portfolio_url ? `\n\nMy work: ${profile.portfolio_url}` : '';

  const openers = {
    direct: `Hi [First name],\n\nI applied for the ${roleTitle || 'open role'} at ${company} and wanted to introduce myself directly.`,
    warm: `Hi [First name],\n\nI have been following what ${company} is building and just applied for the ${roleTitle || 'open role'}.`,
    referral: `Hi [First name],\n\nWe have not met - I am applying for the ${roleTitle || 'open role'} at ${company} and hoped you might point me to the right person on the team.`,
  };

  const body = `I am ${title} with ${years}experience, and the parts of this role around ${roleTitle ? roleTitle.toLowerCase() : 'the team\'s work'} line up closely with what I have been doing.${portfolio}`;
  const close = `\n\nHappy to share more if it is useful.\n\n${me === 'I' ? '' : me}`;

  return `${openers[tone] || openers.direct}\n\n${body}${close}`.trim();
}

// One company -> searches to find real people, plus drafts to send them.
router.post('/outreach', async (req, res) => {
  try {
    const company = String(req.body.company || '').trim();
    if (!company) return res.status(400).json({ error: 'company is required' });

    const used = await lookupsToday(req.user.id);
    if (used >= DAILY_LOOKUP_CAP) {
      return res.status(429).json({
        error: 'Daily lookup limit reached',
        used,
        cap: DAILY_LOOKUP_CAP,
        hint: 'The cap exists because outreach at volume reads as spam to the people receiving it.',
      });
    }

    const p = await query('SELECT * FROM application_profiles WHERE user_id = $1', [req.user.id]);
    const profile = p.rows[0] || {};
    const roleTitle = String(req.body.roleTitle || '').trim() || null;

    await query(
      'INSERT INTO outreach_lookups (user_id, company_name) VALUES ($1, $2)',
      [req.user.id, company.slice(0, 255)]
    );

    res.json({
      company,
      roleTitle,
      searches: SEARCH_ROLES.map((r) => ({
        key: r.key,
        label: r.label,
        url: linkedInPeopleUrl(company, r.terms || roleTitle || ''),
      })),
      drafts: ['direct', 'warm', 'referral'].map((tone) => ({
        tone,
        message: draftOutreach({ company, roleTitle, tone, profile }),
      })),
      lookups: { used: used + 1, cap: DAILY_LOOKUP_CAP, remaining: DAILY_LOOKUP_CAP - used - 1 },
      note: 'HirePilot does not name contacts it has not verified. The searches open LinkedIn\'s own index.',
    });
  } catch (err) {
    console.error('POST /network/outreach failed:', err.message);
    res.status(500).json({ error: 'Could not build an outreach bundle' });
  }
});

// Save a draft against a contact the USER identified. Agent tab.
router.post('/outreach/save', async (req, res) => {
  try {
    const { company, contactName, contactTitle, contactUrl, message } = req.body || {};
    if (!company || !message) return res.status(400).json({ error: 'company and message are required' });
    const r = await query(
      `INSERT INTO outreach_contacts
         (user_id, company_name, contact_name, contact_title, contact_profile_url, draft_message, source, status)
       VALUES ($1,$2,$3,$4,$5,$6,'user','draft') RETURNING id`,
      [
        req.user.id, String(company).slice(0, 255),
        contactName ? String(contactName).slice(0, 255) : null,
        contactTitle ? String(contactTitle).slice(0, 255) : null,
        contactUrl ? String(contactUrl).slice(0, 600) : null,
        String(message).slice(0, 6000),
      ]
    );
    res.status(201).json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    console.error('POST /network/outreach/save failed:', err.message);
    res.status(500).json({ error: 'Could not save that draft' });
  }
});

// Agent / Sent tabs.
router.get('/outreach', async (req, res) => {
  try {
    const status = req.query.status === 'sent' ? 'sent' : 'draft';
    const r = await query(
      `SELECT * FROM outreach_contacts WHERE user_id = $1 AND status = $2
        ORDER BY created_at DESC LIMIT 100`,
      [req.user.id, status]
    );
    res.json({
      outreach: r.rows,
      lookups: { used: await lookupsToday(req.user.id), cap: DAILY_LOOKUP_CAP },
    });
  } catch (err) {
    console.error('GET /network/outreach failed:', err.message);
    res.status(500).json({ error: 'Could not load outreach' });
  }
});

/*
 * Marks a draft as sent. HirePilot does not send it - the user does, from their
 * own account. Sending on someone's behalf to a person we did not verify exists
 * is the failure this whole module is shaped around avoiding.
 */
router.post('/outreach/:id/sent', async (req, res) => {
  try {
    const r = await query(
      `UPDATE outreach_contacts SET status = 'sent', sent_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND user_id = $2 RETURNING id, status, sent_at`,
      [Number(req.params.id), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, ...r.rows[0] });
  } catch (err) {
    console.error('POST /network/outreach/:id/sent failed:', err.message);
    res.status(500).json({ error: 'Could not update that draft' });
  }
});

module.exports = router;
