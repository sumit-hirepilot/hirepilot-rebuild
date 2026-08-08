/*
 * L3 — every failure a stranger can hit must fail in a sentence they can
 * act on. Probed live before any fix:
 *
 *   corrupt PDF  -> 422 {"error":"Invalid PDF structure."}   parser jargon
 *   20 MB PDF    -> 500 {"error":"Internal Server Error",
 *                        "message":"File too large"}          a bare 500
 *
 * The second is multer's LIMIT_FILE_SIZE falling through to the global
 * error handler. Driven through the real exported app so the middleware
 * chain is the deployed one.
 */

process.env.INBOUND_MAIL_SECRET = process.env.INBOUND_MAIL_SECRET || '';

jest.mock('../db', () => ({ query: jest.fn(() => Promise.resolve({ rows: [] })) }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 4 }; next(); },
  attachUserIfPresent: (req, _res, next) => { req.user = { id: 4 }; next(); },
}));

const request = require('supertest');
const app = require('../index');

describe('resume upload failures', () => {
  it('an oversized file is a 413 with a sentence, never a bare 500', async () => {
    const big = Buffer.alloc(9 * 1024 * 1024, 0x41);
    const res = await request(app)
      .post('/api/resume/upload')
      .attach('file', big, { filename: 'resume.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/8 ?MB|too large/i);
    expect(res.body.error).toMatch(/paste/i);
    expect(JSON.stringify(res.body)).not.toMatch(/Internal Server Error/i);
  });

  it('a corrupt file is a sentence about what to do, not parser jargon', async () => {
    const junk = Buffer.from('not a real pdf at all, just bytes');
    const res = await request(app)
      .post('/api/resume/upload')
      .attach('file', junk, { filename: 'resume.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/could ?n.t read|could not read/i);
    expect(res.body.error).toMatch(/paste/i);
    expect(res.body.error).not.toMatch(/structure|Invalid PDF/i);
  });
});
