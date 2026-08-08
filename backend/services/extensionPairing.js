/*
 * E5 — short-lived pairing codes for the browser extension.
 *
 * The old flow had the user copy their full login JWT out of Settings and
 * paste it into the extension: a 7-day password moving through the clipboard,
 * displayed in plain text, indistinguishable from the credential it was. This
 * replaces it with a code the user reads once and types in — short, single
 * use, and worthless a few minutes later.
 *
 * Design, and why each part is the way it is:
 *
 *   - The code is high-entropy but human-typeable: 8 characters from a
 *     32-symbol alphabet with the ambiguous glyphs (0/O, 1/I/L) removed, so
 *     ~40 bits with no "was that a zero or an oh" failures. Formatted XXXX-XXXX
 *     for reading aloud; normalised back before hashing so the dash and case
 *     never matter.
 *
 *   - Only the SHA-256 of the code is stored. A dump of extension_pairings
 *     must not contain anything that can be redeemed. The lookup is by hash,
 *     so the plaintext exists only in the response the user sees and the
 *     request the extension sends.
 *
 *   - Redeem is a single atomic UPDATE guarded on `consumed_at IS NULL AND
 *     expires_at > now`. Two extensions racing the same code cannot both win:
 *     exactly one UPDATE matches the un-consumed row and the other sees zero
 *     rows. Single-use is enforced by the database, not by a read-then-write.
 *
 *   - Creating a code first drops this user's earlier un-consumed codes and
 *     prunes expired rows generally, so the table cannot accumulate — the
 *     500 MB volume that filled once (see the Railway note) stays the reason
 *     this is not allowed to grow.
 */

const crypto = require('crypto');
const { query } = require('../db');

// Minutes, not hours: a pairing code is read off the screen and typed in
// immediately. Ten minutes covers "find the extension, open it, type" without
// leaving a usable secret lying around for a session's worth of time.
const TTL_MS = 10 * 60 * 1000;

// Crockford-ish: no 0/O/1/I/L/U. 32 symbols keeps the maths a clean 5 bits
// each while removing the characters people mistype when copying by eye.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LEN = 8;

// A run of unbiased picks from the alphabet. rejection-samples the random byte
// so the modulo does not skew the distribution toward the low end of the set.
function randomCode() {
  let out = '';
  while (out.length < CODE_LEN) {
    for (const b of crypto.randomBytes(CODE_LEN)) {
      if (b >= 256 - (256 % ALPHABET.length)) continue; // drop the biased tail
      out += ALPHABET[b % ALPHABET.length];
      if (out.length === CODE_LEN) break;
    }
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

// The dash and letter-case are presentation only; hash the canonical form so a
// user who types "abcd efgh" or "ABCD-EFGH" pairs either way.
const normalize = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hash = (code) => crypto.createHash('sha256').update(normalize(code)).digest('hex');

/**
 * Mint a fresh pairing code for a user, returning the PLAINTEXT once.
 * The caller shows it; the database only ever holds its hash.
 */
async function createPairing(userId) {
  // Housekeeping before insert: this user's stale un-consumed codes are dead
  // the moment a new one is asked for, and any expired row anywhere is litter.
  await query(
    `DELETE FROM extension_pairings
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId]
  ).catch(() => {});
  await query(
    `DELETE FROM extension_pairings WHERE expires_at < CURRENT_TIMESTAMP`
  ).catch(() => {});

  const expiresAt = new Date(Date.now() + TTL_MS);

  // Retry only guards the vanishing chance of a hash collision on the UNIQUE
  // index; in practice the first attempt always lands.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      await query(
        `INSERT INTO extension_pairings (user_id, code_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [userId, hash(code), expiresAt]
      );
      return { code, expiresAt, ttlSeconds: Math.round(TTL_MS / 1000) };
    } catch (err) {
      if (attempt === 4) throw err;
    }
  }
  // Unreachable: the loop either returns or throws on the last attempt.
  throw new Error('Could not allocate a pairing code');
}

/**
 * Redeem a code. Returns the owning user id, or null if the code is unknown,
 * already used, or expired. Consumes the code atomically so it works once.
 */
async function redeemPairing(code) {
  if (!normalize(code)) return null;
  const r = await query(
    `UPDATE extension_pairings
        SET consumed_at = CURRENT_TIMESTAMP
      WHERE code_hash = $1
        AND consumed_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP
      RETURNING user_id`,
    [hash(code)]
  );
  return r.rows.length ? r.rows[0].user_id : null;
}

module.exports = {
  createPairing,
  redeemPairing,
  // Exported for tests to assert the stored value is a hash, never the code.
  _hash: hash,
  _normalize: normalize,
  TTL_MS,
};
