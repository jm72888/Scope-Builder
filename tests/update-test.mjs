// Scan context and update dashboard: re-runs, appends a version, shows what
// moved, and can be reverted from Scan history.
import { open, runToBoard, go, report } from './lib.mjs';
const { browser, page, errors } = await open();
const checks = []; const ck = (n, v) => checks.push([n, v]);

await runToBoard(page);
ck('add-context card shown on the board', await page.locator('#add-card').isVisible());
ck('no suggested questions to answer', (await page.locator('#missing, .missing-list').count()) === 0);
ck('the scan button waits for something to scan', !(await page.locator('#scan').isEnabled())
  && (await page.locator('#scan').innerText()).trim() === 'Scan context and update dashboard');
ck('no scan history before the first scan', !(await page.locator('#scans').isVisible()));
ck('no delta on a first run', !(await page.locator('#health-delta').isVisible()));
ck('a first run logs one entry', (await page.locator('#activity .act').count()) === 1);
ck('and it records the evaluation', /Evaluated: \d+%/.test(await page.locator('#activity .act').first().innerText()));

const notesBefore = (await page.locator('#notes').inputValue()).length;

// Make the second run score differently so the delta has something to show.
await page.route('**/api/plan', async (route) => {
  const res = await route.fetch();
  const plan = await res.json();
  // Every deliverable completed: Development rises from 57 to 89, live.
  plan.deliverables = plan.deliverables.map((d) => ({ ...d, status: 'completed' }));
  await route.fulfill({ response: res, json: plan });
});

await page.locator('#add-notes').fill('The Support lead owns it and training is booked for week 2.');
ck('typing lights the scan button', await page.locator('#scan').isEnabled());
await page.locator('#scan').click();
await page.locator('#switcher-meta').filter({ hasText: '2 versions' }).waitFor({ timeout: 30000 });
await page.waitForTimeout(1200);

ck('notes grew by what was added', (await page.locator('#notes').inputValue()).length > notesBefore + 40);
ck('added text cleared from the box', (await page.locator('#add-notes').inputValue()) === '');
ck('a second version was recorded', (await page.locator('#switcher-meta').innerText()).includes('2 versions'));

const delta = await page.locator('#health-delta');
ck('delta badge appears', await delta.isVisible());
ck('delta shows the move and the version', /▲ \d+% since v1/.test(await delta.innerText()));
ck('delta is positive styled', !((await delta.getAttribute('class')) || '').includes('down'));

// The update's diff now lives in the activity feed, newest first.
const top = page.locator('#activity .act').first();
const changed = await top.innerText();
ck('the update is the newest change', /Updated with new context/.test(changed));
ck('it shows the score move', /\d+% to \d+%/.test(changed));
ck('the moved variable is named', changed.includes('Development'));
ck('the move is shown as from-to', /57% to 89%/.test(changed));
ck('the scan is listed in Scan history, with what was scanned', (await page.locator('#scans-list .scan-row').count()) === 1
  && /The Support lead owns it and training is booked for week 2\./.test(await page.locator('#scans-list .scan-what').first().innerText()));

// It must all survive a refresh, from the files rather than memory.
await page.reload();
await page.waitForTimeout(1800);
ck('still two versions after refresh', (await page.locator('#switcher-meta').innerText()).includes('2 versions'));
ck('delta still shown after refresh', await page.locator('#health-delta').isVisible());
ck('the history survives a refresh', (await page.locator('#activity .act').count()) >= 2);
ck('and keeps the update detail', (await page.locator('#activity .act').first().innerText()).includes('57% to 89%'));

// A gate declining to spend should look like an answer, not an error.
await page.route('**/api/plan', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ blocked: true, reason: 'That does not add anything the plan does not already have.' }),
}));
const versionsBefore = await page.locator('#switcher-meta').innerText();
await page.locator('#add-notes').fill('ok');
await page.locator('#scan').click();
await page.waitForTimeout(1200);
ck('a blocked update says why in the add box',
  (await page.locator('#add-status').innerText()).includes('does not add anything'));
ck('a blocked update is not shown as an error', !(await page.locator('#error').isVisible()));
ck('a blocked update adds no version',
  (await page.locator('#switcher-meta').innerText()) === versionsBefore);
ck('the scan button is usable again', await page.locator('#scan').isEnabled());

// --- the source notes cannot be edited on the board ---
await page.locator('#toggle-notes').click();
ck('no separate Evaluate button on the dashboard', !(await page.locator('#run').isVisible()));
ck('no notes box to type in', !(await page.locator('#notes').isVisible()));

// --- typed context is kept if you leave before scanning ---
await page.unroute('**/api/plan');
await page.locator('#add-notes').fill('Finance ops owns the export fallback.');
await page.waitForTimeout(1300);
await page.reload();
await page.waitForTimeout(1800);
ck('unscanned context survives a refresh', (await page.locator('#add-notes').inputValue()) === 'Finance ops owns the export fallback.');
ck('there is no Save context button any more', (await page.locator('#save-context').count()) === 0);

// --- revert a scan: back to the dashboard from before it, as a new version ---
await go(page, 'content');
const titles = () => page.locator('#dlv-grid .dlv .dlv-title').evaluateAll((e) => e.map((x) => x.value));
const statuses = () => page.locator('#dlv-grid .dlv').evaluateAll((e) => e.map((x) => [...x.classList].find((c) => c.startsWith('status-'))));
ck('after the scan every deliverable is completed', (await statuses()).every((c) => c === 'status-completed'));
await go(page, 'overview');
page.once('dialog', (d) => d.accept());
const vNow = Number((await page.locator('#switcher-meta').innerText()).match(/\d+/)[0]);
await page.locator('#scans-list .scan-revert').first().click();
await page.locator('#switcher-meta').filter({ hasText: `${vNow + 1} versions` }).waitFor({ timeout: 10000 });
await page.waitForTimeout(600);
await go(page, 'content');
ck('reverting brings back the board from before the scan', (await statuses()).filter((c) => c === 'status-completed').length === 0);
await go(page, 'overview');
ck('the revert is logged', /Reverted the dashboard to version 1/.test(await page.locator('#activity').innerText()));
ck('and listed in Scan history, where it can be reverted too', /Revert/.test(await page.locator('#scans-list .scan-meta').first().innerText())
  && (await page.locator('#scans-list .scan-revert').first().innerText()).includes('Revert to before this revert'));
page.once('dialog', (d) => d.accept());
await page.locator('#scans-list .scan-revert').first().click();
await page.locator('#switcher-meta').filter({ hasText: `${vNow + 2} versions` }).waitFor({ timeout: 10000 });
await page.waitForTimeout(600);
await go(page, 'content');
ck('reverting the revert puts the scanned board back', (await statuses()).every((c) => c === 'status-completed'));

ck('no JS errors', errors.length === 0);
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
