// Rows open to show their details: a chevron (or a click on empty space)
// expands a large text box that Claude fills and the person can edit.
import { open, runToBoard, go, report } from './lib.mjs';
const { browser, page, errors } = await open({ viewport: { width: 1728, height: 1100 } });
const checks = []; const ck = (n, v) => checks.push([n, v]);
const rows = page.locator('#dlv-grid .dlv');
const reach = async (loc) => { await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); return loc; };

await runToBoard(page);
await go(page, 'content');
await page.waitForTimeout(500);

ck('every row has a chevron', (await page.locator('#dlv-grid .dlv-expand').count()) === (await rows.count()));
ck('rows start closed', (await page.locator('#dlv-grid .dlv-more:visible').count()) === 0);
await (await reach(rows.first().locator('.dlv-expand'))).click();
await page.waitForTimeout(200);
ck('the chevron opens the row', await rows.first().locator('.dlv-more').isVisible()
  && (await rows.first().locator('.dlv-expand').getAttribute('aria-expanded')) === 'true');
const text = await rows.first().locator('.dlv-details').inputValue();
ck('the build wrote real context, many times the one-line subtext', text.split(/\s+/).length >= 60
  && text.length > 5 * (await rows.first().locator('.dlv-notes').inputValue()).length);
ck('the panel spans the whole row, under the cells', await rows.first().evaluate((r) => {
  const m = r.querySelector('.dlv-more').getBoundingClientRect(), t = r.querySelector('.dlv-c-item').getBoundingClientRect(), row = r.getBoundingClientRect();
  return m.top > t.bottom - 1 && m.width > row.width * 0.9;
}));
ck('the one-line subtext stays as the summary', await rows.first().locator('.dlv-notes').isVisible());
await rows.nth(1).locator('.dlv-c-type').click({ position: { x: 120, y: 10 } });
await page.waitForTimeout(200);
ck('a click on empty space in a row opens it too', await rows.nth(1).locator('.dlv-more').isVisible());
ck('several rows can be open at once', await rows.first().locator('.dlv-more').isVisible());
await rows.first().locator('.dlv-status').click();
await page.waitForTimeout(200);
ck('an open row stays open through a status change', await rows.first().locator('.dlv-more').isVisible());
await rows.first().locator('.dlv-title').click();
await page.waitForTimeout(150);
ck('clicking the title edits it rather than closing the row', await rows.first().locator('.dlv-more').isVisible()
  && await page.evaluate(() => document.activeElement.classList.contains('dlv-title')));
await rows.nth(1).locator('.dlv-expand').click();
await page.waitForTimeout(150);
ck('the chevron closes it again', !(await rows.nth(1).locator('.dlv-more').isVisible()));

// --- the person's own details are kept ---
const mine = 'Our own note: the finance team wants a dry run on the August numbers before anything else.';
await rows.first().locator('.dlv-details').fill(mine);
await page.waitForTimeout(1400);
ck('editing details is logged when it saves', /details updated/.test(await page.locator('#activity').innerText()));
await page.reload();
await page.waitForTimeout(1800);
await go(page, 'content');
await page.waitForTimeout(300);
await rows.first().locator('.dlv-expand').click();
await page.waitForTimeout(150);
ck('edited details survive a refresh', (await rows.first().locator('.dlv-details').inputValue()) === mine);
let sent = null;
await page.route('**/api/plan', async (r) => { sent = r.request().postDataJSON(); await r.continue(); });
await go(page, 'overview');
await page.locator('#add-notes').fill('The dry run is booked for the first week.');
await page.locator('#scan').click();
await page.locator('#switcher-meta').filter({ hasText: '2 versions' }).waitFor({ timeout: 30000 });
await page.unroute('**/api/plan');
ck('a scan sends details, marked when the person wrote them', (sent.deliverables || []).some((d) => d.details === mine && d.detailsEdited === true)
  && (sent.deliverables || []).some((d) => d.details && !d.detailsEdited));
await go(page, 'content');
await page.waitForTimeout(300);
await rows.first().locator('.dlv-expand').click();
await page.waitForTimeout(150);
ck('and the person\'s details come back word for word', (await rows.first().locator('.dlv-details').inputValue()) === mine);

// Even if Claude rewrites them, the person's details win.
await page.route('**/api/plan', async (route) => {
  const res = await route.fetch();
  const plan = await res.json();
  plan.deliverables = plan.deliverables.map((d) => ({ ...d, details: 'Rewritten by Claude.' }));
  await route.fulfill({ response: res, json: plan });
});
await go(page, 'overview');
await page.locator('#add-notes').fill('Nothing else changed.');
await page.locator('#scan').click();
await page.locator('#switcher-meta').filter({ hasText: '3 versions' }).waitFor({ timeout: 30000 });
await page.unroute('**/api/plan');
await go(page, 'content');
await page.waitForTimeout(300);
ck('a rewrite from Claude cannot replace details the person wrote', (await rows.first().locator('.dlv-details').inputValue()) === mine);
ck('while rows nobody edited take the new text', (await rows.nth(2).locator('.dlv-details').inputValue()) === 'Rewritten by Claude.');

// --- the same on Communication and Metrics ---
for (const [pg, grid] of [['communication', '#comm-grid'], ['metrics', '#measure-grid']]) {
  await go(page, pg);
  await page.waitForTimeout(300);
  const r = page.locator(`${grid} .dlv`).first();
  await (await reach(r.locator('.dlv-expand'))).click();
  await page.waitForTimeout(150);
  ck(`${pg} rows open to their details`, (await r.locator('.dlv-details').inputValue()).split(/\s+/).length >= 30);
}

ck('no JS errors', errors.length === 0);
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
