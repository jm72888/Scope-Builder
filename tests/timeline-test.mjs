import { open, runToBoard, go, report } from './lib.mjs';
const { browser, page, errors } = await open();
const checks = []; const ck = (n, v) => checks.push([n, v]);

await runToBoard(page);
ck('timeline hidden on overview', !(await page.locator('#sec-timeline').isVisible()));

await go(page, 'schedule');
ck('timeline page shows the sequence', await page.locator('#sec-timeline').isVisible());
ck('one step per milestone, the final one ending the line', (await page.locator('.tl-step').count()) === 4 && (await page.locator('.tl-launch .tl-final-who').count()) === 1);
ck('each step has a node', (await page.locator('.tl-node').count()) === 4);

// --- left to right, zigzag, Launch at the end ---
const xs = await page.locator('.tl-step').evaluateAll(e => e.map(x => x.getBoundingClientRect().x));
ck('stops run left to right', xs.every((v, i) => i === 0 || v > xs[i - 1]));
const ys = await page.locator('.tl-card').evaluateAll(e => e.map(x => Math.round(x.getBoundingClientRect().y)));
ck('stops alternate above and below the spine',
  ys.every((y, i) => (i % 2 === 0) === (y < ys[1])));
ck('Launch marker present', (await page.locator('.tl-launch').count()) === 1);
const lx = (await page.locator('.tl-launch').boundingBox()).x;
ck('Launch sits past the last stop', lx > xs[xs.length - 1]);
ck('the end shape is labelled with the final milestone', /Dashboard live for quarter close/.test(await page.locator('.tl-launch-label').innerText()));
ck('the end shape pulses from its own centre', (await page.locator('.tl-launch-mark').evaluate(e => getComputedStyle(e, '::after').animationName)) === 'emanate-diamond');

// --- the constant pulse ---
ck('nodes emanate continuously',
  (await page.locator('.tl-node').first().evaluate(e => getComputedStyle(e, '::after').animationName)) === 'emanate');
ck('the pulse repeats forever',
  (await page.locator('.tl-node').first().evaluate(e => getComputedStyle(e, '::after').animationIterationCount)) === 'infinite');
ck('Launch pulses too',
  (await page.locator('.tl-launch-mark').evaluate(e => getComputedStyle(e, '::after').animationName)) === 'emanate-diamond');

// --- nothing clipped, at the width people will actually use ---
const clipped = await page.evaluate(() => {
  const w = document.querySelector('.timeline-wrap').getBoundingClientRect();
  return [...document.querySelectorAll('.tl-card')].filter((c) => {
    const r = c.getBoundingClientRect();
    return r.top < w.top - 1 || r.bottom > w.bottom + 1;
  }).length;
});
ck('no card is clipped by the scroll wrapper', clipped === 0);
ck('every stop keeps its when label', (await page.locator('.tl-when').count()) === 4 && (await page.locator('.tl-launch-when').count()) === 1);

// --- the page owns a colour ---
ck('the Timeline page uses forest green accents',
  (await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--page').trim())) === '#2d6a3e');
ck('the spine takes the green',
  (await page.locator('#timeline').evaluate(e => getComputedStyle(e, '::before').backgroundImage)).includes('45, 106, 62'));
ck('but in the rail its icon stays plain black',
  (await page.locator('.nav-item.is-active .nav-icon').evaluate(e => getComputedStyle(e).color)) === 'rgb(17, 17, 17)');
ck('steps carry their index for staggering',
  (await page.locator('.tl-step').evaluateAll(e => e.map(x => x.style.getPropertyValue('--i')))).join(',') === '0,1,2,3');
ck('each milestone stop shows its date and name',
  (await page.locator('.tl-when').count()) === 4 && (await page.locator('.tl-who').count()) === 5);

// The animation must actually run, and it must finish.
ck('build animation starts', await page.locator('#timeline').evaluate(e => e.classList.contains('is-building')));
const early = await page.locator('.tl-card').evaluateAll(e => e.map(x => Number(getComputedStyle(x).opacity)));
ck('later steps still hidden early on', early[early.length - 1] < 0.9);
ck('the spine draws itself',
  (await page.locator('#timeline').evaluate(e => getComputedStyle(e, '::before').animationName)) === 'draw-line');
await page.waitForTimeout(1800);
const late = await page.locator('.tl-card').evaluateAll(e => e.map(x => Number(getComputedStyle(x).opacity)));
ck('every step lands by the end', late.every(o => o === 1));

// Replaying restarts it rather than doing nothing the second time.
await page.locator('#replay-timeline').click();
await page.waitForTimeout(260);
const replay = await page.locator('.tl-card').evaluateAll(e => e.map(x => Number(getComputedStyle(x).opacity)));
ck('replay restarts the build', replay[replay.length - 1] < 0.9);
await page.waitForTimeout(1800);

// Leaving and returning should play it again.
await go(page, 'metrics');
await go(page, 'schedule');
await page.waitForTimeout(200);
ck('returning to the page replays it', await page.locator('#timeline').evaluate(e => e.classList.contains('is-building')));

ck('no JS errors', errors.length === 0);
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
