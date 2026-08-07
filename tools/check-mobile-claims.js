#!/usr/bin/env node
/*
 * A mobile claim is verified by something a phone reads. Never by a width.
 *
 * Resizing the browser sets a true viewport width, so media queries run and
 * the page lays out correctly - with or without a viewport meta tag. The tag
 * is the one thing a resized window cannot test, because only a real mobile
 * browser reads it.
 *
 * That is exactly how it went wrong. Three separate 375px audit passes reported
 * zero overflow and correct layout across the app, while every authenticated
 * page shipped with no `<meta name="viewport">` and would have rendered at the
 * ~980px fallback on an actual phone. The instrument could not see the defect
 * it was aimed at.
 *
 * The same blindness hid a second one: nothing in the frontend detected a
 * phone at all, so the header offered "Download Extension" and the modal
 * walked through installing it, on devices where Chrome extensions do not
 * exist. At 375px in a desktop window that button is perfect.
 *
 * WHAT THIS CHECKS - only things a phone actually reads:
 *   1. the viewport tag is declared PRODUCT-WIDE, in _app, not per page
 *   2. a claim about running on a phone is backed by that tag
 *   3. an install instruction is gated on a real device signal
 *
 * KNOWN LIMIT: it cannot verify rendering on a real handset. It verifies that
 * the inputs a handset reads are present and are the basis of the claim. Real
 * hardware stays a manual step, and BACKLOG_MOBILE.md says so.
 *
 *   node tools/check-mobile-claims.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FE = path.join(ROOT, 'frontend');
const read = (...p) => {
  const f = path.join(FE, ...p);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
const live = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const problems = [];

/* 1. The tag itself, product-wide. */
const app = live(read('pages', '_app.js'));
if (!/name=["']viewport["']/.test(app) || !/width=device-width/.test(app)) {
  problems.push(
    'pages/_app.js does not declare <meta name="viewport" content="width=device-width...">.\n'
    + '    Without it every page lays out at the ~980px fallback on a real phone, and NO\n'
    + '    amount of resizing will show you that - resize sets a true viewport width.'
  );
}

/*
 * 2. A page-local viewport tag is not the fix, and having only one is how this
 *    broke: index.js had it, nothing else did, and the homepage promised "the
 *    whole product".
 */
const pagesDir = path.join(FE, 'pages');
const pageFiles = fs.existsSync(pagesDir)
  ? fs.readdirSync(pagesDir).filter((f) => f.endsWith('.js') && f !== '_app.js' && f !== '_document.js')
  : [];
const claimRe = /mobile browser|on your phone|phone browser|works on your phone/i;

for (const f of pageFiles) {
  const src = live(read('pages', f));
  if (claimRe.test(src) && !/name=["']viewport["']/.test(app)) {
    problems.push(`pages/${f} claims the product runs on a phone, but _app.js declares no viewport tag`);
  }
}

/*
 * 3. An instruction to install the Chrome extension must be gated on a device
 *    signal. Chrome on Android and every iOS browser cannot install one, so an
 *    ungated prompt is an instruction that cannot be followed.
 */
const layout = live(read('components', 'DashboardLayout.js'));
if (/ExtensionInstallModal/.test(layout)) {
  if (!/canInstall/.test(layout)) {
    problems.push(
      'components/DashboardLayout.js prompts for the Chrome extension without checking\n'
      + '    whether the device can install one. Use lib/extensionCapable.'
    );
  }
  if (!/if \(!canInstall\) return;/.test(layout)) {
    problems.push('the automatic extension prompt is not gated on canInstall - a phone cannot follow it');
  }
}

/* The capability check must read a device signal, not a width. */
const cap = live(read('lib', 'extensionCapable.js'));
if (cap) {
  if (!/userAgent|userAgentData|maxTouchPoints/.test(cap)) {
    problems.push('lib/extensionCapable.js decides from something other than a device signal');
  }
  if (/innerWidth|matchMedia\(\s*['"`]\(max-width/.test(cap)) {
    problems.push(
      'lib/extensionCapable.js decides from a WIDTH. A resized desktop window has a\n'
      + '    phone-sized width and is still a desktop browser - that is the whole defect.'
    );
  }
} else if (/canInstall/.test(layout)) {
  problems.push('lib/extensionCapable.js is missing but DashboardLayout expects it');
}

if (problems.length) {
  console.error('A MOBILE CLAIM IS NOT BACKED BY ANYTHING A PHONE READS:\n');
  for (const p of problems) console.error(`  ${p}\n`);
  console.error('Resize proves CSS. It does not prove mobile rendering. Verify against the tag,');
  console.error('the served HTML, or a device signal.');
  process.exit(1);
}

console.log('mobile claims are backed by the viewport tag and a real device signal');
