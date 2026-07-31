/*
 * The resume template.
 *
 * ONE renderer. This produces the HTML the editor shows in its preview pane and
 * the exact same HTML the PDF is printed from, so "what you see is what
 * downloads" is a property of the architecture rather than a promise kept by
 * discipline. Two renderers - a React preview and a pdfkit export - always
 * drift, and pdfkit is being dropped for precisely that reason.
 *
 * Everything is driven by `style`, so the toolbar's font, size, alignment and
 * fit-to-page controls change the real document rather than a facsimile of it.
 *
 * Adding a template means adding an entry to TEMPLATES: a name, its CSS, and
 * nothing else. The body markup is shared, so a new template cannot accidentally
 * change what content appears - only how it looks.
 */

const DEFAULT_STYLE = {
  template: 'standard',
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontSize: 10.5,       // pt
  lineHeight: 1.38,
  align: 'left',        // 'left' | 'justify'
  fitOnePage: false,
  accent: '#111111',
};

const FONTS = [
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'garamond', label: 'Garamond', stack: '"EB Garamond", Garamond, Georgia, serif' },
  { id: 'helvetica', label: 'Helvetica', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: 'inter', label: 'Inter', stack: 'Inter, "Helvetica Neue", Arial, sans-serif' },
  { id: 'charter', label: 'Charter', stack: 'Charter, "Bitstream Charter", Georgia, serif' },
];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const TEMPLATES = {
  standard: {
    label: 'Standard',
    css: `
      .name { font-size: 1.9em; font-weight: 700; letter-spacing: -0.01em; }
      .headline { font-size: 1.02em; margin-top: 2px; }
      .contact { font-size: .86em; margin-top: 5px; color: #333; }
      .sec-title {
        font-size: .82em; font-weight: 700; text-transform: uppercase;
        letter-spacing: .08em; margin: 15px 0 6px;
        border-bottom: 1px solid #cfcfcf; padding-bottom: 3px;
      }
      .entry-head { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; }
      .entry-role { font-weight: 700; }
      .entry-org { font-weight: 400; }
      .entry-when { white-space: nowrap; color: #444; font-size: .92em; }
    `,
  },
};

/*
 * Pending nodes are highlighted here rather than in the editor, so the
 * highlight is part of the document being previewed. Print CSS strips it: a
 * suggestion nobody accepted must never appear in the downloaded PDF, and
 * relying on the caller to filter it would eventually miss a path.
 */
const PENDING_CSS = `
  .pending {
    background: #f3ecff;
    box-shadow: inset 2px 0 0 #7c3aed;
    padding-left: 6px;
    border-radius: 2px;
  }
  .pending::after {
    content: " ⌁ suggested";
    font-size: .72em; color: #7c3aed; font-weight: 600; letter-spacing: .02em;
  }
  @media print {
    .pending, .pending::after { display: none !important; }
  }
`;

function styleFor(style = {}) {
  const s = { ...DEFAULT_STYLE, ...(style || {}) };
  // A font stack the caller supplied by id rather than by value.
  const byId = FONTS.find((f) => f.id === s.fontFamily);
  if (byId) s.fontFamily = byId.stack;
  return s;
}

function renderMeta(meta = {}) {
  const contact = [meta.email, meta.phone, meta.location].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');
  const links = (meta.links || []).map((l) => `<a href="${esc(l.url)}">${esc(l.label || l.url)}</a>`).join(' &nbsp;·&nbsp; ');
  return `
    <header class="doc-head">
      ${meta.name ? `<div class="name">${esc(meta.name)}</div>` : ''}
      ${meta.title ? `<div class="headline">${esc(meta.title)}</div>` : ''}
      ${contact || links ? `<div class="contact">${[contact, links].filter(Boolean).join(' &nbsp;·&nbsp; ')}</div>` : ''}
    </header>`;
}

// `data-node` on every text-bearing element is what lets the editor map a click
// in the preview back to the node it came from.
const nodeAttrs = (n) => `data-node="${esc(n.id)}"${n.status === 'pending' ? ' class="pending"' : ''}`;

function renderSection(sec) {
  const title = `<div class="sec-title">${esc(sec.title || sec.type)}</div>`;

  if (sec.type === 'skills') {
    const groups = (sec.items || []).map((g) => {
      const skills = (g.skills || []).map((s) => `<span ${nodeAttrs(s)}>${esc(s.text)}</span>`).join(', ');
      if (!skills) return '';
      return `<div class="skills-row">${g.name ? `<strong>${esc(g.name)}:</strong> ` : ''}${skills}</div>`;
    }).join('');
    return groups ? `<section data-section="${esc(sec.id)}">${title}${groups}</section>` : '';
  }

  const items = (sec.items || []).map((item) => {
    const head = (item.role || item.org)
      ? `<div class="entry-head" ${nodeAttrs(item)}>
           <div><span class="entry-role">${esc(item.role || '')}</span>${item.org ? ` <span class="entry-org">— ${esc(item.org)}</span>` : ''}</div>
           ${(item.start || item.end) ? `<div class="entry-when">${esc([item.start, item.end].filter(Boolean).join(' – '))}</div>` : ''}
         </div>`
      : '';
    const bullets = (item.bullets || []).length
      ? `<ul class="bullets">${item.bullets.map((b) => `<li ${nodeAttrs(b)}>${esc(b.text)}</li>`).join('')}</ul>`
      : '';
    return head + bullets;
  }).join('');

  return items ? `<section data-section="${esc(sec.id)}">${title}${items}</section>` : '';
}

/**
 * The document body. Shared by preview and print - neither gets its own copy.
 */
function renderBody(doc) {
  const sections = (doc.sections || []).map(renderSection).join('');
  return `${renderMeta(doc.meta)}${sections}`;
}

/**
 * A complete, standalone HTML page.
 *
 * @param {object} doc     structured document
 * @param {object} style   toolbar settings
 * @param {object} opts
 * @param {boolean} opts.forPrint  true when Chrome is about to print this
 */
function renderHtml(doc, style, { forPrint = false } = {}) {
  const s = styleFor(style);
  const tpl = TEMPLATES[s.template] || TEMPLATES.standard;

  /*
   * Fit to one page scales the whole document rather than shrinking the font.
   * Shrinking type alone changes line breaking, so the preview stops matching
   * the export - which is the exact failure this architecture exists to avoid.
   */
  const fit = s.fitOnePage
    ? `.page { transform: scale(var(--fit, 1)); transform-origin: top center; }`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${forPrint ? '#fff' : '#f1f3f8'}; }
  .page {
    width: 8.5in;
    min-height: 11in;
    margin: ${forPrint ? '0' : '0 auto'};
    padding: 0.62in 0.7in;
    background: #fff;
    color: #111;
    font-family: ${s.fontFamily};
    font-size: ${s.fontSize}pt;
    line-height: ${s.lineHeight};
    text-align: ${s.align};
    ${forPrint ? '' : 'box-shadow: 0 2px 18px rgba(15,23,42,.13); border-radius: 2px;'}
  }
  a { color: inherit; text-decoration: none; }
  ul.bullets { margin: 4px 0 0; padding-left: 1.05em; }
  ul.bullets li { margin: 2px 0; }
  .skills-row { margin: 3px 0; }
  section { break-inside: auto; }
  .sec-title { break-after: avoid; }
  .entry-head { break-after: avoid; }
  ${tpl.css}
  ${PENDING_CSS}
  ${fit}
</style></head>
<body><div class="page">${renderBody(doc)}</div></body></html>`;
}

module.exports = {
  renderHtml, renderBody, styleFor,
  TEMPLATES, FONTS, DEFAULT_STYLE,
  templateList: () => Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label })),
};
