/*
 * A3 / H4 — every CSS-module class a page references must exist in the sheet
 * that page imports.
 *
 * CSS Modules resolve a missing class to `undefined`, React drops an undefined
 * className silently, and the element renders unstyled. Nothing throws, nothing
 * logs, and the build is green. This has shipped three times:
 *   - listbox CSS written to a stray drawer.js.css
 *   - drawer CSS written to Jobs.module.css while the drawer imports Dashboard
 *   - page.proof / page.proofTitle referenced in auto-apply.js, never defined
 *
 * A one-off grep found the third only by accident, and its line-anchored regex
 * also produced a FALSE POSITIVE on `.searchInput, .locInput {` - a grouped
 * selector whose second class starts mid-line. This parses selectors properly
 * so the guard can be trusted in both directions.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Every class name defined in a CSS file, including grouped and nested selectors. */
function definedClasses(cssPath) {
  const css = fs.readFileSync(cssPath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ''); // comments may contain class-like text
  const names = new Set();
  // Match every .identifier that is part of a selector, i.e. appears before a
  // `{` on the same rule. Scanning declaration blocks too would pick up things
  // like `.5rem`, so restrict to selector positions.
  for (const block of css.split('}')) {
    const selector = block.split('{')[0];
    if (!selector) continue;
    for (const m of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(m[1]);
  }
  return names;
}

/** The CSS-module imports of a JS file, as { localName -> absolute css path }. */
function moduleImports(jsPath) {
  const src = fs.readFileSync(jsPath, 'utf8');
  const out = {};
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.css)['"]/g)) {
    out[m[1]] = path.resolve(path.dirname(jsPath), m[2]);
  }
  return out;
}

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) out.push(full);
    }
  };
  walk(path.join(ROOT, 'pages'));
  walk(path.join(ROOT, 'components'));
  return out;
}

describe('A3 / H4 — every referenced CSS class is defined', () => {
  const files = sourceFiles();

  it('finds pages that import CSS modules at all', () => {
    // A guard that scans nothing passes forever.
    const withCss = files.filter((f) => Object.keys(moduleImports(f)).length > 0);
    expect(withCss.length).toBeGreaterThan(5);
  });

  it('resolves every styles.x reference in the sheet that file imports', () => {
    const missing = [];

    for (const file of files) {
      const imports = moduleImports(file);
      if (!Object.keys(imports).length) continue;

      // Strip comments: this repo's own commentary names classes it removed.
      const code = fs.readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      for (const [local, cssPath] of Object.entries(imports)) {
        if (!fs.existsSync(cssPath)) {
          missing.push(`${path.relative(ROOT, file)}: imports ${path.relative(ROOT, cssPath)} which does not exist`);
          continue;
        }
        const defined = definedClasses(cssPath);
        const used = new Set(
          [...code.matchAll(new RegExp(`\\b${local}\\.([A-Za-z0-9_]+)`, 'g'))].map((m) => m[1])
        );
        for (const name of used) {
          if (!defined.has(name)) {
            missing.push(
              `${path.relative(ROOT, file)}: ${local}.${name} not in ${path.basename(cssPath)}`
            );
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
