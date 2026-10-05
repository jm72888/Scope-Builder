// Entrances on every page, and none of it when motion is reduced.
import { open, runToBoard, go, report } from './lib.mjs';
const checks = []; const ck = (n, v) => checks.push([n, v]);
const anim = (page, sel) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).animationName);

// ---------------- reduced motion: everything still works, nothing moves ----------------
const r = await open({ reducedMotion: 'reduce' });
ck('reduced: the start-screen backdrop is drawn once and holds still', await r.page.evaluate(async () => {
  const c = document.getElementById('backdrop');
  const snap = () => c.toDataURL();
  const a = snap(); await new Promise((res) => setTimeout(res, 600)); return a === snap() && a.length > 5000;
}));
await runToBoard(r.page);
ck('reduced: board still opens', await r.page.locator('#sidenav').isVisible());
ck('reduced: score shown without counting up', (await r.page.locator('#score-big').innerText()).trim() === '49');
ck('reduced: no entrance class is ever added',
  (await r.page.locator('.page-enter, .hr-enter').count()) === 0);
ck('reduced: summary words are static', (await anim(r.page, '.w')) === 'none');
await go(r.page, 'schedule');
ck('reduced: timeline steps shown immediately',
  await r.page.locator('.tl-card').evaluateAll((e) => e.every((x) => Number(getComputedStyle(x).opacity) === 1)));
ck('reduced: the pulse is off',
  (await r.page.locator('.tl-node').first().evaluate((e) => getComputedStyle(e, '::after').animationName)) === 'none');
await go(r.page, 'content');
ck('reduced: rows static', (await anim(r.page, '#dlv-grid .dlv')) === 'none');
ck('reduced: score blocks static', (await anim(r.page, '.var-blocks i.on')) === 'none');
ck('reduced: gauge drawn without animation', (await anim(r.page, '#health-bar .seg.on')) === 'none');
await go(r.page, 'schedule');
await go(r.page, 'metrics');
ck('reduced: the selected score row holds still', (await anim(r.page, '.health-side .var-metrics')) === 'none');
ck('reduced: no JS errors', r.errors.length === 0);
await r.browser.close();

// ---------------- full motion: each page has its own entrance ----------------
const m = await open();
const p = m.page;
// Record which entrances actually ran, since they clean up after themselves.
await p.evaluate(() => {
  window.__ran = new Set();
  document.addEventListener('animationstart', (e) => window.__ran.add(e.animationName), true);
});
ck('the start screen has a moving backdrop', await p.evaluate(async () => {
  const c = document.getElementById('backdrop');
  const a = c.toDataURL(); await new Promise((res) => setTimeout(res, 500)); return getComputedStyle(c).display !== 'none' && a !== c.toDataURL();
}));
const btnText = () => p.locator('#backdrop-toggle').innerText();
ck('there is a pause button on the start screen', (await btnText()).trim() === 'Pause animation');
await p.waitForTimeout(1200);
await p.locator('#backdrop-toggle').click();
const frozen = await p.evaluate(async () => {
  const c = document.getElementById('backdrop');
  const a = c.toDataURL(); await new Promise((res) => setTimeout(res, 600)); return a === c.toDataURL();
});
ck('pausing freezes the animation', frozen);
ck('paused, no note sits on the headline or subtext', await p.evaluate(() => {
  const c = document.getElementById('backdrop'), x = c.getContext('2d');
  const r = document.querySelector('.appbar-title').getBoundingClientRect();
  const k = c.width / innerWidth;
  const d = x.getImageData(Math.round(r.left * k), Math.round(r.top * k), Math.round(r.width * k), Math.round(r.height * k)).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return false;
  return true;
}));
ck('the button offers to play again', (await btnText()).trim() === 'Play animation');
ck('paused means back at the start: no timeline drawn yet', await p.evaluate(() => {
  const c = document.getElementById('backdrop'), x = c.getContext('2d');
  const d = x.getImageData(0, Math.round(c.height / 2), Math.round(c.width * 0.05), 1).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
  return true;
}));
await p.locator('#backdrop-toggle').click();
ck('playing starts it moving again', await p.evaluate(async () => {
  const c = document.getElementById('backdrop');
  const a = c.toDataURL(); await new Promise((res) => setTimeout(res, 500)); return a !== c.toDataURL();
}));
await runToBoard(p);
ck('the backdrop is gone on the board', (await p.locator('#backdrop').evaluate((e) => getComputedStyle(e).display)) === 'none');
const ran = async () => p.evaluate(() => [...window.__ran]);

let names = await ran();
ck('first open: the shell slides together', names.includes('en-left') && names.includes('en-right'));
ck('the health cards rise', names.includes('en-rise'));
ck('the gauge segments light one after another', names.includes('seg-in'));
await go(p, 'metrics');
await p.waitForTimeout(300);
ck('the selected score row heaves', (await p.locator('.health-side .var-metrics').evaluate((e) => getComputedStyle(e).animationName)) === 'heave');
ck('the others stay still', (await p.locator('.health-side .var-communication').evaluate((e) => getComputedStyle(e).animationName)) !== 'heave');
await go(p, 'overview');
ck('the score blocks pop in', names.includes('en-pip'));
ck('the summary writes itself in', names.includes('en-word'));
ck('the change log drops in and pings', names.includes('en-drop') && names.includes('en-ping'));

await p.evaluate(() => window.__ran.clear());
await go(p, 'content');
await p.waitForTimeout(1600);
names = await ran();
ck('content: the rows rise in', names.includes('en-rise'));

await p.evaluate(() => window.__ran.clear());
await go(p, 'metrics');
await p.waitForTimeout(1600);
names = await ran();
ck('metrics: the rows rise in', names.includes('en-rise'));

await p.evaluate(() => window.__ran.clear());
await go(p, 'schedule');
await p.waitForTimeout(2600);
names = await ran();
ck('schedule: Launch spins into place', names.includes('en-spin'));
ck('schedule: the spine still draws itself', names.includes('draw-line'));

// Revisiting replays rather than doing nothing the second time.
await p.evaluate(() => window.__ran.clear());
await go(p, 'overview');
await p.waitForTimeout(300);
ck('returning to a page replays its entrance', (await ran()).includes('en-word'));

// ---------------- nothing is left behind ----------------
await p.waitForTimeout(2800);
ck('entrance classes are removed afterwards', (await p.locator('.page-enter, .hr-enter').count()) === 0);
ck('no transform lingers on a card',
  await p.locator('.page[data-page="overview"] .card').evaluateAll((e) =>
    e.every((x) => ['none', ''].includes(getComputedStyle(x).transform))));
ck('every word ends fully visible',
  await p.locator('.w').evaluateAll((e) => e.every((x) => Number(getComputedStyle(x).opacity) === 1)));
ck('no horizontal scroll was introduced',
  await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
ck('summary text is intact for copying',
  (await p.locator('#summary').innerText()).split(/\s+/).length > 20);
ck('motion: no JS errors', m.errors.length === 0);
await m.browser.close();

const bad = report(checks, []);
process.exit(bad ? 1 : 0);
