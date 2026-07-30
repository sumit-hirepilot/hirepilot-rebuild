/*
 * Packages ../extension into public/hirepilot-extension.zip.
 *
 * Runs as prebuild so the download can never serve a stale package - the zip is
 * a build artifact, not something to remember to regenerate by hand.
 *
 * Uses the system `zip` because adding a dependency for one archive is not worth
 * it. If the extension folder is missing (a frontend-only build context) or zip
 * is unavailable, this logs and exits 0 rather than failing the deploy: a
 * missing download is a degraded feature, not a reason to have no site.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXT_DIR = path.join(__dirname, '..', '..', 'extension');
const OUT_DIR = path.join(__dirname, '..', 'public');
const OUT = path.join(OUT_DIR, 'hirepilot-extension.zip');

function main() {
  if (!fs.existsSync(path.join(EXT_DIR, 'manifest.json'))) {
    console.log('[extension-zip] no extension/manifest.json - skipping');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Rebuild from scratch; zip would otherwise merge into an existing archive and
  // keep files that have since been deleted.
  if (fs.existsSync(OUT)) fs.rmSync(OUT);

  try {
    execFileSync(
      'zip',
      ['-qr', OUT, '.', '-x', '*.DS_Store', '-x', '__MACOSX/*', '-x', '*/.DS_Store'],
      { cwd: EXT_DIR, stdio: 'inherit' }
    );
  } catch (err) {
    console.warn(`[extension-zip] zip failed (${err.message}) - download will 404`);
    return;
  }

  const { size } = fs.statSync(OUT);
  const version = JSON.parse(
    fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8')
  ).version;
  console.log(`[extension-zip] v${version} packaged, ${Math.round(size / 1024)}KB`);
}

main();
