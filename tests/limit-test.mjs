// The daily build limit: each Evaluate or Scan is one build, a visitor (by
// internet address) gets BUILD_LIMIT a day, counted in Redis when one is
// connected. Spins up its own app server and a stand-in for Upstash's REST
// API on spare ports, so it never touches a running instance or spends anything.
import http from 'http';
import { spawn } from 'child_process';
import { open, fillExample, go, report } from './lib.mjs';

const APP = 3293, REDIS = 3294;
const checks = []; const ck = (n, v) => checks.push([n, v]);
const NOTES = 'We are migrating the billing dashboard off the legacy data model. Eng says six weeks. Finance depends on it daily and Q3 close is blocked.';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in for Upstash: /pipeline takes [["INCR", k], ["EXPIRE", k, s]] or [["GET", k]].
const store = new Map();
let redisCalls = 0;
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    redisCalls++;
    if (req.headers.authorization !== 'Bearer test-token' || req.url !== '/pipeline') { res.writeHead(401); return res.end('[]'); }
    const out = JSON.parse(raw).map(([cmd, key]) => {
      if (cmd === 'INCR') { store.set(key, (store.get(key) || 0) + 1); return { result: store.get(key) }; }
      if (cmd === 'GET') return { result: store.has(key) ? String(store.get(key)) : null };
      return { result: 1 };
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
}).listen(REDIS);

const app = spawn('node', ['../server.js'], {
  env: { ...process.env, MOCK: '1', PORT: String(APP), BUILD_LIMIT: '2', KV_REST_API_URL: `http://localhost:${REDIS}`, KV_REST_API_TOKEN: 'test-token' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
app.stdout.on('data', (d) => { log += d; });
await wait(1400);
ck('the server says the limit is on, counted in Redis', /Build limit: 2 a day per visitor \(Redis\)/.test(log));

const ask = async (path, body, ip = '203.0.113.7') => (await fetch(`http://localhost:${APP}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body),
})).json();

// --- through the page: an Evaluate is one build, a Scan another, then no more ---
const { browser, page, errors } = await open({ viewport: { width: 1600, height: 1000 } });
await page.setExtraHTTPHeaders({ 'x-forwarded-for': '198.51.100.20' });
await page.goto(`http://localhost:${APP}/`);
await page.waitForTimeout(800);
await fillExample(page);
await page.locator('#run').click();
await page.locator('#questions-panel').waitFor({ state: 'visible', timeout: 20000 });
await page.locator('#q-skip-all').click({ force: true });
await page.locator('#health-row').waitFor({ state: 'visible', timeout: 30000 });
ck('the first build goes through', (await page.locator('body').getAttribute('class')).includes('state-board'));
await page.waitForTimeout(600);
await go(page, 'overview');
await page.locator('#add-notes').fill('The export is in scope.');
await page.locator('#scan').click();
await page.locator('#switcher-meta').filter({ hasText: '2 versions' }).waitFor({ timeout: 30000 });
ck('a scan is the second build', true);
await page.locator('#add-notes').fill('Training moved a week.');
await page.locator('#scan').click();
await page.waitForTimeout(1200);
const msg = await page.locator('#add-status').innerText();
ck('the third is refused with a plain reason', /today's 2 builds used/.test(msg) && /reset tomorrow/.test(msg) && /example/.test(msg));
ck('and no version is added', /2 versions/.test(await page.locator('#switcher-meta').innerText()));
ck('the typed context is kept for tomorrow', (await page.locator('#add-notes').inputValue()) === 'Training moved a week.');

// On the start page, a new Evaluate is refused before any questions are asked.
await page.locator('#brand-home').click();
await page.waitForTimeout(600);
await fillExample(page);
await page.locator('#run').click();
await page.waitForTimeout(1500);
ck('a new Evaluate is refused up front, on the start page', await page.locator('#error').isVisible()
  && /builds used/.test(await page.locator('#error').innerText()) && !(await page.locator('#questions-panel').isVisible()));
ck('the example still opens', await (async () => {
  await page.locator('#open-example').click();
  await page.locator('body.state-board').waitFor({ timeout: 10000 });
  return true;
})());
ck('no JS errors', errors.length === 0);
await browser.close();

// --- per visitor, and the questions call cannot be used on its own ---
let r = await ask('/api/plan', { notes: NOTES }, '192.0.2.50');
ck('another visitor has their own count', !r.blocked && !!r.program);
for (let i = 0; i < 5; i++) r = await ask('/api/questions', { notes: NOTES }, '192.0.2.99');
// Questions are allowed twice the build limit (4 here); the fifth is refused.
ck('questions alone are capped too', r.blocked === true && r.limited === true);
ck('the counts were kept in Redis', redisCalls > 0 && [...store.keys()].every((k) => /^sb:(build|ask):\d{4}-\d{2}-\d{2}:/.test(k)));

app.kill();
fake.close();
const bad = report(checks, []);
process.exit(bad ? 1 : 0);
