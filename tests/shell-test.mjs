import { open, runToBoard, go, report } from './lib.mjs';
const { browser, page, errors } = await open();
const checks = []; const ck = (n, v) => checks.push([n, v]);
const vis = (sel) => page.locator(sel).isVisible();

// --- prompt state ---
ck('starts in prompt state', (await page.locator('body').getAttribute('class')).includes('state-prompt'));
ck('sidebar hidden before any run', !(await vis('#sidenav')));
// The rail is the input column before a run, so it is visible from the start.
ck('rail is the centred column before a run', await vis('#rail'));
ck('input lives in the rail', await vis('#notes'));
ck('no result sections visible', (await page.locator('.result:not([hidden])').count()) === 0);
ck('health row hidden before a run', !(await vis('#health-row')));
ck('prompt column is centred and narrow', (await page.locator('#rail').boundingBox()).width < 820);
ck('box starts empty', (await page.locator('#notes').inputValue()) === '');

await runToBoard(page);

// --- board state ---
ck('switches to board state', (await page.locator('body').getAttribute('class')).includes('state-board'));
ck('sidebar appears', await vis('#sidenav'));
ck('rail appears', await vis('#rail'));

const nav = await page.locator('#sidenav').boundingBox();
const board = await page.locator('#board').boundingBox();
const rail = await page.locator('#rail').boundingBox();
ck('sidebar is left of the board', nav.x + nav.width <= board.x + 1);
ck('rail is right of the board', rail.x >= board.x + board.width - 1);
ck('three columns across the viewport', nav.width > 150 && rail.width > 240);

// --- every generated field has a home ---
ck('lands on overview', (await page.evaluate(() => document.body.dataset.page)) === 'overview');
ck('overview filled', (await page.locator('#summary').innerText()).length > 40);
ck('health row shown', await vis('#health-row'));
ck('three health cards: Timeline is not scored', (await page.locator('#health-vars .var').count()) === 3);
ck('in the agreed order',
  (await page.locator('.var-label').allInnerTexts()).join('|') ===
  'Development|Communication|Metrics');
ck('no legacy note on a current-method plan', !(await vis('#legacy-note')));
ck('score boxes have no colored line across the top',
  await page.locator('.var').evaluateAll((e) => e.every((x) => getComputedStyle(x).borderTopWidth === '0px')));
const whyText = await page.locator('#why-pop').evaluate((e) => e.textContent);
ck('tooltip says the Timeline is not scored', /The Timeline is a plan of milestones and is not scored/.test(whyText));
ck('the breakdown is called Sub scores', (await page.locator('.health-side h2').innerText()).trim() === 'Sub scores');
ck('How this is scored sits at the right of Sub scores', (await page.locator('.health-side .panel-head #why-btn').count()) === 1
  && await page.evaluate(() => { const h = document.querySelector('.health-side').getBoundingClientRect(), b = document.getElementById('why-btn').getBoundingClientRect(); const t = document.querySelector('.health-side h2').getBoundingClientRect(); return h.right - b.right < 30 && b.left > t.right; }));
ck('the tooltip covers all three boards the same way', /Development, Communication and Metrics\./.test(whyText));
ck('tooltip says the scores are live, not set by Claude', /scores what is on the dashboard, live/.test(whyText));
const pageText = await page.evaluate(() => document.body.innerText + document.getElementById('why-pop').textContent);
ck('no "cutover" anywhere on the page', !/cut-?over/i.test(pageText));
ck('American spelling on the page',
  !/\b(programmes?|colours?|centred|organis|prioritis|behaviour|optimis)/i.test(pageText));
ck('a gap in the notes is shaded as assumed',
  (await page.locator('.var.is-inferred .var-label').allInnerTexts()).includes('Metrics'));
ck('each score has a bar of ten blocks', (await page.locator('.var .var-blocks i').count()) === 30);
// Communication is 43% live: four full blocks and the fifth three tenths full.
ck('a bar fills one block per ten percent', (await page.locator('.var-communication .var-blocks i.on').count()) === 4);
ck('the block the score lands in fills partway', (await page.locator('.var-communication .var-blocks i.part').count()) === 1
  && (await page.locator('.var-communication .var-blocks i.part').evaluate((e) => e.style.getPropertyValue('--f'))) === '0.30');
const barColor = (key) => page.locator(`.var-${key} .var-blocks i.on`).evaluateAll((e) =>
  [...new Set(e.map((x) => getComputedStyle(x).backgroundColor))]);
const dotColor = (key) => page.locator(`.var-${key} .var-label`).evaluate((e) => getComputedStyle(e, '::before').backgroundColor);
let ownColors = true;
for (const key of ['content', 'communication', 'metrics']) {
  const c = await barColor(key);
  ownColors = ownColors && c.length === 1 && c[0] === await dotColor(key);
}
ck('each score bar is one color, its own', ownColors);
ck('the three bars are three different colors', new Set(await Promise.all(['content', 'communication', 'metrics'].map(async (k) => (await barColor(k))[0]))).size === 3);
ck('the scores are stacked in their own tile',
  await page.locator('.health-side .var').evaluateAll((e) => e.every((x, i, a) => i === 0 || x.getBoundingClientRect().top > a[i - 1].getBoundingClientRect().bottom - 1)));
for (const key of ['metrics', 'communication', 'content']) {
  await page.locator(`.health-side .var-${key}`).click();
  await page.waitForTimeout(250);
  ck(`clicking the ${key} score opens its page`, (await page.evaluate(() => document.body.dataset.page)) === key);
}
await page.locator('.health-side .var-metrics').focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
ck('a score opens with the keyboard too', (await page.evaluate(() => document.body.dataset.page)) === 'metrics');
await go(page, 'content');
ck('Development now uses the orange', (await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--page').trim())) === '#e66a00'
  && (await page.locator('.var-content .var-label').evaluate((e) => getComputedStyle(e, '::before').backgroundColor)) === 'rgb(245, 169, 100)');
await go(page, 'communication');
ck('the selected nav item is lit in its page color, not grey',
  (await page.locator('.nav-item.is-active').evaluate((e) => getComputedStyle(e).color)) === 'rgb(21, 83, 163)');
await go(page, 'schedule');
ck('Timeline has no color of its own in the rail', (await page.locator('.nav-item.is-active').evaluate((e) => getComputedStyle(e).color)) === 'rgb(17, 17, 17)'
  && (await page.locator('.nav-item.is-active .nav-label').innerText()).trim() === 'Timeline');
ck('Timeline has no score row', (await page.locator('.health-side .var-schedule').count()) === 0);
await go(page, 'overview');
await go(page, 'communication');
await page.waitForTimeout(300);
const rowBg = (k) => page.locator(`.health-side .var-${k}`).evaluate((e) => getComputedStyle(e).backgroundColor);
ck('unselected score rows are white', (await rowBg('content')) === 'rgb(255, 255, 255)' && (await rowBg('metrics')) === 'rgb(255, 255, 255)');
ck('the selected score row is grey', (await rowBg('communication')) === 'rgb(246, 246, 243)');
await go(page, 'overview');
ck('a "Raise the score by" section sits to the right of the scores', await (async () => {
  const r = await page.locator('.health-raise').boundingBox(), s2 = await page.locator('.health-side').boundingBox();
  return r && r.x >= s2.x + s2.width - 1 && (await page.locator('.health-raise h2').innerText()).trim() === 'Raise the score by';
})());
const groupSizes = await page.locator('.raise-group').evaluateAll((g) => g.map((x) => x.querySelectorAll('li').length));
ck('one group of suggestions per scored area', groupSizes.length === 3);
ck('two or three suggestions in each', groupSizes.every((n) => n >= 2 && n <= 3));
ck('the suggestions are the ones Claude wrote', /Name an engineering owner for the build/.test(await page.locator('#raise').innerText()));
await go(page, 'content');
ck('the current page lights its group', (await page.locator('.raise-content').evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(246, 246, 243)'
  && (await page.locator('.raise-content').evaluate((e) => getComputedStyle(e).animationName)) === 'none');
await go(page, 'overview');
ck('the overall score is a gauge in the left tile', (await page.locator('.health-main #health-bar .seg').count()) === 10);
ck('no suggested questions in Add more context', (await page.locator('#missing, .missing-list').count()) === 0);

await go(page, 'schedule');
ck('the milestones graphic is on the Timeline page', (await page.locator('.tl-step').count()) === 4 && (await page.locator('.tl-launch').count()) === 1);
ck('no "Has to exist before rollout" on the Timeline page', (await page.locator('#sec-enablement').count()) === 0);
ck('overview hidden while on timeline', !(await vis('#sec-overview')));

await go(page, 'content');
ck('deliverable tiles on Development', await vis('#sec-deliverables'));
ck('no people section on Development for now', !(await vis('#sec-directory')));
ck('no areas of ownership any more', (await page.locator('#sec-people, #responsibilities').count()) === 0);

await go(page, 'communication');
ck('communication tiles on Communication', await vis('#sec-comm-board'));
ck('no open items or "Who has to move" on Communication', (await page.locator('#sec-items-communication, #sec-stakeholders').count()) === 0);

await go(page, 'metrics');
ck('risks are no longer on the Metrics page', (await page.locator('.page[data-page="metrics"] #sec-risks').count()) === 0);
ck('the Metrics table is filled', (await page.locator('#measure-grid .dlv').count()) === 6);
ck('with Tracking and Outcome rows', (await page.locator('#measure-grid .dlv-phase-btn').allInnerTexts()).map((x) => x.trim()).join(',') === 'Tracking,Tracking,Tracking,Outcome,Outcome,Outcome');
ck('risks filled', (await page.locator('#risks li').count()) === 3);
ck('timeline hidden while on measure', !(await vis('#sec-timeline')));
await go(page, 'overview');

// --- health row and rail ---
ck('score shown in the header', /^\d+$/.test((await page.locator('#score-big').innerText()).trim()));
ck('shown as a percentage', (await page.locator('.health-score span').innerText()).trim() === '%');
ck('each value reads as a percentage',
  (await page.locator('.var-value').allInnerTexts()).every(v => /^\d+%$/.test(v.replace(/\s+/g, ''))));
ck('the first card is Development',
  (await page.locator('.var-label').first().innerText()).trim() === 'Development');

// --- the percentage bar ---
const score = Number((await page.locator('#score-big').innerText()).trim());
ck('bar is a labelled progressbar', (await page.locator('#health-bar').getAttribute('role')) === 'progressbar');
ck('bar reports the same number', Number(await page.locator('#health-bar').getAttribute('aria-valuenow')) === score);
ck('the gauge lights one segment per ten percent', (await page.locator('#health-bar .seg.on').count()) === Math.round(score / 10));
ck('band class still set', (await page.locator('#health-bar').getAttribute('class')).includes('watch'));
ck('band shown', (await page.locator('#health-badge').innerText()).trim().length > 2);
// The fixture scores 51% live: in the 50s, its last lit segment yellow.
ck('the phrase matches the score', (await page.locator('#health-badge').innerText()).trim() === 'Taking shape, gaps remain');
ck('the phrase is inked like the gauge', (await page.locator('#health-badge').evaluate((e) => getComputedStyle(e).color)) === 'rgb(142, 105, 0)');
ck('no pill and no highlighter: just colored words', await page.locator('#health-badge').evaluate((e) =>
  getComputedStyle(e).borderTopLeftRadius === '0px' && getComputedStyle(e).backgroundImage === 'none'));
ck('ten different phrases on file', await page.evaluate(() => new Set(HEALTH_PHRASES).size === 10));
ck('each card has its own color dot',
  new Set(await page.locator('.var-label').evaluateAll(e => e.map(x => getComputedStyle(x, '::before').backgroundColor))).size === 3);
ck('score card labels are black text', await page.locator('.var-label').evaluateAll(e => e.every(x => getComputedStyle(x).color === 'rgb(17, 17, 17)')));
ck('tiles are white with a shadow', await page.locator('#health-row').evaluate(e =>
  getComputedStyle(e).backgroundColor === 'rgb(255, 255, 255)' && getComputedStyle(e).boxShadow !== 'none'));
const hm = await page.locator('.health-main').boundingBox(), hs = await page.locator('.health-side').boundingBox();
ck('overall and breakdown share one card, side by side', hs.x >= hm.x + hm.width - 1 && Math.abs(hs.y - hm.y) < 2
  && (await page.locator('.health-side').evaluate((e) => getComputedStyle(e).boxShadow)) === 'none');
ck('the dashboard canvas is grey', (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(239, 239, 236)');
ck('each nav item has an icon', (await page.locator('.nav-item .nav-icon').count()) === 5);
ck('Inter is the font', /Inter/.test(await page.evaluate(() => getComputedStyle(document.body).fontFamily)));
ck('no ask card or tips card any more', (await page.locator('#ask-card, #tips-card').count()) === 0);
ck('add-context box is visible', await vis('#add-notes'));
ck('source notes sit on the Overview, under the summary', (await page.locator('.ov-left #notes-slot #input-panel').count()) === 1);
ck('add more context sits on the Overview, under the source notes', (await page.locator('.ov-left #add-card').count()) === 1);
const notesBox = await page.locator('#input-panel').boundingBox();
const addBox = await page.locator('#add-card').boundingBox();
const sumBox = await page.locator('#sec-overview').boundingBox();
ck('left column runs summary, then source notes, then add more context', sumBox.y < notesBox.y && notesBox.y < addBox.y);
ck('add more context explains what a review does', /Describe any major changes to the project/.test(await page.locator('#add-card .hint').innerText()));
ck('the right rail holds only the developer\'s notes', (await page.locator('#rail > section:visible').count()) === 1 && await vis('#rail #devnotes'));
ck('developer\'s notes are titled and read only', /Developer’s notes/.test(await page.locator('#devnotes h2').innerText())
  && (await page.locator('#devnotes input, #devnotes textarea, #devnotes [contenteditable]').count()) === 0);
ck('developer\'s notes come from the file', /How to use Scope builder/.test(await page.locator('#devnotes-body').innerText()));

// --- source notes preserved ---
ck('source notes kept', (await page.locator('#notes-echo').innerText()).length > 150);
ck('source notes are a single line to start', (await page.locator('#toggle-notes').innerText()).trim() === 'View source notes'
  && !(await vis('#notes-echo')));
await page.locator('#toggle-notes').click();
await page.waitForTimeout(200);
ck('clicking it shows the notes', await vis('#notes-echo'));
ck('the notes are read only on the board', !(await vis('#notes')) && !(await vis('#run')));
ck('toggle relabels when open', (await page.locator('#toggle-notes').innerText()).includes('Hide'));
await page.locator('#toggle-notes').click();
await page.waitForTimeout(200);
ck('and closes again', !(await vis('#notes-echo')));

// --- sidebar nav ---
ck('the rail carries no counts', (await page.locator('.nav-count').count()) === 0);
ck('the rail has the five pages, Timeline last',
  JSON.stringify(await page.locator('.nav-item').evaluateAll((e) => e.map((x) => x.dataset.page)))
    === JSON.stringify(['overview', 'content', 'communication', 'metrics', 'schedule']));
ck('no "Delivery review" subheading anywhere', !/Delivery review/i.test(await page.locator('body').innerText()));
ck('project name sits inside the health card',
  (await page.locator('#health-row #project-title').innerText()).trim() === 'Billing dashboard migration');
ck('no top bar on the board', !(await vis('.appbar')));
ck('reset all lives in the left rail', (await page.locator('#sidenav #reset-all').count()) === 1 && await vis('#reset-all'));
ck('the board starts near the top of the screen', (await page.locator('#health-row').boundingBox()).y < 40);
ck('no "To raise this" on the score cards', (await page.locator('.var-lift').count()) === 0
  && !/To raise this/i.test(await page.locator('#health-vars').innerText()));
const brief = await page.locator('#summary').innerText();
ck('summary says what the project is', /billing dashboard/i.test(brief) && /Sept 30/.test(brief));
ck('summary is not a status report', !/(no named owner|not been told|gap|risk|commit to)/i.test(brief));
const sentences = brief.split(/(?<=\.)\s+/).filter(Boolean).length;
ck('summary is 2 to 4 sentences', sentences >= 2 && sentences <= 4);
const outlined = async () => page.locator('.var').evaluateAll((e) =>
  e.filter((x) => getComputedStyle(x).boxShadow.includes('inset')).map((x) => x.className.match(/var-(\w+)/)[1]));
for (const key of ['content', 'communication', 'metrics']) {
  await go(page, key);
  await page.waitForTimeout(350); // let the outline fade finish
  ck(`on ${key}, only the ${key} card is outlined`, JSON.stringify(await outlined()) === JSON.stringify([key]));
}
await go(page, 'overview');
await page.waitForTimeout(350);
ck('on overview, no card is outlined', (await outlined()).length === 0);
ck('title renamed', (await page.locator('.brand-text').innerText()).includes('Scope builder'));

await go(page, 'metrics');
ck('nav marks the active page',
  (await page.locator('.nav-item.is-active').getAttribute('data-page')) === 'metrics');
ck('only one page active at a time', (await page.locator('.nav-item.is-active').count()) === 1);
ck('health row persists across pages', await vis('#health-row'));
await go(page, 'overview');

// --- reset ---
await page.locator('#reset-all').click();
await page.waitForTimeout(400);
ck('reset returns to prompt state', (await page.locator('body').getAttribute('class')).includes('state-prompt'));
ck('reset hides the sidebar', !(await vis('#sidenav')));
ck('after reset the input is back in the center column', (await page.locator('#rail #input-panel').count()) === 1 && await vis('#notes'));
ck('the start screen keeps slightly rounded corners', await page.evaluate(() => {
  const r = (s) => parseFloat(getComputedStyle(document.querySelector(s)).borderTopLeftRadius);
  return r('#input-panel') === 10 && r('#run') === 6 && r('#notes') === 6 && r('#open-example') === 6;
}));
ck('developer\'s notes sit at the top right of the start screen, open', (await vis('#devnotes-body'))
  && await page.locator('#devnotes').evaluate((e) => { const r = e.getBoundingClientRect(); return r.top < 40 && r.right > innerWidth - 40; }));
ck('without the scoring notes', (await vis('.dn-sec[data-sec="how-to-use-scope-builder"]'))
  && !(await vis('.dn-sec[data-sec="notes-on-scoring"]')));
await page.locator('#devnotes .panel-head').click();
await page.waitForTimeout(200);
ck('they close to a pill with the text level with the arrow', !(await vis('#devnotes-body')) && await page.evaluate(() => {
  const mid = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.top + r.height / 2; };
  return Math.abs(mid('#devnotes h2') - mid('#devnotes-toggle')) < 1.5;
}));
await page.locator('#devnotes .panel-head').click();
ck('reset clears the box', (await page.locator('#notes').inputValue()) === '');

ck('no JS errors', errors.length === 0);
const bad = report(checks, errors);
await browser.close();
process.exit(bad ? 1 : 0);
