/*
 * Unwired guards — every guard, exercised through the endpoint that must
 * invoke it, with input it is supposed to refuse.
 *
 * Three guards shipped that no live path could reach: plans.can() with no
 * caller, untraceable_claim bypassed because POST /api/resume/tailor never
 * called verifyAdditions, and resumeGuard.verify exported and never invoked.
 * Every one of them had a green test, because the test called the FUNCTION and
 * the endpoint did not. A guard tested in isolation proves the guard works; it
 * proves nothing about whether anything runs it.
 *
 * So the rule these tests exist to enforce: a guard is not shipped until an
 * endpoint test proves it fires on real input through the real path. Asserting
 * that the route SOURCE contains `verifyAdditions(` is not that - presence is
 * not function, and a mutation that reorders the call still matches the regex.
 *
 * Each block below sends a request a guard must refuse, and asserts on the
 * REFUSAL. Each also sends the honest counterpart, because a guard that
 * refuses everything is just as broken and passes every negative test.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
  attachUserIfPresent: (req, _res, next) => { req.user = req.user || { id: 42 }; next(); },
}));

const { query } = require('../db');

function app(mount, route) {
  const a = express();
  a.use(express.json());
  a.use(mount, require(route));
  return a;
}

const OLD = { ...process.env };
beforeEach(() => {
  query.mockReset();
  process.env = { ...OLD };
  delete process.env.SUBMISSIONS_HALTED;
});

/* ------------------------------------------------------------------ *
 * can()  —  PUT /api/profile/preferences
 * ------------------------------------------------------------------ */
describe('can() fires on PUT /api/profile/preferences', () => {
  const onTier = (tier) => query.mockImplementation((sql) => {
    if (/FROM users/.test(sql)) return Promise.resolve({ rows: [{ plan_tier: tier, credits_total: 600, credits_used: 0 }] });
    if (/FROM user_preferences/.test(sql)) return Promise.resolve({ rows: [{}] });
    if (/INSERT INTO user_preferences|UPDATE user_preferences/.test(sql)) {
      return Promise.resolve({ rows: [{ auto_apply_enabled: true }] });
    }
    return Promise.resolve({ rows: [] });
  });

  it('refuses to enable Auto-Pilot on a tier that does not include it', async () => {
    onTier('starter');
    const res = await request(app('/api/profile', '../routes/profile'))
      .put('/api/profile/preferences').send({ autoApplyEnabled: true });

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('tier');
    expect(res.body.capability).toBe('autoApply');
  });

  it('allows the same request on a tier that does include it', async () => {
    // Without this the 403 above could just as well be a route that always 403s.
    onTier('power');
    const res = await request(app('/api/profile', '../routes/profile'))
      .put('/api/profile/preferences').send({ autoApplyEnabled: true });

    expect(res.status).not.toBe(403);
  });
});

/* ------------------------------------------------------------------ *
 * submissionsHalted() / checkSubmissionAllowed()
 *   —  POST /api/apply/queue/:id/start
 * ------------------------------------------------------------------ */
describe('the submission gate fires on POST /api/apply/queue/:id/start', () => {
  const world = ({ halted = false, sentToday = 0, credits = { total: 600, used: 0 } } = {}) =>
    query.mockImplementation((sql) => {
      if (/FROM system_flags/.test(sql)) return Promise.resolve({ rows: [{ value: String(halted) }] });
      if (/COUNT\(\*\)::int AS n FROM applications/.test(sql)) return Promise.resolve({ rows: [{ n: sentToday }] });
      if (/FROM users/.test(sql)) {
        return Promise.resolve({ rows: [{ plan_tier: 'power', credits_total: credits.total, credits_used: credits.used }] });
      }
      if (/UPDATE applications/.test(sql)) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });

  const start = () => request(app('/api/apply', '../routes/apply')).post('/api/apply/queue/1/start').send({});

  it('refuses every submission while the halt flag is set', async () => {
    world({ halted: true });
    const res = await start();
    expect(res.status).toBe(429);
    expect(res.body.reason).toBe('halted');
  });

  it('refuses once the daily cap is reached', async () => {
    world({ sentToday: 5 });
    const res = await start();
    expect(res.status).toBe(429);
    expect(res.body.reason).toBe('daily_cap');
    expect(res.body.cap).toBe(5);
  });

  it('refuses when the plan has no applications left', async () => {
    world({ credits: { total: 600, used: 600 } });
    const res = await start();
    expect(res.status).toBe(429);
    expect(res.body.reason).toBe('no_credits');
  });

  it('fails CLOSED when the flag cannot be read at all', async () => {
    query.mockRejectedValue(new Error('db down'));
    const res = await start();
    expect(res.status).toBe(429);
  });

  it('allows a submission when nothing is in the way', async () => {
    // The four refusals above mean nothing if the route refuses unconditionally.
    world({ halted: false, sentToday: 0 });
    const res = await start();
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ *
 * verifyAdditions()  —  POST /api/resume/tailor
 * ------------------------------------------------------------------ */
describe('verifyAdditions() fires on POST /api/resume/tailor', () => {
  const RESUME = [
    'Asha Menon',
    'Senior Product Designer',
    'Led the design system used by 3 product teams.',
    'Shipped an onboarding redesign that lifted activation 12%.',
    'SKILLS',
    'Figma, design systems, user research, accessibility, prototyping',
  ].join('\n');

  const withJob = (description) => query.mockImplementation((sql) => {
    if (/FROM jobs WHERE id/.test(sql)) {
      return Promise.resolve({ rows: [{ title: 'Product Designer', company_name: 'Acme', description, requirements: '' }] });
    }
    if (/FROM resumes/.test(sql)) return Promise.resolve({ rows: [{ id: 6, original_file_text: RESUME }] });
    if (/FROM user_preferences/.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM user_skills/.test(sql)) return Promise.resolve({ rows: [{ skill: 'Figma' }] });
    if (/FROM user_experience/.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM application_profiles/.test(sql)) return Promise.resolve({ rows: [] });
    if (/INSERT INTO tailored_resumes/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 7, created_at: '2026-08-06T00:00:00.000Z' }] });
    }
    return Promise.resolve({ rows: [] });
  });

  const tailor = () => request(app('/api/resume', '../routes/resume'))
    .post('/api/resume/tailor').send({ jobId: 1 });

  it('keeps a skill the job wants and the person does not have out of the text', async () => {
    withJob('We need a designer with strong Marketing skills.');
    const res = await tailor();

    expect(res.status).toBe(201);
    expect(res.body.tailoredText).not.toMatch(/Marketing/i);
    expect(res.body.addedSkills).not.toContain('Marketing');
    expect(res.body.needsConfirmation.map((c) => c.text)).toContain('Marketing');
  });

  it('does not leave the sentence that introduces the refused skills behind', async () => {
    // Filtering the finished text rather than rebuilding from the allowed set
    // leaves "Additional relevant skills for this role:" heading nothing.
    withJob('We need a designer with strong Marketing skills.');
    const res = await tailor();
    expect(res.body.tailoredText).not.toMatch(/Additional relevant skills/i);
  });

  it('keeps the figures the person actually wrote', async () => {
    withJob('We need a designer with strong Marketing skills.');
    const res = await tailor();
    expect(res.body.tailoredText).toMatch(/12%/);
    expect(res.body.tailoredText).toMatch(/3 product teams/);
  });
});

/* ------------------------------------------------------------------ *
 * verifyAdditions()  —  PUT /api/resume/:id/document
 *
 * The widest bypass: this route saved req.body.doc verbatim, so every rule the
 * tailoring paths enforce could be walked round by writing the document
 * directly - which is what the editor does on every save.
 * ------------------------------------------------------------------ */
describe('verifyAdditions() fires on PUT /api/resume/:id/document', () => {
  const DOC = () => ({
    version: 2,
    meta: { name: 'Asha Menon', title: 'Senior Product Designer' },
    sections: [{
      id: 'sec1',
      type: 'experience',
      title: 'Experience',
      items: [{
        id: 'itm1',
        role: 'Senior Product Designer',
        org: 'Valtech',
        bullets: [{ id: 'b1', text: 'Led the design system used by 3 product teams.' }],
      }],
    }],
  });

  let saved;
  beforeEach(() => {
    saved = null;
    query.mockImplementation((sql, params) => {
      if (/FROM resumes/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 6, doc: DOC(), style: null, original_file_text: '', template: null }] });
      }
      if (/UPDATE resumes SET doc/.test(sql)) { saved = JSON.parse(params[0]); return Promise.resolve({ rows: [] }); }
      if (/FROM user_skills/.test(sql)) return Promise.resolve({ rows: [] });
      if (/FROM user_experience/.test(sql)) return Promise.resolve({ rows: [] });
      if (/FROM application_profiles/.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
  });

  const put = (doc) => request(app('/api/resume', '../routes/resume'))
    .put('/api/resume/6/document').send({ doc });

  const bulletIn = (doc, id) => doc.sections[0].items[0].bullets.find((b) => b.id === id);

  it('holds back a bullet claiming something that is nowhere in the user material', async () => {
    const doc = DOC();
    doc.sections[0].items[0].bullets.push({ id: 'b2', text: 'Managed a team of 25 engineers at Google.' });

    const res = await put(doc);

    expect(res.status).toBe(200);
    expect(res.body.heldForConfirmation.map((f) => f.id)).toContain('b2');
    expect(bulletIn(saved, 'b2').status).toBe('pending');
  });

  it('keeps held content out of the flat text the extension pastes', async () => {
    const doc = DOC();
    doc.sections[0].items[0].bullets.push({ id: 'b2', text: 'Managed a team of 25 engineers at Google.' });
    await put(doc);

    // saveDoc regenerates original_file_text with pending excluded - that column
    // is what reaches an employer, so this is the assertion that matters.
    const write = query.mock.calls.find((c) => /UPDATE resumes SET doc/.test(c[0]));
    expect(write[1][1]).not.toMatch(/25 engineers/);
    expect(write[1][1]).toMatch(/design system/);
  });

  it('leaves a bullet the person already had completely alone', async () => {
    const res = await put(DOC());
    expect(res.body.heldForConfirmation).toHaveLength(0);
    expect(bulletIn(saved, 'b1').status).toBeUndefined();
  });

  it('accepts an edit built from words the person already used', async () => {
    // The refusals above prove nothing if every write is held.
    const doc = DOC();
    doc.sections[0].items[0].bullets.push({ id: 'b2', text: 'Led the design system.' });

    const res = await put(doc);

    expect(res.body.heldForConfirmation).toHaveLength(0);
    expect(bulletIn(saved, 'b2').status).toBeUndefined();
  });

  it('reverts an untraceable job title in the header', async () => {
    /*
     * meta is not a node, so the walk above never sees it. A title typed here
     * would have gone out at the top of every export unchecked. There is no
     * pending flag on meta, so the only honest options are revert or publish.
     */
    const doc = DOC();
    doc.meta.title = 'Director of Engineering at Netflix';

    const res = await put(doc);

    expect(res.body.heldForConfirmation.map((f) => f.id)).toContain('meta.title');
    expect(saved.meta.title).toBe('Senior Product Designer');
  });

  it('leaves a header edit the person can support alone', async () => {
    const doc = DOC();
    doc.meta.title = 'Product Designer';

    const res = await put(doc);

    expect(res.body.heldForConfirmation).toHaveLength(0);
    expect(saved.meta.title).toBe('Product Designer');
  });

  it('holds back an invented employer, not just an invented sentence', async () => {
    const doc = DOC();
    doc.sections[0].items.push({ id: 'itm2', role: 'Director of Engineering', org: 'Netflix', bullets: [] });

    const res = await put(doc);

    expect(res.body.heldForConfirmation.map((f) => f.id)).toContain('itm2');
  });
});
