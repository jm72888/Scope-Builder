import { open, runToBoard, report } from './lib.mjs';
const { browser, page, errors } = await open();
const checks = []; const ck = (n, v) => checks.push([n, v]);
await runToBoard(page, { answer: true });
await page.waitForTimeout(1000);

const lifts = await page.locator('.var-lift').allInnerTexts();
ck('four lift lines came back', lifts.length === 4);
ck('lifts are actions, not restatements', lifts.every(l => l.split('\n').pop().trim().length > 15));

const missing = await page.locator('#missing li').count();
ck('missing context returned', missing > 0 && missing <= 6);
const asks = await page.locator('.missing-ask').allInnerTexts();
ck('missing items are questions', asks.filter(a => a.trim().endsWith('?')).length >= Math.ceil(asks.length * 0.6));
const sections = await page.locator('.nav-item.has-open').count();
ck('missing items map onto real sections', sections > 0);
const lift_targets = await page.locator('.missing-meta b').allInnerTexts();
ck('every missing item names a variable',
  lift_targets.length === missing &&
  lift_targets.every(t => ['alignment','communication','schedule','metrics'].includes(t.trim())));

ck('project saved', (await page.locator('#switcher-meta').innerText()).includes('1 version'));
await page.reload();
await page.waitForTimeout(1600);
ck('survives refresh with real data', (await page.locator('.result:not([hidden])').count()) === 6);
ck('no error box', !(await page.locator('#error').isVisible()));
ck('no JS errors', errors.length === 0);

console.log('\n  --- real output ---');
console.log('  project : ' + (await page.locator('#switcher-name').innerText()));
console.log('  score   : ' + (await page.locator('#score-big').innerText()).trim());
console.log('  lifts   :');
for (const l of lifts) console.log('    - ' + l.split('\n').pop().trim());
console.log('  missing :');
for (let i = 0; i < asks.length; i++) console.log(`    - [${lift_targets[i].trim()}] ${asks[i].trim()}`);

const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
