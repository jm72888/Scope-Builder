import { open, runToBoard, report } from './lib.mjs';
const { browser, page, errors } = await open();
const checks = []; const ck = (n, v) => checks.push([n, v]);

await runToBoard(page);

for (const [w, label] of [[1440,'desktop'],[1180,'narrow desktop'],[1100,'rail wraps'],[860,'tablet'],[640,'small'],[390,'phone']]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
    offenders: [...document.querySelectorAll('*')]
      .filter(e => e.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 3).map(e => e.tagName + '.' + String(e.className).slice(0, 24)),
  }));
  ck(`${w}px (${label}) no horizontal scroll`, m.scrollW <= m.winW + 1);
  if (m.scrollW > m.winW + 1) console.log('      offenders: ' + m.offenders.join(', '));
  ck(`${w}px sidebar still reachable`, await page.locator('#sidenav').isVisible());
  ck(`${w}px rail content still reachable`, await page.locator('#devnotes').isVisible());
}

// Below 860 the sidebar becomes a horizontal strip above the board.
await page.setViewportSize({ width: 640, height: 900 });
await page.waitForTimeout(400);
const nav = await page.locator('#sidenav').boundingBox();
const board = await page.locator('#board').boundingBox();
ck('sidebar stacks above the board on small screens', nav.y + nav.height <= board.y + 2);
// The notes and add-context boxes stack under it, so the strip itself is taller now;
// what matters is that the page links stay on one row.
ck('page links sit in one horizontal row', (await page.locator('.nav').boundingBox()).height < 60);
ck('add-context still reachable on small screens', await page.locator('#add-card').isVisible());
ck('source notes still reachable on small screens', await page.locator('#toggle-notes').isVisible());

ck('no JS errors', errors.length === 0);
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
