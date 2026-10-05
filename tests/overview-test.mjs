// The Overview: project summary, next milestones, recent changes.
import { open, runToBoard, go, report } from './lib.mjs';
const { browser, page, errors } = await open({ viewport: { width: 1500, height: 1000 } });
const checks = []; const ck = (n, v) => checks.push([n, v]);

await runToBoard(page);
ck('lands on overview', (await page.evaluate(() => document.body.dataset.page)) === 'overview');
ck('exactly the four sections, in order',
  (await page.locator('.page[data-page="overview"] .card.result:not([hidden]) h2').allInnerTexts()).join('|') ===
  'Project summary|Top risks|Next milestones|Recent changes');
ck('view source notes is on the left, collapsed', await page.locator('.ov-left #toggle-notes').isVisible()
  && !(await page.locator('#notes-echo').isVisible()));
ck('and opens read only', await (async () => {
  await page.locator('#toggle-notes').click();
  await page.waitForTimeout(150);
  const ok = await page.locator('#notes-echo').isVisible() && (await page.locator('.ov-left #input-panel textarea:visible').count()) === 0;
  await page.locator('#toggle-notes').click();
  return ok;
})());
const pos = async (id) => page.locator(id).boundingBox();
const [sum, rsk, nms, chg, add] = [await pos('#sec-overview'), await pos('#sec-risks'), await pos('#sec-milestones'), await pos('#sec-activity'), await pos('#add-card')];
ck('the right column runs risks, next milestones, recent changes', rsk.x > sum.x + sum.width - 1 && Math.abs(rsk.x - nms.x) < 2
  && Math.abs(nms.x - chg.x) < 2 && rsk.y < nms.y && nms.y < chg.y);
ck('add more context is on the left, under the summary', Math.abs(add.x - sum.x) < 2 && add.y > sum.y);
ck('top risks are listed on the overview', (await page.locator('#risks').innerText()).length > 40);
ck('no tasks list on the overview', (await page.locator('#tasks, #sec-tasks').count()) === 0);

// --- summary ---
const brief = (await page.locator('#summary').innerText()).trim();
const sentences = brief.split(/(?<=[.!?])\s+/).filter(Boolean).length;
ck('summary is 2 to 4 sentences', sentences >= 2 && sentences <= 4);

// --- milestones ---
ck('the next three milestones', (await page.locator('.ms').count()) === 3);
ck('each reads title, then date, then days to go', await page.locator('.ms').first().evaluate((li) => {
  const kids = [...li.children].map((c) => c.className);
  return kids.join(',') === 'ms-who,ms-when,ms-what' && /^In \d+ days?$|^Today$/.test(li.querySelector('.ms-what').textContent.trim());
}));
ck('the dots carry no numbers and sit on a line', await page.locator('.ms').first().evaluate((li) =>
  getComputedStyle(li, '::before').content === '""' && getComputedStyle(li, '::after').width === '2px'));
const firstMs = (await page.locator('.ms-who').first().innerText()).trim();
await go(page, 'schedule');
const firstStop = (await page.locator('.tl-who').first().innerText()).trim();
ck('they are the first three stops on the timeline', firstMs === firstStop);
await go(page, 'overview');
await page.locator('#to-timeline').click();
await page.waitForTimeout(300);
ck('full timeline link goes to Schedule', (await page.evaluate(() => document.body.dataset.page)) === 'schedule');
await go(page, 'overview');

// --- recent changes ---
ck('the first run is logged', /Evaluated: \d+%/.test(await page.locator('#activity .act').first().innerText()));
await page.reload();
await page.waitForTimeout(1800);
ck('the history survives a refresh', (await page.locator('#activity .act').count()) >= 1);

// --- sharp edges throughout; only true points stay round ---
ck('cards, buttons, fields and badges are square-cornered', await page.evaluate(() =>
  ['.card', '.health-row', '#add-notes', '#scan', '.undo-btn', '#health-badge', '.switcher-btn', '.nav-item', '.why-btn']
    .map((s) => document.querySelector(s)).filter(Boolean)
    .every((e) => getComputedStyle(e).borderTopLeftRadius === '0px' && getComputedStyle(e).borderBottomRightRadius === '0px')));
ck('milestone dots stay round', await page.locator('.ms').first().evaluate((e) => getComputedStyle(e, '::before').borderTopLeftRadius === '50%'));

// --- the name at the top left goes back to the start page ---
await page.locator('#brand-home').click();
await page.waitForTimeout(600);
ck('Scope builder at the top left goes to the start page', (await page.locator('body').getAttribute('class')).includes('state-prompt'));
ck('with the project still there to pick up', await page.locator('#resume-list .resume-row').first().isVisible());

ck('no JS errors', errors.length === 0);
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
