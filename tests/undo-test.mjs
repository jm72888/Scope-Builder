// Every editable tile has its own undo, at least ten steps deep.
import { open, runToBoard, go, report } from './lib.mjs';
const { browser, page, errors } = await open({ viewport: { width: 1500, height: 1000 } });
const checks = []; const ck = (n, v) => checks.push([n, v]);
const undoBtn = (key) => page.locator(`.undo-btn[data-undo="${key}"]`);
const tasks = (key) => page.locator(`#items-${key} .item-task`).evaluateAll((e) => e.map((x) => x.value));

await page.evaluate(() => localStorage.removeItem('scope-builder:people'));
await page.reload();
await page.waitForTimeout(600);
await runToBoard(page);

for (const key of ['deliverables', 'comms', 'measures', 'milestones', 'add-notes']) {
  ck(`${key} has an undo button`, (await undoBtn(key).count()) === 1);
}
ck('undo starts disabled', !(await undoBtn('measures').isEnabled()));

// --- the Metrics table: twelve edits, all undone in order ---
const rowsM = page.locator('#measure-grid .dlv');
const titlesM = () => page.locator('#measure-grid .dlv-title').evaluateAll((e) => e.map((x) => x.value));
await go(page, 'metrics');
await page.waitForTimeout(300);
const start = await titlesM();
for (let i = 1; i <= 12; i++) {
  await page.locator('#measure-add').click();
  await page.waitForTimeout(60);
}
ck('twelve rows added', (await titlesM()).length === start.length + 12);
for (let i = 0; i < 12; i++) { await undoBtn('measures').click(); await page.waitForTimeout(40); }
ck('ten-plus steps back restores the list', JSON.stringify(await titlesM()) === JSON.stringify(start));
ck('undo is disabled when there is nothing left', !(await undoBtn('measures').isEnabled()));

// A burst of typing is one step; delete and phase changes are steps too.
await rowsM.first().locator('.dlv-title').fill('');
await rowsM.first().locator('.dlv-title').type('Typed in one go', { delay: 10 });
await page.waitForTimeout(1100);
await rowsM.nth(1).hover();
await rowsM.nth(1).locator('.dlv-del').click();
await page.waitForTimeout(100);
await rowsM.first().locator('.dlv-phase-btn').click();
await page.waitForTimeout(200);
await page.locator('.picker .picker-opt', { hasText: 'Outcome' }).click();
await page.waitForTimeout(150);
await undoBtn('measures').click(); await page.waitForTimeout(80);
ck('undo puts Type (A) back', (await rowsM.first().locator('.dlv-phase-btn').innerText()).trim() === 'Tracking');
await undoBtn('measures').click(); await page.waitForTimeout(80);
ck('undo brings a deleted row back', (await titlesM()).length === start.length);
await undoBtn('measures').click(); await page.waitForTimeout(80);
ck('one undo reverses a whole burst of typing', (await titlesM())[0] === start[0]);

// Each tile has its own history.
await go(page, 'schedule');
await page.locator('#add-milestone').click();
await page.waitForTimeout(100);
ck('another area keeps its own history', await undoBtn('milestones').isEnabled() && !(await undoBtn('measures').isEnabled()));
await undoBtn('milestones').click();

// --- add more context ---
await go(page, 'overview');   // Add more context lives on the Overview
await page.locator('#add-notes').type('First thought', { delay: 5 });
await page.waitForTimeout(1100);
await page.locator('#add-notes').type('. Second thought', { delay: 5 });
await page.waitForTimeout(1100);
await undoBtn('add-notes').click(); await page.waitForTimeout(80);
ck('undo steps the context box back one burst', (await page.locator('#add-notes').inputValue()) === 'First thought');
await undoBtn('add-notes').click(); await page.waitForTimeout(80);
ck('and back to empty', (await page.locator('#add-notes').inputValue()) === '');

// --- no Revert buttons; Undo reaches back past the autosave ---
ck('there are no Revert to last save buttons', (await page.locator('.revert-btn').count()) === 0);
await go(page, 'content');
await page.waitForTimeout(300);
const dlvTitles = () => page.locator('#dlv-grid .dlv-title').evaluateAll((e) => e.map((x) => x.value));
const savedDlv = await dlvTitles();
await page.locator('#dlv-grid .dlv').nth(1).locator('.dlv-del').click();
await page.waitForTimeout(1400);   // long enough for the autosave
ck('the delete saved itself', (await dlvTitles()).length === savedDlv.length - 1);
await undoBtn('deliverables').click();
await page.waitForTimeout(1400);
ck('undo brings it back after it was saved', JSON.stringify(await dlvTitles()) === JSON.stringify(savedDlv));
await page.reload();
await page.waitForTimeout(1800);
await go(page, 'content');
await page.waitForTimeout(300);
ck('and the undo is saved too', JSON.stringify(await dlvTitles()) === JSON.stringify(savedDlv));

ck('no JS errors', errors.length === 0);
await page.evaluate(() => localStorage.removeItem('scope-builder:people'));
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
