/*
 * Feature 8 — a saved resume version per company.
 *
 * The interesting half is the REFUSAL. A company name is not always known:
 * a pasted JD has no verified employer, a linked job whose page never named
 * one is stored NULL, and aggregators have written literal junk into the field
 * ('name' on a fifth of himalayas' rows, which once rendered as an employer).
 *
 * Filing a resume under any of those would offer it back as "the version you
 * saved for name". So the endpoint refuses, with a reason the UI can render -
 * a refusal the client swallows is the boundary defect this codebase has now
 * shipped twice.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 5 }; next(); },
}));

const { query } = require('../db');
const { companyKeyFor } = require('../services/companyKey');

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { id: 5 }; next(); });
  a.use('/api/resume', require('../routes/resume'));
  return a;
}

/** The tailored resume the request names, with whatever company its job had. */
function owns(company, { exists = true } = {}) {
  query.mockImplementation(async (sql, params) => {
    if (/FROM tailored_resumes t/i.test(sql) && /WHERE t\.id = \$1/i.test(sql)) {
      return { rows: exists ? [{ id: params[0], job_id: 9, source: 'indexed_job', company_name: company }] : [] };
    }
    if (/INSERT INTO company_resume_versions/i.test(sql)) {
      return { rows: [{ id: 1, company_name: params[2], label: params[4], created_at: new Date(), updated_at: new Date(), replaced: false }] };
    }
    return { rows: [] };
  });
}

beforeEach(() => query.mockReset());

describe('the key folds the variants a job board actually produces', () => {
  it.each([
    ['Discord', 'discord'],
    ['discord', 'discord'],
    ['  Discord  ', 'discord'],
    ['Acme, Inc.', 'acme'],
    ['Acme Pvt Ltd.', 'acme'],
    ['Grey Affairs', 'grey affairs'],
  ])('%s -> %s', (input, expected) => {
    const r = companyKeyFor(input);
    expect(r.ok).toBe(true);
    expect(r.key).toBe(expected);
  });

  it('keeps the name the posting used, not the folded key', () => {
    // The key is for matching; the user recognises the original spelling.
    expect(companyKeyFor('Acme, Inc.').name).toBe('Acme, Inc.');
  });

  it('bounds the key to the column width', () => {
    expect(companyKeyFor('x'.repeat(400)).key.length).toBeLessThanOrEqual(120);
  });
});

describe('it refuses when there is no company to file under', () => {
  it.each([null, undefined, '', '   '])('absent company (%p) is refused', (c) => {
    const r = companyKeyFor(c);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('company_unknown');
  });

  it.each(['name', 'N/A', 'unknown', 'Company', '-'])('placeholder %p is refused', (c) => {
    const r = companyKeyFor(c);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('company_not_a_name');
  });

  it('a name of only punctuation is refused rather than keyed to empty', () => {
    const r = companyKeyFor('!!! ???');
    expect(r.ok).toBe(false);
  });
});

describe('POST /company-versions', () => {
  it('saves against a real company', async () => {
    owns('Discord');
    const res = await request(app())
      .post('/api/resume/company-versions')
      .send({ tailoredResumeId: 3, label: 'Growth roles' });

    expect(res.status).toBe(201);
    expect(res.body.companyName).toBe('Discord');

    const ins = query.mock.calls.find(([sql]) => /INSERT INTO company_resume_versions/i.test(sql));
    expect(ins[1][1]).toBe('discord');            // key
    expect(ins[1][2]).toBe('Discord');            // display name
  });

  it('refuses a pasted JD with no employer, and says why', async () => {
    owns(null);
    const res = await request(app())
      .post('/api/resume/company-versions')
      .send({ tailoredResumeId: 3 });

    // 422, not 400 - the request is fine, the company simply is not known.
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('company_unknown');
    expect(res.body.detail.length).toBeGreaterThan(40);
  });

  it('refuses a placeholder employer rather than filing under it', async () => {
    owns('name');
    const res = await request(app())
      .post('/api/resume/company-versions')
      .send({ tailoredResumeId: 3 });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('company_not_a_name');
    expect(res.body.detail).toMatch(/placeholder/i);
  });

  it('writes nothing when it refuses', async () => {
    owns(null);
    await request(app()).post('/api/resume/company-versions').send({ tailoredResumeId: 3 });
    expect(query.mock.calls.filter(([sql]) => /INSERT INTO company_resume_versions/i.test(sql))).toHaveLength(0);
  });

  it('404s on someone else\'s tailored resume', async () => {
    owns('Discord', { exists: false });
    const res = await request(app())
      .post('/api/resume/company-versions')
      .send({ tailoredResumeId: 3 });
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe('not_found');
  });

  it('rejects a non-numeric id before touching the database', async () => {
    query.mockResolvedValue({ rows: [] });
    const res = await request(app())
      .post('/api/resume/company-versions')
      .send({ tailoredResumeId: 'all' });
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('reports when it replaced an earlier version for the same company', async () => {
    /*
     * One version per company, so saving a second REPLACES the first. The user
     * had something and now does not; a silent overwrite of their own earlier
     * work is the thing to avoid.
     */
    query.mockImplementation(async (sql, params) => {
      if (/FROM tailored_resumes t/i.test(sql)) return { rows: [{ id: 3, job_id: 9, company_name: 'Discord' }] };
      if (/INSERT INTO company_resume_versions/i.test(sql)) {
        return { rows: [{ id: 1, company_name: 'Discord', label: null, created_at: new Date(), updated_at: new Date(), replaced: true }] };
      }
      return { rows: [] };
    });
    const res = await request(app())
      .post('/api/resume/company-versions')
      .send({ tailoredResumeId: 3 });
    expect(res.body.replaced).toBe(true);
  });
});

describe('GET /company-versions', () => {
  it('passes absence through rather than inventing a job title', async () => {
    query.mockImplementation(async (sql) => {
      if (/FROM company_resume_versions v/i.test(sql)) {
        return { rows: [{ id: 1, company_key: 'discord', company_name: 'Discord', label: null, tailored_resume_id: 3, ats_score: 64, job_id: null, job_title: null, source: 'pasted_jd', confirmed_at: null, created_at: new Date(), updated_at: new Date() }] };
      }
      return { rows: [] };
    });
    const res = await request(app()).get('/api/resume/company-versions');
    expect(res.status).toBe(200);
    expect(res.body.versions[0].jobTitle).toBeNull();
    expect(res.body.versions[0].jobTitleKnown).toBe(false);
  });

  it('bounds the page size', async () => {
    query.mockResolvedValue({ rows: [] });
    await request(app()).get('/api/resume/company-versions?limit=9999');
    const call = query.mock.calls.find(([sql]) => /FROM company_resume_versions v/i.test(sql));
    expect(call[1][1]).toBeLessThanOrEqual(100);
  });

  it('scopes to the caller', async () => {
    query.mockResolvedValue({ rows: [] });
    await request(app()).get('/api/resume/company-versions');
    const call = query.mock.calls.find(([sql]) => /FROM company_resume_versions v/i.test(sql));
    expect(call[0]).toMatch(/v\.user_id = \$1/);
    expect(call[1][0]).toBe(5);
  });
});
