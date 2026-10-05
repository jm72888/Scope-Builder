// Server-level tests for the Jev gates. Spins up its own stub TypeSafe and its
// own app server on spare ports, so it never touches a running instance and
// never spends anything.
import { spawn } from 'child_process';
import { report } from './lib.mjs';

const APP = 3291, FAKE = 3292;
const checks = []; const ck = (n, v) => checks.push([n, v]);
const NOTES = 'We are migrating the billing dashboard off the legacy data model. Eng says six weeks. Finance depends on it daily and Q3 close is blocked.';

let procs = [];
function run(cmd, args, env) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = '';
  p.stdout.on('data', (d) => { p.log += d; });
  p.stderr.on('data', (d) => { p.log += d; });
  procs.push(p);
  return p;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function stop() {
  for (const p of procs) { try { p.kill(); } catch {} }
  procs = [];
  await wait(500);
}

async function boot({ noul, mode, key = 'stub', gates, url = `http://localhost:${FAKE}/` } = {}) {
  await stop();
  if (mode !== 'down') run('node', ['fake-typesafe.mjs'], { PORT: String(FAKE), NOUL: String(noul ?? 0.9), MODE: mode || 'ok' });
  const env = { MOCK: '1', PORT: String(APP), PROJECTS_DIR: '/tmp/pt-gate', TYPESAFE_URL: url, GATE_TIMEOUT_MS: '1200' };
  if (key) env.TYPESAFE_API_KEY = key;
  if (gates !== undefined) env.GATES = gates;
  const app = run('node', ['../server.js'], env);
  await wait(1400);
  return app;
}

async function ask(path, body) {
  const res = await fetch(`http://localhost:${APP}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}

// --- the gate does its job ---
await boot({ noul: 0.9 });
let r = await ask('/api/questions', { notes: NOTES });
ck('a real programme passes the gate', !r.blocked && Array.isArray(r.questions));

await boot({ noul: 0.05 });
r = await ask('/api/questions', { notes: NOTES });
ck('junk is blocked before Claude is called', r.blocked === true);
ck('a block explains itself', typeof r.reason === 'string' && r.reason.length > 30);

await boot({ noul: 0.1 });
r = await ask('/api/plan', { notes: NOTES, added: 'ok thanks', previousNotes: NOTES });
ck('filler context is blocked', r.blocked === true);

await boot({ noul: 0.85 });
r = await ask('/api/plan', { notes: NOTES, added: 'Sales Ops owns it', previousNotes: NOTES });
ck('real context gets through', !r.blocked && !!r.program);

await boot({ noul: 0.01 });
r = await ask('/api/plan', { notes: NOTES });
ck('a first run is never gated as an update', !r.blocked && !!r.program);

// --- every failure must fail OPEN ---
await boot({ noul: 0.01, mode: 'error' });
r = await ask('/api/questions', { notes: NOTES });
ck('TypeSafe 500: carries on', !r.blocked);

const t0 = Date.now();
await boot({ noul: 0.01, mode: 'hang' });
r = await ask('/api/questions', { notes: NOTES });
const held = Date.now() - t0;
ck('TypeSafe hangs: carries on', !r.blocked);
ck('and gives up near the timeout, not never', held < 9000);

await boot({ noul: 0.01, mode: 'down' });
r = await ask('/api/questions', { notes: NOTES });
ck('TypeSafe unreachable: carries on', !r.blocked);

const noKey = await boot({ noul: 0.01, key: null, mode: 'down' });
r = await ask('/api/questions', { notes: NOTES });
ck('no API key: carries on', !r.blocked);
ck('and says why the gates are off', noKey.log.includes('off (no TYPESAFE_API_KEY)'));

const off = await boot({ noul: 0.01, gates: '0' });
r = await ask('/api/questions', { notes: NOTES });
ck('GATES=0 kill switch: carries on', !r.blocked);
ck('and names the kill switch', off.log.includes('off (GATES=0)'));

await stop();
const bad = report(checks, []);
process.exit(bad ? 1 : 0);
