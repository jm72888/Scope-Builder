// Metrics: a ledger like Development and Communication, with Type (A),
// Tracking or Outcome, beside Type (B), subtext and a target date, and the
// same scoring (status, owners, dates, date risk). Edits save themselves.
import { open, runToBoard, go, report } from './lib.mjs';
const { browser, page, errors } = await open({ viewport: { width: 1728, height: 1100 } });
const checks = []; const ck = (n, v) => checks.push([n, v]);
const rows = page.locator('#measure-grid .dlv');
// The number itself, not any +/- float sitting beside it.
const valueOf = () => page.locator('.health-side .var-metrics .var-value').evaluate((e) => Number(e.firstChild.textContent.replace(/\D/g, '')));
const reach = async (loc) => { await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(200); return loc; };
const pick = async (btn, label) => {
  await (await reach(btn)).click();
  await page.waitForTimeout(250);
  await page.locator('.picker .picker-opt', { hasText: label }).click();
  await page.waitForTimeout(150);
};

await page.evaluate(() => localStorage.removeItem('scope-builder:people'));
await page.reload();
await page.waitForTimeout(600);
await runToBoard(page);
await go(page, 'metrics');
await page.waitForTimeout(400);

// --- the page is one table ---
ck('no open items and no old lists on the Metrics page', (await page.locator('#sec-items-metrics, #tracking, #success').count()) === 0);
ck('Claude\'s six metrics are rows', (await rows.count()) === 6);
ck('the columns are Status, Metric, Type (A), Type (B), Owner, Target',
  (await page.locator('#measure-grid .dlv-head').innerText()).replace(/\s+/g, ' ').trim().toUpperCase() === 'STATUS METRIC TYPE (A) TYPE (B) OWNER TARGET');
ck('Type (A) sits just left of Type (B)', await rows.first().evaluate((r) =>
  r.querySelector('.dlv-c-phase').nextElementSibling.classList.contains('dlv-c-type')));
ck('the cells line up under their labels', await page.evaluate(() => {
  const head = [...document.querySelectorAll('#measure-grid .dlv-head span')].map((x) => Math.round(x.getBoundingClientRect().left));
  return [...document.querySelectorAll('#measure-grid .dlv')].every((r) => [...r.querySelectorAll('.dlv-c')].every((c, i) => Math.abs(Math.round(c.getBoundingClientRect().left) - head[i]) <= 1));
}));
ck('rows are square-edged, with a subtext line like the other boards', (await rows.first().evaluate((e) => getComputedStyle(e).borderRadius)) === '0px'
  && (await page.locator('#measure-grid .dlv-notes').count()) === 6 && (await rows.nth(4).locator('.dlv-notes').inputValue()) === 'Under 10 a week');
ck('kinds come from Claude', (await page.locator('#measure-grid .dlv-kind-btn').evaluateAll((e) => e.map((x) => x.dataset.value))).join(',')
  === 'support,adoption,quality,adoption,support,speed');
ck('targets are dates, as on the other boards', (await page.locator('#measure-grid .dlv-date-btn').count()) === 6
  && (await page.locator('#measure-grid .dlv-target').count()) === 6 && /^[A-Z][a-z]{2} \d{1,2}$/.test((await rows.nth(3).locator('.dlv-date-btn').innerText()).trim()));
ck('a metric with no date asks for one', (await rows.nth(2).locator('.dlv-date-btn').innerText()).trim() === 'Set date');
ck('owners the notes named are pre-assigned', (await page.locator('#measure-grid .dlv.is-unowned').count()) === 3);
ck('sort by status and by date, as on the other boards', (await page.locator('.sort-btn[data-sort="measures"]').count()) === 2);

// --- Type (A): Tracking or Outcome, each with its own symbol, and nothing else ---
await (await reach(rows.first().locator('.dlv-phase-btn'))).click();
await page.waitForTimeout(250);
ck('Type (A) offers exactly Tracking and Outcome', (await page.locator('.picker .picker-label').allInnerTexts()).map((x) => x.trim()).join(',') === 'Tracking,Outcome');
ck('each with a symbol', (await page.locator('.picker .picker-icon svg').count()) === 2);
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
await (await reach(rows.first().locator('.dlv-kind-btn'))).click();
await page.waitForTimeout(250);
ck('Type (B) offers the four metric kinds', (await page.locator('.picker .picker-label').allInnerTexts()).map((x) => x.trim()).join(',')
  === 'Adoption / usage,Speed / time,Quality / accuracy,Support / satisfaction');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);

// --- scoring: status, owners and targets, as on the other boards ---
// Progress (1 + 5 x 0.1) / 6 -> 12.5, owners 3/6 -> 12.5, targets 4/6 -> 16.7: 41.7 -> 42.
ck('Metrics scores 42 from the table', (await valueOf()) === 42);
ck('hovering shows progress, owners and dates', /Progress 25% · Owners 50% · Dates 67%/.test(await page.locator('.health-side .var-metrics').getAttribute('title')));
let calls = 0;
await page.route('**/api/plan', async (r) => { calls++; await r.continue(); });
await (await reach(rows.nth(1).locator('.dlv-status'))).click();   // Not started -> Blocked
await page.waitForTimeout(150);
ck('a status change moves the score at once', (await valueOf()) === 41);
ck('a red "−1%" floats off the Metrics number', (await page.locator('.health-side .var-metrics .score-float.is-down').innerText()).trim() === '\u22121%');
ck('and off the overall score when it moves', (await page.locator('.health-score .score-float').count()) <= 1);
ck('the float is red', (await page.locator('.health-side .var-metrics .score-float').evaluate((e) => getComputedStyle(e).color)) === 'rgb(196, 43, 43)');
await rows.nth(1).locator('.dlv-status').click();                  // Blocked -> In progress
await rows.nth(1).locator('.dlv-status').click();                  // In progress -> Completed
await page.waitForTimeout(150);
ck('completing a metric raises it', (await valueOf()) === 49);
ck('a green "+8%" floats off it', (await page.locator('.health-side .var-metrics .score-float.is-up').last().innerText()).trim() === '+8%'
  && (await page.locator('.health-side .var-metrics .score-float.is-up').last().evaluate((e) => getComputedStyle(e).color)) === 'rgb(43, 138, 52)');
ck('the overall score floats its own change', /^[+\u2212]\d+%$/.test((await page.locator('.health-score .score-float').last().innerText()).trim()));
await page.waitForTimeout(2000);
ck('the floats fade away and are removed', (await page.locator('.score-float').count()) === 0);
const far = new Date(Date.now() + 30 * 86400000);
const farIso = `${far.getFullYear()}-${String(far.getMonth() + 1).padStart(2, '0')}-${String(far.getDate()).padStart(2, '0')}`;
await rows.nth(2).locator('.dlv-target').evaluate((e, v) => { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, farIso);
await page.waitForTimeout(200);
ck('setting a target date raises it', (await valueOf()) === 53);
await rows.nth(2).locator('.dlv-notes').fill('Signed off before build locks');
await page.waitForTimeout(150);
await pick(rows.nth(2).locator('.dlv-owner-btn'), 'Finance ops');
// 20 + 25 x 4/6 + 25 x 5/6 = 57.5, which rounds up.
ck('naming an owner raises it', (await valueOf()) === 58);
await pick(rows.nth(4).locator('.dlv-phase-btn'), 'Tracking');
ck('Type (A) can be changed', (await rows.nth(4).locator('.dlv-phase-btn').innerText()).trim() === 'Tracking');

// --- it all saves itself, logged, with no call to Claude ---
await page.waitForTimeout(1400);
ck('nothing called Claude', calls === 0);
await page.unroute('**/api/plan');
const log = await page.locator('#activity').innerText();
ck('the changes are logged as they save', /Regional finance leads walked through: Completed/.test(log)
  && /Export workaround documented and signed off: targeting/.test(log) && /Support tickets about the dashboard: now Tracking/.test(log));
await page.reload();
await page.waitForTimeout(1800);
await go(page, 'metrics');
await page.waitForTimeout(300);
ck('the edits survive a refresh', (await rows.nth(2).locator('.dlv-target').inputValue()) === farIso
  && (await rows.nth(2).locator('.dlv-notes').inputValue()) === 'Signed off before build locks'
  && (await rows.nth(4).locator('.dlv-phase-btn').innerText()).trim() === 'Tracking' && (await valueOf()) === 58);

// --- a scan sends Claude the table, phases included ---
let sent = null;
await page.route('**/api/plan', async (r) => { sent = r.request().postDataJSON(); await r.continue(); });
await go(page, 'overview');
await page.locator('#add-notes').fill('Finance ops will report the metrics weekly.');
await page.locator('#scan').click();
await page.locator('#switcher-meta').filter({ hasText: '2 versions' }).waitFor({ timeout: 30000 });
await page.unroute('**/api/plan');
const ms = (sent && sent.measures) || [];
ck('the whole table is sent', ms.length === 6);
ck('with Type (A) and (B), subtext, dates and owners by name', ms.some((m) => m.title === 'Support tickets about the dashboard' && m.phase === 'on_track' && m.kind === 'support')
  && ms.some((m) => m.target === farIso && m.notes === 'Signed off before build locks' && m.owner === 'Finance ops'));
await go(page, 'metrics');
await page.waitForTimeout(300);
ck('your statuses are kept after the scan', (await rows.nth(1).getAttribute('class')).includes('status-completed'));

ck('no JS errors', errors.length === 0);
await page.evaluate(() => localStorage.removeItem('scope-builder:people'));
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
