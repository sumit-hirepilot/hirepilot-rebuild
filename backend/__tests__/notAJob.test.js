/*
 * A7.12 — a row that is not a job posting must never be stored.
 *
 * Observed on production: a candidate's own bio - "Hi! I am Max. I am a Design
 * Leader with 13+ years..." - indexed as a job with a working Apply Now and
 * Auto-Pilot on, its job_url pointing at linkedin.com/in/<person>. Four
 * sibling rows resolved to greenhouse, the ONE enabled adapter, so they were
 * genuinely reachable by automated apply. Applying to a person is a real
 * submission that cannot be taken back.
 *
 * The fixtures below are the actual production values, not invented ones.
 */

const fs = require('fs');
const path = require('path');
const { notAJobReason } = require('../services/parsedField');

describe('A7.12 — the guard rejects what is not a job', () => {
  it('rejects a bio indexed as a job', () => {
    expect(notAJobReason({
      title: 'Hi! I am Max. I am a Design Leader with 13+ years of experience',
      company_name: 'Hi! I am Max. I am a Design Leader with 13+ years of experience and extensive knowledge in several areas',
      job_url: 'https://www.linkedin.com/in/maxberdnikau/',
    })).toBeTruthy();
  });

  it('rejects a company field that is a whole sentence', () => {
    // The parse failed; the text being about hiring does not make it a company.
    expect(notAJobReason({
      title: 'I am a recruiter for Turquoise',
      company_name: 'I am a recruiter for Turquoise and we are hiring a Senior Performance Engineer for our Data Products team based in the United States.',
      job_url: 'https://jobs.ashbyhq.com/turquoise-health/abc',
    })).toBeTruthy();
  });

  it('rejects a destination that identifies a person, not a posting', () => {
    expect(notAJobReason({
      title: 'Senior Designer', company_name: 'Acme',
      job_url: 'https://www.linkedin.com/in/someone/',
    })).toBeTruthy();
  });

  it('rejects a row whose title and company are the same text', () => {
    // The signature of a parser slicing one string into both fields.
    expect(notAJobReason({
      title: 'Hey everyone, we are hiring an Agentic AI staff engineer',
      company_name: 'Hey everyone, we are hiring an Agentic AI staff engineer to build our platform',
      job_url: 'https://example.com/job/1',
    })).toBeTruthy();
  });

  it('keeps real postings, including ones with long titles', () => {
    // A guard that rejects real jobs is worse than none: it silently shrinks
    // the index and nobody notices.
    for (const row of [
      { title: 'Senior Product Designer', company_name: 'Vercel', job_url: 'https://job-boards.greenhouse.io/vercel/jobs/1' },
      { title: 'Staff Engineer, Platform', company_name: 'Republic Services', job_url: 'https://jobs.republicservices.com/us/en/job/R-1' },
      { title: 'Senior Research Software Engineer', company_name: 'Anthropic', job_url: 'https://boards.greenhouse.io/x/jobs/2' },
      { title: 'UX Designer Senior', company_name: 'Valtech', job_url: 'https://jobs.lever.co/valtech/3' },
    ]) {
      expect(notAJobReason(row)).toBeNull();
    }
  });
});

describe('A7.12 — the HN adapter withholds what it cannot parse', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'apis', 'hackernews.js'), 'utf8'
  );

  it('requires the pipe convention rather than guessing an employer', () => {
    // Without pipes, segments[0] was the ENTIRE first line - that is how a
    // paragraph became a company name.
    expect(src).toMatch(/segments\.length\s*<\s*2/);
    expect(src).not.toMatch(/segments\[0\]\s*\|\|\s*'Company hiring via HN'/);
  });

  it('drops the unparseable comments instead of mapping them through', () => {
    expect(src).toMatch(/\.filter\(Boolean\)/);
  });
});

describe('A7.12 — ingestion applies the guard', () => {
  const agg = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'jobAggregator.js'), 'utf8'
  );

  it('calls notAJobReason before storing', () => {
    expect(agg).toMatch(/notAJobReason\(normalized\)/);
  });

  it('records WHY a row was withheld rather than skipping silently', () => {
    expect(agg).toMatch(/sourceStats\.notAJob/);
  });
});
