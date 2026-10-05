import { open, runToBoard, report, URL } from './lib.mjs';
const { browser, page, errors } = await open();
const checks = []; const ck = (n, v) => checks.push([n, v]);

ck('no project before a run', (await page.locator('#switcher-name').innerText()).includes('No project'));

await runToBoard(page);
await page.waitForTimeout(800);
ck('project named from the output', (await page.locator('#switcher-name').innerText()).length > 8);
ck('version count shown', (await page.locator('#switcher-meta').innerText()).includes('1 version'));

// It must survive a reload, which is the whole point.
await page.reload();
await page.waitForTimeout(1500);
ck('still on the board after refresh', (await page.locator('body').getAttribute('class')).includes('state-board'));
ck('notes restored after refresh', (await page.locator('#notes').inputValue()).length > 150);
ck('score restored after refresh', (await page.locator('#score-big').innerText()).trim() === '49');
ck('sections restored after refresh', (await page.locator('.result:not([hidden])').count()) >= 4);
ck('project still named after refresh', (await page.locator('#switcher-name').innerText()).length > 8);

// A second project, then switch back to the first.
const firstName = await page.locator('#switcher-name').innerText();
await page.locator('#switcher-btn').click();
await page.waitForTimeout(300);
ck('switcher menu opens', await page.locator('#switcher-menu').isVisible());
await page.locator('#new-project').click();
await page.waitForTimeout(500);
ck('new project returns to the prompt', (await page.locator('body').getAttribute('class')).includes('state-prompt'));
ck('new project clears the box', (await page.locator('#notes').inputValue()) === '');

await runToBoard(page);
await page.waitForTimeout(900);
await page.locator('#switcher-btn').click();
await page.waitForTimeout(400);
const rows = await page.locator('.project-row').count();
ck('the other project is listed', rows >= 1);
await page.locator('.project-row').first().click();
await page.waitForTimeout(900);
ck('switching loads the other project', (await page.locator('#switcher-name').innerText()) === firstName);
ck('switched project renders its board', (await page.locator('.result:not([hidden])').count()) >= 4);

ck('no suggested questions and no rail counts', (await page.locator('#missing, .nav-count').count()) === 0);

// Each health card says how to raise it.

// Projects live in this browser only: another browser sees none of them.
const ctx2 = await page.context().browser().newContext();
const fresh = await ctx2.newPage();
await fresh.goto(URL);
await fresh.waitForTimeout(1600);
ck('another browser lands on the prompt', (await fresh.locator('body').getAttribute('class')).includes('state-prompt'));
ck('and sees none of this visitor\'s projects', !(await fresh.locator('#resume').isVisible()) && (await fresh.locator('.resume-row').count()) === 0);
await ctx2.close();

// In this browser, saved work is offered on the start page.
await page.evaluate(() => localStorage.removeItem('program-triage:last'));
await page.reload();
await page.waitForTimeout(1600);
ck('with nothing open, this browser lands on the prompt', (await page.locator('body').getAttribute('class')).includes('state-prompt'));
ck('but its saved projects are offered', await page.locator('#resume').isVisible() && (await page.locator('.resume-row').count()) === 2);
await page.locator('.resume-row').first().click();
await page.waitForTimeout(1500);
ck('opening one shows its board', (await page.locator('body').getAttribute('class')).includes('state-board'));
ck('and the offer goes away', !(await page.locator('#resume').isVisible()));
ck('projects are kept in this browser\'s storage', await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('scope-builder:project:')).length === 2));

// --- a project saved under the previous four must still open honestly ---
const legacy = {
  id: 'legacy-method-test',
  name: 'Legacy method test',
  versions: [{
    n: 1, at: '2026-09-30T10:00:00Z', notes: 'Old notes', score: 30,
    plan: {
      program: 'Legacy method test',
      alignment: { value: 4, evidence: '"a"' }, ownership: { value: 3, evidence: '"b"' },
      simplicity: { value: 4, evidence: '"c"' }, room: { value: 3, evidence: '"d"' },
      summary: { call: 'c', risk: 'r', ask: 'a' }, missing: [], comms: [], enablement: [],
      tracking: [], success: [], risks: [], stakeholders: [], responsibilities: [],
    },
  }],
};
await page.evaluate((proj) => localStorage.setItem('scope-builder:project:' + proj.id, JSON.stringify(proj)), legacy);
await page.locator('#switcher-btn').click();
await page.waitForTimeout(400);
await page.locator('.project-row', { hasText: 'Legacy method test' }).click();
await page.waitForTimeout(1500);
ck('legacy project opens under its own labels',
  (await page.locator('.var-label').allInnerTexts()).join('|') === 'Alignment|Ownership|Simplicity|Schedule room');
ck('and says it was scored on the previous method', await page.locator('#legacy-note').isVisible());
// a4 x2 + o3 x1.5 + s4 x1.5 + r3 x1 = 21.5 ; weights 6 ; (21.5-6)/54*100 = 28.7 -> 29
ck('its percentage is recomputed with its own weights',
  (await page.locator('#score-big').innerText()).trim() === '29');
ck('no current-method label is invented for it',
  !(await page.locator('.var-label').allInnerTexts()).includes('Communication'));

// --- a project saved under Alignment & Ownership (1-10) opens honestly too ---
const prev = {
  id: 'previous-method-test', name: 'Previous method test',
  versions: [{
    n: 1, at: '2026-10-01T10:00:00Z', notes: 'Old notes', score: 29,
    plan: {
      program: 'Previous method test',
      alignment: { value: 3, evidence: '"a"' }, communication: { value: 2, evidence: '"b"' },
      schedule: { value: 9, evidence: '"c"' }, metrics: { value: 2, evidence: '"d"' },
      summary: { call: 'c', risk: 'r', ask: 'a' }, missing: [], comms: [], enablement: [],
      tracking: [], success: [], risks: [], stakeholders: [],
    },
  }],
};
await page.evaluate((proj) => localStorage.setItem('scope-builder:project:' + proj.id, JSON.stringify(proj)), prev);
await page.locator('#switcher-btn').click();
await page.waitForTimeout(400);
await page.locator('.project-row', { hasText: 'Previous method test' }).click();
await page.waitForTimeout(1500);
ck('previous-method project keeps its own labels',
  (await page.locator('.var-label').allInnerTexts()).join('|') === 'Alignment & Ownership|Communication|Schedule|Metrics');
ck('and is flagged as the previous method', await page.locator('#legacy-note').isVisible());
// (3-1)/9 x2 + (2-1)/9 x1.5 + (9-1)/9 + (2-1)/9 = 14.5/9 over 5.5 = 29.3% -> 29
ck('its total is unchanged by the switch to percentages', (await page.locator('#score-big').innerText()).trim() === '29');
ck('an older project without suggestions says how to get them', /next scan/.test(await page.locator('#raise').innerText()));
ck('its cards read as percentages', (await page.locator('.var-value').first().innerText()).replace(/\s+/g, '') === '22%');

ck('no JS errors', errors.length === 0);
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
