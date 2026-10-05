import { open, runToBoard, report, fillExample } from './lib.mjs';
const { browser, page, errors } = await open();
const checks = []; const ck = (n, v) => checks.push([n, v]);

ck('no example button in the top bar', (await page.locator('#gen-example').count()) === 0);
ck('reset button labelled correctly', (await page.locator('#reset-all').innerText()).trim() === 'Reset all');

// The examples file stays: tests and anyone curious can still use it.
const seen = await page.evaluate(async () =>
  (await (await fetch('examples.txt')).text()).split('\n---\n').map((e) => e.trim()).filter(Boolean));
ck('15 distinct examples on file', new Set(seen).size === 15);
ck('examples are the long form', seen.every(s => s.split(' ').length > 180));
ck('no personal names', !seen.some(s => /\b(Priya|Dana|Raj|Marco|Sarah|John|Jane)\b/.test(s)));
ck('no em-dashes', !seen.some(s => s.includes('—')));

await runToBoard(page);
ck('copy buttons present on the board',
  (await page.locator('#copy-summary').count()) === 1);

await page.locator('#reset-all').click();
await page.waitForTimeout(400);
ck('reset clears everything', (await page.locator('#notes').inputValue()) === '');
ck('reset hides results', (await page.locator('.result:not([hidden])').count()) === 0);
await fillExample(page);

// A full run still works after a reset.
await page.locator('#run').click();
await page.locator('#questions-panel').waitFor({ state: 'visible', timeout: 20000 });
await page.locator('#q-skip-all').click({ force: true });
await page.locator('#health-row').waitFor({ state: 'visible', timeout: 30000 });
ck('full run works after reset', await page.locator('#health-row').isVisible());
ck('no error box', !(await page.locator('#error').isVisible()));

ck('no JS errors', errors.length === 0);
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
