import { open, runToBoard, report } from './lib.mjs';
const { browser, page, errors } = await open({ viewport: { width: 1440, height: 950 } });
const checks = []; const ck = (n, v) => checks.push([n, v]);

await runToBoard(page, { answer: true });

const txt = (s) => page.locator(s).innerText();
ck('program name set from real output', (await txt('#program-name')).length > 5);
ck('overview filled', (await txt('#summary')).length > 60);
ck('four health variables with evidence', (await page.locator('#health-vars .var').count()) === 4);
ck('score is a real number', /^\d+$/.test((await txt('#score-big')).trim()));
ck('stakeholders present', (await page.locator('#stakeholders li').count()) > 0);
ck('comms steps present', (await page.locator('#comms .comms li').count()) > 0);
ck('enablement present', (await page.locator('#enablement li').count()) > 0);
ck('tracking present', (await page.locator('#tracking li').count()) > 0);
ck('success present', (await page.locator('#success li').count()) > 0);
ck('risks present', (await page.locator('#risks li').count()) > 0);
ck('the ask reached the rail', (await txt('#rail-ask')).length > 15);
ck('no empty section on the board', (await page.locator('.result:not([hidden])').count()) === 6);
ck('no error box', !(await page.locator('#error').isVisible()));

const trackTxt = await txt('#tracking');
const succTxt = await txt('#success');
ck('metric kinds stay distinct', trackTxt !== succTxt);
ck('answers cited in evidence', /You confirmed/i.test(await txt('#health-vars')));
ck('no em-dash in any rendered output', !(await txt('#board')).includes('—'));
ck('no JS errors', errors.length === 0);

console.log('\n  --- real output ---');
console.log('  program : ' + await txt('#program-name'));
console.log('  score   : ' + (await txt('#score-big')).trim() + ' ' + (await txt('#health-badge')).trim());
console.log('  counts  : ' + (await Promise.all(['n-stakeholders','n-comms','n-enablement','n-metrics','n-risks','n-gaps']
  .map(async i => i.slice(2) + ' ' + (await txt('#' + i)).trim()))).join(', '));
await page.screenshot({ path: '/tmp/live-board.png', fullPage: true });

const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
