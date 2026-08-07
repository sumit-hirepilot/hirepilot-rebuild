/*
 * A controlled stand-in for an employer's Greenhouse application form.
 *
 * A5 defers to counsel whether HirePilot may drive automation against a real
 * employer's board. This page replaces exactly one thing - the employer's form
 * and its confirmation page - so the rest of the pipeline can be proved end to
 * end without an automated application landing in a real company's ATS.
 *
 * IT IS BUILT TO THE ADAPTER'S SELECTORS, DELIBERATELY, and that is also its
 * limit. `extension/content/adapters/greenhouse.js` claims a page when it finds
 * `#application_form` or fields named `job_application[...]`, so this markup is
 * the legacy Greenhouse board's, field for field. That means the real adapter,
 * the real field resolver and the real runner all execute against it.
 *
 * It can therefore never catch SELECTOR DRIFT on the live boards: a page shaped
 * to fit will always fit. Only a real board can prove that, and that is the run
 * A5 gates. The delta is written up in SUBMISSION_AUDIT.md.
 *
 * Nothing here is reachable from the product's navigation, and the banner says
 * what it is on every render. A test target that could be mistaken for a real
 * employer would be its own defect.
 */

import Head from 'next/head';
import { useState } from 'react';
import { API_BASE } from '../../lib/apiBase';

export default function GreenhouseSandbox() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ats-sandbox/submit`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(e.target),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
    } catch (err) {
      setError(err.message);
    }
  }

  /*
   * The confirmation is rendered into the SAME document rather than by
   * navigating, because the runner reads the post-submit page's text and the
   * wording has to be what SUCCESS_SIGNALS actually matches.
   */
  if (result) {
    return (
      <>
        <Head><title>Application received</title></Head>
        <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
          <p style={{ background: '#fde68a', color: '#78350f', padding: '.75rem 1rem', borderRadius: 8, fontWeight: 600 }}>
            HirePilot controlled test target — not a real employer, and no application was sent to one.
          </p>
          <h1>Thank you for applying.</h1>
          <p>
            Your application has been received. Confirmation number{' '}
            <strong data-hp-confirmation-id>{result.confirmationId}</strong>.
          </p>
          <p style={{ color: '#475569' }}>
            Captured {result.received?.file ? `resume ${result.received.file.filename} (${result.received.file.bytes} bytes)` : 'no file'}.
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      <Head><title>Apply — Senior Product Designer (HirePilot test target)</title></Head>
      <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
        <p style={{ background: '#fde68a', color: '#78350f', padding: '.75rem 1rem', borderRadius: 8, fontWeight: 600 }}>
          HirePilot controlled test target — not a real employer. Nothing submitted here reaches anyone.
        </p>
        <h1>Senior Product Designer</h1>

        {/* Legacy Greenhouse board markup: the id and the job_application[...]
            field names are both things the shipped adapter matches on. */}
        <form id="application_form" onSubmit={onSubmit} encType="multipart/form-data">
          <label htmlFor="first_name">First Name *</label>
          <input id="first_name" name="job_application[first_name]" type="text" autoComplete="given-name" required />

          <label htmlFor="last_name">Last Name *</label>
          <input id="last_name" name="job_application[last_name]" type="text" autoComplete="family-name" required />

          <label htmlFor="email">Email *</label>
          <input id="email" name="job_application[email]" type="email" required />

          <label htmlFor="phone">Phone</label>
          <input id="phone" name="job_application[phone]" type="tel" />

          <label htmlFor="resume">Resume/CV *</label>
          <input id="resume" name="job_application[resume]" type="file" accept=".pdf,.doc,.docx,.txt" required />

          <label htmlFor="cover_letter_text">Cover Letter</label>
          <textarea id="cover_letter_text" name="job_application[cover_letter]" rows={5} />

          {/* Screening questions, the part the answer engine fills. */}
          <label htmlFor="q_authorised">Are you legally authorized to work in this country? *</label>
          <select id="q_authorised" name="job_application[answers][work_authorised]" required defaultValue="">
            <option value="" disabled>Select...</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>

          <label htmlFor="q_sponsorship">Will you now or in the future require sponsorship? *</label>
          <select id="q_sponsorship" name="job_application[answers][sponsorship]" required defaultValue="">
            <option value="" disabled>Select...</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>

          <label htmlFor="q_notice">What is your notice period?</label>
          <input id="q_notice" name="job_application[answers][notice_period]" type="text" />

          <label htmlFor="q_years">How many years of product design experience do you have?</label>
          <input id="q_years" name="job_application[answers][years_experience]" type="text" />

          {/* Demographic questions are present ON PURPOSE. The product must
              never auto-answer these, and a target without them could not show
              that it did not. */}
          <fieldset>
            <legend>Voluntary Self-Identification</legend>
            <label htmlFor="d_gender">Gender</label>
            <select id="d_gender" name="job_application[demographic][gender]" defaultValue="">
              <option value="">Decline To Self Identify</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>

            <label htmlFor="d_veteran">Veteran Status</label>
            <select id="d_veteran" name="job_application[demographic][veteran]" defaultValue="">
              <option value="">Decline To Self Identify</option>
              <option value="Yes">I am a protected veteran</option>
              <option value="No">I am not a protected veteran</option>
            </select>
          </fieldset>

          <button id="submit_app" type="submit">Submit Application</button>
        </form>

        {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
      </main>
    </>
  );
}
