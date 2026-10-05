// Live scoring: the area scores are worked out in the app from the tiles,
// date risk included, and move as soon as a tile changes.
import { open, runToBoard, go, report } from './lib.mjs';
const { browser, page, errors } = await open({ viewport: { width: 1500, height: 1000 } });
const checks = []; const ck = (n, v) => checks.push([n, v]);
// Local dates, as the app reads them.
const day = (n) => { const t = new Date(Date.now() + n * 86400000); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
// The number itself, not any +/- float sitting beside it.
const valueOf = (k) => page.locator(`.health-side .var-${k} .var-value`).evaluate((e) => Number(e.firstChild.textContent.replace(/\D/g, '')));

// First the fixture as it comes: nothing near its date.
await runToBoard(page);
ck('no date risk when nothing is close', !/Date risk/.test((await page.locator('.health-side .var-content').getAttribute('title')) || ''));
ck('the fixture scores 49 live', (await page.locator('#score-big').innerText()).trim() === '49');
ck('how-this-is-scored explains the date rule', /Dates count too/.test(await page.locator('#why-pop').textContent()));
ck('hovering a score shows what makes it up', /Progress \d+% · Owners \d+% · Dates \d+%/.test(await page.locator('.health-side .var-content').getAttribute('title')));

// Now tiles at different distances from their dates, none with an owner.
await page.route('**/api/plan', async (route) => {
  const res = await route.fetch();
  const plan = await res.json();
  plan.deliverables = [
    { title: 'Three days out, not started', kind: 'feature', status: 'not_started', target: day(3), owner: null },   // risk 7
    { title: 'Ten days out, blocked', kind: 'feature', status: 'blocked', target: day(10), owner: null },            // risk 4
    { title: 'Overdue, in progress', kind: 'feature', status: 'in_progress', target: day(-2), owner: null },         // risk 12
    { title: 'Overdue but completed', kind: 'feature', status: 'completed', target: day(-5), owner: null },          // 0
    { title: 'Far off, not started', kind: 'feature', status: 'not_started', target: day(30), owner: null },        // 0
    { title: 'In progress, date close', kind: 'feature', status: 'in_progress', target: day(2), owner: null },     // 0
  ];
  plan.communications = [
    { title: 'Overdue briefing', kind: 'presentation', status: 'not_started', target: day(-1), owner: null },      // 12
    { title: 'Overdue email', kind: 'email', status: 'blocked', target: day(-4), owner: null },                   // 12
    { title: 'Overdue demo', kind: 'demo', status: 'not_started', target: day(-3), owner: null },                 // 12 -> capped at 30
  ];
  await route.fulfill({ response: res, json: plan });
});
await page.locator('#reset-all').click();
await page.waitForTimeout(300);
await runToBoard(page);
await page.waitForTimeout(600);

// Development: progress (0.1 + 0 + 0.5 + 1 + 0.1 + 1) / 6 = 0.45 -> 22.5 (on-time
// In progress counts fully, overdue In progress half), owners 0, dates 25:
// 47.5, less 7 + 4 + 12 = 23, leaves 24.5 -> 25.
ck('Development scores 25 live, after 23 points of date risk', (await valueOf('content')) === 25);
ck('nothing sits under the scores', (await page.locator('.var-risk').count()) === 0);
const tip = await page.locator('.health-side .var-content').getAttribute('title');
ck('hovering the score says how much date risk took off', /Date risk −23:/.test(tip));
ck('hovering the risk lists each item and its cost', /Three days out, not started: not started, 3 days to go \(−7\)/.test(tip)
  && /Overdue, in progress: 2 days past its target \(−12\)/.test(tip) && !/completed/i.test(tip) && !/Far off/.test(tip));
// Communication: progress 0.067 -> 3.3, owners 0, dates 25: 28.3, less 36 capped at 30.
ck('the date cost per area is capped at 30', /Date risk −30:/.test(await page.locator('.health-side .var-communication').getAttribute('title')));
ck('a score never goes below zero', (await valueOf('communication')) === 0);
// Metrics: progress (1 + 5 x 0.1) / 6 -> 12.5, owners 3/6 -> 12.5, targets 4/6 -> 16.7: 41.7 -> 42.
ck('Metrics comes from its own table, and Timeline is not scored', (await valueOf('metrics')) === 42 && (await page.locator('.health-side .var-schedule').count()) === 0);
// Overall: (2 x 0.25 + 1.5 x 0 + 1 x 0.42) / 4.5 = 0.204 -> 20
ck('the overall score adds them up', (await page.locator('#score-big').innerText()).trim() === '20');

// --- live: a change on a tile moves the score at once, with no save ---
let calls = 0;
await page.route('**/api/plan', async (r) => { calls++; await r.continue(); });
await go(page, 'content');
await page.waitForTimeout(400);
// The completed, overdue tile goes back to Not started: progress falls and it
// becomes 12 points of risk (capped at 30 in all): 15 + 25 - 30 = 10.
await page.locator('#dlv-grid .dlv', { hasText: 'Overdue but completed' }).locator('.dlv-status').click();
await page.waitForTimeout(250);
ck('changing a tile moves the score straight away', (await valueOf('content')) === 10);
ck('and the overall score with it', (await page.locator('#score-big').innerText()).trim() === '14');
await page.locator('.undo-btn[data-undo="deliverables"]').click();
await page.waitForTimeout(250);
ck('undoing moves it back', (await valueOf('content')) === 25);
ck('none of this called Claude', calls === 0);

// Moving an on-time In progress tile to Completed leaves the score where it is.
const before = await valueOf('content');
await page.locator('#dlv-grid .dlv', { hasText: 'In progress, date close' }).locator('.dlv-status').click();
await page.waitForTimeout(250);
ck('completing an on-time In progress item does not change the score', (await page.locator('#dlv-grid .dlv', { hasText: 'In progress, date close' }).getAttribute('class')).includes('status-completed')
  && (await valueOf('content')) === before);

ck('no JS errors', errors.length === 0);
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
