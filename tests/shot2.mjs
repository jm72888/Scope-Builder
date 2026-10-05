import { open, runToBoard } from './lib.mjs';
const { browser, page } = await open({ viewport: { width: 1440, height: 950 } });
await runToBoard(page);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/d-top.png', clip: { x: 0, y: 0, width: 1440, height: 620 } });
await browser.close();
