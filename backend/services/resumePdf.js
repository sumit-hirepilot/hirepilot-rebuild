/*
 * PDF export, printed from the same HTML the editor previews.
 *
 * This replaces pdfkit. pdfkit built its own layout from the flat text with its
 * own heading heuristics, so the preview and the download were two different
 * renderers that could only be kept in agreement by hand - and would drift the
 * moment either changed. Printing the preview's exact markup through headless
 * Chrome makes "what you see is what downloads" structural.
 *
 * Chromium is a heavy dependency and it is treated as optional at runtime: if
 * it cannot launch, the PDF endpoint says so plainly and the rest of the API is
 * untouched. An export feature must not be able to take down the apply pipeline.
 */

const { renderHtml } = require('./resumeTemplate');

let browserPromise = null;
let unavailableReason = null;

/*
 * One browser for the process, launched on first use.
 *
 * Launching per request costs about a second each time and leaks processes
 * under load; a single instance with a fresh page per render is the usual
 * shape. The promise is cached rather than the browser so concurrent first
 * calls do not launch several.
 */
async function getBrowser() {
  if (unavailableReason) throw new Error(unavailableReason);
  if (browserPromise) return browserPromise;

  browserPromise = (async () => {
    let puppeteer;
    try {
      // eslint-disable-next-line global-require
      puppeteer = require('puppeteer-core');
    } catch {
      throw new Error('puppeteer-core is not installed');
    }

    // Alpine cannot run Puppeteer's bundled Chromium, so the image installs the
    // system package and points here. Falls back to the usual paths for local
    // development on macOS and Debian.
    const candidates = [
      process.env.CHROME_PATH,
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].filter(Boolean);

    const fs = require('fs');
    const executablePath = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
    if (!executablePath) throw new Error('No Chromium binary found for PDF export');

    return puppeteer.launch({
      executablePath,
      headless: 'new',
      // --no-sandbox is required in a container running as a non-root user with
      // no user namespaces; this browser only ever loads our own markup, never
      // a remote page, so it is not rendering untrusted content.
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
  })().catch((err) => {
    unavailableReason = err.message;
    browserPromise = null;
    throw err;
  });

  return browserPromise;
}

/**
 * Render a structured resume to PDF bytes.
 *
 * @param {object} doc    structured document
 * @param {object} style  toolbar settings
 * @returns {Promise<Buffer>}
 */
async function renderPdf(doc, style) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const html = renderHtml(doc, style, { forPrint: true });
    // setContent rather than a data: URL - data URLs have length limits that a
    // long resume reaches, and this keeps relative behaviour predictable.
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 });

    return await page.pdf({
      format: 'Letter',
      printBackground: true,
      // Margins live in the template's .page padding, so the same spacing
      // applies on screen and on paper. Setting them here as well would
      // double them and shift every line break.
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    });
  } finally {
    await page.close().catch(() => {});
  }
}

// Whether export is usable, for the UI to disable the button honestly rather
// than offer a download that will fail.
async function available() {
  try {
    await getBrowser();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = { renderPdf, available };
