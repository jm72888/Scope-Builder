// Builds a demo project with a realistic history, so the dashboard can be
// browsed in MOCK mode with every section populated and nothing spent.
// Writes into demo-projects/, never into your real projects/ folder.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// fileURLToPath, not .pathname: the folder name has a space, which the URL
// form encodes as %20 and the filesystem then cannot find.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const body = src.slice(src.indexOf('function mockPlan'), src.indexOf('const server = http.createServer'));
const base = new Function(body + '\nreturn mockPlan();')();

const clone = (o) => JSON.parse(JSON.stringify(o));
const W = { content: 2, communication: 1.5, schedule: 1, metrics: 1 };
const sum = Object.values(W).reduce((a, b) => a + b, 0);
const score = (p) => Math.round(Object.keys(W).reduce((t, k) => t + p[k].value * W[k], 0) / sum);

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const notes = fs.readFileSync(path.join(root, 'examples.txt'), 'utf8').split('\n---\n')[1].trim();

// The directory, as if someone had worked on it.
const people = [
  { id: 'p-support', name: 'Support lead', role: 'Head of Support', email: 'support.lead@example.com', slack: '@support-lead', directory: '' },
  { id: 'p-finops', name: 'Finance ops', role: 'Finance operations', email: '', slack: '', directory: '' },
  { id: 'p-vpf', name: 'VP of Finance', role: 'VP Finance', email: 'vp.finance@example.com', slack: '', directory: 'https://example.com/directory/vp-finance' },
  { id: 'p-eng', name: 'Eng lead', role: 'Engineering manager', email: '', slack: '@eng-lead', directory: '' },
];
const idFor = (name) => (people.find((p) => p.name === name) || {}).id || '';
let n = 0;
const itemsFrom = (plan) => plan.open_items.map((i) => ({ id: 'i-demo' + (++n), section: i.section, task: i.task, owner: idFor(i.owner) }));

// v1: the first evaluation, straight from the fixture.
const v1plan = clone(base);

// v2: after the export scope was settled and the regional leads were briefed.
const v2plan = clone(base);
v2plan.content = { ...v2plan.content, value: 62, evidence: 'You confirmed: the export button is in scope for Sept 30' };
v2plan.communication = { ...v2plan.communication, value: 55, evidence: 'You confirmed: regional leads briefed on the 12th' };
v2plan.missing = v2plan.missing.filter((m) => !/in or out of scope|regional finance/.test(m.ask));
v2plan.open_items = v2plan.open_items
  .filter((i) => !/^Decide whether the export button|^Walk the regional finance leads/.test(i.task))
  .map((i) => (/^Name an owner for the build/.test(i.task) ? { ...i, owner: 'Eng lead' } : i));
v2plan.open_items.push({ section: 'communication', task: 'Send regional leads the go-live checklist', owner: 'Finance ops' });
v2plan.summary = { ...v2plan.summary,
  risk: 'Nobody is named to report reconciliation progress, so a slip will surface late.',
  ask: 'Can you name who reports reconciliation progress each week, yes or no?' };

const v1 = { n: 1, at: hoursAgo(26), notes, score: score(v1plan), plan: v1plan, items: itemsFrom(v1plan) };
const v2 = { n: 2, at: hoursAgo(3),
  notes: notes + '\n\nAlso: Met with the VP of Finance this morning and the CSV export button is officially in scope for Sept 30, so eng builds it instead of us writing a workaround guide. Regional finance leads were briefed on the 12th, and the EMEA and APAC leads asked for their own walkthrough because they reconcile in local currency before converting. Support finally named a tier 2 lead as the owner for agent training, and they want the session recorded so later hires can watch it. Data eng also flagged that the historical invoice backfill could slip a week if the 2023 records need cleanup, which would squeeze the window before go-live.',
  added: 'Met with the VP of Finance this morning and the CSV export button is officially in scope for Sept 30, so eng builds it instead of us writing a workaround guide. Regional finance leads were briefed on the 12th, and the EMEA and APAC leads asked for their own walkthrough because they reconcile in local currency before converting. Support finally named a tier 2 lead as the owner for agent training, and they want the session recorded so later hires can watch it. Data eng also flagged that the historical invoice backfill could slip a week if the 2023 records need cleanup, which would squeeze the window before go-live.',
  score: score(v2plan), plan: v2plan, items: itemsFrom(v2plan) };

const project = {
  id: 'demo-billing-dashboard-migration',
  name: v2plan.program,
  updated: hoursAgo(3),
  versions: [v1, v2],
  activity: [
    { at: hoursAgo(3), kind: 'updated', text: `Updated with new context: ${v1.score}% to ${v2.score}%`,
      details: [`Development ${v1plan.content.value}% to ${v2plan.content.value}%`,
                `Communication ${v1plan.communication.value}% to ${v2plan.communication.value}%`,
                'Answered: Is the export button in or out of scope for Sept 30?',
                'Answered: Which regional finance leads use the dashboard differently?', '1 new open item'] },
    { at: hoursAgo(3), kind: 'owner', text: 'Name an owner for the build on the engineering side: assigned to Eng lead' },
    { at: hoursAgo(3), kind: 'reopened', text: 'Open item removed: Decide whether the export button ships before go-live' },
    { at: hoursAgo(26), kind: 'evaluated', text: `Evaluated: ${v1.score}%` },
  ],
};

const dir = path.join(root, 'demo-projects');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, project.id + '.json'), JSON.stringify(project, null, 2));
fs.writeFileSync(path.join(root, 'demo-people.json'), JSON.stringify({ people }, null, 2));
console.log(`demo project: ${project.name}, v1 ${v1.score}% -> v2 ${v2.score}%, ${project.activity.length} changes`);
