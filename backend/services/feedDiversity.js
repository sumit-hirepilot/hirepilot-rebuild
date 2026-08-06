/*
 * A7.9 — source diversity, as one canonical order rather than a per-request cap.
 *
 * THE DEFECT. The cap lived in SQL:
 *     source_rank <= GREATEST(3, CEIL((page * limit) / 4))
 * so `page` and `limit` were not only pagination - they also decided how many
 * rows each source could contribute. At limit=10 the cap was 3 per source on
 * page 1, 5 on page 2, 8 on page 3, and each page was sliced with OFFSET out of
 * a DIFFERENT capped list. Those lists are not nested at the front: a row that
 * enters when the cap widens is inserted ABOVE rows already shown, so the
 * offset steps past it. Measured on production: 40 rows read as one page of 40,
 * and as four pages of 10, differed by 6 jobs - unreachable by paging at all.
 *
 * THE RULE. Pages must be slices of ONE list. So diversity is applied once, to
 * the ranked order, producing a canonical sequence; a page is then a plain
 * slice of it. Coherence is structural rather than something to remember.
 *
 * WHY THE BLOCK IS A CONSTANT. The obvious quota - CEIL(limit / 4) - would
 * reintroduce the same bug in a quieter form: the canonical order would depend
 * on the caller's page size, so pages 1..4 at limit 10 and one page of 40 would
 * again be different lists. They would each be internally coherent and still
 * disagree with each other. The acceptance property is that the concatenation
 * of pages 1..N at limit L equals page 1 at limit N*L, in order, for ANY L -
 * and that holds only if the sequence does not know what L is.
 *
 * BLOCK/QUOTA reproduce the old shape at the default page size: no source may
 * take more than 3 of any 10 consecutive rows, which is what CEIL(limit/4) gave
 * on page 1 at limit 10 - the one page that behaved correctly before.
 */

const BLOCK = 10;
const QUOTA = 3;

/**
 * The ranked rows, reordered so no source dominates, deterministically.
 *
 * A row that is over quota for the block being filled DEFERS - it keeps its
 * place in the queue and is offered again for the next block. It is never
 * dropped, which is the difference between diversity and data loss.
 *
 * At the tail, when a block can only be completed from deferred rows, the quota
 * relaxes rather than leaving rows unreachable: a strict quota with three
 * sources left would strand every remaining row forever. Diversity is a
 * presentation preference; reachability is a correctness property, and when
 * they conflict the preference yields.
 *
 * @param {object[]} rows   ranked rows, already in final ranking order
 * @param {function} sourceOf  row -> source key
 * @returns {object[]} the same rows, reordered; same length, same members
 */
function diversify(rows, sourceOf = (r) => r.source) {
  const queue = rows.slice();
  const out = [];

  while (queue.length) {
    const used = new Map();
    let placed = 0;

    // One pass over what is left, taking whatever fits this block's quota.
    for (let i = 0; i < queue.length && placed < BLOCK; ) {
      const src = sourceOf(queue[i]) || '';
      const n = used.get(src) || 0;
      if (n < QUOTA) {
        used.set(src, n + 1);
        out.push(queue.splice(i, 1)[0]);
        placed += 1;
      } else {
        i += 1; // over quota for this block - stays in the queue, in place
      }
    }

    /*
     * Nothing fitted: every remaining row belongs to a source already at quota
     * for this block, which happens whenever the tail is dominated by one or
     * two sources. Emit in rank order and stop pretending otherwise.
     */
    if (placed === 0) {
      out.push(...queue.splice(0, BLOCK));
    }
  }

  return out;
}

/**
 * Page P of the diversified order.
 *
 * Pure in (rows, page, limit): the same ranked input always yields the same
 * page, and the pages tile the sequence exactly.
 */
function pageOf(rows, page, limit, sourceOf) {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const l = Math.max(1, Math.floor(Number(limit) || 10));
  return diversify(rows, sourceOf).slice((p - 1) * l, p * l);
}

module.exports = { diversify, pageOf, BLOCK, QUOTA };
