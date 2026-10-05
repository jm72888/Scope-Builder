import { open, runToBoard, report, fillExample } from './lib.mjs';
const { browser, page, errors } = await open();
const checks = []; const ck = (n, v) => checks.push([n, v]);
await page.waitForTimeout(600);

// In prompt state the status lives in the hidden sidebar, so check the values
// rather than visibility.
ck('model named with its version', (await page.locator('#conn-model').innerText()).includes('Claude Sonnet 5.5'));
ck('mock mode reports disconnected', (await page.locator('#conn-state').innerText()).trim() === 'Disconnected');
ck('dot is red when disconnected',
  (await page.locator('#conn-dot').evaluate(e => getComputedStyle(e).backgroundColor)).replace(/\s/g,'') === 'rgb(208,32,32)');

await runToBoard(page);
ck('status visible in the sidebar on the board', await page.locator('#conn').isVisible());
const conn = await page.locator('#conn').boundingBox();
const nav = await page.locator('#sidenav').boundingBox();
ck('status sits at the bottom of the sidebar', conn.y > nav.y + nav.height * 0.6);

await page.route('**/api/status', r => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ connected: true, model: 'Claude Opus 5.5', reason: 'API key loaded' }) }));
await page.reload();
await page.waitForTimeout(700);
ck('flips to Connected', (await page.locator('#conn-state').innerText()).trim() === 'Connected');
ck('picks up the model name', (await page.locator('#conn-model').innerText()).includes('Claude Opus 5.5'));
ck('dot is green when connected',
  (await page.locator('#conn-dot').evaluate(e => getComputedStyle(e).backgroundColor)).replace(/\s/g,'') === 'rgb(63,154,30)');

await page.unroute('**/api/status');
await page.route('**/api/plan', r => r.fulfill({ status: 500, contentType: 'application/json',
  body: JSON.stringify({ error: 'Claude API returned 401' }) }));
if (await page.locator('#reset-all').isVisible()) await page.locator('#reset-all').click();
await fillExample(page);
await page.locator('#run').click();
await page.locator('#questions-panel').waitFor({ state: 'visible', timeout: 20000 });
await page.locator('#q-skip-all').click({ force: true });
await page.waitForTimeout(1500);
ck('a failed call downgrades the status', (await page.locator('#conn-state').innerText()).trim() === 'Disconnected');
ck('error surfaced to the user', await page.locator('#error').isVisible());
ck('stays in prompt state when the run fails', (await page.locator('body').getAttribute('class')).includes('state-prompt'));

ck('no JS errors', errors.length === 0);
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
