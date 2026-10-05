// Shared helpers. Every suite starts the page in its prompt state and drives
// the real UI; nothing reaches past the DOM into app internals.
import { chromium } from 'playwright';

// Tests run against their own MOCK server on 3211, so the demo on 3210 (and
// anything saved to it from an open browser) is never touched.
export const URL = process.env.TEST_URL || 'http://localhost:3211/';

export async function open(opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 950 },
    reducedMotion: opts.reducedMotion,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForTimeout(250);
  return { browser, page, errors };
}

// The example button is gone, so tests put an example in the box themselves.
export async function fillExample(page, i = 0) {
  await page.evaluate(async (i) => {
    const all = (await (await fetch('examples.txt')).text()).split('\n---\n').map((e) => e.trim()).filter(Boolean);
    document.getElementById('notes').value = all[i % all.length];
  }, i);
}

// Prompt -> questions -> skip -> board. The path every suite needs.
export async function runToBoard(page, { answer = false } = {}) {
  await fillExample(page);
  await page.locator('#run').click();
  await page.locator('#questions-panel').waitFor({ state: 'visible', timeout: 20000 });
  if (answer) {
    for (let i = 0; i < 3; i++) {
      const opt = page.locator('.q-opt:not(.q-other)').first();
      // The questions panel heaves gently, so clicks there skip the wait for stillness.
      if (await opt.count()) { await opt.click({ force: true }); await page.waitForTimeout(400); }
    }
  } else {
    await page.locator('#q-skip-all').click({ force: true });
  }
  await page.locator('#health-row').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1100);
}

export async function go(page, name) {
  await page.locator(`.nav-item[data-page="${name}"]`).click();
  await page.waitForTimeout(260);
}

export function report(checks, errors, extra) {
  let bad = 0;
  for (const [name, ok] of checks) { if (!ok) bad++; console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}`); }
  if (errors && errors.length) { console.log('  JS errors: ' + errors.join(' | ')); }
  if (extra) console.log(extra);
  return bad;
}
