// Development: deliverable tiles with a kind tag, an owner and a status ring.
import { open, runToBoard, go, report } from './lib.mjs';
const { browser, page, errors } = await open({ viewport: { width: 1728, height: 1100 } });
const checks = []; const ck = (n, v) => checks.push([n, v]);
const tiles = page.locator('#dlv-grid .dlv');
const statusOf = (i) => tiles.nth(i).evaluate((e) => [...e.classList].find((c) => c.startsWith('status-')));
const acts = () => page.locator('#activity .act').count();
// Scan context from the Overview, the one action that calls Claude after the first build.
const scan = async (text, versions) => {
  await go(page, 'overview');
  await page.locator('#add-notes').fill(text);
  await page.waitForTimeout(150);
  await page.locator('#scan').click();
  await page.locator('#switcher-meta').filter({ hasText: `${versions} versions` }).waitFor({ timeout: 30000 });
};

await runToBoard(page);
await go(page, 'content');
await page.waitForTimeout(600);
// Scroll a control into view and let the scroll settle before clicking it:
// a scroll event arriving after the click would close the picker it opened.
const reach = async (loc) => { await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(200); return loc; };

ck('Development opens with what is being built', (await page.locator('#sec-deliverables h2').innerText()).includes('being built'));
ck('Claude\'s seven deliverables are tiles', (await tiles.count()) === 7);
const b0 = await tiles.nth(0).boundingBox(), b1 = await tiles.nth(1).boundingBox(), b2 = await tiles.nth(2).boundingBox(), b3 = await tiles.nth(3).boundingBox();
const b4 = await tiles.nth(4).boundingBox(), b5 = await tiles.nth(5).boundingBox();
const gridBox = await page.locator('#dlv-grid').boundingBox();
ck('one row per item, stacked down the card', [b0, b1, b2, b3, b4, b5].every((b, i, a) => i === 0 || (Math.abs(b.x - a[i - 1].x) < 1 && b.y >= a[i - 1].y + a[i - 1].height - 1)));
ck('each row spans the card', Math.abs(b4.width - gridBox.width) < 2);
ck('rows, not cards: wide and short, square edges', b0.width > b0.height * 5 && (await tiles.nth(0).evaluate((e) => getComputedStyle(e).borderRadius)) === '0px');
ck('a header labels the columns', (await page.locator('#dlv-grid .dlv-head').innerText()).replace(/\s+/g, ' ').trim().toUpperCase() === 'STATUS DELIVERABLE TYPE OWNER TARGET');
ck('the cells line up under their labels', await page.evaluate(() => {
  const head = [...document.querySelectorAll('#dlv-grid .dlv-head span')].map((x) => Math.round(x.getBoundingClientRect().left));
  return [...document.querySelectorAll('#dlv-grid .dlv')].every((r) => [...r.querySelectorAll('.dlv-c')].every((c, i) => Math.abs(Math.round(c.getBoundingClientRect().left) - head[i]) <= 1));
}));
ck('only the status chip carries color; the row stays white', (await tiles.nth(0).evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(255, 255, 255)');
ck('each tile has a separate notes box', (await page.locator('#dlv-grid .dlv .dlv-notes').count()) === 7
  && (await tiles.nth(0).locator('.dlv-notes').inputValue()) === 'Eng estimate is 6 to 8 weeks');
ck('each tile is tagged with its kind', (await page.locator('#dlv-grid .dlv .dlv-kind-btn').evaluateAll((e) => e.map((x) => x.dataset.value)))
  .join(',') === 'feature,feature,integration,document,training,content,data');
ck('statuses come from the notes', (await statusOf(0)) === 'status-in_progress' && (await statusOf(1)) === 'status-not_started');
ck('the header counts progress', /0 of 7 completed, 2 in progress/.test(await page.locator('#dlv-count').innerText()));
ck('an unowned tile is flagged', (await page.locator('#dlv-grid .dlv.is-unowned').count()) === 2);

// --- the ring: each click moves to the next state, then round again ---
ck('there is no dropdown list of states', (await page.locator('#dlv-grid .stage-menu, #dlv-grid .dlv-stage-btn').count()) === 0);
await tiles.nth(1).locator('.dlv-status').click();
await page.waitForTimeout(150);
ck('Not started is followed by Blocked', (await statusOf(1)) === 'status-blocked');
ck('the ring pops as it moves', (await tiles.nth(1).getAttribute('class')).includes('is-stepped'));
ck('there is no save button to wait for', (await page.locator('#update, #pending').count()) === 0);
await tiles.nth(1).locator('.dlv-status').click();
await page.waitForTimeout(100);
ck('Blocked is followed by In progress', (await statusOf(1)) === 'status-in_progress');
await tiles.nth(2).locator('.dlv-status').click();
await page.waitForTimeout(100);
ck('In progress is followed by Completed', (await statusOf(2)) === 'status-completed');
ck('completing sets off the confetti', (await tiles.nth(2).getAttribute('class')).includes('is-celebrating'));
await tiles.nth(5).locator('.dlv-status').click();
await tiles.nth(5).locator('.dlv-status').click();
await tiles.nth(5).locator('.dlv-status').click();
await tiles.nth(5).locator('.dlv-status').click();
await page.waitForTimeout(100);
ck('after Completed it starts again at Not started', (await statusOf(5)) === 'status-not_started');
await tiles.nth(3).locator('.dlv-notes').fill('Draft due in week 2');
await page.waitForTimeout(1000);

// --- tag, owner, title, add, delete ---
const pick = async (tile, btn, label) => {
  await (await reach(tile.locator(btn))).click();
  await page.waitForTimeout(250);
  await page.locator('.picker .picker-opt', { hasText: label }).click();
  await page.waitForTimeout(150);
};
ck('notes sit under the title, the type in its own column to the right', await tiles.nth(6).evaluate((t) => {
  const r = (s) => t.querySelector(s).getBoundingClientRect();
  return r('.dlv-notes').top > r('.dlv-title').top && r('.dlv-kind-btn').left > r('.dlv-title').right;
}));
await (await reach(tiles.nth(6).locator('.dlv-kind-btn'))).click();
await page.waitForTimeout(250);
ck('the type opens a picker, not a browser dropdown', await page.locator('.picker').isVisible()
  && (await page.locator('#dlv-grid select').count()) === 0);
ck('the picker marks the current type', (await page.locator('.picker .picker-opt.is-current').innerText()).trim() === 'Data');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
ck('Escape closes it', (await page.locator('.picker').count()) === 0);
await pick(tiles.nth(6), '.dlv-kind-btn', 'Document');
await pick(tiles.nth(6), '.dlv-owner-btn', 'Support lead');
ck('the owner shows as initials and a name', (await tiles.nth(6).locator('.dlv-owner-btn').innerText()).replace(/\s+/g, ' ').trim() === 'SL Support lead');
await tiles.nth(0).locator('.dlv-title').fill('Dashboard rebuilt on the new revenue model');
await page.waitForTimeout(1000);
await page.locator('#dlv-add').click();
await page.waitForTimeout(150);
ck('the add slot makes a new tile, ready to type', (await tiles.count()) === 8
  && await page.evaluate(() => document.activeElement.classList.contains('dlv-title')));
await tiles.nth(7).locator('.dlv-title').fill('Training slideshow for Finance');
await page.waitForTimeout(1000);
await tiles.nth(4).locator('.dlv-del').click();
await page.waitForTimeout(150);
ck('a tile can be deleted', (await tiles.count()) === 7);

// --- undo walks it back ---
await page.locator('.undo-btn[data-undo="deliverables"]').click();
await page.waitForTimeout(150);
ck('undo brings the deleted tile back', (await tiles.count()) === 8);

// --- every edit saves itself; nothing calls Claude ---
let calls = 0;
await page.route('**/api/plan', async (r) => { calls++; await r.continue(); });
await page.waitForTimeout(1300);
ck('the edits saved without calling Claude', calls === 0);
await go(page, 'overview');
ck('and went into Recent changes as they were saved', /Billing to revenue model data pipeline: Completed/.test(await page.locator('#activity').innerText())
  && /Added: Training slideshow for Finance/i.test(await page.locator('#activity').innerText()));
await page.unroute('**/api/plan');

// --- a scan sends the whole current board with the new context ---
let sent = null;
await page.route('**/api/plan', async (r) => { sent = r.request().postDataJSON(); await r.continue(); });
await scan('The export guide is now owned by Finance ops.', 2);
await page.unroute('**/api/plan');
const dl = (sent && sent.deliverables) || [];
ck('the current tiles are sent to Claude', dl.length === 8);
ck('with their statuses', dl.some((d) => d.title === 'Billing to revenue model data pipeline' && d.status === 'completed'));
ck('with their notes', dl.some((d) => d.title === 'Export workaround guide for Finance' && d.notes === 'Draft due in week 2'));
ck('with owners by name and kinds', dl.some((d) => d.title === 'Weekly reconciliation check report' && d.owner === 'Support lead' && d.kind === 'document'));
ck('and the context that was typed', /The export guide is now owned by Finance ops\./.test(sent.notes));
await go(page, 'content');
await page.waitForTimeout(400);
ck('your statuses are kept after the review', (await statusOf(2)) === 'status-completed');
ck('the completed tile is logged', /Billing to revenue model data pipeline: Completed/.test(await page.locator('#activity').innerText()));

await page.reload();
await page.waitForTimeout(1800);
await go(page, 'content');
await page.waitForTimeout(400);
ck('tiles survive a refresh', (await tiles.count()) === 8 && (await statusOf(2)) === 'status-completed'
  && (await tiles.nth(3).locator('.dlv-notes').inputValue()) === 'Draft due in week 2');

// --- a date that is close shows its days left on the status row ---
await go(page, 'content');
await page.waitForTimeout(300);
const t5 = new Date(Date.now() + 5 * 86400000);
const soon = `${t5.getFullYear()}-${String(t5.getMonth() + 1).padStart(2, '0')}-${String(t5.getDate()).padStart(2, '0')}`;
await tiles.nth(4).locator('.dlv-target').evaluate((e, v) => { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, soon);
await page.waitForTimeout(200);
ck('status is the first column and the date sits in Target', await tiles.nth(4).evaluate((t) => {
  const cells = [...t.querySelectorAll('.dlv-c')];
  return !!cells[0].querySelector('.dlv-status') && !!cells[4].querySelector('.dlv-date-btn') && cells[4].classList.contains('dlv-bottom');
}));
ck('a close date is flagged on the date itself, with the days left on hover', await tiles.nth(4).evaluate((t) =>
  t.querySelector('.dlv-bottom').classList.contains('is-due') && t.querySelector('.dlv-date-btn').title === '5 days left'));

await page.locator('.undo-btn[data-undo="deliverables"]').click();
await page.waitForTimeout(150);

// --- sort by status: one click sorts, then the tiles stay put until the next click ---
const statuses = () => tiles.evaluateAll((e) => e.map((x) => [...x.classList].find((c) => c.startsWith('status-')).slice(7)));
const ids = () => tiles.evaluateAll((e) => e.map((x) => x.dataset.dlv));
const order = { blocked: 0, not_started: 1, in_progress: 2, completed: 3 };
const inOrder = (list) => list.every((s2, i) => i === 0 || order[list[i - 1]] <= order[s2]);
await page.waitForTimeout(1300);
const actsBefore = await acts();
const sortBtn = page.locator('.sort-btn[data-sort="deliverables"][data-by="status"]');
await sortBtn.click();
await page.waitForTimeout(80);
ck('tiles glide when sorted', await tiles.evaluateAll((e) => e.some((x) => /translate/.test(x.style.transform) || /transform/.test(x.style.transition))));
await page.waitForTimeout(900);
ck('one click puts Blocked first, then Not started, In progress, Completed', inOrder(await statuses()));
ck('the button does not stay pressed', (await sortBtn.getAttribute('aria-pressed')) === null
  && (await sortBtn.innerText()).trim() === 'Sort by status');
await page.waitForTimeout(1300);
ck('sorting is a view, not a change to save', (await acts()) === actsBefore);
const placed = await ids();
await tiles.nth(0).locator('.dlv-status').click();
await page.waitForTimeout(150);
await tiles.last().locator('.dlv-status').click();
await page.waitForTimeout(300);
ck('changing statuses afterwards leaves every tile where it is', JSON.stringify(await ids()) === JSON.stringify(placed));
ck('so the order is no longer by status', !inOrder(await statuses()));
await sortBtn.click();
await page.waitForTimeout(1000);
ck('clicking again sorts by the new statuses', inOrder(await statuses()));
const dates = () => tiles.evaluateAll((e) => e.map((x) => x.querySelector('.dlv-target').value));
await page.locator('.sort-btn[data-sort="deliverables"][data-by="date"]').click();
await page.waitForTimeout(1000);
const ds = await dates();
const dated = ds.filter(Boolean);
ck('sort by date puts the soonest target first and undated last',
  dated.every((d, i) => i === 0 || dated[i - 1] <= d)
  && (ds.indexOf('') === -1 || ds.slice(ds.indexOf('')).every((d) => d === '')));
ck('and leaves the button ready for another click', (await page.locator('.sort-btn[data-by="date"][data-sort="deliverables"]').getAttribute('aria-pressed')) === null);
// --- the same board on Communication, with its own types ---
await go(page, 'communication');
await page.waitForTimeout(500);
const ctiles = page.locator('#comm-grid .dlv');
ck('Communication has its own tiles', (await ctiles.count()) === 6
  && (await page.locator('#sec-comm-board h2').innerText()).includes('go out'));
await (await reach(ctiles.first().locator('.dlv-kind-btn'))).click();
await page.waitForTimeout(250);
const ckinds = (await page.locator('.picker .picker-label').allInnerTexts()).map((x) => x.trim());
await page.keyboard.press('Escape');
ck('with communication types, Sign-off included', ['Email campaign', 'Presentation', 'Feedback session', 'Sign-off'].every((k) => ckinds.includes(k))
  && !ckinds.includes('Integration'));
await (await reach(ctiles.nth(5).locator('.dlv-kind-btn'))).click();
await page.waitForTimeout(250);
await page.locator('.picker .picker-opt', { hasText: 'Sign-off' }).click();
await page.waitForTimeout(150);
await ctiles.nth(3).locator('.dlv-status').click();
await page.waitForTimeout(150);
ck('a communication moves on with one click', (await ctiles.nth(3).getAttribute('class')).includes('status-blocked'));
ck('the boards keep separate histories', await page.locator('.undo-btn[data-undo="comms"]').isEnabled()
  && !(await page.locator('.undo-btn[data-undo="milestones"]').isEnabled()));
let sent2 = null;
await page.route('**/api/plan', async (r) => { sent2 = r.request().postDataJSON(); await r.continue(); });
await scan('The FAQ moves to week 3.', 3);
ck('communications are sent to Claude', (sent2.communications || []).length === 6
  && sent2.communications.some((d) => d.kind === 'sign_off'));
ck('and the retag was logged when it saved', /tagged Sign-off/.test(await page.locator('#activity').innerText()));

// --- a narrow card: each row becomes two lines, the item across the top ---
await page.setViewportSize({ width: 1280, height: 1000 });
await go(page, 'content');
await page.waitForTimeout(400);
ck('on a narrow card the labels hide and the item takes the full first line', !(await page.locator('#dlv-grid .dlv-head').isVisible())
  && await tiles.nth(0).evaluate((t) => {
    const r = t.getBoundingClientRect(), item = t.querySelector('.dlv-c-item').getBoundingClientRect(), st = t.querySelector('.dlv-c-status').getBoundingClientRect();
    return item.width > r.width * 0.9 && st.top > item.bottom - 1;
  }));

ck('no JS errors', errors.length === 0);
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
