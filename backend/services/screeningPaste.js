/*
 * Feature 9 — a block of answers, pasted, parsed into question/answer pairs.
 *
 * People keep their standard application answers somewhere already: a note, a
 * doc, the last form they filled in. Retyping twenty of them one at a time is
 * the reason the answer bank stays empty, and an empty answer bank is why the
 * queue stalls on "needs you".
 *
 * PASTED TEXT IS UNTRUSTED INPUT. It is parsed, never followed. Nothing here
 * interprets the content as an instruction, and `instructionLike` records how
 * often someone tries - the same boundary feature 3 draws for a pasted job
 * description, for the same reason: if a model is ever put on this path, this
 * file is where the line already is.
 *
 * DEMOGRAPHIC QUESTIONS ARE REFUSED, not stored. The product must never
 * auto-answer them, and the reliable way to guarantee that is to never hold an
 * answer to auto-fill from. A pasted block will contain them, because the
 * forms people copy from contain them. Each one is returned with a reason so
 * the refusal is visible rather than a silent drop.
 */

const { boundText } = require('./requestBounds');

/* Reused from screeningPrefill, deliberately: two patterns for one rule drift,
 * and the one that drifts is the one that stops matching. */
const { DEMOGRAPHIC } = require('./screeningPrefill');

const MAX_PASTE = 20000;
const MAX_PAIRS = 100;
const MAX_QUESTION = 500;
const MAX_ANSWER = 4000;

/*
 * Recorded, never acted on. Identical list to the pasted-JD path.
 */
const INSTRUCTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above)/i,
  /disregard (the )?(above|previous|prior)/i,
  /you are (now )?(a|an) /i,
  /system prompt/i,
  /\bact as\b/i,
  /new instructions?:/i,
];

/* Zero-width and control characters make two different strings look identical
 * to a person reviewing what will be sent. */
const stripInvisible = (s) => String(s || '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');

/*
 * The shapes people actually paste. Ordered most explicit first, because
 * "Q:/A:" is unambiguous while "line then line" is a guess.
 */
const Q_PREFIX = /^\s*(?:Q|Question)\s*[:.\-)]\s*(.+)$/i;
const A_PREFIX = /^\s*(?:A|Ans|Answer)\s*[:.\-)]\s*(.*)$/i;
const NUMBERED = /^\s*\d+[.)]\s*(.+)$/;
/* "Question? Answer" or "Question: answer" on one line. */
const INLINE = /^\s*(.{3,300}?[?:])\s*(.{1,})$/;

const clean = (s) => stripInvisible(s).replace(/\s+/g, ' ').trim();

/**
 * @returns {{
 *   pairs: {question: string, answer: string}[],
 *   refused: {question: string, reason: string, detail: string}[],
 *   instructionLike: boolean,
 *   clamped: boolean,
 *   truncatedPairs: number
 * }}
 */
function parseScreeningPaste(raw) {
  const bounded = boundText(raw, { max: MAX_PASTE });
  const text = stripInvisible(bounded.value || '');

  const instructionLike = INSTRUCTION_PATTERNS.some((re) => re.test(text));

  const lines = text.split(/\r?\n/);
  const found = [];

  let pendingQuestion = null;
  let pendingAnswer = null;

  const flush = () => {
    if (pendingQuestion == null) return;
    const q = clean(pendingQuestion).slice(0, MAX_QUESTION);
    const a = clean(pendingAnswer == null ? '' : pendingAnswer).slice(0, MAX_ANSWER);
    if (q && a) found.push({ question: q, answer: a });
    pendingQuestion = null;
    pendingAnswer = null;
  };

  for (const line of lines) {
    const bare = line.trim();

    const qm = Q_PREFIX.exec(bare);
    if (qm) {
      flush();
      pendingQuestion = qm[1];
      pendingAnswer = '';
      continue;
    }

    const am = A_PREFIX.exec(bare);
    if (am && pendingQuestion != null) {
      pendingAnswer = am[1];
      continue;
    }

    if (!bare) {
      // A blank line ends a pair; it is the only separator many pastes have.
      flush();
      continue;
    }

    if (pendingQuestion != null) {
      // Continuation of the answer, so multi-line answers survive.
      pendingAnswer = `${pendingAnswer || ''} ${bare}`;
      continue;
    }

    const nm = NUMBERED.exec(bare);
    const candidate = nm ? nm[1] : bare;

    const im = INLINE.exec(candidate);
    if (im && im[2].trim()) {
      found.push({
        question: clean(im[1]).replace(/[?:]\s*$/, '?').slice(0, MAX_QUESTION),
        answer: clean(im[2]).slice(0, MAX_ANSWER),
      });
      continue;
    }

    // A line that looks like a question with the answer on the next line.
    pendingQuestion = candidate;
    pendingAnswer = '';
  }
  flush();

  /*
   * Demographic pairs are separated out with a reason rather than dropped.
   * A silent drop is indistinguishable from a parser that failed, and the user
   * would paste again wondering why nothing happened.
   */
  const pairs = [];
  const refused = [];
  const seen = new Set();

  for (const p of found) {
    if (DEMOGRAPHIC.test(p.question)) {
      refused.push({
        question: p.question,
        reason: 'demographic',
        detail: 'HirePilot never stores or auto-answers demographic and equal-opportunity '
          + 'questions. Answer these yourself on the employer\'s form, every time.',
      });
      continue;
    }

    // Same question twice in one paste: the later answer is the one they meant.
    const key = p.question.toLowerCase();
    if (seen.has(key)) {
      const at = pairs.findIndex((x) => x.question.toLowerCase() === key);
      if (at >= 0) pairs[at] = p;
      continue;
    }
    seen.add(key);
    pairs.push(p);
  }

  const truncatedPairs = Math.max(0, pairs.length - MAX_PAIRS);

  return {
    pairs: pairs.slice(0, MAX_PAIRS),
    refused,
    instructionLike,
    clamped: Boolean(bounded.clamped),
    truncatedPairs,
  };
}

module.exports = {
  parseScreeningPaste, MAX_PASTE, MAX_PAIRS, MAX_QUESTION, MAX_ANSWER, INSTRUCTION_PATTERNS,
};
