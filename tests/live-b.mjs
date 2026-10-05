import { open, runToBoard, go, report } from './lib.mjs';
const { browser, page, errors } = await open({ viewport: { width: 1440, height: 980 } });
const checks = []; const ck = (n, v) => checks.push([n, v]);

await runToBoard(page, { answer: true });
await page.waitForTimeout(900);
const first = (await page.locator('#score-big').innerText()).trim();
ck('first run scored', /^\d+$/.test(first));
ck('four lifts came back', (await page.locator('.var-lift').count()) === 4);
const openItems = await page.locator('#missing li').count();
ck('missing context returned', openItems > 0);

await go(page, 'schedule');
ck('timeline built from real comms', (await page.locator('.tl-step').count()) > 0);
await go(page, 'alignment');
ck('measure page filled', (await page.locator('#stakeholders li').count()) > 0);
await go(page, 'overview');

// Answer the first open question and rebuild.
const firstAsk = (await page.locator('.missing-ask').first().innerText()).trim();
await page.locator('#add-notes').fill('Sales Ops owns the migration end to end, and the enablement lead has committed two days a week from next Monday.');
await page.locator('#update').click();
// The health row never hides during an update, so waiting on it would resolve
// immediately. Wait for the version count to actually change.
await page.locator('#switcher-meta').filter({ hasText: '2 versions' }).waitFor({ timeout: 60000 });
await page.waitForTimeout(1800);

const second = (await page.locator('#score-big').innerText()).trim();
ck('second version recorded', (await page.locator('#switcher-meta').innerText()).includes('2 versions'));
ck('delta badge shown', await page.locator('#health-delta').isVisible());
ck('what-changed card shown', await page.locator('#sec-changed').isVisible());
ck('no error box', !(await page.locator('#error').isVisible()));
ck('no JS errors', errors.length === 0);

console.log('\n  --- real run ---');
console.log('  score    : ' + first + ' then ' + second + '   (' + (await page.locator('#health-delta').innerText()).trim() + ')');
console.log('  answered : ' + firstAsk);
console.log('  changed  :');
for (const l of (await page.locator('#changed li').allInnerTexts())) console.log('    - ' + l.replace(/\n/g, '  '));
console.log('  still open: ' + (await page.locator('#missing li').count()) + ' (was ' + openItems + ')');
await page.screenshot({ path: '/tmp/live-b.png', fullPage: true });

const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
