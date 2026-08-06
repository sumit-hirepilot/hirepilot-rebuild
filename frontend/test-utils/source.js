/*
 * Read source for assertion, with the explanation removed.
 *
 * Standing rule: an assertion satisfied by your own prose is not a test. This
 * project has hit it in both directions - a guard that passed because the
 * banned identifier appeared in a comment saying it was banned, and a guard
 * that failed because the comment recording a fix named the thing it fixed.
 *
 * Every source-scanning test reads through this, so the rule holds by
 * construction rather than by each author remembering it.
 */

const fs = require('fs');

function stripComments(src) {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ') // JSX {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, ' ')           // block
    .replace(/^\s*\/\/.*$/gm, ' ');              // whole-line //
}

/** Read a file and strip its comments in one step. */
function readCode(...parts) {
  const path = require('path');
  return stripComments(fs.readFileSync(path.join(...parts), 'utf8'));
}

module.exports = { stripComments, readCode };
