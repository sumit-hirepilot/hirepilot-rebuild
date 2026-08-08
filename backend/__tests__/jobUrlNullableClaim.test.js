/*
 * jobs.job_url must be nullable, and the claim must be READ BACK from the
 * running database rather than believed because migrations.js contains the
 * statement (D36 - the runner logs a failed statement and continues).
 *
 * Why nullable: a manual tracker entry is an application the user made
 * off-platform, and "I applied at a walk-in / by email" has no posting URL.
 * The base schema's NOT NULL described aggregated jobs, where a URL always
 * exists. With the column NOT NULL the only options were fabricating a URL -
 * absence must stay absent - or the 500 production actually served
 * (reproduced 2026-08-08: `null value in column "job_url"`).
 *
 * Per D24/D36 the reporter is proved in both directions: a nullable column
 * reads present, a NOT NULL column reads absent, and an unknown column reads
 * absent rather than vacuously satisfied.
 */

const { CLAIMS, readBack } = require('../services/schemaClaims');

function mockCatalog({ jobUrlNullable }) {
  return (sql) => {
    if (/information_schema\.tables/.test(sql)) return Promise.resolve({ rows: [] });
    if (/pg_indexes/.test(sql)) return Promise.resolve({ rows: [] });
    if (/pg_constraint/.test(sql)) return Promise.resolve({ rows: [] });
    if (/pg_trigger/.test(sql)) return Promise.resolve({ rows: [] });
    if (/information_schema\.columns/.test(sql)) {
      return Promise.resolve({
        rows: jobUrlNullable === undefined ? [] : [{
          table_name: 'jobs', column_name: 'job_url',
          column_default: null, is_nullable: jobUrlNullable ? 'YES' : 'NO',
        }],
      });
    }
    return Promise.resolve({ rows: [] });
  };
}

const claimFor = (results) => results.find((c) => c.name === 'jobs.job_url' && c.kind === 'column_nullable');

describe('the jobs.job_url nullability claim', () => {
  it('is declared', () => {
    expect(CLAIMS.some((c) => c.kind === 'column_nullable' && c.name === 'jobs.job_url')).toBe(true);
  });

  it('reads present when the column is nullable', async () => {
    const results = await readBack(mockCatalog({ jobUrlNullable: true }));
    expect(claimFor(results)).toBeTruthy();
    expect(claimFor(results).present).toBe(true);
  });

  it('reads absent when the column is still NOT NULL - the failing production state', async () => {
    const results = await readBack(mockCatalog({ jobUrlNullable: false }));
    expect(claimFor(results).present).toBe(false);
  });

  it('reads absent for a column the catalogue does not know, not vacuously present', async () => {
    const results = await readBack(mockCatalog({ jobUrlNullable: undefined }));
    expect(claimFor(results).present).toBe(false);
  });
});
