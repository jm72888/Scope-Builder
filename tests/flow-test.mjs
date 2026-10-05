// The behaviours that existed before the dashboard and must survive it.
import { open, report, fillExample } from './lib.mjs';
const { browser, page, errors } = await open();
const checks = []; const ck = (n, v) => checks.push([n, v]);

// One route only. A second registration would take precedence over this one
// and the call would never be counted.
const calls = [];
const payloads = [];
await page.route('**/api/**', async (route) => {
  const u = new URL(route.request().url()).pathname;
  if (u !== '/api/status' && !u.startsWith('/api/projects/')) calls.push(u);
  if (u === '/api/plan') payloads.push(route.request().postDataJSON());
  if (u === '/api/questions' || u === '/api/plan') await new Promise(r => setTimeout(r, 1800));
  await route.continue();
});

await page.waitForTimeout(1200);
ck('no API call on load', calls.length === 0);
await fillExample(page);
await page.waitForTimeout(1200);
ck('no API call from loading an example', calls.length === 0);

// --- phase one: questions ---
await page.locator('#run').click();
await page.waitForTimeout(500);
ck('questions call fires on Evaluate', calls.includes('/api/questions'));
ck('meter visible while reading', await page.locator('#meter').isVisible());
ck('status says it is reading', (await page.locator('#status').innerText()).includes('Reading'));

await page.locator('#questions-panel').waitFor({ state: 'visible', timeout: 20000 });
const total = await page.locator('#meter i').count();
const held = await page.locator('#meter i.lit').count();
ck('questions appear partway through the fill', held > 2 && held < total * 0.5);
ck('plan call has not fired yet', !calls.includes('/api/plan'));
ck('one question at a time', (await page.locator('.q').count()) === 1);
ck('counter reads 1 / 3', (await page.locator('#q-count').innerText()).trim() === '1 / 3');
await page.waitForTimeout(1800);
ck('meter holds while you answer', (await page.locator('#meter i.lit').count()) === held);

// --- answering continues automatically ---
await page.locator('.q-opt:not(.q-other)').first().click({ force: true });
await page.waitForTimeout(500);
ck('answering advances', (await page.locator('#q-count').innerText()).trim() === '2 / 3');
await page.locator('#q-back').click({ force: true });
await page.waitForTimeout(250);
ck('back restores the answer', (await page.locator('.q-opt.is-picked').count()) === 1);
await page.locator('.q-opt:not(.q-other)').first().click({ force: true });
await page.waitForTimeout(500);
await page.locator('.q-other input[type=text]').fill('Only the non-US regions');
await page.locator('.q-next').click({ force: true });
await page.waitForTimeout(400);
ck('free text advances', (await page.locator('#q-count').innerText()).trim() === '3 / 3');

await page.locator('#q-skip').click({ force: true });
await page.locator('#health-row').waitFor({ state: 'visible', timeout: 30000 });
ck('last answer continues on its own', calls.includes('/api/plan'));
ck('two answers sent', payloads[0].answers.length === 2);
ck('free text reached the server', JSON.stringify(payloads[0].answers).includes('non-US regions'));
ck('skipped question reported as a gap', payloads[0].unanswered.length === 1);
if (calls.length !== 2) console.log('DBG calls', JSON.stringify(calls));
ck('exactly two model calls per run', calls.length === 2);
ck('meter completes then clears', !(await page.locator('#meter').isVisible()));

// --- the why popover still paints on top ---
await page.waitForTimeout(300);
await page.locator('#why-btn').click();
await page.waitForTimeout(350);
ck('why popover opens', (await page.locator('#why-pop').evaluate(e => getComputedStyle(e).visibility)) === 'visible');
const onTop = await page.evaluate(() => {
  const r = document.getElementById('why-pop').getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.bottom - 6);
  return !!(hit && hit.closest('#why-pop'));
});
ck('why popover paints above the board', onTop);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
ck('escape closes it', (await page.locator('#why-pop').evaluate(e => getComputedStyle(e).visibility)) === 'hidden');

// --- score arithmetic, checked by hand against the fixture ---
// Live, from the fixture's tiles: Development 57 (on-time In progress counts
// fully), Communication 42.5 (shown 43), Metrics 50. Timeline is not scored.
// (2x57 + 1.5x43 + 42) / 4.5 = 49.0 -> 49.
ck('health percentage 49 as hand-calculated', (await page.locator('#score-big').innerText()).trim() === '49');
ck('band is worth watching', (await page.locator('#health-badge').getAttribute('class')).includes('watch'));
ck('health cards are separate surfaces',
  (await page.locator('.var').first().evaluate(e => getComputedStyle(e).backgroundColor)) !== 'rgba(0, 0, 0, 0)');
ck('no text under the score bars', (await page.locator('#health-vars .var-evidence').count()) === 0);
ck('no arrows on the score rows', (await page.locator('#health-vars .var-go').count()) === 0
  && !/→/.test(await page.locator('#health-vars').innerText()));

ck('no error box', !(await page.locator('#error').isVisible()));
ck('no JS errors', errors.length === 0);
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
