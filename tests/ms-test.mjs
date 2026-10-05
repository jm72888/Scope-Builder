// Schedule as major milestones: the graphic first, then an editor for it.
import { open, runToBoard, go, report } from './lib.mjs';
const { browser, page, errors } = await open({ viewport: { width: 1500, height: 1100 }, reducedMotion: 'reduce' });
const checks = []; const ck = (n, v) => checks.push([n, v]);
// Local dates, as the app reads them.
const day = (n) => { const t = new Date(Date.now() + n * 86400000); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
const stops = () => page.locator('#timeline .tl-who').allInnerTexts();

await runToBoard(page);
await go(page, 'schedule');
await page.waitForTimeout(600);

const heads = await page.locator('.page[data-page="schedule"] .card.result:not([hidden]) h2').allInnerTexts();
ck('Milestones comes first, then the editor', heads[0] === 'Milestones' && heads[1] === 'Edit milestones');
ck('no open items on Schedule', (await page.locator('#sec-items-schedule').count()) === 0);
ck('the graphic shows the five milestones, the last as the end shape', (await page.locator('#timeline .tl-step').count()) === 4
  && (await page.locator('#timeline .tl-launch .tl-final-who').innerText()).trim() === 'Dashboard live for quarter close');
ck('the final milestone is in the list, last, editable, and cannot be deleted', await (async () => {
  await page.locator('#ms-included-toggle').click();
  await page.waitForTimeout(150);
  const last = page.locator('#ms-included-list .ms-row').last();
  const ok = (await last.getAttribute('class')).includes('is-final') && (await last.locator('.ms-title').inputValue()) === 'Dashboard live for quarter close'
    && (await last.locator('.item-del').count()) === 0;
  await page.locator('#ms-included-toggle').click();
  await page.waitForTimeout(150);
  return ok;
})());
ck('stalks are centred on their dots', await page.locator('#timeline .tl-step').first().evaluate((s) => {
  const node = s.querySelector('.tl-node').getBoundingClientRect();
  const stalk = getComputedStyle(s.querySelector('.tl-card'), '::after');
  const card = s.querySelector('.tl-card').getBoundingClientRect();
  const x = card.left + parseFloat(stalk.left) + parseFloat(stalk.marginLeft) + parseFloat(stalk.width) / 2;
  return Math.abs(x - (node.left + node.width / 2)) < 1.5 && parseFloat(stalk.width) >= 2;
}));
ck('each stop has a date', (await page.locator('#timeline .tl-when').allInnerTexts()).every((t) => /^[A-Z][a-z]{2} \d{1,2}$/i.test(t.trim())));
ck('the line still ends on Launch', (await page.locator('#timeline .tl-launch').count()) === 1);
ck('today is marked on the line', /Today · [A-Z][a-z]{2} \d{1,2}/.test(await page.locator('#timeline .tl-today').innerText()));
ck('today sits before the first upcoming milestone', await page.evaluate(() => {
  const kids = [...document.querySelectorAll('#timeline > li')];
  return kids[0].classList.contains('tl-today');   // every fixture milestone is still ahead
}));
ck('milestones sit well away from the line', await page.locator('#timeline .tl-step').first().locator('.tl-card')
  .evaluate((e) => parseFloat(getComputedStyle(e, '::after').height) >= 80));

// --- the editor ---
const startStops = await stops();
ck('Included starts collapsed', !(await page.locator('#ms-included-list').isVisible()));
ck('and says how many are in the graphic', /Included \(5\)/.test(await page.locator('#ms-included-label').innerText()));
await page.locator('#ms-included-toggle').click();
await page.waitForTimeout(150);
ck('it opens to show them, editable', (await page.locator('#ms-included-list .ms-row').count()) === 5 && await page.locator('#ms-included-list .ms-title').first().isVisible());

// Move the second milestone's date, rename the last, delete the third, add a new one.
await page.locator('#ms-included-list .ms-row').nth(1).locator('.ms-date').fill(day(40));
await page.locator('#ms-included-list .ms-row').nth(4).locator('.ms-title').fill('Dashboard live for Q4 close');
await page.waitForTimeout(1000);
await page.locator('#ms-included-list .ms-row').nth(2).locator('.item-del').click();
await page.waitForTimeout(150);
await page.locator('#add-milestone').click();
await page.waitForTimeout(150);
const fresh = page.locator('#ms-new-list .ms-row').last();
await fresh.locator('.ms-title').fill('Finance sign-off on reconciliation');
await page.waitForTimeout(1000);
await fresh.locator('.ms-date').fill(day(10));
await page.waitForTimeout(150);
ck('new milestones get their own rows with a name and a date', (await page.locator('#ms-new-list .ms-row').count()) === 1
  && (await fresh.locator('.ms-date').getAttribute('type')) === 'date');
ck('no per-row Add to timeline buttons, no "New milestones" label', (await page.locator('.ms-add-tl').count()) === 0
  && !/New milestones/.test(await page.locator('#sec-ms-edit').innerText()));
ck('the graphic waits for the save button', JSON.stringify(await stops()) === JSON.stringify(startStops));
const msSave = page.locator('#ms-save');
// The heave only runs with motion on; the rest of the test runs with it off so
// the button holds still to be clicked.
await page.emulateMedia({ reducedMotion: 'no-preference' });
ck('Save and update timeline sits by the title, lit and heaving', await msSave.isEnabled()
  && (await msSave.evaluate((e) => getComputedStyle(e).animationName)) === 'save-heave'
  && (await msSave.innerText()).trim() === 'Save and update timeline');
await page.emulateMedia({ reducedMotion: 'reduce' });

// --- Save and update timeline: applies it, with no API call ---
let apiCalls = 0;
await page.route('**/api/plan', async (r) => { apiCalls++; await r.continue(); });
await msSave.click();
await page.waitForTimeout(600);
const applied = await stops();
ck('the graphic now shows the new list in date order, ending on the final one', applied.length === 5 && applied[1] === 'Finance sign-off on reconciliation'
  && applied[3] === 'Data pipeline backfill complete' && applied[4] === 'Dashboard live for Q4 close');
ck('applying the timeline does not call Claude', apiCalls === 0);
ck('the button goes quiet with nothing left to save', !(await msSave.isEnabled()) && !(await msSave.evaluate((e) => e.classList.contains('can-save'))));
ck('the changes are logged', /Milestone added: Finance sign-off on reconciliation/.test(await page.locator('#activity').textContent()));
await page.reload();
await page.waitForTimeout(1800);
await go(page, 'schedule');
await page.waitForTimeout(500);
ck('the applied timeline survives a refresh', JSON.stringify(await stops()) === JSON.stringify(applied));
await page.unroute('**/api/plan');

// --- the next scan sends the applied milestones to Claude ---
let sent = null;
await page.route('**/api/plan', async (r) => { sent = r.request().postDataJSON(); await r.continue(); });
await go(page, 'overview');
await page.locator('#add-notes').fill('Training moved a week.');
await page.locator('#scan').click();
await page.locator('#switcher-meta').filter({ hasText: '2 versions' }).waitFor({ timeout: 30000 });
const ms = (sent && sent.milestones) || [];
ck('the applied list goes to Claude at the next scan', ms.length === 5 && ms.some((m) => m.title === 'Finance sign-off on reconciliation' && m.date === day(10)));
await go(page, 'schedule');
await page.waitForTimeout(600);
const after = await stops();
ck('after the scan, the graphic still shows it', JSON.stringify(after) === JSON.stringify(applied));

await go(page, 'overview');
ck('the Overview shows the next three by date', (await page.locator('#milestones .ms-who').allInnerTexts()).join('|')
  === after.slice(0, 3).join('|'));

// --- undo still works after Save and update timeline ---
await go(page, 'schedule');
await page.waitForTimeout(300);
const n0 = (await stops()).length;
await page.locator('#add-milestone').click();
await page.keyboard.type('Undo me after saving');
await page.locator('#ms-new-list .ms-row').last().locator('.ms-date').fill(day(12));
await page.waitForTimeout(1000);
await page.locator('#ms-save').click();
await page.waitForTimeout(500);
ck('the saved milestone is in the graphic', (await stops()).length === n0 + 1);
const undoMs = page.locator('.undo-btn[data-undo="milestones"]');
ck('Undo is still available after saving the timeline', await undoMs.isEnabled());
await undoMs.click();
await undoMs.click();
await undoMs.click();
await page.waitForTimeout(200);
ck('undoing after a save brings the old list back, ready to save', !(await page.locator('.ms-title').evaluateAll((e) => e.some((x) => x.value === 'Undo me after saving')))
  && await page.locator('#ms-save').isEnabled());
await page.locator('#ms-save').click();
await page.waitForTimeout(500);
ck('saving that takes the milestone back out of the graphic', (await stops()).length === n0);
ck('there are no Revert buttons', (await page.locator('.revert-btn').count()) === 0);

ck('no JS errors', errors.length === 0);
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
