// Scope builder: the server-side work, shared by the local server (server.js)
// and the Vercel functions in api/. It calls Claude so the key never reaches
// the browser, serves MOCK fixtures, and enforces the daily build limit.
// Projects and people are not here: they live in each visitor's browser.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || 'claude-sonnet-5-5';
const EFFORT = process.env.EFFORT || 'low';
const MOCK = process.env.MOCK === '1';

// Jev gates: cheap judgments that decide whether a Claude call is worth making.
// Every gate fails OPEN. If TypeSafe is slow, down, or unconfigured, the run
// proceeds as it always did. A cost optimization that breaks the tool when a
// third party has a bad day is not one.
const TYPESAFE_KEY = process.env.TYPESAFE_API_KEY;
const TYPESAFE_URL = process.env.TYPESAFE_URL || 'https://api.typesafe.ai/v1/systemone';
const GATES = process.env.GATES !== '0' && !!TYPESAFE_KEY;

// Starting points, not settled values. Both are cheap to be wrong about in one
// direction only: blocking a real run is worse than allowing a pointless one,
// so both sit low enough to let anything arguable through.
const T_IS_PROGRAMME = Number(process.env.T_IS_PROGRAMME || 0.35);
const T_ADDS_SOMETHING = Number(process.env.T_ADDS_SOMETHING || 0.4);
const GATE_TIMEOUT_MS = Number(process.env.GATE_TIMEOUT_MS || 4000);

async function askJev(state, questions) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GATE_TIMEOUT_MS);
  try {
    const res = await fetch(TYPESAFE_URL, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TYPESAFE_KEY },
      body: JSON.stringify({ state, model: 'jev-latest', questions }),
    });
    if (!res.ok) throw new Error('TypeSafe returned ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Returns null to mean "carry on", or a reason string to mean "do not spend".
async function gateNewNotes(notes) {
  if (!GATES) return null;
  try {
    const out = await askJev(notes, {
      is_programme: {
        type: 'noul',
        instructions: 'Does this text describe a specific piece of work, project or program that someone is planning or running?',
        criteria: {
          true: 'Describes work with any of: a goal, a team, a system, a date, people involved, or a decision to make. Rough, unfinished and badly written all still count.',
          false: 'Too short or too vague to describe any particular piece of work. A bare URL, a greeting, a single phrase, placeholder text, or an unrelated note.',
        },
      },
    });
    const p = out?.answers?.is_programme?.noul;
    if (typeof p !== 'number') return null;
    console.log('  gate  is_programme ' + p.toFixed(2));
    return p < T_IS_PROGRAMME
      ? "That does not look like a description of a piece of work yet. Add what it is, who is involved, or what has to happen, and try again."
      : null;
  } catch (err) {
    console.log('  gate  skipped (' + err.message + ')');
    return null;
  }
}

async function gateAddedContext(notes, added) {
  if (!GATES) return null;
  try {
    const out = await askJev({ existing_notes: notes, newly_added: added }, {
      adds_something: {
        type: 'noul',
        instructions: 'Does `newly_added` state a fact that `existing_notes` does not already contain, or answer a question the notes leave open?',
        criteria: {
          true: 'Names a person, team, date, number, decision, constraint or dependency that is new, or contradicts or corrects something in the existing notes.',
          false: 'Acknowledgement, filler, a restatement of what the notes already say, or a note that the writer does not know yet.',
        },
      },
    });
    const p = out?.answers?.adds_something?.noul;
    if (typeof p !== 'number') return null;
    console.log('  gate  adds_something ' + p.toFixed(2));
    return p < T_ADDS_SOMETHING
      ? "That does not add anything the plan does not already have, so nothing was rebuilt. Answer one of the open questions above and it will be."
      : null;
  } catch (err) {
    console.log('  gate  skipped (' + err.message + ')');
    return null;
  }
}

// Longer context for the sample rows, so MOCK runs show expanded rows as a
// real build would fill them.
function sampleDetails() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'example', 'sample-details.json'), 'utf8')).details || {}; }
  catch { return {}; }
}
function withSampleDetails(list) {
  const map = sampleDetails();
  return (list || []).map((d) => ({ ...d, details: d.details || map[String(d.title || '').toLowerCase()] || '' }));
}

// "claude-sonnet-5-5" reads as "Claude Sonnet 5.5" in the header. Trailing date
// snapshots (claude-sonnet-4-5-20250929) are dropped, they are not the version.
function modelLabel(id) {
  const family = ['Opus', 'Sonnet', 'Haiku', 'Fable', 'Mythos'].find((f) => id.includes(f.toLowerCase()));
  if (!family) return id;
  const version = id
    .replace(/^claude-/, '')
    .replace(new RegExp('^' + family.toLowerCase() + '-?'), '')
    .split('-')
    .filter((part) => /^\d+$/.test(part) && part.length <= 2)
    .join('.');
  return version ? `Claude ${family} ${version}` : `Claude ${family}`;
}

// Connected means a real call would reach the API: a key is present and we are
// not serving fixtures. It does not claim the last call succeeded; the page
// downgrades this to disconnected the moment one actually fails.
function connectionStatus() {
  if (MOCK) return { connected: false, reason: 'Mock mode, serving fixtures' };
  if (!API_KEY) return { connected: false, reason: 'No ANTHROPIC_API_KEY set' };
  return { connected: true, reason: 'API key loaded' };
}

// Prompt caching. The instructions are identical on every call and the notes
// never are, so the cache breakpoint goes on the instructions (the system
// block), not on the notes. Automatic caching would put it on the last block,
// the notes, and pay for a cache write every run without ever reading one.
// A prefix shorter than the model's minimum (512 tokens on Sonnet 5.5) is
// simply not cached, at no cost, so the short questions prompt is harmless.
// CACHE_TTL=1h keeps entries for an hour at a higher write price; 5m is default.
const CACHE_TTL = process.env.CACHE_TTL === '1h' ? '1h' : '5m';
const API_URL = process.env.API_URL || 'https://api.anthropic.com/v1/messages';

function cachedSystem(text) {
  const cache = CACHE_TTL === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
  return [{ type: 'text', text, cache_control: cache }];
}

async function callClaude(system, user, maxTokens) {
  if (!API_KEY) {
    throw new Error('No ANTHROPIC_API_KEY set. See readme.md for how to add one.');
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      // Low effort: this is structured extraction and short-form writing, not
      // deep reasoning. At the default, adaptive thinking spent ~2,400 output
      // tokens per run that nobody ever sees, and sometimes ran the response
      // into the max_tokens ceiling mid-JSON.
      output_config: { effort: EFFORT },
      system: cachedSystem(system),
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error('Claude API returned ' + res.status + ': ' + body.slice(0, 400));
  }
  const data = await res.json();
  if (data.stop_reason === 'max_tokens') {
    throw new Error('The response was cut off. Try fewer programs, or shorter notes.');
  }
  const u = data.usage || {};
  const think = (u.output_tokens_details || {}).thinking_tokens || 0;
  const read = u.cache_read_input_tokens || 0;
  const wrote = u.cache_creation_input_tokens || 0;
  console.log('  tokens  in ' + (u.input_tokens || 0) + '  out ' + (u.output_tokens || 0) +
    (read ? '  cache read ' + read : '') + (wrote ? '  cache write ' + wrote : '') +
    (think ? '  (thinking ' + think + ')' : ''));
  return data.content.map((block) => block.text || '').join('');
}

// The model is told to return JSON only, but a stray sentence or code fence
// shouldn't break the demo.
function parseJson(text) {
  let t = text.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) t = fenced[1].trim();
  const open = t.indexOf('{');
  const close = t.lastIndexOf('}');
  if (open !== -1 && close > open) t = t.slice(open, close + 1);
  return JSON.parse(t);
}

// ---------- fixtures for MOCK=1 ----------

function mockQuestions() {
  return { needed: true, questions: [
    { id: 'q1', question: 'Who owns this on the Support side?', why: 'Decides whether agent training can be committed to a date',
      options: ['The Support lead', 'Someone on the Support team, not yet named', 'Nobody yet, needs assigning'] },
    { id: 'q2', question: 'Does the new dashboard need the export button before go-live?', why: 'Half of Finance reconciles through it',
      options: ['Yes, it blocks go-live', 'No, a manual workaround is acceptable for Q3', 'Unknown, needs a call with Finance'] },
    { id: 'q3', question: 'Is Sept 30 movable if the build slips?', why: 'Determines whether scope or date gives first',
      options: ['No, Q3 close is fixed', 'It could move a week', 'Not my call, the VP of Finance decides'] },
  ] };
}

function mockPlan() {
  // Target dates sit well clear of today, so the fixture carries no date risk.
  // Local dates, as the app reads them; UTC would be a day off in the evening.
  const inDays = (n) => { const t = new Date(Date.now() + n * 86400000); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  return {
    program: 'Billing dashboard migration',
    brief: 'Moving the billing dashboard onto the new revenue data model, so Finance can close the quarter from one set of numbers. Engineering is doing the build, Finance teams in every region rely on the dashboard to reconcile, and Support handles the questions that come in once it changes. It has to be live before Q3 close on Sept 30.',
    content: { value: 25, evidence: '"eng says 6 weeks, could be 8"', inferred: false,
      raise: ['Decide whether the export button ships before go-live', 'Agree which reports the export must produce', 'Name an engineering owner for the build'] },
    communication: { value: 20, evidence: '"also need to loop in the regional finance leads at some point"', inferred: false,
      raise: ['Walk the regional finance leads through what changes', 'Send Support agents the go-live date and changes', 'Write down who tells each group what, and when'] },
    schedule: { value: 88, evidence: '"Q3 close is Sept 30, hard date"', inferred: false,
      raise: ['Confirm Sept 30 in writing with Support and the regions', 'Agree what drops if the build slips'] },
    metrics: { value: 15, evidence: 'Not stated. Assumed no measure beyond hitting the date', inferred: true,
      raise: ['Define what counts as a completed reconciliation', 'Name who reports reconciliation progress each week', 'Set a target for dashboard support tickets'] },
    summary: {
      call: 'Commit to the migration for Sept 30, with the export button in scope.',
      risk: 'Support has no named owner, so agent training has no one to schedule it.',
      ask: 'Can you name a Support owner this week so training can be booked?',
    },
    stakeholders: [
      { name: 'VP of Finance', bucket: 'champion', note: 'Escalated twice; Q3 close depends on it', ask: 'Confirm Sept 30 is immovable' },
      { name: 'Support lead', bucket: 'unknown', note: 'Says fine, likely has not reviewed agent impact', ask: 'Name an owner on their team' },
      { name: 'Eng team', bucket: 'informed', note: 'Doing the build, gave the 6-8 week estimate', ask: 'Confirm export button scope' },
      { name: 'Regional finance leads', bucket: 'unknown', note: 'Use the dashboard differently, not yet told', ask: 'Thirty minutes to walk their workflow' },
    ],
    comms: [
      { when: 'Week 0', who: 'VP of Finance', what: 'Lock Sept 30 and confirm export button is in scope', channel: '1:1' },
      { when: 'Week 0', who: 'Support lead', what: 'Walk the agent-facing changes, ask for a named owner', channel: '1:1' },
      { when: 'Week 1', who: 'Eng team', what: 'Scope walkthrough with the export requirement confirmed', channel: 'Working session' },
      { when: 'Week 2', who: 'Regional finance leads', what: 'Show what changes for their workflow, gather objections early', channel: 'Demo call' },
      { when: 'Week 4', who: 'Finance and Support', what: 'Go-live date, training dates, what breaks and when', channel: 'Email + all-hands' },
    ],
    enablement: [
      'Export workaround documented before go-live, owned by Finance ops',
      'Thirty-minute agent walkthrough for Support, recorded for later hires',
      'Support on-call schedule staffed for two weeks after go-live',
    ],
    measures: [
      { title: 'Support owner named and confirmed', phase: 'on_track', kind: 'support', notes: 'A named person, not the team', target: inDays(5), status: 'in_progress', owner: 'Support lead' },
      { title: 'Regional finance leads walked through', phase: 'on_track', kind: 'adoption', notes: 'All of them, non-US first', target: inDays(19), status: 'not_started', owner: 'Finance ops' },
      { title: 'Export workaround documented and signed off', phase: 'on_track', kind: 'quality', notes: '', target: null, status: 'not_started', owner: null },
      { title: 'Reconciliations completed in the new tool', phase: 'outcome', kind: 'adoption', notes: '100% of monthly reconciliations', target: inDays(40), status: 'not_started', owner: 'Finance ops' },
      { title: 'Support tickets about the dashboard', phase: 'outcome', kind: 'support', notes: 'Under 10 a week', target: inDays(45), status: 'not_started', owner: null },
      { title: 'Hours of manual reconciliation per week', phase: 'outcome', kind: 'speed', notes: 'Down from baseline', target: null, status: 'not_started', owner: null },
    ],
    tracking: [
      { metric: 'Support owner named and confirmed', check: 'Weekly', target: 'By end of week 1', bad: 'Training cannot be scheduled' },
      { metric: 'Regional finance leads walked through', check: 'Weekly', target: 'All of them by week 3', bad: 'They will escalate post-launch' },
      { metric: 'Export workaround documented and signed off', check: 'At each milestone', target: 'Before build locks', bad: 'Go-live date is at risk' },
    ],
    success: [
      { metric: 'Finance reconciliations completed in new tool', target: '100% by Sept 28', bad: 'Export gap is still blocking' },
      { metric: 'Support tickets about the dashboard', target: 'Under 10 per week by week 2', bad: 'Training did not land' },
      { metric: 'Hours of manual reconciliation per week', target: 'Down from baseline by Q4', bad: 'The migration bought nothing' },
    ],
    deliverables: [
      { title: 'Dashboard on the new revenue data model', kind: 'feature', status: 'in_progress', notes: 'Eng estimate is 6 to 8 weeks', target: inDays(18), owner: 'Eng team' },
      { title: 'Export button for Finance reconciliation', kind: 'feature', status: 'not_started', notes: 'Half of Finance reconciles through it', target: inDays(30), owner: 'Eng team' },
      { title: 'Billing to revenue model data pipeline', kind: 'integration', status: 'in_progress', notes: 'Historical invoices are the messy part', target: inDays(16), owner: null },
      { title: 'Export workaround guide for Finance', kind: 'document', status: 'not_started', notes: '', target: inDays(25), owner: 'Finance ops' },
      { title: 'Agent walkthrough for Support', kind: 'training', status: 'not_started', notes: 'Thirty minutes, recorded for later hires', target: inDays(21), owner: 'Support lead' },
      { title: 'Go-live FAQ for regional finance leads', kind: 'content', status: 'not_started', notes: '', target: inDays(40), owner: null },
      { title: 'Weekly reconciliation check report', kind: 'data', status: 'not_started', notes: '', owner: 'Finance ops' },
    ],
    milestones: [
      { title: 'Export scope and date locked', note: 'VP of Finance confirms the export is in', date: inDays(5) },
      { title: 'Data pipeline backfill complete', note: 'All historical invoices on the new model', date: inDays(16) },
      { title: 'Agent training delivered', note: '', date: inDays(21) },
      { title: 'Regional leads sign off', note: 'Every region walked through its workflow', date: inDays(24) },
      { title: 'Dashboard live for quarter close', note: 'Finance closes from one set of numbers', date: inDays(28), final: true },
    ],
    communications: [
      { title: 'Scope and date briefing for the VP of Finance', kind: 'presentation', status: 'not_started', notes: 'Lock Sept 30 and the export scope', target: inDays(20), owner: 'VP of Finance' },
      { title: 'Agent walkthrough of the changes', kind: 'training_session', status: 'not_started', notes: 'Ask Support for a named owner', target: inDays(21), owner: 'Support lead' },
      { title: 'Workflow demo for regional finance leads', kind: 'demo', status: 'not_started', notes: 'Gather objections before the build locks', target: inDays(24), owner: null },
      { title: 'Go-live announcement to Finance and Support', kind: 'announcement', status: 'not_started', notes: 'Date, training dates, what breaks and when', target: inDays(26), owner: null },
      { title: 'Feedback session after the first close', kind: 'feedback', status: 'not_started', notes: '', target: inDays(35), owner: 'Finance ops' },
      { title: 'Weekly migration update email', kind: 'email', status: 'not_started', notes: '', owner: 'Eng team' },
    ],
    open_items: [
      { section: 'metrics', task: 'Define what counts as a completed reconciliation', owner: 'Finance ops' },
      { section: 'metrics', task: 'Name who reports reconciliation progress each week', owner: null },
    ],
    risks: [
      { risk: 'Export button slips and Finance cannot reconcile', mitigation: 'Confirm scope with eng in week 1, document a manual fallback' },
      { risk: 'Support agents hit the change untrained', mitigation: 'Named owner by end of week 0, training booked week 4' },
      { risk: 'A region surfaces a workflow gap after go-live', mitigation: 'Demo to regional leads in week 2, before the build locks' },
    ],
  };
}

// ---------- the daily build limit ----------
// Each Evaluate or Scan is one build: one call to /api/plan. A visitor (by
// internet address) gets BUILD_LIMIT a day. The count lives in Upstash Redis
// when it is connected (Vercel forgets everything between requests), and in
// memory otherwise, which is enough for a local server. On Vercel the limit
// defaults to 3; locally it is off unless BUILD_LIMIT is set.
const BUILD_LIMIT = Number(process.env.BUILD_LIMIT || (process.env.VERCEL ? 3 : 0));
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const memoryCounts = new Map();

const LIMIT_REASON = () => `That's today's ${BUILD_LIMIT} builds used. They reset tomorrow. In the meantime, open the example on the start page to explore everything.`;

function visitorOf(headers) {
  const fwd = String((headers || {})['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || String((headers || {})['x-real-ip'] || 'local');
}

function dayKey(kind, visitor) {
  return `sb:${kind}:${new Date().toISOString().slice(0, 10)}:${visitor}`;
}

async function redis(commands) {
  const res = await fetch(REDIS_URL.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + REDIS_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error('Redis returned ' + res.status);
  return (await res.json()).map((x) => x.result);
}

// Count one more of `kind` for this visitor today; returns the new count.
async function bump(kind, visitor) {
  const key = dayKey(kind, visitor);
  if (REDIS_URL && REDIS_TOKEN) {
    const [n] = await redis([['INCR', key], ['EXPIRE', key, 172800]]);
    return Number(n);
  }
  const n = (memoryCounts.get(key) || 0) + 1;
  memoryCounts.set(key, n);
  return n;
}

async function peek(kind, visitor) {
  const key = dayKey(kind, visitor);
  if (REDIS_URL && REDIS_TOKEN) {
    const [n] = await redis([['GET', key]]);
    return Number(n || 0);
  }
  return memoryCounts.get(key) || 0;
}

// ---------- the two calls ----------
// Each returns { status, body } so the local server and Vercel answer alike.

// Step 1: what's missing from these notes that would change the plan?
async function handleQuestions(body, headers) {
  const notes = String(body.notes || '').trim();
  if (notes.length < 40) return { status: 200, body: { needed: false, questions: [] } };
  if (BUILD_LIMIT) {
    const visitor = visitorOf(headers);
    // No point asking questions for a build that will be refused, and the
    // questions call has its own ceiling so it cannot be used on its own.
    if (await peek('build', visitor) >= BUILD_LIMIT || await bump('ask', visitor) > BUILD_LIMIT * 2) {
      return { status: 200, body: { blocked: true, limited: true, reason: LIMIT_REASON() } };
    }
  }
  const blocked = await gateNewNotes(notes);
  if (blocked) return { status: 200, body: { blocked: true, reason: blocked } };
  if (MOCK) return { status: 200, body: mockQuestions() };
  const prompt = fs.readFileSync(path.join(ROOT, 'questions-prompt.md'), 'utf8');
  const text = await callClaude(prompt, notes, 1500);
  return { status: 200, body: parseJson(text) };
}

// Step 2: the whole dashboard, in one call. Scoring lives in the browser.
async function handlePlan(body, headers) {
  const notes = String(body.notes || '').trim();
  if (!notes) return { status: 400, body: { error: 'Paste in a program first.' } };
  if (BUILD_LIMIT && await bump('build', visitorOf(headers)) > BUILD_LIMIT) {
    return { status: 200, body: { blocked: true, limited: true, reason: LIMIT_REASON() } };
  }
  // Only an update carries `added`, and only an update is worth gating:
  // a first run has nothing to compare against.
  if (body.added) {
    const blocked = await gateAddedContext(String(body.previousNotes || ''), String(body.added));
    if (blocked) return { status: 200, body: { blocked: true, reason: blocked } };
  }
  const items = Array.isArray(body.items) ? body.items : [];
  const deliverables = Array.isArray(body.deliverables) ? body.deliverables : [];
  const communications = Array.isArray(body.communications) ? body.communications : [];
  const milestones = Array.isArray(body.milestones) ? body.milestones : [];
  const measures = Array.isArray(body.measures) ? body.measures : [];
  // Demo mode stands in for Claude keeping the reviewed lists, as the prompt asks.
  if (MOCK) {
    const plan = mockPlan();
    if (items.length) plan.open_items = items;
    if (deliverables.length) plan.deliverables = deliverables;
    if (communications.length) plan.communications = communications;
    if (milestones.length) plan.milestones = milestones;
    if (measures.length) plan.measures = measures;
    for (const k of ['deliverables', 'communications', 'measures']) plan[k] = withSampleDetails(plan[k]);
    return { status: 200, body: plan };
  }
  const answers = Array.isArray(body.answers) ? body.answers : [];
  const answerText = answers.length
    ? '\n\nTHEY ANSWERED YOUR QUESTIONS:\n' +
      answers.map((a) => '- ' + a.question + '\n  ' + a.answer).join('\n')
    : '\n\nThey skipped the clarifying questions. Treat what they did not answer as a gap.';
  const unanswered = Array.isArray(body.unanswered) ? body.unanswered : [];
  const gapText = unanswered.length
    ? '\n\nLEFT UNANSWERED (these are gaps):\n' + unanswered.map((q) => '- ' + q).join('\n')
    : '';
  // A row's details travel with it; ones the person wrote are marked so
  // Claude returns them word for word.
  const detailsText = (d) => (d.details
    ? `\n    details${d.detailsEdited ? ' (written by the person; return word for word)' : ''}: ${String(d.details).replace(/\s+/g, ' ')}` : '');
  const itemText = items.length
    ? '\n\nCURRENT OPEN ITEMS (reviewed and edited by the person):\n' +
      items.map((i) => `- [${i.section}] ${i.task}` + (i.owner ? ` (owner: ${i.owner})` : ' (no owner)')).join('\n')
    : '';
  const dlvText = deliverables.length
    ? '\n\nCURRENT DELIVERABLES (tracked by the person; keep their statuses):\n' +
      deliverables.map((d) => `- [${d.kind}] ${d.title} | status: ${d.status}` + (d.target ? ` | target: ${d.target}` : '') + (d.owner ? ` | owner: ${d.owner}` : ' | no owner') + (d.notes ? ` | notes: ${d.notes}` : '') + detailsText(d)).join('\n')
    : '';
  const commText = communications.length
    ? '\n\nCURRENT COMMUNICATIONS (tracked by the person; keep their statuses):\n' +
      communications.map((d) => `- [${d.kind}] ${d.title} | status: ${d.status}` + (d.target ? ` | target: ${d.target}` : '') + (d.owner ? ` | owner: ${d.owner}` : ' | no owner') + (d.notes ? ` | notes: ${d.notes}` : '') + detailsText(d)).join('\n')
    : '';
  const measureText = measures.length
    ? '\n\nCURRENT METRICS (tracked by the person; keep their statuses):\n' +
      measures.map((d) => `- [${d.phase} / ${d.kind}] ${d.title} | status: ${d.status}` + (d.target ? ` | target: ${d.target}` : '') + (d.owner ? ` | owner: ${d.owner}` : ' | no owner') + (d.notes ? ` | notes: ${d.notes}` : '') + detailsText(d)).join('\n')
    : '';
  const msText = milestones.length
    ? '\n\nCURRENT MILESTONES (edited by the person; keep them and their dates):\n' +
      milestones.map((m) => `- ${m.title}` + (m.note ? ` (${m.note})` : '') + (m.date ? ` | ${m.date}` : ' | no date') + (m.final ? ' | final' : '')).join('\n')
    : '';
  const prompt = fs.readFileSync(path.join(ROOT, 'plan-prompt.md'), 'utf8');
  // Today's date, so relative dates in the notes ("in two weeks") can become target dates.
  const today = 'TODAY: ' + new Date().toISOString().slice(0, 10) + '\n\n';
  const text = await callClaude(prompt, today + 'THEIR NOTES:\n' + notes + answerText + gapText + itemText + dlvText + commText + measureText + msText, 12000);
  return { status: 200, body: parseJson(text) };
}

function handleStatus() {
  return { status: 200, body: { ...connectionStatus(), model: modelLabel(MODEL) } };
}

function describeSetup() {
  return [
    'Model: ' + MODEL + '  effort: ' + EFFORT + '  prompt cache: ' + CACHE_TTL,
    'Jev gates: ' + (GATES ? 'on' : process.env.GATES === '0' ? 'off (GATES=0)' : 'off (no TYPESAFE_API_KEY)'),
    'Build limit: ' + (BUILD_LIMIT ? BUILD_LIMIT + ' a day per visitor' + (REDIS_URL ? ' (Redis)' : ' (in memory)') : 'off'),
    MOCK ? 'MOCK mode: serving fixtures, no API calls, no cost' : (!API_KEY ? 'WARNING: ANTHROPIC_API_KEY is not set. See readme.md' : 'Live: calls Claude'),
  ];
}

module.exports = { handleQuestions, handlePlan, handleStatus, describeSetup };
