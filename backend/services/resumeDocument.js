/*
 * The structured resume document.
 *
 * Resumes were stored as flat text, which has no addressable parts - you cannot
 * reorder a section, edit one bullet, or mark a single change as pending when
 * the whole document is one string. This is the model those operations need.
 *
 * Flat text remains the DERIVED view, never the source. Everything downstream
 * already reads it: the extension pastes it into free-text fields, the ATS
 * checker scores it, and ~26 stored tailored rows contain it. Replacing it
 * would have broken all of that, so toText() regenerates it from structure on
 * every write and the old readers never notice.
 *
 * Provenance is carried per bullet, not per document. It is what lets the
 * editor show a proposed change as pending, and what lets the enforcement layer
 * refuse a claim that traces back to nothing the user actually said.
 */

const SECTION_TYPES = ['summary', 'experience', 'education', 'skills', 'projects', 'custom'];

// Where a piece of text came from. 'user' is theirs; anything else has to earn
// its place before it counts as part of the resume.
const ORIGINS = ['user', 'tailored', 'suggested'];

let seq = 0;
// Deterministic within a process and unique enough for node addressing. Not a
// database key - these live inside a JSONB blob.
function nid(prefix) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

function emptyDoc() {
  return {
    version: 1,
    meta: { name: '', title: '', email: '', phone: '', location: '', links: [] },
    sections: [],
  };
}

/* ------------------------------------------------------------------ *
 * Parsing flat text into structure
 *
 * Heuristic and deliberately conservative. A line it cannot classify becomes a
 * bullet in the section it appears under rather than being dropped - losing a
 * line of someone's resume to a parser is far worse than mis-filing it, and the
 * editor lets them move it.
 * ------------------------------------------------------------------ */

const HEADING_RE = /^[A-Z][A-Z\s&/()+.,'-]{2,48}$/;
const HEADING_HINTS = [
  [/^(work\s+)?experience|employment|professional\s+background|career/i, 'experience'],
  [/^education|academics?|qualifications?/i, 'education'],
  [/^(core\s+|key\s+|technical\s+)?skills?|tools|technolog/i, 'skills'],
  [/^projects?|selected\s+work|case\s+stud/i, 'projects'],
  [/^summary|profile|objective|about/i, 'summary'],
];

const BULLET_RE = /^\s*[-*•·▪◦‣]\s+/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE_RE = /(\+?\d[\d\s()-]{7,}\d)/;
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s,;]+)/gi;

// "Role at Company | 2021 - Present" and the many shapes near it.
const DATE_RANGE_RE = /((?:19|20)\d{2}|present|current|now)\s*[–—-]\s*((?:19|20)\d{2}|present|current|now)/i;

function classifyHeading(line) {
  const t = line.trim().replace(/[:]+$/, '');
  if (!t || t.length > 52) return null;
  const looksHeading = HEADING_RE.test(t) || /^[A-Z][a-z]+(\s[A-Z][a-z]+)?$/.test(t);
  if (!looksHeading) return null;
  for (const [re, type] of HEADING_HINTS) {
    if (re.test(t)) return { type, title: t };
  }
  // An ALL-CAPS line that matches no hint is still a heading the user wrote.
  return HEADING_RE.test(t) ? { type: 'custom', title: t } : null;
}

function parseText(text) {
  const doc = emptyDoc();
  const raw = String(text || '').replace(/\r\n?/g, '\n');
  const lines = raw.split('\n');

  /*
   * Contact details come from the first few lines, where every resume puts
   * them, and are removed from the body so they are not repeated as bullets.
   */
  const headLines = lines.slice(0, 8).join('\n');
  doc.meta.email = (headLines.match(EMAIL_RE) || [''])[0];
  doc.meta.phone = (headLines.match(PHONE_RE) || [''])[0].trim();
  const links = headLines.match(URL_RE) || [];
  doc.meta.links = [...new Set(links)].slice(0, 6).map((url) => ({
    label: /linkedin/i.test(url) ? 'LinkedIn' : /github/i.test(url) ? 'GitHub' : 'Website',
    url: url.replace(/[.,;]$/, ''),
  }));

  // The name is the first substantial line that is not contact data. Resumes
  // often letter-space it ("S U M I T   K U M A R"); the words are separated by
  // runs of spaces, so a single-space pattern misses it entirely.
  const firstReal = lines.find((l) => {
    const t = l.trim();
    return t && !EMAIL_RE.test(t) && !PHONE_RE.test(t) && !/^https?:/i.test(t);
  }) || '';
  const trimmed = firstReal.trim();
  const letterSpaced = /^(?:\S\s+){2,}\S$/.test(trimmed) && trimmed.replace(/\s/g, '').length <= 40;
  doc.meta.name = letterSpaced
    // Two-or-more spaces separate words; single spaces separate letters.
    ? trimmed.split(/\s{2,}/).map((w) => w.replace(/\s+/g, '')).join(' ')
    : trimmed;

  /*
   * Location, from the contact line. Dropping it lost "Bengaluru, India" on the
   * round trip - and location is asked for on essentially every application, so
   * losing it silently means the derived text no longer contains something the
   * autofill path may look for.
   */
  const contactLine = lines.slice(0, 8).find((l) => EMAIL_RE.test(l) || PHONE_RE.test(l)) || '';
  const locPart = contactLine
    .split(/\s*[|·•]\s*/)
    .map((x) => x.trim())
    .find((x) => x && !EMAIL_RE.test(x) && !PHONE_RE.test(x) && !/^https?:|^www\./i.test(x) && /[a-z]/i.test(x));
  if (locPart) doc.meta.location = locPart;

  let current = null;
  let seenHeading = false;
  const push = (section) => { doc.sections.push(section); return section; };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const t = line.trim();
    if (!t) continue;

    /*
     * Everything above the first heading is the header block: name, headline
     * and contact details, all already captured into meta. Skipping it by a
     * line-index guess left the contact line behind, which then opened an
     * implicit "Summary" section - so a resume with its own SUMMARY heading got
     * two of them.
     */
    if (!seenHeading) {
      if (t === trimmed) continue;
      if (EMAIL_RE.test(t) || PHONE_RE.test(t) || /^https?:|^www\./i.test(t)) continue;
      if (locPart && t === locPart) continue;
      // A short line directly under the name is the headline, not a summary.
      if (!doc.meta.title && i < 4 && t.length <= 60 && !/[.!?]$/.test(t)) {
        doc.meta.title = t;
        continue;
      }
    }

    const heading = classifyHeading(t);
    if (heading) {
      seenHeading = true;
      current = push({
        id: nid('sec'), type: heading.type, title: heading.title,
        items: [], collapsed: false,
      });
      continue;
    }

    if (!current) {
      // Text before any heading is the summary, which is where it almost always
      // is when a resume has no explicit "Summary" line.
      current = push({ id: nid('sec'), type: 'summary', title: 'Summary', items: [] });
    }

    if (current.type === 'skills') {
      const parts = t.replace(/^[^:]{0,30}:\s*/, '').split(/[,;|•·]/)
        .map((x) => x.trim()).filter(Boolean);
      const group = current.items[0] || (current.items[0] = { id: nid('grp'), name: null, skills: [] });
      for (const skill of parts) {
        if (!group.skills.some((s) => s.text.toLowerCase() === skill.toLowerCase())) {
          group.skills.push({ id: nid('skl'), text: skill, origin: 'user' });
        }
      }
      continue;
    }

    const isBullet = BULLET_RE.test(line);
    const dates = t.match(DATE_RANGE_RE);

    // A non-bullet line carrying a date range starts a new role/entry.
    if (!isBullet && dates && (current.type === 'experience' || current.type === 'education' || current.type === 'projects')) {
      const label = t.replace(DATE_RANGE_RE, '').replace(/[|·—–-]\s*$/, '').trim();
      const [role, org] = label.split(/\s+(?:at|@|[|·—–])\s+/);
      current.items.push({
        id: nid('itm'),
        role: (role || label).trim(),
        org: (org || '').trim(),
        start: dates[1], end: dates[2],
        current: /present|current|now/i.test(dates[2]),
        bullets: [],
      });
      continue;
    }

    const target = current.items[current.items.length - 1];
    const bullet = {
      id: nid('b'),
      text: t.replace(BULLET_RE, '').trim(),
      origin: 'user',
    };

    if (target && Array.isArray(target.bullets)) {
      target.bullets.push(bullet);
    } else {
      // Loose line with no entry to hang off: keep it as a standalone item
      // rather than discarding it.
      current.items.push({ id: nid('itm'), role: null, org: null, bullets: [bullet] });
    }
  }

  return doc;
}

/* ------------------------------------------------------------------ *
 * Serialising structure back to flat text
 *
 * This is the contract with everything downstream. `includePending` is false by
 * default: a suggestion nobody accepted must never leak into the text the
 * extension pastes into an employer's form.
 * ------------------------------------------------------------------ */

function toText(doc, { includePending = false } = {}) {
  if (!doc || !Array.isArray(doc.sections)) return '';
  const keep = (node) => node && (includePending || node.status !== 'pending');

  const out = [];
  const m = doc.meta || {};
  if (m.name) out.push(m.name);
  if (m.title) out.push(m.title);
  const contact = [m.email, m.phone, m.location].filter(Boolean).join(' · ');
  if (contact) out.push(contact);
  if ((m.links || []).length) out.push(m.links.map((l) => l.url).join(' · '));

  for (const sec of doc.sections) {
    out.push('');
    out.push((sec.title || sec.type || '').toUpperCase());

    if (sec.type === 'skills') {
      for (const group of sec.items || []) {
        const skills = (group.skills || []).filter(keep).map((s) => s.text);
        if (!skills.length) continue;
        out.push(group.name ? `${group.name}: ${skills.join(', ')}` : skills.join(', '));
      }
      continue;
    }

    for (const item of sec.items || []) {
      if (!keep(item)) continue;
      const head = [item.role, item.org].filter(Boolean).join(' — ');
      const when = [item.start, item.end].filter(Boolean).join(' – ');
      if (head || when) out.push([head, when].filter(Boolean).join('  |  '));
      for (const b of item.bullets || []) {
        if (!keep(b)) continue;
        out.push(`- ${b.text}`);
      }
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ------------------------------------------------------------------ *
 * Node addressing - what the editor and the enforcement layer both need
 * ------------------------------------------------------------------ */

// Every text-bearing node, flattened, with the path needed to mutate it.
function walk(doc) {
  const nodes = [];
  (doc.sections || []).forEach((sec, si) => {
    (sec.items || []).forEach((item, ii) => {
      if (sec.type === 'skills') {
        (item.skills || []).forEach((s, bi) => nodes.push({ node: s, kind: 'skill', si, ii, bi, section: sec }));
        return;
      }
      if (item.role || item.org) nodes.push({ node: item, kind: 'entry', si, ii, bi: -1, section: sec });
      (item.bullets || []).forEach((b, bi) => nodes.push({ node: b, kind: 'bullet', si, ii, bi, section: sec }));
    });
  });
  return nodes;
}

function findNode(doc, id) {
  return walk(doc).find((n) => n.node.id === id) || null;
}

// Removes a node by id. Used by reject, which must leave nothing behind.
function removeNode(doc, id) {
  const hit = findNode(doc, id);
  if (!hit) return false;
  const sec = doc.sections[hit.si];
  const item = sec.items[hit.ii];
  if (hit.kind === 'skill') item.skills.splice(hit.bi, 1);
  else if (hit.kind === 'bullet') item.bullets.splice(hit.bi, 1);
  else sec.items.splice(hit.ii, 1);
  return true;
}

function countPending(doc) {
  return walk(doc).filter((n) => n.node.status === 'pending').length;
}

function reorderSections(doc, orderedIds) {
  const byId = new Map((doc.sections || []).map((s) => [s.id, s]));
  const next = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  // Anything the caller did not mention keeps its place at the end rather than
  // being dropped - a reorder must never delete a section.
  for (const s of doc.sections || []) if (!orderedIds.includes(s.id)) next.push(s);
  doc.sections = next;
  return doc;
}

module.exports = {
  SECTION_TYPES, ORIGINS,
  emptyDoc, parseText, toText,
  walk, findNode, removeNode, countPending, reorderSections,
  nid,
};
