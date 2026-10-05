// The worked example on the landing page: a fresh, dated-to-today copy of a
// saved project for each visitor, opened with no call to Claude.
import fs from 'fs';
import { open, go, report } from './lib.mjs';
const { browser, page, errors } = await open({ viewport: { width: 1728, height: 1100 } });
const checks = []; const ck = (n, v) => checks.push([n, v]);
const EX = new URL('../example/billing-dashboard-migration.json', import.meta.url);
const before = fs.readFileSync(EX, 'utf8');
const ex = JSON.parse(before);

let planCalls = 0;
await page.route('**/api/plan', async (r) => { planCalls++; await r.continue(); });
await page.route('**/api/questions', async (r) => { planCalls++; await r.continue(); });

ck('the landing page offers the example', await page.locator('#open-example').isVisible()
  && /Open the example/.test(await page.locator('#open-example').innerText()));
await page.locator('#open-example').click();
await page.locator('body.state-board').waitFor({ timeout: 10000 });
await page.waitForTimeout(1200);
ck('it opens straight onto the dashboard', (await page.locator('body').getAttribute('class')).includes('state-board'));
ck('named as the example', /\(example\)$/.test((await page.locator('#switcher-name').innerText()).trim()));
ck('with both versions', /2 versions/.test(await page.locator('#switcher-meta').innerText()));
ck('the example card is gone from the board', !(await page.locator('#example-card').isVisible()));
const v = ex.project.versions[ex.project.versions.length - 1];
await go(page, 'content');
ck('every Development row is there', (await page.locator('#dlv-grid .dlv').count()) === v.deliverables.length);
await go(page, 'communication');
ck('every Communication row is there', (await page.locator('#comm-grid .dlv').count()) === v.communications.length);
ck('owners come with it', (await page.locator('#comm-grid .dlv-owner-name').allInnerTexts()).some((t) => t.trim() === 'VP of Finance'));
await go(page, 'metrics');
ck('every Metrics row is there', (await page.locator('#measure-grid .dlv').count()) === v.measures.length);
await go(page, 'schedule');
ck('and the timeline', (await page.locator('.tl-step, .tl-launch').count()) === v.milestones.length);
ck('opening it called Claude not once', planCalls === 0);

// --- edits stay in the copy ---
await go(page, 'content');
await page.locator('#dlv-grid .dlv').first().locator('.dlv-title').fill('Changed in my copy');
await page.waitForTimeout(1400);
ck('the saved example is untouched by edits', fs.readFileSync(EX, 'utf8') === before);
const firstId = await page.evaluate(() => project.id);
await page.locator('#brand-home').click();
await page.waitForTimeout(600);
await page.locator('#open-example').click();
await page.locator('body.state-board').waitFor({ timeout: 10000 });
await page.waitForTimeout(1200);
ck('a second visit is a second, fresh copy', (await page.evaluate(() => project.id)) !== firstId);
await go(page, 'content');
ck('without the first copy\'s edits', (await page.locator('#dlv-grid .dlv .dlv-title').first().inputValue()) === v.deliverables[0].title);

ck('no JS errors', errors.length === 0);
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
