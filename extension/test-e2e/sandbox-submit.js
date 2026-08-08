const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const EXT = process.env.EXT;
  const CFT = process.env.CHROME;
  const API = process.env.API;
  const APP = process.env.APP;
  const TOKEN = fs.readFileSync(process.env.SCRATCH + '/ext-token.txt', 'utf8').trim();
  const ART = process.env.SCRATCH + '/pw/artifacts';
  fs.mkdirSync(ART, { recursive: true });
  const swLog = [], pageLog = [];
  const log = (...a) => console.log('[harness]', ...a);

  const ctx = await chromium.launchPersistentContext(process.env.SCRATCH + '/pw/run-' + Date.now(), {
    headless: false,
    executablePath: CFT,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check'],
  });

  // Capture any new page's console + the sandbox tab
  ctx.on('page', (p) => {
    p.on('console', (m) => pageLog.push(`[${new URL(p.url()||'about:blank','http://x').pathname}] ${m.type()}: ${m.text()}`));
  });

  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const extId = sw.url().split('/')[2];
  log('extension id', extId);
  sw.on('console', (m) => swLog.push(`${m.type()}: ${m.text()}`));

  // Pair: exactly what the popup's HP_SET_TOKEN does, plus autoSubmit on for the sandbox.
  await sw.evaluate(async ({ token, api, app }) => {
    await chrome.storage.local.set({ token, apiBase: api, appBase: app, autoSubmit: true });
  }, { token: TOKEN, api: API, app: APP });
  log('paired (token + autoSubmit in storage)');

  // Open the real popup and drive it like a user.
  const popup = await ctx.newPage();
  popup.on('console', (m) => pageLog.push(`[popup] ${m.type()}: ${m.text()}`));
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
  await popup.waitForTimeout(2500);
  const connected = await popup.evaluate(() => document.getElementById('conn')?.textContent);
  log('popup connection status:', connected);
  const queueText = await popup.evaluate(() => document.getElementById('queueList')?.textContent?.slice(0,200));
  log('popup queue:', queueText);

  // Listen for the sandbox tab BEFORE we start the run.
  const sandboxTabP = ctx.waitForEvent('page', { predicate: (p) => /ats-sandbox\/greenhouse/.test(p.url()), timeout: 60000 }).catch(() => null);

  // Click Run queue.
  const ran = await popup.evaluate(() => { const b = document.getElementById('runBtn'); if (b) { b.click(); return true; } return false; });
  log('clicked Run queue:', ran);

  const sandboxTab = await sandboxTabP;
  if (!sandboxTab) { log('SANDBOX TAB NEVER OPENED'); }
  else {
    log('sandbox tab opened:', sandboxTab.url());
    // Wait for the drawer to appear and the form to fill / confirmation to render
    await sandboxTab.waitForTimeout(1000);
    // drawer present?
    const drawer = await sandboxTab.evaluate(() => !!document.querySelector('[data-hp-drawer], #hp-drawer, .hp-drawer, [id*="hirepilot" i], [class*="hirepilot" i]')).catch(() => false);
    // field values after fill
    const filled = await sandboxTab.evaluate(() => {
      const g = (id) => document.getElementById(id);
      return {
        first: g('first_name')?.value, last: g('last_name')?.value, email: g('email')?.value, phone: g('phone')?.value,
        authorised: g('q_authorised')?.value, sponsorship: g('q_sponsorship')?.value, notice: g('q_notice')?.value, years: g('q_years')?.value,
        gender: g('d_gender')?.value, veteran: g('d_veteran')?.value,
        resumeName: g('resume')?.files?.[0]?.name, resumeSize: g('resume')?.files?.[0]?.size,
      };
    }).catch((e) => ({ error: e.message }));
    log('drawer present:', drawer);
    log('filled fields:', JSON.stringify(filled));
    await sandboxTab.screenshot({ path: ART + '/sandbox-filled.png' }).catch(()=>{});

    // wait for confirmation to render (auto-submit) up to 30s
    let confId = null;
    for (let i = 0; i < 30; i++) {
      confId = await sandboxTab.evaluate(() => document.querySelector('[data-hp-confirmation-id]')?.textContent).catch(() => null);
      if (confId) break;
      // the tab may have been closed by finalize() on success — catch that
      if (sandboxTab.isClosed()) { log('sandbox tab closed (finalize removes it on verified success)'); break; }
      await new Promise(r => setTimeout(r, 1000));
    }
    log('CONFIRMATION_ID:', confId || (sandboxTab.isClosed() ? '(tab closed on success)' : 'NONE'));
    if (!sandboxTab.isClosed()) await sandboxTab.screenshot({ path: ART + '/sandbox-after.png' }).catch(()=>{});
  }

  await popup.waitForTimeout(3000);
  // Final popup counters
  const counters = await popup.evaluate(() => ({
    submitted: document.getElementById('sSubmitted')?.textContent,
    failed: document.getElementById('sFailed')?.textContent,
    err: document.getElementById('mainErr')?.textContent,
  })).catch(() => ({}));
  log('popup counters:', JSON.stringify(counters));

  fs.writeFileSync(ART + '/sw-console.log', swLog.join('\n'));
  fs.writeFileSync(ART + '/page-console.log', pageLog.join('\n'));
  log('artifacts in', ART);
  await ctx.close();
  log('DONE');
})().catch(e => { console.error('[harness] FATAL:', e.stack); process.exit(2); });
