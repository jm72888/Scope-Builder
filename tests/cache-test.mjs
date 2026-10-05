// Prompt caching, checked against a stand-in Claude API so nothing is spent.
// The breakpoint must sit on the instructions (identical every call), never on
// the notes (different every call), and the cache numbers must reach the log.
import http from 'http';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { report } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = []; const ck = (n, v) => checks.push([n, v]);
const bodies = [];
let call = 0;

// The stand-in: records each request, answers the first as a cache write and
// every later one as a cache read, the way the real API would.
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    bodies.push(JSON.parse(raw));
    call++;
    const usage = call === 1
      ? { input_tokens: 120, output_tokens: 40, cache_creation_input_tokens: 2300, cache_read_input_tokens: 0 }
      : { input_tokens: 120, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 2300 };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ stop_reason: 'end_turn', usage, content: [{ type: 'text', text: '{"program":"Test","questions":[]}' }] }));
  });
});
await new Promise((r) => fake.listen(3299, r));

async function runServer(extraEnv) {
  const env = { PATH: process.env.PATH, PORT: '3212', API_URL: 'http://127.0.0.1:3299/v1/messages',
    ANTHROPIC_API_KEY: 'test-key-not-real', PROJECTS_DIR: '/tmp/pt-cache', ...extraEnv };
  const proc = spawn('node', ['server.js'], { cwd: root, env });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50 && !/running at/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
  return { proc, log: () => log };
}

const post = (p, body) => fetch('http://127.0.0.1:3212' + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

const notes = 'Billing dashboard migration. Eng says 6 weeks. Q3 close is Sept 30, hard date. Support owner unknown.';
let s = await runServer({});
await post('/api/questions', { notes });
await post('/api/plan', { notes, answers: [] });
await post('/api/plan', { notes: notes + ' Also: training booked.', answers: [] });

const planCall = bodies[1];
ck('the instructions are sent as a cached block', Array.isArray(planCall.system)
  && planCall.system.length === 1 && planCall.system[0].cache_control && planCall.system[0].cache_control.type === 'ephemeral');
ck('the cached block is the instructions themselves', /raise the score|`raise`/i.test(planCall.system[0].text));
ck('the notes are never marked for caching', bodies.every((b) => typeof b.messages[0].content === 'string'));
ck('no automatic cache marker on the request', bodies.every((b) => b.cache_control === undefined));
ck('the questions call is marked too (skipped for free if too short)', !!bodies[0].system[0].cache_control);
ck('two plan calls send identical instructions, so the second can reuse the first',
  bodies[1].system[0].text === bodies[2].system[0].text);
ck('the 5-minute cache is the default', !bodies[1].system[0].cache_control.ttl);
ck('the log shows the cache write', /cache write 2300/.test(s.log()));
ck('the log shows the cache read', /cache read 2300/.test(s.log()));
ck('startup reports the cache setting', /prompt cache: 5m/.test(s.log()));
s.proc.kill();

// The 1-hour option.
bodies.length = 0;
await new Promise((r) => setTimeout(r, 300));
s = await runServer({ CACHE_TTL: '1h' });
await post('/api/plan', { notes, answers: [] });
ck('CACHE_TTL=1h asks for the 1-hour cache', bodies[0] && bodies[0].system[0].cache_control.ttl === '1h');
s.proc.kill();
fake.close();

const bad = report(checks, []);
process.exit(bad ? 1 : 0);
