// Scope builder: browser side.
// The health arithmetic lives here on purpose: it is plain, readable, and anyone
// can check it against the numbers the model pulled out of the notes.

const el = (id) => document.getElementById(id);

// Higher is better on all four, so the score reads the same way as the pieces
// that make it: a high number is a healthy program. Each method says its own
// scale; every variable is shown as its position on that scale, in percent.

// The current method, in display order. Development carries the
// most: if nobody can say exactly what is being built, nothing else lands.
const HEALTH_VARS = [
  { key: 'content', label: 'Development', weight: 2 },
  { key: 'communication', label: 'Communication', weight: 1.5 },
  { key: 'metrics', label: 'Metrics', weight: 1 },
];
// Timeline (the milestones page, keyed 'schedule') is outside the scoring.

// Earlier methods, kept only so an old project still shows its own numbers
// under its own labels. Mapping old values onto new keys would be invented.
const PREVIOUS_VARS = [
  { key: 'alignment', label: 'Alignment & Ownership', weight: 2 },
  { key: 'communication', label: 'Communication', weight: 1.5 },
  { key: 'schedule', label: 'Schedule', weight: 1 },
  { key: 'metrics', label: 'Metrics', weight: 1 },
];

const LEGACY_VARS = [
  { key: 'alignment', label: 'Alignment', weight: 2 },
  { key: 'ownership', label: 'Ownership', weight: 1.5 },
  { key: 'simplicity', label: 'Simplicity', weight: 1.5 },
  { key: 'room', label: 'Schedule room', weight: 1 },
];

const METHODS = {
  current: { vars: HEALTH_VARS, min: 0, max: 100 },
  previous: { vars: PREVIOUS_VARS, min: 1, max: 10 },
  legacy: { vars: LEGACY_VARS, min: 1, max: 10 },
};

function methodFor(plan) {
  if (!plan || plan.content !== undefined) return METHODS.current;
  if (plan.communication !== undefined) return METHODS.previous;
  if (plan.room !== undefined) return METHODS.legacy;
  return METHODS.current;
}

function isLegacy(plan) {
  return methodFor(plan) !== METHODS.current;
}

function varsFor(plan) {
  return methodFor(plan).vars;
}

const BUCKETS = [
  { key: 'champion', label: 'Champions' },
  { key: 'resistant', label: 'Resistant' },
  { key: 'unknown', label: 'Position unknown' },
  { key: 'informed', label: 'Keep informed' },
];


let pendingQuestions = [];
let lastPlan = null;

/* ---------- projects ---------- */
// Projects and people live in this browser's localStorage, so each visitor
// sees only their own. LAST_KEY remembers which one was open, so a refresh
// lands you back where you were.

const LAST_KEY = 'program-triage:last';
let project = null;      // { id, name, versions: [...] }

function slug(text) {
  return String(text || 'program').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'program';
}

function newProjectId(name) {
  const stamp = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${slug(name)}-${rand}`;
}

// localStorage can throw in a private window, and a remembered id is a
// convenience, never state the app depends on.
function rememberLast(id) {
  try { localStorage.setItem(LAST_KEY, id); } catch {}
}

function recallLast() {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}

function forgetLast() {
  try { localStorage.removeItem(LAST_KEY); } catch {}
}

function latest(p) {
  const v = (p && p.versions) || [];
  return v[v.length - 1] || null;
}

function previous(p) {
  const v = (p && p.versions) || [];
  return v.length > 1 ? v[v.length - 2] : null;
}

async function saveProject(opts) {
  if (!project) return;
  try {
    await post('/api/projects/save', { project }, opts);
    rememberLast(project.id);
  } catch (err) {
    // A failed save must not destroy what is on screen.
    showError('Could not save this project: ' + err.message);
  }
}

// A finished evaluation becomes version 1 of a new project, or the next
// version of the open one.
function recordVersion(notes, plan, added) {
  const entry = {
    n: (project ? project.versions.length : 0) + 1,
    at: new Date().toISOString(),
    notes, plan,
  };
  if (added) entry.added = added;

  let before = null;
  if (!project) {
    project = { id: newProjectId(plan.program), name: plan.program || 'Program', versions: [entry], activity: [] };
  } else {
    before = latest(project);
    project.name = plan.program || project.name;
    project.versions.push(entry);
  }
  // The new version's tiles, items and milestones exist before it is scored,
  // since the score is worked out from them.
  seedItems(plan);
  seedBoards(plan);
  seedMilestones(plan);
  const live = liveAdjusted(plan);
  entry.score = healthScore(live);
  entry.areas = Object.fromEntries(HEALTH_VARS.map((v) => [v.key, pctOf(live, v.key)]));
  if (!before) logActivity('evaluated', `Evaluated: ${entry.score}%`);
  else {
    const d = describeUpdate(before, entry);
    logActivity('updated', d.text, d.details);
  }
  return entry;
}

// A variable's position on its method's scale, from 0 to 1.
function fractionOf(plan, key) {
  const m = methodFor(plan);
  let v = Number((plan[key] || {}).value);
  if (!Number.isFinite(v)) v = (m.min + m.max) / 2;
  v = Math.min(m.max, Math.max(m.min, v));
  return (v - m.min) / (m.max - m.min);
}

function pctOf(plan, key) {
  return Math.round(fractionOf(plan, key) * 100);
}

// The weighted average of the four, rounded once at the end. Derived from the
// weights, so changing a weight cannot silently skew it.
function healthScore(plan) {
  const vars = varsFor(plan);
  const sum = vars.reduce((t, v) => t + v.weight, 0);
  return Math.round((vars.reduce((t, v) => t + fractionOf(plan, v.key) * v.weight, 0) / sum) * 100);
}

function healthBand(score) {
  if (score >= 67) return 'healthy';
  if (score >= 34) return 'watch';
  return 'fragile';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}

function setStatus(msg) { el('status').textContent = msg; }

function showError(msg) {
  const box = el('error');
  box.textContent = msg;
  box.hidden = false;
}

const SCORE_PAGES = ['content', 'communication', 'schedule', 'metrics'];

const RESULT_SECTIONS = ['sec-overview', 'sec-milestones', 'sec-activity', 'sec-timeline',
  'sec-directory', 'sec-measures', 'sec-risks', 'sec-deliverables', 'sec-comm-board',
  'sec-ms-edit'];

// Which page each missing-context section belongs to, so a count lands on the
// page where answering it would actually change something.

function hideResults() {
  RESULT_SECTIONS.forEach((id) => { el(id).hidden = true; });
  el('health-row').hidden = true;
  el('add-card').hidden = true;
}

/* ---------- people and tasks ---------- */
// The directory is shared across projects; who owns what is per project and
// lives in the project's current version.

let people = [];

function personId() {
  return 'p-' + Math.random().toString(36).slice(2, 9);
}

async function loadPeople() {
  try {
    const res = await post('/api/people/list', {});
    people = Array.isArray(res.people) ? res.people : [];
  } catch {
    people = [];   // the directory is a convenience, not the work
  }
}

async function savePeople() {
  try {
    await post('/api/people/save', { people });
  } catch (err) {
    showError('Could not save the people directory: ' + err.message);
  }
}

function personById(id) {
  return people.find((p) => p.id === id) || null;
}

/* ---------- developer's notes ---------- */
// Read only in the app. The text lives in developer-notes.md beside the app;
// editing that file is the only way to change it. Blank lines separate
// paragraphs, "# " starts a heading, "- " a bullet and "1. " a numbered step.

// Escaped text, with any email address turned into a mail link.
function linkify(text) {
  return esc(text).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, (m) => `<a href="mailto:${m}">${m}</a>`);
}

async function loadDeveloperNotes() {
  try {
    const res = await fetch('developer-notes.md', { cache: 'no-store' });
    if (!res.ok) return;
    const text = (await res.text()).trim();
    if (!text) return;
    let open = false;
    const html = text.split(/\n\s*\n/).map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.every((l) => l.startsWith('- '))) return `<ul>${lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>`;
      if (lines.every((l) => /^\d+\.\s/.test(l))) return `<ol>${lines.map((l) => `<li>${linkify(l.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`;
      if (lines[0].startsWith('# ')) {
        // Each heading starts a section, tagged with its name so a page can
        // leave one out (the start page skips Notes on scoring).
        const title = lines[0].slice(2).trim();
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const head = (open ? '</div>' : '') + `<div class="dn-sec" data-sec="${esc(slug)}"><h3>${esc(title)}</h3>`;
        open = true;
        return head + (lines.length > 1 ? `<p>${linkify(lines.slice(1).join(' '))}</p>` : '');
      }
      // "\\- " at the start of a line shows a dash as written, not a bullet.
      return `<p>${linkify(lines.map((l) => l.replace(/^\\-/, '-')).join(' '))}</p>`;
    }).join('') + (open ? '</div>' : '');
    el('devnotes-body').innerHTML = html;
  } catch { /* the notes are optional */ }
}

/* ---------- undo ---------- */
// Every editable tile keeps its own history, newest last, up to UNDO_LIMIT
// steps. A burst of typing counts as one step, so one undo does not take back
// a single letter.

const UNDO_LIMIT = 20;
const undoStacks = {};
const bursts = {};

function pushUndo(key, snap) {
  const stack = (undoStacks[key] = undoStacks[key] || []);
  stack.push(snap);
  if (stack.length > UNDO_LIMIT) stack.shift();
  renderUndo(key);
}

function renderUndo(key) {
  const n = (undoStacks[key] || []).length;
  document.querySelectorAll(`.undo-btn[data-undo="${key}"]`).forEach((b) => {
    b.disabled = n === 0;
    b.title = n ? `Undo the last change (${n} step${n === 1 ? '' : 's'} back available)` : 'Nothing to undo';
  });
}

function clearUndo(keys) {
  for (const k of keys) {
    delete undoStacks[k];
    endBurst(k);
    if (k in lastText) lastText[k] = el(k).value;   // the new starting point
    renderUndo(k);
  }
}

const PLAN_UNDO_KEYS = () => ['notes', 'add-notes', 'deliverables', 'comms', 'measures', 'milestones', 'items-metrics'];

function burstOpen(key) { return !!bursts[key]; }
function touchBurst(key, onClose) {
  clearTimeout(bursts[key]);
  bursts[key] = setTimeout(() => { delete bursts[key]; if (onClose) onClose(); }, 900);
}
function endBurst(key) { clearTimeout(bursts[key]); delete bursts[key]; }

// Text boxes: remember the value from before each burst of typing.
const lastText = {};
function trackText(key, node) {
  lastText[key] = node.value;
  node.addEventListener('input', () => {
    if (!burstOpen(key)) pushUndo(key, lastText[key]);
    touchBurst(key, () => { lastText[key] = node.value; });
  });
}

function resetText(key, node) {
  lastText[key] = node.value;
  clearUndo([key]);
}

function snapSection(section) {
  return currentItems().filter((i) => i.section === section).map((i) => ({ ...i }));
}

function snapPeople() {
  return { people: JSON.parse(JSON.stringify(people)), items: draftItems ? draftItems.map((i) => ({ ...i })) : null,
    boards: Object.fromEntries(BOARD_KEYS.map((k) => [k, drafts[k] ? drafts[k].map((d) => ({ ...d })) : null])) };
}

async function undo(key) {
  const stack = undoStacks[key] || [];
  if (!stack.length) return;
  const snap = stack.pop();
  endBurst(key);
  renderUndo(key);
  if (key === 'milestones') {
    draftMs = snap.map((m) => ({ ...m }));
    renderMsEditor();
  } else if (BOARDS[key]) {
    drafts[key] = snap.map((d) => ({ ...d }));
    renderBoard(key);
  } else if (key.startsWith('items-')) {
    const section = key.slice('items-'.length);
    draftItems = editItems().filter((i) => i.section !== section).concat(snap.map((i) => ({ ...i })));
    renderItems();
  } else if (key === 'people') {
    people = snap.people;
    draftItems = snap.items;
    for (const k of BOARD_KEYS) drafts[k] = (snap.boards || {})[k] || null;
    await savePeople();
    renderPeople();
  } else {
    const node = el(key);
    node.value = snap;
    lastText[key] = snap;
  }
  renderPending();
}

/* ---------- open items ---------- */
// Each score page has its own list. Claude fills it in; a person adds, edits,
// deletes and assigns. The saved list lives on the version. Edits go into a
// draft copy, which the autosave keeps on the version a moment later.

let draftItems = null;

function itemId() {
  return 'i-' + Math.random().toString(36).slice(2, 9);
}

function savedItems() {
  return (latest(project) || {}).items || [];
}

function currentItems() {
  return draftItems || savedItems();
}

function editItems() {
  if (!draftItems) draftItems = savedItems().map((i) => ({ ...i }));
  return draftItems;
}

// The owner Claude names becomes a person in the directory, marked as a
// placeholder until someone adds contact details. Nobody is invented: it is
// the role or name the notes used.
function personFor(name) {
  if (!name) return '';
  let match = people.find((p) => p.name.toLowerCase() === String(name).toLowerCase());
  if (!match) {
    match = { id: personId(), name: String(name), role: '', email: '', slack: '', directory: '', placeholder: true };
    people.push(match);
  }
  return match.id;
}

function seedItems(plan) {
  const v = latest(project);
  if (!v || v.items) return;
  const before = people.length;
  v.items = (Array.isArray(plan.open_items) ? plan.open_items : [])
    .filter((i) => SCORE_PAGES.includes(i.section) && String(i.task || '').trim())
    .map((i) => ({ id: itemId(), section: i.section, task: String(i.task).trim(), owner: personFor(i.owner) }));
  // New owners have to be saved, or the items point at nobody after a refresh.
  if (people.length > before) savePeople();
}

function itemChanged(item) {
  const before = savedItems().find((x) => x.id === item.id);
  return !before || before.task !== item.task || (before.owner || '') !== (item.owner || '');
}

// Development and Communication have tile boards instead of open-items lists.
// The Metrics open items gave way to the Metrics table.
const ITEM_PAGES = [];

function renderItems() {
  const items = currentItems();
  for (const key of ITEM_PAGES) {
    const list = items.filter((i) => i.section === key);
    const unowned = list.filter((i) => !i.owner).length;
    el('items-count-' + key).textContent = list.length
      ? `${list.length} open` + (unowned ? `, ${unowned} unowned` : '') : '';
    el('items-count-' + key).className = 'items-count' + (unowned ? ' warn' : '');
    el('items-' + key).innerHTML = list.length ? list.map((i) => {
      const options = ['<option value="">Unassigned</option>'].concat(people.map((p) =>
        `<option value="${esc(p.id)}"${p.id === i.owner ? ' selected' : ''}>${esc(p.name)}</option>`)).join('');
      return `
        <li class="item${itemChanged(i) ? ' is-unsaved' : ''}${i.owner ? '' : ' is-unowned'}" data-item="${esc(i.id)}">
          <input class="item-task" value="${esc(i.task)}" aria-label="Open item">
          <select class="item-owner" aria-label="Owner">${options}</select>
          <button type="button" class="item-del" aria-label="Delete item">Delete</button>
        </li>`;
    }).join('') : '<li class="hint">Nothing open here.</li>';

    el('items-' + key).querySelectorAll('.item').forEach((row) => {
      const id = row.dataset.item;
      const find = () => editItems().find((x) => x.id === id);
      // Typing updates the draft without redrawing, so the cursor stays put.
      row.querySelector('.item-task').addEventListener('input', (e) => {
        if (!burstOpen('items-' + key)) pushUndo('items-' + key, snapSection(key));
        touchBurst('items-' + key);
        find().task = e.target.value.trim();
        row.classList.toggle('is-unsaved', itemChanged(find()));
        renderPending();
      });
      row.querySelector('.item-owner').addEventListener('change', (e) => {
        pushUndo('items-' + key, snapSection(key));
        find().owner = e.target.value;
        renderItems();
        renderPending();
      });
      row.querySelector('.item-del').addEventListener('click', () => {
        pushUndo('items-' + key, snapSection(key));
        draftItems = editItems().filter((x) => x.id !== id);
        renderItems();
        renderPending();
      });
    });
    el('sec-items-' + key).hidden = false;
  }
}

function addItem(section) {
  pushUndo('items-' + section, snapSection(section));
  const id = itemId();
  editItems().push({ id, section, task: '', owner: '' });
  renderItems();
  renderPending();
  const input = document.querySelector(`.item[data-item="${id}"] .item-task`);
  if (input) input.focus();
}

/* ---------- milestones (Timeline page) ---------- */
// The Timeline is the project's major milestones: a name and the date it
// should happen or be done by. The graphic shows the saved list; the editor
// below it holds changes until "Save and update timeline".

let draftMs = null;
let msIncludedOpen = false;

function savedMs() {
  return ((latest(project) || {}).milestones || []).map((m) => ({ ...m, date: m.date || '', note: m.note || '' }));
}
function currentMs() { return draftMs || savedMs(); }
function editMs() {
  if (!draftMs) draftMs = savedMs();
  return draftMs;
}
function snapMs() { return currentMs().map((m) => ({ ...m })); }

// What the graphic shows: the milestones as last saved. Edits wait in the
// editor until "Save and update timeline" (or the main save) applies them.
function timelineMs() {
  return savedMs().filter((m) => m.title);
}

// Apply the editor's changes to the timeline itself: saved to the project
// straight away, no review, since the timeline is not scored.
async function saveTimeline() {
  const changes = msChanges();
  if (!changes.length || !project) return;
  const v = latest(project);
  const list = currentMs().filter((m) => m.title).map((m) => ({ ...m }));
  const end = finalOf(list);
  list.forEach((m) => { m.final = m === end; delete m.onTimeline; });
  v.milestones = list;
  pendingLog = changes;
  logSavedChanges();
  draftMs = null;
  // Undo history survives the save: an undo afterwards brings the old
  // milestones back into the editor, ready to save again.
  endBurst('milestones');
  renderUndo('milestones');
  await saveProject();
  renderMsEditor();
  renderTimeline();
  renderMilestones();
  playTimeline();
  renderActivity();
  renderPending();
}

// The final milestone (launch, go-live) ends the line in its own shape. One is
// marked final; older lists without the mark use their last milestone.
function finalOf(list) {
  if (!list.length) return null;
  const sorted = byDate(list);
  return list.find((m) => m.final) || sorted[sorted.length - 1];
}

// Dated milestones in date order; undated ones after, as they were listed.
function byDate(list) {
  const dated = list.filter((m) => m.date).sort((a, b) => a.date.localeCompare(b.date));
  return dated.concat(list.filter((m) => !m.date));
}

function seedMilestones(plan) {
  const v = latest(project);
  if (!v || v.milestones) return;
  // Older plans had a communication sequence instead; it stands in for them.
  const src = Array.isArray(plan.milestones)
    ? plan.milestones.map((m) => ({ title: m.title, note: m.note, date: m.date, final: !!m.final }))
    : (plan.comms || []).map((c) => ({ title: c.what || c.who, label: c.when }));
  v.milestones = src.filter((m) => String(m.title || '').trim()).slice(0, 12).map((m) => ({
    id: itemId(),
    title: String(m.title).trim(),
    note: String(m.note || '').trim(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(m.date || '')) ? m.date : '',
    label: m.label || '',
    final: !!m.final,
  }));
  const last = finalOf(v.milestones);
  v.milestones.forEach((m) => { m.final = m === last; });
}

function msChanged(m) {
  const b = savedMs().find((x) => x.id === m.id);
  return !b || b.title !== m.title || (b.date || '') !== (m.date || '') || (b.note || '') !== (m.note || '');
}

function msRow(m, fresh, isFinal) {
  return `
    <li class="ms-row${fresh ? ' is-new' : msChanged(m) ? ' is-unsaved' : ''}${isFinal ? ' is-final' : ''}" data-ms="${esc(m.id)}">
      ${isFinal ? '<span class="ms-final-badge" title="The final milestone ends the timeline">Final</span>' : ''}
      <div class="ms-text">
        <input class="ms-title" value="${esc(m.title)}" placeholder="Milestone" aria-label="${isFinal ? 'Final milestone' : 'Milestone'}">
        <input class="ms-note" value="${esc(m.note || '')}" placeholder="Subtext (optional)" aria-label="Subtext">
      </div>
      <input type="date" class="ms-date" value="${esc(m.date || '')}" aria-label="Date it should happen or be done by">
      ${isFinal ? '<span class="ms-del-spacer"></span>' : '<button type="button" class="item-del" aria-label="Delete milestone">Delete</button>'}
    </li>`;
}

// The timeline's own save button: lit, and gently heaving, when there is
// something it can apply.
function renderMsSave() {
  const can = msChanges().length > 0;
  el('ms-save').disabled = !can;
  el('ms-save').classList.toggle('can-save', can);
}

function renderMsEditor() {
  const list = currentMs();
  const savedIds = new Set(savedMs().map((m) => m.id));
  const included = list.filter((m) => savedIds.has(m.id));
  const added = list.filter((m) => !savedIds.has(m.id));
  el('ms-count').textContent = `${timelineMs().length} in the graphic`;
  renderMsSave();
  el('ms-included-label').textContent = `Included (${included.length})`;
  el('ms-included').classList.toggle('is-open', msIncludedOpen);
  el('ms-included-toggle').setAttribute('aria-expanded', String(msIncludedOpen));
  el('ms-included-list').innerHTML = included.length ? (() => { const end = finalOf(included); return byDate(included.filter((m) => m !== end)).map((m) => msRow(m, false, false)).join('') + (end ? msRow(end, false, true) : ''); })() : '<li class="hint">Nothing in the graphic yet.</li>';
  el('ms-new-list').innerHTML = added.map((m) => msRow(m, true)).join('');

  el('sec-ms-edit').querySelectorAll('.ms-row').forEach((row) => {
    const id = row.dataset.ms;
    const find = () => editMs().find((x) => x.id === id);
    row.querySelector('.ms-title').addEventListener('input', (e) => {
      if (!burstOpen('milestones')) pushUndo('milestones', snapMs());
      touchBurst('milestones');
      find().title = e.target.value.trim();
      if (!row.classList.contains('is-new')) row.classList.toggle('is-unsaved', msChanged(find()));
      renderPending();
    });
    row.querySelector('.ms-note').addEventListener('input', (e) => {
      if (!burstOpen('milestones')) pushUndo('milestones', snapMs());
      touchBurst('milestones');
      find().note = e.target.value.trim();
      if (!row.classList.contains('is-new')) row.classList.toggle('is-unsaved', msChanged(find()));
      renderPending();
    });
    row.querySelector('.ms-date').addEventListener('change', (e) => {
      pushUndo('milestones', snapMs());
      find().date = e.target.value;
      if (!row.classList.contains('is-new')) row.classList.toggle('is-unsaved', msChanged(find()));
      renderPending();
    });
    const del = row.querySelector('.item-del');
    if (del) del.addEventListener('click', () => {
      pushUndo('milestones', snapMs());
      draftMs = editMs().filter((x) => x.id !== id);
      renderMsEditor();
      renderPending();
    });
  });
  el('sec-ms-edit').hidden = false;
}

function addMilestone() {
  pushUndo('milestones', snapMs());
  const id = itemId();
  editMs().push({ id, title: '', note: '', date: '', label: '' });
  renderMsEditor();
  renderPending();
  const input = document.querySelector(`.ms-row[data-ms="${id}"] .ms-title`);
  if (input) input.focus();
}

function msChanges() {
  if (!draftMs) return [];
  const before = savedMs();
  const out = [];
  for (const m of draftMs) {
    if (!m.title) continue;
    const b = before.find((x) => x.id === m.id);
    if (!b) { out.push({ kind: 'ms-added', ms: m }); continue; }
    if (b.title !== m.title) out.push({ kind: 'ms-renamed', ms: m, from: b.title });
    if ((b.date || '') !== (m.date || '')) out.push({ kind: 'ms-dated', ms: m });
    if ((b.note || '') !== (m.note || '')) out.push({ kind: 'ms-note', ms: m });
  }
  for (const b of before) if (!draftMs.some((x) => x.id === b.id)) out.push({ kind: 'ms-removed', ms: b });
  return out;
}

function describeMsChange(c) {
  const m = c.ms;
  const when = m.date ? shortDate(m.date) : 'no date';
  if (c.kind === 'ms-added') return `- Added: ${m.title}, by ${when}`;
  if (c.kind === 'ms-removed') return `- Removed: ${m.title}`;
  if (c.kind === 'ms-renamed') return `- Renamed "${c.from}" to "${m.title}"`;
  if (c.kind === 'ms-note') return m.note ? `- ${m.title}: subtext now reads "${m.note}"` : `- ${m.title}: subtext cleared`;
  return `- ${m.title}: date is now ${when}`;
}

/* ---------- picker ---------- */
// A small floating card for choosing a tile's kind or owner, in place of the
// browser's own dropdown. Closes on a choice, Escape, a click elsewhere or a
// scroll.

let pickerEl = null;

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

function closePicker() {
  if (pickerEl) { pickerEl.remove(); pickerEl = null; }
}

function openPicker({ anchor, title, options, current, onPick }) {
  const again = pickerEl && pickerEl._anchor === anchor;
  closePicker();
  if (again) return;   // a second click on the same button closes it
  const box = document.createElement('div');
  box.className = 'picker';
  box.setAttribute('role', 'listbox');
  box.innerHTML = `<p class="picker-title">${esc(title)}</p>` + options.map((o, i) => `
    <button type="button" class="picker-opt${o.value === current ? ' is-current' : ''}" role="option"
      aria-selected="${o.value === current}" data-v="${esc(o.value)}" style="--i:${i}">
      ${o.icon ? `<span class="picker-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${o.icon}</svg></span>`
        : `<span class="picker-initials">${esc(o.initials)}</span>`}
      <span class="picker-label">${esc(o.label)}</span>
    </button>`).join('');
  document.body.appendChild(box);
  box._anchor = anchor;
  const r = anchor.getBoundingClientRect();
  const h = box.offsetHeight, w = box.offsetWidth;
  const below = r.bottom + 8 + h < window.innerHeight;
  box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  box.style.top = (below ? r.bottom + 8 : Math.max(8, r.top - h - 8)) + 'px';
  box.classList.add(below ? 'from-top' : 'from-bottom');
  box.querySelectorAll('.picker-opt').forEach((o) => o.addEventListener('click', (e) => {
    e.stopPropagation();
    closePicker();
    onPick(o.dataset.v);
  }));
  (box.querySelector('.is-current') || box.querySelector('.picker-opt')).focus({ preventScroll: true });
  pickerEl = box;
}

document.addEventListener('click', (e) => {
  if (pickerEl && !pickerEl.contains(e.target) && e.target.closest('.dlv-kind-btn, .dlv-owner-btn, .dlv-phase-btn') !== pickerEl._anchor) closePicker();
});
document.addEventListener('keydown', (e) => {
  if (!pickerEl) return;
  if (e.key === 'Escape') { const a = pickerEl._anchor; closePicker(); a.focus(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const opts = [...pickerEl.querySelectorAll('.picker-opt')];
    const i = opts.indexOf(document.activeElement);
    opts[(i + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length].focus();
    e.preventDefault();
  }
});
// Close when the page (or whatever holds the button) scrolls, but not when a
// text box scrolls its own text back into place as focus leaves it.
window.addEventListener('scroll', (e) => {
  if (!pickerEl) return;
  const t = e.target;
  if (t === document || t === document.documentElement || (t.contains && t.contains(pickerEl._anchor))) closePicker();
}, true);
window.addEventListener('resize', closePicker);

/* ---------- tile boards: Development and Communication ---------- */
// Square tiles for the things that have to exist: on Development, what is
// being built; on Communication, what has to go out or happen. Claude
// proposes them; people add, rename, retag, assign, write notes and move each
// one through its states. Like everything else, edits wait for the save button.

const DEV_KINDS = [
  { key: 'content', label: 'Content', icon: '<rect x="3.5" y="5" width="17" height="12" rx="2"/><path d="M10 9l4.5 2.5L10 14z"/><path d="M8 20h8"/>' },
  { key: 'document', label: 'Document', icon: '<path d="M7 3.5h7l4.5 4.5v12.5H7z"/><path d="M14 3.5V8h4.5M9.5 12.5h6M9.5 16h6"/>' },
  { key: 'feature', label: 'Feature', icon: '<path d="M12 3.5l2.2 5.3 5.3 2.2-5.3 2.2L12 18.5l-2.2-5.3L4.5 11l5.3-2.2z"/>' },
  { key: 'integration', label: 'Integration', icon: '<circle cx="7" cy="12" r="3.5"/><circle cx="17" cy="12" r="3.5"/><path d="M10.5 12h3"/>' },
  { key: 'data', label: 'Data', icon: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>' },
  { key: 'design', label: 'Design', icon: '<circle cx="9" cy="9" r="5"/><rect x="11" y="11" width="9" height="9" rx="1.5"/>' },
  { key: 'training', label: 'Training', icon: '<rect x="3.5" y="4.5" width="17" height="11" rx="1.5"/><path d="M12 15.5v4M8 20h8M7.5 9h5M7.5 12h8"/>' },
];

const COMM_KINDS = [
  { key: 'email', label: 'Email campaign', icon: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>' },
  { key: 'presentation', label: 'Presentation', icon: '<rect x="3.5" y="4" width="17" height="11" rx="1.5"/><path d="M12 15v3.5M8.5 20.5l3.5-2 3.5 2M8 11l3-3 2.5 2L17 7"/>' },
  { key: 'feedback', label: 'Feedback session', icon: '<path d="M4 5.5h11v7H8.5L5.5 15v-2.5H4z"/><path d="M15 9h5v7h-1.5v2.5L15.5 16H11v-3.5"/>' },
  { key: 'announcement', label: 'Announcement', icon: '<path d="M4 10v4h3l7 4V6L7 10z"/><path d="M17.5 9.5a3.5 3.5 0 0 1 0 5"/>' },
  { key: 'training_session', label: 'Training session', icon: '<path d="M3 9l9-4.5L21 9l-9 4.5z"/><path d="M7 11v4.5c0 1.2 2.2 2.5 5 2.5s5-1.3 5-2.5V11M21 9v5"/>' },
  { key: 'one_on_one', label: '1:1 conversation', icon: '<circle cx="8" cy="8.5" r="3"/><circle cx="16" cy="8.5" r="3"/><path d="M3 19c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5M11 19c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5"/>' },
  { key: 'faq', label: 'FAQ / guide', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 16.6v.2"/>' },
  { key: 'demo', label: 'Demo', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M10 8.5l5.5 3.5-5.5 3.5z"/>' },
  { key: 'sign_off', label: 'Sign-off', icon: '<path d="M3.5 19.5h17"/><path d="M5 15.5c2-3 3.5-4.5 4.5-3.5s-1.5 3.5 0 3.5 3-3 4.5-3 0 2.5 1.5 2.5 2-1 2.5-1.5"/><path d="M15.5 4.5l3 3-6.5 6.5-3.5.5.5-3.5z"/>' },
];

const MEASURE_KINDS = [
  { key: 'adoption', label: 'Adoption / usage', icon: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15.5 6.5a3 3 0 0 1 0 5.5M17.5 14.3c1.6.6 2.7 2.2 3 4.7"/>' },
  { key: 'speed', label: 'Speed / time', icon: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M10 3.5h4"/>' },
  { key: 'quality', label: 'Quality / accuracy', icon: '<path d="M12 3.5l7 3v5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9v-5z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/>' },
  { key: 'support', label: 'Support / satisfaction', icon: '<path d="M4.5 12a7.5 7.5 0 0 1 15 0v4"/><rect x="3.5" y="12" width="4" height="6" rx="1"/><rect x="16.5" y="12" width="4" height="6" rx="1"/><path d="M19.5 18c0 1.5-1.5 2.5-4 2.5h-2"/>' },
];

// Type (A) on Metrics: watched along the way, or judged at the end; nothing else.
// Tracking is a pulse line (a reading taken as you go); Outcome a bullseye (the result aimed at).
const PHASES = [
  { key: 'on_track', label: 'Tracking', icon: '<path d="M3 12.5h4l2.4-6 4.2 11 2.4-5H21"/>' },
  { key: 'outcome', label: 'Outcome', icon: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>' },
];
const PHASE = Object.fromEntries(PHASES.map((p) => [p.key, p]));

// An older plan has no kinds on its metrics; a word or two usually tells.
function guessMeasureKind(text) {
  const t = String(text || '').toLowerCase();
  if (/ticket|support|survey|satisf|complain/.test(t)) return 'support';
  if (/hour|day|time|week|fast|minute|close/.test(t)) return 'speed';
  if (/error|mismatch|accura|rework|signed off|document/.test(t)) return 'quality';
  return 'adoption';
}

const BOARDS = {
  deliverables: {
    field: 'deliverables', kinds: DEV_KINDS, fallback: 'feature',
    grid: 'dlv-grid', count: 'dlv-count', section: 'sec-deliverables', add: 'dlv-add',
    noun: 'deliverable', Noun: 'Deliverable', heading: 'Deliverables changes', ask: 'What has to be built?',
  },
  comms: {
    field: 'communications', kinds: COMM_KINDS, fallback: 'email',
    grid: 'comm-grid', count: 'comm-count', section: 'sec-comm-board', add: 'comm-add',
    noun: 'communication', Noun: 'Communication', heading: 'Communications changes', ask: 'What has to go out?',
  },
  // Metrics: the same rows, with Type (A), Tracking or Outcome, beside the type.
  measures: {
    field: 'measures', kinds: MEASURE_KINDS, fallback: 'adoption', metric: true,
    grid: 'measure-grid', count: 'measure-count', section: 'sec-measures', add: 'measure-add',
    noun: 'metric', Noun: 'Metric', heading: 'Metrics changes', ask: 'What should be measured?',
  },
};
const BOARD_KEYS = Object.keys(BOARDS);
for (const b of Object.values(BOARDS)) b.KIND = Object.fromEntries(b.kinds.map((k) => [k.key, k]));

// Three stages along a ring, plus Blocked, which sits outside the run.
const STAGES = [
  { key: 'not_started', label: 'Not started', p: 0 },
  { key: 'in_progress', label: 'In progress', p: 0.5 },
  { key: 'completed', label: 'Completed', p: 1 },
];
const BLOCKED = { key: 'blocked', label: 'Blocked', p: 1 };
const STAGE = Object.fromEntries(STAGES.concat(BLOCKED).map((s) => [s.key, s]));
// The order a click steps through, then round again.
const CYCLE = [STAGE.not_started, BLOCKED, STAGE.in_progress, STAGE.completed];
// Earlier versions had more stages; they fold into the current four.
const OLD_STAGE = { scoping: 'in_progress', building: 'in_progress', review: 'in_progress', shipped: 'completed' };
const normStage = (s) => (STAGE[OLD_STAGE[s] || s] ? OLD_STAGE[s] || s : 'not_started');

const drafts = { deliverables: null, comms: null, measures: null };

// "Sort by status" is a one-off: a click puts the tiles in status order, most
// urgent first, and they then stay where they are while statuses change, until
// the next click sorts again. It is a view: the saved list keeps its order.
const viewOrder = { deliverables: null, comms: null, measures: null };
// Rows opened to show their details stay open through redraws.
const openRows = new Set();
const STATUS_ORDER = { blocked: 0, not_started: 1, in_progress: 2, completed: 3 };

function shownTiles(bk) {
  const list = currentTiles(bk);
  const order = viewOrder[bk];
  if (!order) return list;
  const at = new Map(order.map((id, i) => [id, i]));
  // Anything added since the last sort goes at the end, in the order it came.
  return list.map((d, i) => ({ d, k: at.has(d.id) ? at.get(d.id) : order.length + i }))
    .sort((a, b) => a.k - b.k).map((x) => x.d);
}

// Tiles glide from where they were to where they now are (first, last,
// invert, play), each a beat after the one before.
// How each sort compares two tiles. By date: soonest target first (anything
// past its date comes first of all), undated at the end.
const SORTS = {
  status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  date: (a, b) => (a.target ? 0 : 1) - (b.target ? 0 : 1) || (a.target || '').localeCompare(b.target || ''),
};

function sortNow(bk, by = 'status') {
  const grid = el(BOARDS[bk].grid);
  const before = new Map([...grid.querySelectorAll('.dlv')].map((t) => [t.dataset.dlv, t.getBoundingClientRect()]));
  viewOrder[bk] = shownTiles(bk).map((d, i) => ({ d, i }))
    .sort((a, b) => SORTS[by](a.d, b.d) || (a.i - b.i))
    .map((x) => x.d.id);
  renderBoard(bk);
  if (reducedMotion()) return;
  [...grid.querySelectorAll('.dlv')].forEach((t, i) => {
    const was = before.get(t.dataset.dlv);
    if (!was) return;
    const now = t.getBoundingClientRect();
    const dx = was.left - now.left, dy = was.top - now.top;
    if (!dx && !dy) return;
    t.style.transition = 'none';
    t.style.transform = `translate(${dx}px, ${dy}px)`;
    t.style.zIndex = '3';
    void t.offsetWidth;
    t.style.transition = `transform 0.55s cubic-bezier(0.22, 1, 0.36, 1) ${i * 35}ms`;
    t.style.transform = '';
    t.addEventListener('transitionend', () => { t.style.transition = ''; t.style.zIndex = ''; }, { once: true });
  });
}
let justShipped = null;   // the tile that should celebrate on this render
let justStepped = null;   // the tile whose ring should pop and refill

function savedTiles(bk) {
  return ((latest(project) || {})[BOARDS[bk].field] || []).map((d) => ({ ...d, status: normStage(d.status), notes: d.notes || '', target: d.target || '',
    details: d.details || '',
    ...(BOARDS[bk].metric ? metricShape(d) : {}) }));
}
function currentTiles(bk) { return drafts[bk] || savedTiles(bk); }
function editTiles(bk) {
  if (!drafts[bk]) drafts[bk] = savedTiles(bk);
  return drafts[bk];
}
function snapTiles(bk) { return currentTiles(bk).map((d) => ({ ...d })); }

function seedBoards(plan) {
  const v = latest(project);
  if (!v) return;
  const before = people.length;
  for (const bk of BOARD_KEYS) {
    const b = BOARDS[bk];
    if (v[b.field]) continue;
    if (b.metric) { v[b.field] = seedMeasures(plan); continue; }
    v[b.field] = (Array.isArray(plan[b.field]) ? plan[b.field] : [])
      .filter((d) => String(d.title || '').trim())
      .slice(0, 12)
      .map((d) => ({
        id: itemId(),
        title: String(d.title).trim(),
        kind: b.KIND[d.kind] ? d.kind : b.fallback,
        status: normStage(d.status),
        notes: String(d.notes || '').trim(),
        target: /^\d{4}-\d{2}-\d{2}$/.test(String(d.target || '')) ? d.target : '',
        owner: personFor(d.owner),
        details: String(d.details || '').trim(),
      }));
  }
  keepEditedDetails(v);
  if (people.length > before) savePeople();
}

// Metrics come from the plan's measures; an older plan has its "on track"
// and "did it work" lists instead, which map straight onto the two phases.
// Metrics rows saved before targets became dates kept a value there ("under
// 10 a week"); it moves to the subtext, and the target waits for a date.
function metricShape(d) {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(d.target || ''));
  return { phase: PHASE[d.phase] ? d.phase : 'on_track', target: iso ? d.target : '',
    notes: d.notes || (iso ? '' : String(d.target || '')) };
}

function seedMeasures(plan) {
  const src = Array.isArray(plan.measures) ? plan.measures
    : (plan.tracking || []).map((m) => ({ title: m.metric, phase: 'on_track', target: m.target }))
      .concat((plan.success || []).map((m) => ({ title: m.metric, phase: 'outcome', target: m.target })));
  return src.filter((m) => String(m.title || '').trim()).slice(0, 12).map((m) => ({
    id: itemId(),
    title: String(m.title).trim(),
    phase: PHASE[m.phase] ? m.phase : 'on_track',
    kind: BOARDS.measures.KIND[m.kind] ? m.kind : guessMeasureKind(m.title),
    status: normStage(m.status),
    // An older plan's "target" was a bar ("under 10 a week"); it reads as subtext now.
    notes: String(m.notes || (/^\d{4}-\d{2}-\d{2}$/.test(String(m.target || '')) ? '' : m.target || '')).trim(),
    target: /^\d{4}-\d{2}-\d{2}$/.test(String(m.target || '')) ? m.target : '',
    owner: personFor(m.owner),
    details: String(m.details || '').trim(),
  }));
}

// Details a person wrote survive a scan word for word, whatever comes back:
// a row in the new version takes them from the same row in the one before.
function keepEditedDetails(v) {
  const prev = project && project.versions.length > 1 ? project.versions[project.versions.length - 2] : null;
  if (!prev || prev === v) return;
  for (const b of Object.values(BOARDS)) {
    const mine = new Map((prev[b.field] || []).filter((d) => d.detailsEdited).map((d) => [String(d.title).toLowerCase(), d]));
    for (const d of v[b.field] || []) {
      const was = mine.get(String(d.title).toLowerCase());
      if (was) { d.details = was.details; d.detailsEdited = true; }
    }
  }
}

function tileChanged(bk, d) {
  const b = savedTiles(bk).find((x) => x.id === d.id);
  return !b || b.title !== d.title || b.kind !== d.kind || b.status !== d.status
    || (b.notes || '') !== (d.notes || '') || (b.owner || '') !== (d.owner || '') || (b.target || '') !== (d.target || '')
    || (b.phase || '') !== (d.phase || '') || (b.details || '') !== (d.details || '');
}

// Whole days from today to a YYYY-MM-DD date; negative once it has passed.
function daysUntil(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;   // a metric's target is a value, not a date
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// A short note beside the date when it is close or gone, for anything not done.
function dueNote(d) {
  const n = daysUntil(d.target);
  if (n === null || d.status === 'completed') return '';
  if (n < 0) return 'overdue';
  if (n === 0) return 'today';
  if (n <= 14) return `${n} day${n === 1 ? '' : 's'}`;
  return '';
}

// How far off the target is, for anything not yet completed: "12 days",
// "Today", or "3 days late" once it has passed.
function daysText(d) {
  const n = daysUntil(d.target);
  if (n === null || d.status === 'completed') return '';
  if (n === 0) return 'Today';
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} late`;
  return `${n} day${n === 1 ? '' : 's'}`;
}

function ring(status) {
  const s = STAGE[status] || STAGES[0];
  const C = 2 * Math.PI * 9;
  const inner = status === 'completed'
    ? '<path class="ring-mark" d="M7.5 12.2l3 3 6-6.2"/>'
    : status === 'blocked' ? '<path class="ring-mark" d="M12 7.5v5.5M12 16.3v.2"/>' : '';
  return `<svg class="ring" viewBox="0 0 24 24" aria-hidden="true">
      <circle class="ring-track" cx="12" cy="12" r="9"/>
      <circle class="ring-fill" cx="12" cy="12" r="9" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - s.p)).toFixed(2)}" style="--c:${C.toFixed(2)}"/>
      ${inner}</svg>`;
}

function setTileStatus(bk, id, status) {
  pushUndo(bk, snapTiles(bk));
  const d = editTiles(bk).find((x) => x.id === id);
  if (!d || d.status === status) return;
  if (status === 'completed') justShipped = id;
  justStepped = id;
  d.status = status;
  renderBoard(bk);
  renderPending();
}

// Titles grow to fit their words, so nothing is cut off in a narrow tile. A
// hidden page measures as zero, so this runs again whenever a page is shown.
function fitTitle(t) {
  if (!t.offsetParent) return;
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 'px';
}

function fitTitles(scope) {
  (scope || document).querySelectorAll('.dlv-title').forEach(fitTitle);
}

function renderBoards() {
  for (const bk of BOARD_KEYS) renderBoard(bk);
}

function renderBoard(bk) {
  const b = BOARDS[bk];
  const grid = el(b.grid);
  if (!grid) return;
  const list = shownTiles(bk);
  // A redraw after an edit should not replay the page's entrance.
  if (grid.children.length) el(b.section).closest('.page').classList.remove('page-enter');
  const done = list.filter((d) => d.status === 'completed').length;
  const moving = list.filter((d) => d.status === 'in_progress').length;
  const blocked = list.filter((d) => d.status === 'blocked').length;
  el(b.count).textContent = list.length ? `${done} of ${list.length} completed` + (moving ? `, ${moving} in progress` : '')
    + (blocked ? `, ${blocked} blocked` : '') : '';

  const tiles = list.map((d) => {
    const k = b.KIND[d.kind] || b.KIND[b.fallback];
    const st = STAGE[d.status] || STAGES[0];
    const owner = personById(d.owner);
    const due = dueNote(d);
    // Short enough to share a row with the status; the full words on hover.
    const dueText = due === 'overdue' ? 'Late' : due === 'today' ? 'Today' : due ? parseInt(due, 10) + 'd' : '';
    const dueLong = due === 'overdue' ? 'Past its target date' : due === 'today' ? 'Due today' : due ? due + ' left' : '';
    // One row per item, in ledger columns: status, the item and its notes,
    // type, owner, target, delete.
    return `
      <div class="dlv kind-${k.key} status-${st.key}${openRows.has(d.id) ? ' is-open' : ''}${d.details ? ' has-details' : ''}${tileChanged(bk, d) ? ' is-unsaved' : ''}${d.owner ? '' : ' is-unowned'}${justShipped === d.id ? ' is-celebrating' : ''}${justStepped === d.id ? ' is-stepped' : ''}" data-dlv="${esc(d.id)}">
        <div class="dlv-c dlv-c-status">
          <button type="button" class="dlv-status" aria-label="Status: ${st.label}. Click for the next state">${ring(st.key)}<span class="dlv-status-label">${st.label}</span></button>
        </div>
        <div class="dlv-c dlv-c-item">
          <button type="button" class="dlv-expand" aria-expanded="${openRows.has(d.id)}" aria-label="${openRows.has(d.id) ? 'Hide' : 'Show'} details"></button>
          <textarea class="dlv-title" rows="1" spellcheck="false" aria-label="${b.Noun}" placeholder="${b.ask}">${esc(d.title)}</textarea>
          <textarea class="dlv-notes" rows="1" spellcheck="false" aria-label="Notes" placeholder="Add notes&hellip;">${esc(d.notes || '')}</textarea>
        </div>
        ${b.metric ? `<div class="dlv-c dlv-c-phase">
          <button type="button" class="dlv-phase-btn phase-${esc(d.phase || 'on_track')}" data-value="${esc(d.phase || 'on_track')}" aria-haspopup="listbox" title="Tracking: watched along the way. Outcome: judged at the end."><svg class="dlv-tag-icon" viewBox="0 0 24 24" aria-hidden="true">${(PHASE[d.phase] || PHASES[0]).icon}</svg><span>${(PHASE[d.phase] || PHASES[0]).label}</span></button>
        </div>` : ''}
        <div class="dlv-c dlv-c-type">
          <button type="button" class="dlv-tag dlv-kind-btn" data-value="${k.key}" aria-haspopup="listbox" title="What kind of ${b.noun} this is">
            <svg class="dlv-tag-icon" viewBox="0 0 24 24" aria-hidden="true">${k.icon}</svg><span>${k.label}</span>
          </button>
        </div>
        <div class="dlv-c dlv-c-owner">
          <button type="button" class="dlv-owner-btn" data-value="${esc(d.owner || '')}" aria-haspopup="listbox" aria-label="Owner: ${owner ? esc(owner.name) : 'unassigned'}">
            <span class="initials">${owner ? esc(initials(owner.name)) : '+'}</span><span class="dlv-owner-name">${owner ? esc(owner.name) : 'Assign owner'}</span>
          </button>
        </div>
        <div class="dlv-c dlv-c-target dlv-bottom${due ? ' is-due' : ''}${due === 'overdue' ? ' is-overdue' : ''}">
          <span class="dlv-target-row">
            <button type="button" class="dlv-date-btn" aria-label="Target date: ${d.target ? shortDate(d.target) : 'not set'}${dueLong ? '. ' + dueLong : ''}" title="${dueLong}">${d.target ? shortDate(d.target) : 'Set date'}</button>
            ${daysText(d) ? `<span class="dlv-days">${daysText(d)}</span>` : ''}
            <input type="date" class="dlv-target" value="${esc(d.target || '')}" tabindex="-1" aria-hidden="true">
          </span>
        </div>
        <div class="dlv-c dlv-c-del">
          <button type="button" class="dlv-del" aria-label="Delete ${b.noun}">Delete</button>
        </div>
        <div class="dlv-more"${openRows.has(d.id) ? '' : ' hidden'}>
          <p class="dlv-more-label">Details</p>
          <textarea class="dlv-details" spellcheck="true" aria-label="Details" placeholder="Add context: what it is, why it matters, what it depends on, who is involved&hellip;">${esc(d.details || '')}</textarea>
        </div>
        <span class="confetti" aria-hidden="true">${'<i></i>'.repeat(10)}</span>
      </div>`;
  }).join('');
  grid.innerHTML = `
    <div class="dlv-head" aria-hidden="true"><span>Status</span><span>${b.Noun}</span>${b.metric ? '<span>Type (A)</span><span>Type (B)</span>' : '<span>Type</span>'}<span>Owner</span><span>Target</span><span></span></div>`
    + tiles + `
    <button type="button" class="dlv-add" id="${b.add}"><span>+</span>Add ${b.noun}</button>`;
  justShipped = null;
  justStepped = null;

  fitTitles(grid);

  grid.querySelectorAll('.dlv').forEach((tile) => {
    const id = tile.dataset.dlv;
    const find = () => editTiles(bk).find((x) => x.id === id);
    const typed = (field) => (e) => {
      if (!burstOpen(bk)) pushUndo(bk, snapTiles(bk));
      touchBurst(bk);
      find()[field] = e.target.value.trim();
      tile.classList.toggle('is-unsaved', tileChanged(bk, find()));
      renderPending();
    };
    tile.querySelector('.dlv-title').addEventListener('input', (e) => { fitTitle(e.target); typed('title')(e); });
    if (tile.querySelector('.dlv-notes')) tile.querySelector('.dlv-notes').addEventListener('input', typed('notes'));
    // Details: typed text is the person's own from here on, kept through scans.
    tile.querySelector('.dlv-details').addEventListener('input', (e) => { typed('details')(e); find().detailsEdited = true; });
    // The chevron, or a click on empty space in the row, opens and closes it.
    const toggle = () => {
      const open = !openRows.has(id);
      if (open) openRows.add(id); else openRows.delete(id);
      tile.classList.toggle('is-open', open);
      tile.querySelector('.dlv-more').hidden = !open;
      const ex = tile.querySelector('.dlv-expand');
      ex.setAttribute('aria-expanded', String(open));
      ex.setAttribute('aria-label', (open ? 'Hide' : 'Show') + ' details');
    };
    tile.querySelector('.dlv-expand').addEventListener('click', toggle);
    tile.addEventListener('click', (e) => {
      if (e.target === tile || e.target.classList.contains('dlv-c')) toggle();
    });
    const picked = (field) => (e) => {
      pushUndo(bk, snapTiles(bk));
      find()[field] = e.target.value;
      renderBoard(bk);
      renderPending();
    };
    const choose = (field) => (value) => {
      if ((find()[field] || '') === value) return;
      pushUndo(bk, snapTiles(bk));
      find()[field] = value;
      renderBoard(bk);
      renderPending();
    };
    tile.querySelector('.dlv-kind-btn').addEventListener('click', (e) => openPicker({
      anchor: e.currentTarget, title: 'What kind', current: find().kind, onPick: choose('kind'),
      options: b.kinds.map((x) => ({ value: x.key, label: x.label, icon: x.icon })),
    }));
    if (b.metric) tile.querySelector('.dlv-phase-btn').addEventListener('click', (e) => openPicker({
      anchor: e.currentTarget, title: 'Type (A)', current: find().phase || 'on_track', onPick: choose('phase'),
      options: PHASES.map((x) => ({ value: x.key, label: x.label, icon: x.icon })),
    }));
    tile.querySelector('.dlv-owner-btn').addEventListener('click', (e) => openPicker({
      anchor: e.currentTarget, title: 'Who owns it', current: find().owner || '', onPick: choose('owner'),
      options: [{ value: '', label: 'Unassigned', initials: '\u2013' }]
        .concat(people.map((p) => ({ value: p.id, label: p.name, initials: initials(p.name) }))),
    }));
    tile.querySelector('.dlv-target').addEventListener('change', picked('target'));
    // The visible date is text; clicking it opens the browser's own picker.
    tile.querySelector('.dlv-date-btn').addEventListener('click', () => {
      const input = tile.querySelector('.dlv-target');
      if (input.showPicker) { try { input.showPicker(); return; } catch { /* fall through */ } }
      input.focus();
      input.click();
    });
    tile.querySelector('.dlv-del').addEventListener('click', () => {
      pushUndo(bk, snapTiles(bk));
      drafts[bk] = editTiles(bk).filter((x) => x.id !== id);
      renderBoard(bk);
      renderPending();
    });
    // Each click moves it to the next state, in the order people asked for,
    // and after Completed it starts again at Not started.
    tile.querySelector('.dlv-status').addEventListener('click', () => {
      const cur = currentTiles(bk).find((x) => x.id === id).status;
      const i = CYCLE.findIndex((x) => x.key === cur);
      setTileStatus(bk, id, CYCLE[(i + 1) % CYCLE.length].key);
    });
  });
  el(b.add).addEventListener('click', () => addTile(bk));
  el(b.section).hidden = false;
}

function addTile(bk) {
  pushUndo(bk, snapTiles(bk));
  const id = itemId();
  editTiles(bk).push({ id, title: '', kind: BOARDS[bk].fallback, status: 'not_started', notes: '', target: '', owner: '', details: '',
    ...(BOARDS[bk].metric ? { phase: 'on_track' } : {}) });
  renderBoard(bk);
  renderPending();
  const t = document.querySelector(`#${BOARDS[bk].grid} .dlv[data-dlv="${id}"] .dlv-title`);
  if (t) t.focus();
}

function tileChanges() {
  const out = [];
  for (const bk of BOARD_KEYS) {
    if (!drafts[bk]) continue;
    const before = savedTiles(bk);
    const push = (kind, dlv, extra) => out.push({ kind, dlv, board: bk, ...extra });
    for (const d of drafts[bk]) {
      if (!d.title) continue;
      const b = before.find((x) => x.id === d.id);
      if (!b) { push('dlv-added', d); continue; }
      if (b.title !== d.title) push('dlv-renamed', d, { from: b.title });
      if (b.kind !== d.kind) push('dlv-kind', d);
      if (b.status !== d.status) push('dlv-status', d);
      if ((b.notes || '') !== (d.notes || '')) push('dlv-notes', d);
      if ((b.target || '') !== (d.target || '')) push('dlv-target', d);
      if ((b.owner || '') !== (d.owner || '')) push('dlv-owner', d);
      if ((b.phase || '') !== (d.phase || '')) push('dlv-phase', d);
      if ((b.details || '') !== (d.details || '')) push('dlv-details', d);
    }
    for (const b of before) if (!drafts[bk].some((x) => x.id === b.id)) push('dlv-removed', b);
  }
  return out;
}

function kindLabel(bk, d) {
  const b = BOARDS[bk];
  return (b.KIND[d.kind] || b.KIND[b.fallback]).label;
}

function describeDlvChange(c) {
  const d = c.dlv;
  const kind = kindLabel(c.board, d);
  if (c.kind === 'dlv-added') return `- Added (${kind}): ${d.title}, ${STAGE[d.status].label.toLowerCase()}` + (d.owner ? `, owned by ${ownerName(d.owner)}` : '');
  if (c.kind === 'dlv-removed') return `- Removed: ${d.title}`;
  if (c.kind === 'dlv-renamed') return `- Renamed "${c.from}" to "${d.title}"`;
  if (c.kind === 'dlv-kind') return `- ${d.title}: now tagged ${kind}`;
  if (c.kind === 'dlv-status') return `- ${d.title}: status is now ${STAGE[d.status].label}`;
  if (c.kind === 'dlv-notes') return d.notes ? `- ${d.title}: notes now read "${d.notes}"` : `- ${d.title}: notes cleared`;
  if (c.kind === 'dlv-phase') return `- ${d.title}: now ${PHASE[d.phase].label}`;
  if (c.kind === 'dlv-details') return `- ${d.title}: details updated`;
  if (c.kind === 'dlv-target') return d.target ? `- ${d.title}: now targeted for ${shortDate(d.target)}` : `- ${d.title}: target date cleared`;
  return d.owner ? `- ${d.title}: now owned by ${ownerName(d.owner)}` : `- ${d.title}: no owner yet`;
}


// The directory and the owner menus both list people, so they redraw together.
function renderPeople() {
  renderDirectory();
  renderItems();
  renderBoards();
  el('sec-directory').hidden = false;
}

function renderDirectory() {
  el('people-list').innerHTML = people.length ? people.map((p) => `
    <div class="person" data-person="${esc(p.id)}">
      <div class="person-top">
        <input class="person-name" data-f="name" value="${esc(p.name)}" aria-label="Name">
        <input class="person-role" data-f="role" value="${esc(p.role || '')}" placeholder="Role" aria-label="Role">
        <button type="button" class="person-del" aria-label="Remove ${esc(p.name)}">Remove</button>
      </div>
      <div class="person-links">
        <input data-f="email" value="${esc(p.email || '')}" placeholder="email" aria-label="Email">
        <input data-f="slack" value="${esc(p.slack || '')}" placeholder="@slack" aria-label="Slack handle">
        <input data-f="directory" value="${esc(p.directory || '')}" placeholder="directory link" aria-label="Directory page">
      </div>
      <div class="person-actions">
        ${p.email ? `<a href="mailto:${esc(p.email)}">Email</a>` : ''}
        ${p.slack ? `<a href="https://slack.com/app_redirect?channel=${encodeURIComponent(String(p.slack).replace(/^@/, ''))}" target="_blank" rel="noreferrer">Slack</a>` : ''}
        ${p.directory ? `<a href="${esc(p.directory)}" target="_blank" rel="noreferrer">Directory</a>` : ''}
      </div>
    </div>`).join('') : '<p class="hint">Nobody added yet.</p>';

  el('people-list').querySelectorAll('.person').forEach((row) => {
    const p = personById(row.dataset.person);
    row.querySelectorAll('input[data-f]').forEach((input) => {
      input.addEventListener('change', async () => {
        pushUndo('people', snapPeople());
        p[input.dataset.f] = input.value.trim();
        if (p.email || p.slack || p.directory) delete p.placeholder;
        await savePeople();
        renderPeople(lastPlan || {});
      });
    });
    row.querySelector('.person-del').addEventListener('click', async () => {
      pushUndo('people', snapPeople());
      people = people.filter((x) => x.id !== p.id);
      // Anything they owned goes back to unassigned, as an unsaved change.
      if (currentItems().some((i) => i.owner === p.id)) {
        editItems().forEach((i) => { if (i.owner === p.id) i.owner = ''; });
      }
      for (const bk of BOARD_KEYS) {
        if (currentTiles(bk).some((d) => d.owner === p.id)) {
          editTiles(bk).forEach((d) => { if (d.owner === p.id) d.owner = ''; });
        }
      }
      await savePeople();
      renderPeople();
      renderPending();
    });
  });
}

async function addPerson() {
  pushUndo('people', snapPeople());
  people.push({ id: personId(), name: 'New person', role: '', email: '', slack: '', directory: '' });
  await savePeople();
  renderPeople(lastPlan || {});
  const last = el('people-list').querySelector('.person:last-child .person-name');
  if (last) { last.focus(); last.select(); }
}

/* ---------- pages ---------- */

/* ---------- entrances ----------
   Every page arrives with its own motion, keyed to what it holds: the summary
   writes itself in, tasks slide into a list, owners get stamped, contacts are
   dealt in, metrics converge from both sides. All of it is transform and
   opacity only, uses fill-mode 'backwards' so nothing lingers once it ends,
   and is skipped entirely under reduced motion. */

// Restart a CSS animation class. Removing it, forcing a reflow, and adding it
// back is the only reliable way to replay; then strip it so it cannot linger.
function replay(node, cls, ms) {
  if (!node || reducedMotion()) return;
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
  clearTimeout(node['_' + cls]);
  node['_' + cls] = setTimeout(() => node.classList.remove(cls), ms);
}

// Items inside a card cascade in reading order. Two side-by-side lists (the
// metrics columns) cascade in parallel instead, so they visibly converge.
const ENTER_ITEMS = '.item, .dlv, .dlv-add, .ms, .act, .person, .bucket h3, .bucket li, .plan-list li';

function animatePage(name) {
  const page = document.querySelector(`.page[data-page="${name}"]`);
  if (!page || reducedMotion()) return;
  page.querySelectorAll(':scope > .card, :scope > .overview-grid > .card, :scope .ov-col > .card').forEach((card, c) => {
    card.style.setProperty('--c', c);
    card.querySelectorAll(ENTER_ITEMS).forEach((n, i) => n.style.setProperty('--i', Math.min(i, 14)));
    card.querySelectorAll('.metric-list').forEach((list) =>
      list.querySelectorAll(':scope > li').forEach((n, i) => n.style.setProperty('--i', i)));
  });
  replay(page, 'page-enter', 2600);
}

// The four score cards rise, then each card's pips fill one at a time up to
// its value, so the number is seen being reached rather than just appearing.
function animateHealth() {
  const row = el('health-row');
  if (!row || reducedMotion()) return;
  row.querySelectorAll('.var').forEach((v, i) => v.style.setProperty('--i', i));
  replay(row, 'hr-enter', 2200);
}

function showPage(name) {
  document.body.dataset.page = name;
  fitTitles(document.querySelector(`.page[data-page="${name}"]`));
  document.querySelectorAll('.nav-item[data-page]').forEach((i) =>
    i.classList.toggle('is-active', i.dataset.page === name));
  animatePage(name);
  if (name === 'schedule') playTimeline();
  el('board').scrollTo?.({ top: 0 });
  window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/* ---------- shell state ---------- */
// The dashboard only opens once there is something to put in it, so an empty
// shell is never shown.

function enterBoard(plan) {
  el('resume').hidden = true;
  if (document.body.classList.contains('state-prompt')) replay(document.body, 'shell-enter', 1800);
  document.body.classList.remove('state-prompt');
  document.body.classList.add('state-board');
  el('project-title').textContent = plan.program || 'Program';
  el('notes-slot').append(el('input-panel'));   // source notes sit on the Overview, under the summary
  el('input-heading').textContent = 'Source notes';
  el('toggle-notes').hidden = false;
  el('notes-echo').hidden = false;
  el('notes-echo').textContent = el('notes').value.trim();
  el('input-panel').classList.add('is-collapsed');
  el('input-panel').classList.remove('is-open');
  el('toggle-notes').textContent = 'View source notes';
  el('toggle-notes').setAttribute('aria-expanded', 'false');
  el('health-row').hidden = false;
  el('add-card').hidden = false;
}

function enterPrompt() {
  document.body.classList.add('state-prompt');
  document.body.classList.remove('state-board');
  document.body.dataset.page = 'overview';
  el('program-name').innerHTML = 'Scope <em>builder</em>';
  el('appbar-sub').textContent = 'Paste rough notes, get an organized dashboard.';
  el('input-heading').textContent = 'Input';
  el('toggle-notes').hidden = true;
  el('notes-echo').hidden = true;
  el('input-panel').classList.remove('is-collapsed');
  el('error').after(el('input-panel'));
  el('add-card').hidden = true;
  el('health-row').hidden = true;
}


/* ---------- switcher ---------- */

function renderSwitcher(projects) {
  const name = project ? project.name : 'No project yet';
  const n = project ? project.versions.length : 0;
  el('switcher-name').textContent = name;
  el('switcher-meta').textContent = project
    ? `${n} version${n === 1 ? '' : 's'}`
    : 'Paste notes to start';

  const others = (projects || []).filter((p) => !project || p.id !== project.id);
  el('project-list').innerHTML = others.length
    ? others.map((p) => `
        <button type="button" class="project-row" data-id="${esc(p.id)}">
          <span class="project-name">${esc(p.name || p.id)}</span>
          <span class="project-meta">${p.versions} version${p.versions === 1 ? '' : 's'}<b>${p.score ?? ''}</b></span>
        </button>`).join('')
    : '<p class="switcher-empty">Nothing else saved yet.</p>';

  el('project-list').querySelectorAll('.project-row').forEach((row) => {
    row.addEventListener('click', () => openProject(row.dataset.id));
  });
}

async function refreshSwitcher() {
  try {
    const { projects } = await post('/api/projects/list', {});
    renderSwitcher(projects);
    renderResume(projects);
  } catch {
    renderSwitcher([]);   // the switcher is navigation, not the work
    renderResume([]);
  }
}

// Shown only on the prompt screen, where the sidebar switcher is not available.
function renderResume(projects) {
  const list = (projects || []).slice(0, 5);
  const show = !document.body.classList.contains('state-board') && list.length > 0;
  el('resume').hidden = !show;
  if (!show) return;

  el('resume-list').innerHTML = list.map((p) => `
    <button type="button" class="resume-row" data-id="${esc(p.id)}">
      <span class="resume-name">${esc(p.name || p.id)}</span>
      <span class="resume-meta">${p.versions} version${p.versions === 1 ? '' : 's'}<b>${p.score ?? ''}%</b></span>
    </button>`).join('');

  el('resume-list').querySelectorAll('.resume-row').forEach((row) => {
    row.addEventListener('click', () => openProject(row.dataset.id));
  });
}

function toggleSwitcher(open) {
  const menu = el('switcher-menu');
  const next = open === undefined ? menu.hidden : open;
  menu.hidden = !next;
  el('switcher-btn').setAttribute('aria-expanded', String(next));
  if (next) refreshSwitcher();
}

async function openProject(id) {
  toggleSwitcher(false);
  if (!confirmDiscard()) return;
  try {
    const p = await post('/api/projects/get', { id });
    project = p;
    rememberLast(p.id);
    const v = latest(p);
    if (!v) return;
    el('notes').value = v.notes || '';
    lastPlan = v.plan;
    showPlan(v.plan);
    await refreshSwitcher();
  } catch (err) {
    showError('Could not open that project: ' + err.message);
  }
}

// Everything that puts a finished plan on screen, in one place, so opening a
// saved project and finishing a run follow the identical path.
function showPlan(plan) {
  el('error').hidden = true;
  viewOrder.deliverables = null;
  viewOrder.comms = null;
  viewOrder.measures = null;
  clearStaged();
  clearUndo(PLAN_UNDO_KEYS());
  renderSummary(plan);
  seedItems(plan);
  seedBoards(plan);
  seedMilestones(plan);
  renderHealth(plan);
  renderStakeholders(plan);
  renderTimeline();
  renderMsEditor();
  renderEnablement(plan);
  renderRisks(plan);
  renderPeople();
  hideQuestions();
  enterBoard(plan);
  renderChanged();
  renderMilestones();
  renderActivity();
  renderScans();
  el('add-notes').value = project.contextDraft || '';
  resetText('add-notes', el('add-notes'));
  renderPending();
  showPage(document.body.dataset.page || 'overview');
  animateHealth();
}

// A refresh should land you back where you were.
async function restoreLast() {
  const id = recallLast();
  if (!id) { await refreshSwitcher(); return; }
  try {
    const p = await post('/api/projects/get', { id });
    project = p;
    const v = latest(p);
    if (v) {
      el('notes').value = v.notes || '';
      lastPlan = v.plan;
      showPlan(v.plan);
    }
  } catch {
    forgetLast();   // it was deleted or the folder moved
  }
  await refreshSwitcher();
}

function newProject() {
  toggleSwitcher(false);
  if (!confirmDiscard()) return;
  clearStaged();
  project = null;
  forgetLast();
  resetAll();
  refreshSwitcher();
}

async function post(path, body, opts) {
  if (LOCAL_ROUTES[path]) return LOCAL_ROUTES[path](body || {});
  const res = await fetch(path, {
    method: 'POST',
    keepalive: !!(opts && opts.keepalive),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: 'The server sent back something unreadable.' }));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

/* ---------- storage in this browser ---------- */
// The project and people "endpoints" are answered here, from localStorage,
// so nothing a visitor makes leaves their browser except the notes sent to
// Claude. Same shapes the server used to return, so callers did not change.

const STORE = 'scope-builder:';
const PROJECT_PREFIX = STORE + 'project:';

function storeGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

function storeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    throw new Error(err && err.name === 'QuotaExceededError'
      ? "This browser's storage for Scope builder is full. Open the project switcher and delete an old project, then try again."
      : 'This browser would not let Scope builder save (private browsing can block it).');
  }
}

function storedProjects() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PROJECT_PREFIX)) {
        const p = storeGet(key);
        if (p && p.id && Array.isArray(p.versions) && p.versions.length) out.push(p);
      }
    }
  } catch { /* storage blocked: no projects */ }
  return out;
}

const LOCAL_ROUTES = {
  '/api/projects/list': () => ({
    projects: storedProjects().map((p) => {
      const last = p.versions[p.versions.length - 1] || {};
      return { id: p.id, name: p.name, updated: p.updated, versions: p.versions.length, score: last.score };
    }).sort((a, b) => String(b.updated).localeCompare(String(a.updated))),
  }),
  '/api/projects/get': ({ id }) => {
    const p = storeGet(PROJECT_PREFIX + id);
    if (!p) throw new Error('No such project.');
    return p;
  },
  '/api/projects/save': ({ project: p }) => {
    if (!p || !p.id || !Array.isArray(p.versions) || !p.versions.length) throw new Error('A project needs at least one version.');
    p.updated = new Date().toISOString();
    storeSet(PROJECT_PREFIX + p.id, p);
    return { ok: true, id: p.id, updated: p.updated };
  },
  '/api/projects/delete': ({ id }) => {
    try { localStorage.removeItem(PROJECT_PREFIX + id); } catch {}
    return { ok: true };
  },
  '/api/people/list': () => ({ people: storeGet(STORE + 'people') || [] }),
  '/api/people/save': ({ people: list }) => {
    storeSet(STORE + 'people', (Array.isArray(list) ? list : []).slice(0, 500));
    return { ok: true };
  },
  '/api/example/open': () => openExample(),
};

// The worked example: a fresh copy of the saved snapshot for this visitor,
// every date moved by the days since it was saved, so it always looks as it
// did that day (the same "in 18 days", the same scores).
function shiftDates(value, days) {
  if (Array.isArray(value)) return value.map((x) => shiftDates(x, days));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, days)]));
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) {
    return new Date(new Date(value).getTime() + days * 86400000).toISOString();
  }
  return value;
}

async function openExample() {
  const res = await fetch('example/billing-dashboard-migration.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('The example is missing.');
  const ex = await res.json();
  const [y, m, d] = String(ex.savedOn).split('-').map(Number);
  const t = new Date();
  const days = Math.round((Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) - Date.UTC(y, m - 1, d)) / 86400000);
  const copy = shiftDates(ex.project, days);
  copy.id = 'example-billing-dashboard-' + Math.random().toString(36).slice(2, 8);
  copy.name = String(copy.name || 'Billing dashboard migration').replace(/ \(example\)$/, '') + ' (example)';
  LOCAL_ROUTES['/api/projects/save']({ project: copy });
  // The people it names join this browser's directory, once each.
  const mine = storeGet(STORE + 'people') || [];
  const known = new Set(mine.map((p) => p.id));
  const added = (ex.people || []).filter((p) => !known.has(p.id));
  if (added.length) storeSet(STORE + 'people', mine.concat(added));
  return { id: copy.id };
}

// Projects an earlier version saved as files on this machine are offered once
// by a local server started with IMPORT_LEGACY=1; the public site has none.
async function importLegacy() {
  if (storeGet(STORE + 'imported') || !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  try {
    const res = await fetch('/api/legacy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!res.ok) return;
    const { projects = [], people: those = [] } = await res.json();
    for (const p of projects) if (!storeGet(PROJECT_PREFIX + p.id)) storeSet(PROJECT_PREFIX + p.id, p);
    const mine = storeGet(STORE + 'people') || [];
    const known = new Set(mine.map((p) => p.id));
    storeSet(STORE + 'people', mine.concat(those.filter((p) => !known.has(p.id))));
    storeSet(STORE + 'imported', true);
  } catch { /* nothing to import */ }
}

/* ---------- questions, one at a time ---------- */

let qIndex = 0;
let qAnswers = [];  // index -> string, or null for skipped

function renderProgress() {
  const total = pendingQuestions.length;
  const answered = qAnswers.filter((a) => a !== null && a !== undefined).length;
  el('q-count').textContent = qIndex < total
    ? `${qIndex + 1} / ${total}`
    : `${answered} of ${total} answered`;

  el('q-progress').innerHTML = pendingQuestions.map((_, i) => {
    const cls = qAnswers[i] ? 'done' : (i === qIndex ? 'current' : '');
    return `<i class="${cls}"></i>`;
  }).join('');

  el('q-back').hidden = qIndex === 0 || qIndex >= total;
  el('q-skip').hidden = qIndex >= total;
  el('q-skip-all').hidden = qIndex >= total;
}

function renderQuestion() {
  const total = pendingQuestions.length;

  if (qIndex >= total) {
    const answered = qAnswers.filter(Boolean);
    const skipped = total - answered.length;
    el('questions').innerHTML = `
      <div class="q-done">
        <b>${skipped ? `${answered.length} of ${total} answered.` : 'All answered.'}</b>
        <span>${skipped
          ? `The ${skipped === 1 ? 'one' : skipped} you skipped ${skipped === 1 ? 'becomes a' : 'become'} flagged gap${skipped === 1 ? '' : 's'} in the plan. Hit Evaluate when ready.`
          : 'Hit Evaluate when ready.'}</span>
        ${answered.length ? `<div class="q-answered">You said:<ul>${
          pendingQuestions.map((q, i) => qAnswers[i]
            ? `<li>${esc(qAnswers[i])}</li>` : '').join('')
        }</ul></div>` : ''}
      </div>`;
    renderProgress();
    return;
  }

  const q = pendingQuestions[qIndex];
  const current = qAnswers[qIndex];
  const opts = (q.options || []).map((opt) => `
    <label class="q-opt${current === opt ? ' is-picked' : ''}">
      <input type="radio" name="q" value="${esc(opt)}"${current === opt ? ' checked' : ''}>
      <span>${esc(opt)}</span>
    </label>`).join('');

  const otherValue = current && !(q.options || []).includes(current) ? current : '';

  el('questions').innerHTML = `
    <div class="q" data-q="${qIndex}">
      <p class="q-text">${esc(q.question)}</p>
      <p class="q-why">${esc(q.why)}</p>
      <div class="q-opts">
        ${opts}
        <label class="q-opt q-other${otherValue ? ' is-picked' : ''}">
          <input type="radio" name="q" value="__other__"${otherValue ? ' checked' : ''}>
          <input type="text" placeholder="Something else&hellip;" aria-label="Your own answer" value="${esc(otherValue)}">
          <button type="button" class="q-next">Next</button>
        </label>
      </div>
    </div>`;

  // Picking a listed option answers and moves on — no extra click to confirm.
  // Listening on click as well as change matters: coming Back to a question
  // and re-picking the option that's already selected fires no change event,
  // which would leave you stuck on that question.
  let moved = false;
  const choose = (label, value) => {
    if (moved) return;
    moved = true;
    qAnswers[qIndex] = value;
    el('questions').querySelectorAll('.q-opt').forEach((o) => o.classList.remove('is-picked'));
    label.classList.add('is-picked');
    setTimeout(advance, 220);
  };
  el('questions').querySelectorAll('.q-opt:not(.q-other)').forEach((label) => {
    const radio = label.querySelector('input[type="radio"]');
    label.addEventListener('click', () => choose(label, radio.value));
    radio.addEventListener('change', () => choose(label, radio.value));
  });

  // The free-text box needs an explicit Next, since we can't know you're done typing.
  const box = el('questions').querySelector('.q-other input[type="text"]');
  const next = el('questions').querySelector('.q-next');
  const takeOther = () => {
    if (moved) return;
    moved = true;
    const v = box.value.trim();
    qAnswers[qIndex] = v || null;
    advance();
  };
  box.addEventListener('focus', () => {
    box.closest('.q-opt').querySelector('input[type="radio"]').checked = true;
    el('questions').querySelectorAll('.q-opt').forEach((o) =>
      o.classList.toggle('is-picked', o.querySelector('input[type="radio"]').checked));
  });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); takeOther(); } });
  next.addEventListener('click', takeOther);

  renderProgress();
}

function advance() {
  qIndex++;
  if (qIndex >= pendingQuestions.length) {
    // Last one answered: carry straight on rather than asking for another click.
    renderQuestion();
    buildPlan(el('notes').value.trim());
    return;
  }
  slideQuestion(1);
}

// Fade the current question out in the direction of travel, then bring the
// next one in from the other side. Skipped entirely if the viewer has asked
// for reduced motion.
function slideQuestion(dir) {
  const box = el('questions');
  if (reducedMotion()) { renderQuestion(); return; }
  box.classList.add(dir > 0 ? 'leave-left' : 'leave-right');
  setTimeout(() => {
    box.classList.remove('leave-left', 'leave-right');
    renderQuestion();
    box.classList.add(dir > 0 ? 'enter-right' : 'enter-left');
    setTimeout(() => box.classList.remove('enter-right', 'enter-left'), 260);
  }, 150);
}

function reducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function renderQuestions(questions) {
  pendingQuestions = questions;
  qAnswers = new Array(questions.length).fill(null);
  qIndex = 0;
  el('questions-panel').hidden = false;
  el('questions-panel').classList.remove('enter');
  void el('questions-panel').offsetWidth;   // restart the animation
  el('questions-panel').classList.add('enter');
  renderQuestion();
}

function hideQuestions() {
  el('questions-panel').hidden = true;
}

// What was answered, and what was left for the plan to flag as a gap.
function collectAnswers() {
  const answers = [];
  const unanswered = [];
  pendingQuestions.forEach((q, i) => {
    if (qAnswers[i]) answers.push({ question: q.question, answer: qAnswers[i] });
    else unanswered.push(q.question);
  });
  return { answers, unanswered };
}

/* ---------- unsaved changes ---------- */
// Tiles and open items are edited as drafts and saved by the autosave below.
// Timeline edits stay drafts until Save and update timeline.

function clearStaged() {
  draftItems = null;
  drafts.deliverables = null;
  drafts.comms = null;
  drafts.measures = null;
  draftMs = null;
}

function notesEdited() {
  const v = latest(project);
  return !!v && document.body.classList.contains('state-board')
    && el('notes').value.trim() !== String(v.notes || '').trim();
}

function itemChanges() {
  if (!draftItems) return [];
  const before = savedItems();
  const out = [];
  for (const i of draftItems) {
    if (!i.task) continue;
    const was = before.find((x) => x.id === i.id);
    if (!was) out.push({ kind: 'item-added', item: i });
    else {
      if (was.task !== i.task) out.push({ kind: 'item-edited', item: i, from: was.task });
      if ((was.owner || '') !== (i.owner || '')) out.push({ kind: 'item-owner', item: i });
    }
  }
  for (const was of before) {
    if (!draftItems.some((x) => x.id === was.id)) out.push({ kind: 'item-removed', item: was });
  }
  return out;
}

// Context saved with "Save context": kept on the project, so it survives a
// refresh, and sent at the next review.
function heldContext() {
  return (project && project.held) || [];
}

function pendingChanges() {
  const out = itemChanges().concat(tileChanges(), msChanges());
  for (const c of heldContext()) out.push({ kind: 'held', text: c.text });
  if (notesEdited()) out.push({ kind: 'notes' });
  if (el('add-notes').value.trim()) out.push({ kind: 'context' });
  return out;
}

function renderPending() {
  el('scan').disabled = scanning || (!el('add-notes').value.trim() && !heldContext().length);
  if (el('ms-save')) renderMsSave();
  refreshScores();
  scheduleAutosave();
}

// Everything but the Timeline saves itself, so the only thing that can be
// lost by leaving is a Timeline edit not yet applied with its own button.
function unsavedCount() {
  return msChanges().length;
}

/* ---------- autosave ---------- */
// Edits to tiles and open items are saved to the project shortly after they
// are made, with no API call. A burst of edits is saved, and logged in Recent
// changes, once. Typed but unscanned context is kept as a draft too.

let autosaveTimer = null;
let scanning = false;

function contextDraftChanged() {
  return !!project && (project.contextDraft || '') !== el('add-notes').value;
}

function scheduleAutosave() {
  if (!project || scanning) return;
  if (!itemChanges().length && !tileChanges().length && !contextDraftChanged()) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosave, 900);
}

async function autosave(opts) {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  const v = latest(project);
  if (!v) return;
  const changes = itemChanges().concat(tileChanges());
  const ctx = contextDraftChanged();
  if (!changes.length && !ctx) return;
  if (changes.length) {
    pendingLog = changes;
    logSavedChanges();
    // Blank rows stay on screen as drafts; only titled ones are kept.
    if (draftItems) v.items = draftItems.filter((i) => i.task).map((i) => ({ ...i }));
    for (const bk of BOARD_KEYS) {
      if (drafts[bk]) v[BOARDS[bk].field] = drafts[bk].filter((d) => d.title).map((d) => ({ ...d }));
    }
    const live = liveAdjusted(v.plan);
    v.score = healthScore(live);
    v.areas = Object.fromEntries(HEALTH_VARS.map((x) => [x.key, pctOf(live, x.key)]));
    renderActivity();
  }
  if (ctx) project.contextDraft = el('add-notes').value;
  await saveProject(opts);
}

function confirmDiscard() {
  if (autosaveTimer) autosave();
  const n = unsavedCount();
  return !n || window.confirm(`You have ${n} Timeline change${n === 1 ? '' : 's'} not yet applied with Save and update timeline. Discard ${n === 1 ? 'it' : 'them'}?`);
}

// Changes become plain sentences appended to the notes, so Claude reads them
// like any other fact and can quote them as evidence.
const SECTION_LABEL = { ...Object.fromEntries(HEALTH_VARS.map((v) => [v.key, v.label])), schedule: 'Timeline' };

function ownerName(id) {
  const p = personById(id);
  return p ? p.name + (p.role ? ` (${p.role})` : '') : '';
}

function describeItemChange(c) {
  const where = SECTION_LABEL[c.item.section] || c.item.section;
  if (c.kind === 'item-added') return `- Added to ${where}: ${c.item.task}` + (c.item.owner ? `, owned by ${ownerName(c.item.owner)}` : '');
  if (c.kind === 'item-removed') return `- Removed from ${where}: ${c.item.task}`;
  if (c.kind === 'item-edited') return `- Changed "${c.from}" to "${c.item.task}"`;
  return c.item.owner ? `- ${c.item.task}: now owned by ${ownerName(c.item.owner)}` : `- ${c.item.task}: no owner yet`;
}

// "Scan context and update dashboard": Claude reads the new context with the
// whole current dashboard and builds the next version. The version before it
// stays as it was, so the scan can be reverted from Scan history.
async function scan() {
  if (!project || scanning) return;
  const typed = el('add-notes').value.trim();
  if (!typed && !heldContext().length) return;
  await autosave();
  scanning = true;

  const parts = [];
  for (const c of heldContext()) parts.push(c.text);
  if (typed) parts.push(typed);
  // Timeline edits not yet applied ride along, as they always have.
  const ms = msChanges();
  if (ms.length) parts.push('Milestones changes:\n' + ms.map(describeMsChange).join('\n'));
  const changes = ms;
  const extra = parts.join('\n\n');

  const base = el('notes').value.trim();
  const merged = extra ? base + '\n\nAlso: ' + extra : base;
  el('notes').value = merged;
  el('notes-echo').textContent = merged;
  el('scan').disabled = true;
  el('scan').classList.add('is-busy');
  el('add-status').textContent = 'Scanning your context and updating the dashboard\u2026';
  pendingAdded = extra || null;
  pendingLog = changes;
  // Claude gets the reviewed list itself, so it can keep the wording and owners.
  const msList = currentMs().filter((m) => m.title);
  const msEnd = finalOf(msList);
  pendingMs = msList.map((m) => ({ title: m.title, note: m.note || '', date: m.date || null, final: m === msEnd }));
  pendingBoards = Object.fromEntries(BOARD_KEYS.map((bk) => [BOARDS[bk].field,
    currentTiles(bk).filter((d) => d.title).map((d) => ({
      title: d.title, kind: d.kind, status: d.status, notes: d.notes || '', target: d.target || null, owner: (personById(d.owner) || {}).name || null,
      ...(BOARDS[bk].metric ? { phase: d.phase || 'on_track' } : {}),
      details: d.details || '', detailsEdited: !!d.detailsEdited,
    }))]));
  pendingItems = currentItems().filter((i) => i.task).map((i) => ({
    section: i.section, task: i.task, owner: (personById(i.owner) || {}).name || null,
  }));
  pendingQuestions = [];
  qAnswers = [];
  clearHeldOnSave = heldContext().length > 0;
  const ok = await buildPlan(merged);
  clearHeldOnSave = false;
  if (!ok) {
    // Leave everything pending so nothing is lost. Put the notes back as typed.
    el('notes').value = base;
    el('notes-echo').textContent = base;
    pendingLog = [];
    pendingItems = null;
    pendingBoards = null;
    pendingMs = null;
  }
  scanning = false;
  el('scan').classList.remove('is-busy');
  renderPending();
}

/* ---------- scan history ---------- */
// Every version after the first came from a scan (or a revert). The version
// before each one is never changed afterwards, so it is the snapshot to go
// back to. Going back adds a new version, so a revert can itself be reverted.

function whenText(at) {
  return new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderScans() {
  const vs = (project && project.versions) || [];
  const rows = vs.slice(1).map((v, i) => ({ v, before: vs[i] })).reverse().slice(0, 6);
  el('scans').hidden = !rows.length;
  el('scans-list').innerHTML = rows.map(({ v, before }) => {
    // The scanned context itself, before any list of edits that rode along.
    const said = String(v.added || '').split(/\n\n(?=[A-Z][\w ]+ changes?:\n)/)[0].replace(/\s+/g, ' ').trim();
    const what = v.restoredFrom ? `Reverted to version ${v.restoredFrom}` : (said ? `\u201c${said}\u201d` : 'Dashboard updated');
    return `
      <li class="scan-row">
        <span class="scan-meta"><b>${v.restoredFrom ? 'Revert' : 'Scan'}</b> ${esc(whenText(v.at))}</span>
        <span class="scan-what">${esc(what)}</span>
        <button type="button" class="scan-revert" data-n="${before.n}">Revert to before this ${v.restoredFrom ? 'revert' : 'scan'}</button>
      </li>`;
  }).join('');
  el('scans-list').querySelectorAll('.scan-revert').forEach((b) => b.addEventListener('click', () => revertTo(Number(b.dataset.n))));
}

async function revertTo(n) {
  const src = project && project.versions.find((v) => v.n === n);
  if (!src || scanning) return;
  if (!window.confirm('Put the dashboard back the way it was before this? Edits made since then will be replaced. You can undo this from Scan history.')) return;
  await autosave();
  const entry = { ...JSON.parse(JSON.stringify(src)), n: project.versions.length + 1, at: new Date().toISOString(), restoredFrom: n };
  delete entry.added;
  project.versions.push(entry);
  logActivity('updated', `Reverted the dashboard to version ${n}, from ${whenText(src.at)}`);
  el('notes').value = entry.notes || '';
  el('notes-echo').textContent = entry.notes || '';
  lastPlan = entry.plan;
  await saveProject();
  showPlan(entry.plan);
  await refreshSwitcher();
}

let pendingItems = null;
let pendingBoards = null;
let pendingMs = null;
let clearHeldOnSave = false;   // saved context is used up by this review
let pendingAdded = null;
let pendingLog = [];

// The changes go into the activity feed only once they are actually saved.
function logSavedChanges() {
  for (const c of pendingLog) {
    if (c.kind === 'item-added') logActivity('done', `Open item added: ${c.item.task}`);
    if (c.kind === 'item-removed') logActivity('reopened', `Open item removed: ${c.item.task}`);
    if (c.kind === 'item-edited') logActivity('updated', `Open item edited: ${c.item.task}`);
    if (c.kind === 'item-owner') {
      if (c.item.owner) logActivity('owner', `${c.item.task}: assigned to ${(personById(c.item.owner) || {}).name || 'someone'}`);
      else logActivity('unassigned', `${c.item.task}: no owner again`);
    }
    if (c.kind === 'notes') logActivity('updated', 'Source notes edited');
    if (c.kind === 'ms-added') logActivity('done', `Milestone added: ${c.ms.title}`);
    if (c.kind === 'ms-removed') logActivity('reopened', `Milestone removed: ${c.ms.title}`);
    if (c.kind === 'ms-renamed') logActivity('updated', `Milestone renamed: ${c.ms.title}`);
    if (c.kind === 'ms-note') logActivity('updated', `${c.ms.title}: subtext updated`);
    if (c.kind === 'ms-dated') logActivity('updated', `${c.ms.title}: now ${c.ms.date ? shortDate(c.ms.date) : 'undated'}`);
    const Noun = c.board ? BOARDS[c.board].Noun : '';
    if (c.kind === 'dlv-added') logActivity('done', `${Noun} added: ${c.dlv.title}`);
    if (c.kind === 'dlv-removed') logActivity('reopened', `${Noun} removed: ${c.dlv.title}`);
    if (c.kind === 'dlv-renamed') logActivity('updated', `${Noun} renamed: ${c.dlv.title}`);
    if (c.kind === 'dlv-kind') logActivity('updated', `${c.dlv.title}: tagged ${kindLabel(c.board, c.dlv)}`);
    if (c.kind === 'dlv-status') logActivity(c.dlv.status === 'completed' ? 'done' : 'updated', `${c.dlv.title}: ${STAGE[c.dlv.status].label}`);
    if (c.kind === 'dlv-notes') logActivity('updated', `${c.dlv.title}: notes updated`);
    if (c.kind === 'dlv-phase') logActivity('updated', `${c.dlv.title}: now ${PHASE[c.dlv.phase].label}`);
    if (c.kind === 'dlv-details') logActivity('updated', `${c.dlv.title}: details updated`);
    if (c.kind === 'dlv-target') logActivity('updated', c.dlv.target ? `${c.dlv.title}: targeting ${shortDate(c.dlv.target)}` : `${c.dlv.title}: target date cleared`);
    if (c.kind === 'dlv-owner') logActivity(c.dlv.owner ? 'owner' : 'unassigned', c.dlv.owner
      ? `${c.dlv.title}: assigned to ${(personById(c.dlv.owner) || {}).name || 'someone'}` : `${c.dlv.title}: no owner again`);
    if (c.kind === 'held') logActivity('updated', `Context added: ${c.text.length > 70 ? c.text.slice(0, 69) + '\u2026' : c.text}`);
  }
  pendingLog = [];
}

/* ---------- the evaluate meter ---------- */
// There is no real progress signal from a single API call, so the meter is
// paced against a typical run and deliberately stops one segment short. It
// only completes when the response actually lands.

// The bar fills toward a cap rather than straight to full, because the run has
// two calls with your answers in between. Phase one reads the notes, then it
// holds while you answer, then phase two builds the plan. It always stops one
// segment short until the response actually lands.
const PHASE1_CAP = 0.34;
const PHASE1_MS = 5000;
const PHASE2_MS = 40000;   // the build writes a paragraph of details per row

let meterTimer = null;
let meterCount = 0;
let meterN = 0;

// Segment count comes from the measured width so the bars stay narrow and
// upright whatever the window size.
function meterBuild() {
  const bar = el('meter');
  bar.classList.add('is-on');
  const usable = bar.clientWidth - 14;
  meterCount = Math.max(20, Math.min(90, Math.floor(usable / 10)));
  bar.innerHTML = Array.from({ length: meterCount }, () => '<i></i>').join('');
  meterN = 0;
  meterSet(0);
}

function meterSet(n) {
  meterN = n;
  el('meter').querySelectorAll('i').forEach((b, i) => {
    b.classList.toggle('lit', i < n);
    b.classList.toggle('tip', i === n - 1 && n < meterCount);
  });
}

function meterRun(capFraction, durationMs) {
  clearInterval(meterTimer);
  const target = Math.max(1, Math.floor(meterCount * capFraction) - 1);
  if (meterN >= target) return;
  const pace = Math.max(60, durationMs / (target - meterN));
  meterTimer = setInterval(() => {
    if (meterN < target) meterSet(meterN + 1);
    else clearInterval(meterTimer);
  }, pace);
}

// Stops where it is. The pulsing leading segment shows it is waiting, not dead.
function meterHold() { clearInterval(meterTimer); }

function meterFinish(ok) {
  clearInterval(meterTimer);
  if (ok) {
    meterSet(meterCount);
    setTimeout(() => el('meter').classList.remove('is-on'), 850);
  } else {
    el('meter').classList.remove('is-on');
  }
}

/* ---------- rendering ---------- */

// A plan made before the brief existed falls back to its call and risk, so an
// older project still has a summary rather than an empty card.
function briefOf(plan) {
  if (plan.brief) return plan.brief;
  const s = plan.summary || {};
  return [s.call, s.risk].filter(Boolean).join(' ');
}

function renderSummary(plan) {
  // Words are wrapped so they can arrive one after another. The spaces stay as
  // real text between them, so copying and reading the text is unaffected.
  const words = briefOf(plan).split(/\s+/).filter(Boolean);
  el('summary').innerHTML = words.map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`).join(' ');
  el('sec-overview').hidden = false;
}

/* ---------- date risk ---------- */
// A fixed, visible rule on top of Claude's scores. On Development and
// Communication, anything not started or blocked within RISK_WINDOW days of
// its target date costs up to 8 points, more as the date nears; anything not
// completed after its date costs 12. At most RISK_CAP points per area. It uses
// the saved tiles, so it changes as days pass, not as you edit.

const RISK_WINDOW = 14;
const RISK_CAP = 30;
const RISK_AREAS = { content: 'deliverables', communication: 'comms', metrics: 'measures' };

function riskOf(d) {
  const n = daysUntil(d.target);
  if (n === null || d.status === 'completed') return null;
  if (n < 0) return { points: 12, why: `${-n} day${n === -1 ? '' : 's'} past its target` };
  if ((d.status === 'not_started' || d.status === 'blocked') && n <= RISK_WINDOW) {
    const word = d.status === 'blocked' ? 'blocked' : 'not started';
    return { points: Math.round(2 + 6 * (RISK_WINDOW - n) / RISK_WINDOW), why: `${word}, ${n === 0 ? 'due today' : n + ' day' + (n === 1 ? '' : 's') + ' to go'}` };
  }
  return null;
}

function dateRisk(area) {
  const bk = RISK_AREAS[area];
  if (!bk || !project) return { points: 0, items: [] };
  const items = currentTiles(bk).map((d) => ({ d, r: riskOf(d) })).filter((x) => x.r)
    .map(({ d, r }) => ({ title: d.title, points: r.points, why: r.why }));
  const points = Math.min(RISK_CAP, items.reduce((t, x) => t + x.points, 0));
  return { points, items };
}

/* ---------- live scores ---------- */
// The four area scores are worked out here, in the browser, from what is on
// the dashboard right now, and change as soon as anything is edited. Claude
// writes the content; this arithmetic does the scoring.

const share = (list, test) => (list.length ? list.filter(test).length / list.length : 0);
// Completed counts fully, and so does In progress while it is on time: moving
// it to Completed does not change the score. Once its date has passed, In
// progress counts half (and date risk takes its share as well).
const PROGRESS = { completed: 1, in_progress: 1, not_started: 0.1, blocked: 0 };
function progressOf(d) {
  if (d.status === 'in_progress' && d.target && daysUntil(d.target) < 0) return 0.5;
  return PROGRESS[d.status] ?? 0;
}

// All three boards: progress 50, owners 25, dates 25, less date risk.
function tileScore(bk, area) {
  const list = currentTiles(bk).filter((d) => d.title);
  if (!list.length) return { value: 0, parts: 'No items yet' };
  const progress = list.reduce((t, d) => t + progressOf(d), 0) / list.length;
  const owners = share(list, (d) => d.owner);
  const dates = share(list, (d) => d.target);
  const risk = dateRisk(area);
  const value = Math.max(0, Math.min(100, Math.round(50 * progress + 25 * owners + 25 * dates - risk.points)));
  return { value, risk, parts: `Progress ${Math.round(progress * 100)}% · Owners ${Math.round(owners * 100)}% · Dates ${Math.round(dates * 100)}%` };
}


function liveScores() {
  return {
    content: tileScore('deliverables', 'content'),
    communication: tileScore('comms', 'communication'),
    metrics: tileScore('measures', 'metrics'),
  };
}

// The plan as scored now. Only the current method scores live; projects saved
// under earlier methods keep the numbers they were given.
let shownScore = null;
let shownRisk = {};
let shownParts = {};
function liveAdjusted(plan) {
  shownRisk = {};
  shownParts = {};
  if (methodFor(plan) !== METHODS.current || !project || (latest(project) || {}).plan !== plan) return plan;
  const adj = { ...plan };
  for (const [area, sc] of Object.entries(liveScores())) {
    adj[area] = { ...(plan[area] || {}), value: sc.value };
    shownParts[area] = sc.parts;
    if (sc.risk && sc.risk.points) shownRisk[area] = sc.risk;
  }
  return adj;
}

// Called after every edit: redraw the score card in place, without replaying
// its entrance.
let quietHealth = false;
let shownKey = '';
function refreshScores() {
  if (!lastPlan || !project || document.body.classList.contains('state-prompt')) return;
  // Nothing to redraw if no score has moved (and the entrance can finish).
  const key = JSON.stringify(Object.values(liveScores()).map((x) => x.value));
  if (key === shownKey) return;
  const before = shownNumbers();
  quietHealth = true;
  renderHealth(lastPlan);
  quietHealth = false;
  renderChanged();
  floatChanges(before, shownNumbers());
}

// The numbers on the score card as they stand: each area and the total.
function shownNumbers() {
  const out = { overall: shownScore };
  document.querySelectorAll('.health-side .var').forEach((row) => {
    const key = [...row.classList].find((c) => c.startsWith('var-') && c !== 'var-risk');
    const v = row.querySelector('.var-value');
    // The number is the first text in the cell; a float may be sitting after it.
    if (key && v && v.firstChild) out[key.slice(4)] = Number(String(v.firstChild.textContent).replace(/[^\d]/g, ''));
  });
  return out;
}

// When an edit moves a score, a small "+2%" in green (or "−3%" in red) rises
// off the number and fades, so you can see what the change was worth.
function floatChanges(before, after) {
  for (const [key, now] of Object.entries(after)) {
    const was = before[key];
    if (was == null || now == null || was === now) continue;
    const host = key === 'overall' ? el('score-big').parentElement
      : document.querySelector(`.health-side .var-${key} .var-value`);
    if (!host) continue;
    const d = now - was;
    const f = document.createElement('span');
    f.className = 'score-float ' + (d > 0 ? 'is-up' : 'is-down') + (key === 'overall' ? ' is-overall' : '');
    f.setAttribute('aria-hidden', 'true');
    f.textContent = (d > 0 ? '+' : '\u2212') + Math.abs(d) + '%';
    host.appendChild(f);
    f.addEventListener('animationend', () => f.remove());
    setTimeout(() => f.remove(), 2500);   // in case the animation never runs
  }
}

// Date risk is still taken off the score; it is named only on hover, so
// nothing sits under the scores themselves.
function riskNote(key) {
  const r = shownRisk[key];
  return r ? `\nDate risk \u2212${r.points}:\n` + r.items.map((x) => `${x.title}: ${x.why} (\u2212${x.points})`).join('\n') : '';
}

function renderHealth(raw) {
  const plan = liveAdjusted(raw);
  shownKey = JSON.stringify(Object.values(liveScores()).map((x) => x.value));
  const score = healthScore(plan);
  shownScore = score;
  const band = healthBand(score);
  const badge = el('health-badge');
  const big = el('score-big');
  // One phrase per ten points, inked in a deep shade of that gauge segment's
  // color, over a highlighter stroke in the segment's own pastel.
  // The color is the last lit segment's, so the words match the gauge.
  const lit = Math.max(0, stepsOn(score) - 1);
  badge.className = `health-badge ${band}`;
  badge.textContent = HEALTH_PHRASES[Math.min(9, Math.floor(score / 10))];
  badge.style.setProperty('--hl', STEP_COLORS[lit]);
  badge.style.setProperty('--tx', STEP_INK[lit]);

  // Counting up reads as the number being worked out rather than asserted.
  if (reducedMotion() || quietHealth) {
    big.textContent = String(score);
  } else {
    const t0 = performance.now();
    const DUR = 750;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / DUR);
      big.textContent = String(Math.round(score * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    big.textContent = '0';
    requestAnimationFrame(step);
  }

  drawGauge(score, band, quietHealth);

  el('legacy-note').hidden = !isLegacy(plan);

  el('health-vars').innerHTML = varsFor(plan).map((v) => {
    const d = plan[v.key] || {};
    const pct = pctOf(plan, v.key);
    const answered = /^You confirmed:/i.test(String(d.evidence));
    const cls = d.inferred ? ' is-inferred' : (answered ? ' is-answered' : '');
    return `
      <div class="var var-${v.key}${cls}${SCORE_PAGES.includes(v.key) ? ' is-link' : ''}"${SCORE_PAGES.includes(v.key)
        ? ` data-go="${v.key}" role="link" tabindex="0" aria-label="Open ${esc(v.label)}"` : ''}${shownParts[v.key] ? ` title="${esc(shownParts[v.key] + riskNote(v.key))}"` : ''}>
        <div class="var-head">
          <span class="var-label">${esc(v.label)}</span>
          <span class="var-value">${pct}<small>%</small></span>
        </div>
        <div class="var-blocks" aria-hidden="true">${blocks(pct)}</div>
      </div>`;
  }).join('');
  // A score opens the page that holds everything behind it.
  renderRaise(plan);
  el('health-vars').querySelectorAll('.var[data-go]').forEach((card) => {
    const go = () => showPage(card.dataset.go);
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

// "Raise the score by": the two or three moves Claude suggests for each score.
function renderRaise(plan) {
  const groups = varsFor(plan).filter((v) => SCORE_PAGES.includes(v.key)).map((v) => {
    const list = Array.isArray((plan[v.key] || {}).raise) ? plan[v.key].raise.filter(Boolean).slice(0, 3) : [];
    return { v, list };
  }).filter((g) => g.list.length);
  el('raise').innerHTML = groups.length ? groups.map(({ v, list }) => `
    <div class="raise-group raise-${v.key}" data-go="${v.key}">
      <p class="raise-head">${esc(v.label)}</p>
      <ul>${list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>`).join('')
    // The general rule, in the open fourth cell of the grid.
    + '<p class="raise-note">In general, scores are raised by assigning owners, specifying dates, and moving tasks from not started/blocked to in progress/completed.</p>'
    : '<p class="hint">Suggestions arrive with the next scan.</p>';
  el('raise').querySelectorAll('.raise-group').forEach((g) =>
    g.querySelector('.raise-head').addEventListener('click', () => showPage(g.dataset.go)));
}

// Ten steps, in three plain zones that match the bands: red, yellow, green.
// No blended orange between them. Each zone brightens a little as it goes.
const STEP_COLORS = ['#ef7f7a', '#f08a80', '#f29686',
  '#f6cf5c', '#f7d469', '#f8d977',
  '#a3d17a', '#93c86a', '#83bf5c', '#72b54f'];

// Darker shades of STEP_COLORS, for text that has to be read.
const STEP_INK = ['#a8231c', '#b02c22', '#b53728',
  '#8a6400', '#8e6900', '#926e00',
  '#4a8424', '#407a1f', '#36701a', '#2b6415'];

const HEALTH_PHRASES = [
  'Not ready to start',          // 0-9
  'Critical gaps everywhere',    // 10-19
  'Shaky foundations',           // 20-29
  'Fragile, needs attention',    // 30-39
  'Taking shape, gaps remain',   // 40-49
  'Halfway there',               // 50-59
  'Mostly on track',             // 60-69
  'Solid footing',               // 70-79
  'In good shape',               // 80-89
  'Ready to land',               // 90-100
];

function stepsOn(pct) {
  return Math.round(pct / 10);
}

// Score bars take their score's own color (set in CSS); only the overall
// gauge uses the red, yellow, green zones.
// Each block is ten points; the one the score lands in fills partway.
function blocks(pct) {
  return STEP_COLORS.map((_, i) => {
    const f = Math.max(0, Math.min(1, (pct - i * 10) / 10));
    const cls = f >= 1 ? 'on' : f > 0 ? 'part' : '';
    return `<i class="${cls}" style="--p:${i};--f:${f.toFixed(2)}"></i>`;
  }).join('');
}

// A half circle of ten segments, filled from the left in the same zones.
function drawGauge(score, band, quiet) {
  const gauge = el('health-bar');
  gauge.className = 'gauge ' + band;
  gauge.setAttribute('aria-valuenow', String(score));

  const cx = 120, cy = 120, r = 92, gap = 2.6;
  const on = stepsOn(score);
  const pt = (deg) => {
    const rad = (Math.PI / 180) * deg;
    return `${(cx + r * Math.cos(rad)).toFixed(2)} ${(cy - r * Math.sin(rad)).toFixed(2)}`;
  };
  const segs = STEP_COLORS.map((c, i) => {
    const from = 180 - i * 18 - gap / 2;
    const to = 180 - (i + 1) * 18 + gap / 2;
    const d = `M ${pt(from)} A ${r} ${r} 0 0 1 ${pt(to)}`;
    const lit = i < on;
    return `<path class="seg${lit ? ' on' : ''}" style="--p:${i}" d="${d}" stroke="${lit ? c : '#ecece8'}"/>`
      + (lit ? `<path class="seg-hatch" style="--p:${i}" d="${d}"/>` : '');
  }).join('');
  el('gauge-svg').innerHTML = `
    <defs>
      <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="3" height="7" fill="rgba(255,255,255,0.32)"/>
      </pattern>
    </defs>${segs}`;
  if (!reducedMotion() && !quiet) replay(gauge, 'is-drawing', 1800);
}

function renderStakeholders(plan) {
  if (!el('stakeholders')) return;   // the section is off the page for now
  const people = Array.isArray(plan.stakeholders) ? plan.stakeholders : [];
  const html = BUCKETS.map((b) => {
    const rows = people.filter((p) => p.bucket === b.key);
    if (!rows.length) return '';
    return `
      <div class="bucket ${b.key}">
        <h3>${esc(b.label)}</h3>
        <ul>${rows.map((p) => `
          <li><b>${esc(p.name)}</b><br><span>${esc(p.note)}</span>
          ${p.ask ? `<br><span class="comms-channel">Ask: ${esc(p.ask)}</span>` : ''}</li>`).join('')}</ul>
      </div>`;
  }).join('');

  el('stakeholders').innerHTML = html || '<p class="hint">Nobody was named in the notes.</p>';

  el('sec-stakeholders').hidden = false;
}


function renderTimeline() {
  const all = timelineMs();
  const end = finalOf(all);
  const steps = byDate(all.filter((m) => m !== end));
  const stops = steps.map((m, i) => `
    <li class="tl-step" style="--i:${i}">
      <span class="tl-node" aria-hidden="true"></span>
      <div class="tl-card">
        <span class="tl-when">${esc(m.date ? shortDate(m.date) : m.label || 'No date')}</span>
        <div><span class="tl-who">${esc(m.title)}</span></div>
        ${m.note ? `<p class="tl-note">${esc(m.note)}</p>` : ''}
      </div>
    </li>`);

  // Today sits after the last milestone that has passed. Stops are evenly
  // spaced, so this marks where today falls in the order, not a scale.
  if (all.length) {
    const passed = steps.filter((m) => m.date && daysUntil(m.date) < 0).length;
    const now = new Date();   // local, so the evening does not read as tomorrow
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    stops.splice(passed, 0, `
    <li class="tl-today" aria-label="Today">
      <span class="tl-today-line" aria-hidden="true"></span>
      <span class="tl-today-label">Today &middot; ${esc(shortDate(todayIso))}</span>
    </li>`);
  }

  // The line ends on the final milestone, in its own shape.
  const launch = end
    ? `<li class="tl-launch" style="--i:${steps.length}">
         <span class="tl-launch-mark" aria-hidden="true"></span>
         <span class="tl-launch-label"><span class="tl-launch-when">${esc(end.date ? shortDate(end.date) : 'No date')}</span><span class="tl-who tl-final-who">${esc(end.title)}</span>${end.note ? `<span class="tl-note">${esc(end.note)}</span>` : ''}</span>
       </li>`
    : '<li class="hint">No milestones yet. Add them below.</li>';

  el('timeline').innerHTML = stops.join('') + launch;
  el('sec-timeline').hidden = false;
  fitTimeline();
}

// The graphic is only as tall as its tallest card needs. Cards sit a fixed
// distance above or below the line, so their reach from the middle does not
// depend on the height; measure it and size the steps to fit. Re-run whenever
// the timeline changes size (shown, resized, cards wrapping differently).
function fitTimeline() {
  const tl = el('timeline');
  if (!tl || !tl.offsetWidth) return;
  let reach = 0;
  tl.querySelectorAll('.tl-card, .tl-launch-label').forEach((c) => {
    const box = c.offsetParent;
    if (!box) return;
    const mid = box.clientHeight / 2;
    reach = Math.max(reach, Math.abs(c.offsetTop - mid), Math.abs(c.offsetTop + c.offsetHeight - mid));
  });
  const h = Math.max(300, Math.ceil(reach * 2 + 28));
  if (tl.style.getPropertyValue('--tl-h') !== h + 'px') tl.style.setProperty('--tl-h', h + 'px');
}
if (window.ResizeObserver) new ResizeObserver(() => fitTimeline()).observe(document.getElementById('timeline'));

function playTimeline() {
  const tl = el('timeline');
  if (!tl || !tl.children.length || reducedMotion()) return;
  tl.classList.remove('is-building');
  void tl.offsetWidth;
  tl.classList.add('is-building');
}

function renderEnablement(plan) {
  const items = (plan.enablement || []).map((e) => `<li>${esc(e)}</li>`).join('');
  if (!el('enablement')) return;   // the section is off the Schedule page
  el('enablement').innerHTML = items ? `<ul class="plan-list">${items}</ul>` : '<p class="hint">Nothing was identified.</p>';
  el('sec-enablement').hidden = false;
}

function renderRisks(plan) {
  const items = (plan.risks || []).map((r) => `
    <li><b>${esc(r.risk)}</b><br>${esc(r.mitigation)}</li>`).join('');
  el('risks').innerHTML = items ? `<ul class="plan-list">${items}</ul>` : '<p class="hint">No risks were identified.</p>';
  el('sec-risks').hidden = false;
}

function renderChanged() {
  const now = latest(project);
  const before = previous(project);
  const badge = el('health-delta');
  if (!now || !before) { badge.hidden = true; return; }
  badge.hidden = false;
  // Two versions scored by different methods cannot be compared.
  if (isLegacy(before.plan) !== isLegacy(now.plan)) {
    badge.textContent = 're-scored';
    badge.className = 'health-delta';
    return;
  }
  // Compare what is on screen now (date risk included) with the last version.
  const move = (shownScore ?? now.score) - before.score;
  badge.textContent = (move > 0 ? '\u25b2 ' : move < 0 ? '\u25bc ' : '') + Math.abs(move) + '% since v' + before.n;
  badge.className = 'health-delta' + (move < 0 ? ' down' : '');
}

/* ---------- activity ---------- */
// One history per project, newest first. It is written when something happens
// and stored with the project, so it survives a refresh and never has to be
// reconstructed by diffing.

function logActivity(kind, text, details) {
  if (!project) return;
  if (!project.activity) project.activity = [];
  const entry = { at: new Date().toISOString(), kind, text };
  if (details && details.length) entry.details = details;
  project.activity.unshift(entry);
  project.activity = project.activity.slice(0, 40);
}

// What an update changed, worked out once at the moment it happened.
function describeUpdate(before, now) {
  if (isLegacy(before.plan) !== isLegacy(now.plan)) {
    return { text: `Re-scored on the current method: ${now.score}%`, details: [] };
  }
  const details = [];
  for (const v of varsFor(now.plan)) {
    const a1 = before.areas ? before.areas[v.key] : pctOf(before.plan, v.key);
    const b1 = now.areas ? now.areas[v.key] : pctOf(now.plan, v.key);
    if (a1 !== undefined && b1 !== undefined && a1 !== b1) details.push(`${v.label} ${a1}% to ${b1}%`);
  }
  const askedNow = new Set((now.plan.missing || []).map((m) => m.ask));
  for (const m of before.plan.missing || []) {
    if (!askedNow.has(m.ask)) details.push(`Answered: ${m.ask}`);
  }
  const itemsBefore = new Set((before.plan.open_items || []).map((i) => i.task));
  const added = (now.plan.open_items || []).filter((i) => !itemsBefore.has(i.task));
  if (added.length) details.push(`${added.length} new open item${added.length === 1 ? '' : 's'}`);
  const move = now.score - before.score;
  const arrow = move === 0 ? `held at ${now.score}%` : `${before.score}% to ${now.score}%`;
  return { text: `Updated with new context: ${arrow}`, details };
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function renderActivity() {
  const items = ((project && project.activity) || []).slice(0, 8);
  el('activity').innerHTML = items.length ? items.map((e) => `
    <li class="act act-${esc(e.kind)}">
      <span class="act-dot" aria-hidden="true"></span>
      <div>
        <span class="act-text">${esc(e.text)}</span>
        <span class="act-when">${esc(ago(e.at))}</span>
        ${e.details ? `<ul class="act-details">${e.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
      </div>
    </li>`).join('') : '<li class="hint">Nothing has changed yet.</li>';
  el('sec-activity').hidden = false;
}

/* ---------- milestones ---------- */

// The Overview's next three: the soonest milestones that have not passed.
function renderMilestones() {
  const next = byDate(timelineMs()).filter((m) => !m.date || daysUntil(m.date) >= 0).slice(0, 3);
  el('milestones').innerHTML = next.length ? next.map((m) => {
    const n = m.date ? daysUntil(m.date) : null;
    const when = n === null ? '' : n === 0 ? 'Today' : `In ${n} day${n === 1 ? '' : 's'}`;
    return `
    <li class="ms">
      <span class="ms-who">${esc(m.title)}</span>
      <span class="ms-when">${esc(m.date ? shortDate(m.date) : m.label || 'No date')}</span>
      ${when ? `<span class="ms-what">${esc(when)}</span>` : ''}
    </li>`;
  }).join('') : '<li class="hint">No milestones yet.</li>';
  el('sec-milestones').hidden = false;
}

/* ---------- flow ---------- */

// Nothing calls the API until Evaluate is pressed. Questions interrupt the run
// partway through rather than being generated in the background as you type.
let awaitingAnswers = false;

async function build() {
  const notes = el('notes').value.trim();
  if (!notes) return showError('Paste in a program first.');

  // Second press while the questions are up means "go with what I have".
  if (awaitingAnswers) return buildPlan(notes);

  el('error').hidden = true;
  el('run').disabled = true;
  hideQuestions();
  hideResults();
  setStatus('Reading your notes\u2026');
  meterBuild();
  meterRun(PHASE1_CAP, PHASE1_MS);

  let res;
  try {
    res = await post('/api/questions', { notes });
  } catch (err) {
    // Not being able to ask is no reason to refuse to evaluate.
    return buildPlan(notes);
  }

  // The gate decided this is not worth spending on. Say so plainly and stop.
  if (res && res.blocked) {
    meterFinish(false);
    setStatus('');
    showError(res.reason);
    el('run').disabled = false;
    return;
  }

  if (res && res.needed && (res.questions || []).length) {
    meterHold();
    renderQuestions(res.questions);
    awaitingAnswers = true;
    el('run').disabled = false;
    setStatus('Answer below, or press Evaluate to continue.');
    el('questions-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  return buildPlan(notes);
}

async function buildPlan(notes) {
  const { answers, unanswered } = collectAnswers();
  awaitingAnswers = false;

  el('error').hidden = true;
  el('run').disabled = true;
  setStatus('Evaluating\u2026');
  if (!el('meter').classList.contains('is-on')) meterBuild();
  meterRun(1, PHASE2_MS);

  try {
    const plan = await post('/api/plan', {
      notes, answers, unanswered,
      added: pendingAdded || undefined,
      items: pendingItems || undefined,
      deliverables: (pendingBoards || {}).deliverables,
      communications: (pendingBoards || {}).communications,
      measures: (pendingBoards || {}).measures,
      milestones: pendingMs || undefined,
      previousNotes: pendingAdded ? (latest(project) || {}).notes : undefined,
    });

    // A gate declined to spend. That is a result, not a failure.
    if (plan.blocked) {
      meterFinish(false);
      setStatus('');
      el('add-status').textContent = plan.reason;
      // On the start page there is no context box to say it in.
      if (!document.body.classList.contains('state-board')) showError(plan.reason);
      pendingAdded = null;
      return false;
    }
    lastPlan = plan;
    meterFinish(true);
    setConnection(true, null, 'Last call succeeded');
    const full = answers.length
      ? notes + '\n\n' + answers.map((x) => `${x.question}\n${x.answer}`).join('\n\n')
      : notes;
    if (full !== notes) {
      el('notes').value = full;
      el('notes-echo').textContent = full;
    }
    logSavedChanges();
    // The edits are now part of the new version, so they stop being drafts
    // before it is scored from its own tiles.
    clearStaged();
    recordVersion(full, plan, pendingAdded);
    pendingAdded = null;
    pendingItems = null;
    pendingBoards = null;
    pendingMs = null;
    if (clearHeldOnSave) project.held = [];
    clearUndo(PLAN_UNDO_KEYS());
    renderSummary(plan);
    seedItems(plan);
    seedBoards(plan);
    seedMilestones(plan);
    renderHealth(plan);
    renderStakeholders(plan);
      renderTimeline();
    renderMsEditor();
    renderEnablement(plan);
    renderRisks(plan);
      renderPeople();
    hideQuestions();
    enterBoard(plan);
    renderChanged();
    renderMilestones();
    renderActivity();
    showPage('overview');
    revealResults();
    setStatus('Done.');
    el('add-notes').value = '';
    project.contextDraft = '';
    el('add-status').textContent = '';
    renderScans();
    await saveProject();
    await refreshSwitcher();
    el('sec-overview').scrollIntoView({ behavior: 'smooth', block: 'start' });
    renderPending();
    return true;
  } catch (err) {
    meterFinish(false);
    showError(err.message);
    setStatus('');
    checkConnection();
    return false;
  } finally {
    el('run').disabled = false;
  }
}

// After a run or when a project opens: the score row and the open page enter.
function revealResults() {
  animateHealth();
  animatePage(document.body.dataset.page || 'overview');
}

function planAsText() {
  if (!lastPlan) return '';
  const p = lastPlan;
  const s = p.summary || {};
  const out = [
    (p.program || 'Program').toUpperCase(), '',
    'THE CALL', s.call, '',
    'BIGGEST RISK', s.risk, '',
    'WHAT I NEED FROM YOU', s.ask, '',
    'DELIVERY HEALTH: ' + healthScore(p) + '%', '',
    'MILESTONES',
    ...byDate(savedMs()).map((m) => `  ${m.date ? shortDate(m.date) : m.label || 'No date'}  ${m.title}`), '',
    'ENABLEMENT',
    ...(p.enablement || []).map((e) => '  - ' + e), '',
    'IS IT ON TRACK? (leading indicators)',
    ...(p.tracking || []).map((m) => `  - ${m.metric}: ${m.target}${m.check ? ` [${m.check}]` : ''} (miss means: ${m.bad})`), '',
    'DID IT WORK? (outcomes)',
    ...(p.success || []).map((m) => `  - ${m.metric}: ${m.target} (miss means: ${m.bad})`), '',
    'TOP RISKS',
    ...(p.risks || []).map((r) => `  - ${r.risk}\n    ${r.mitigation}`),
  ];
  if ((p.gaps || []).length) out.push('', 'GAPS', ...p.gaps.map((g) => '  - ' + g));
  return out.join('\n');
}

function copy(text, btn) {
  navigator.clipboard.writeText(text).then(
    () => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1600); },
    () => showError('Could not copy. Select the text instead.')
  );
}

/* ---------- "why score like this" ---------- */
// All three ways in (hover, keyboard focus, click) resolve through one state
// object, so dismissing it actually dismisses it. A CSS :hover rule would
// override the class and leave the panel stuck open after Escape.
function setupWhy() {
  const btn = el('why-btn');
  const pop = el('why-pop');
  if (!btn || !pop) return;

  const state = { hovering: false, focused: false, pinned: false, dismissed: false };

  function sync() {
    const open = state.pinned || (!state.dismissed && (state.hovering || state.focused));
    pop.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
  }

  const wrap = btn.parentElement;
  wrap.addEventListener('mouseenter', () => { state.hovering = true; sync(); });
  wrap.addEventListener('mouseleave', () => { state.hovering = false; state.dismissed = false; sync(); });
  btn.addEventListener('focus', () => { state.focused = true; sync(); });
  btn.addEventListener('blur', () => { state.focused = false; state.dismissed = false; sync(); });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.pinned = !state.pinned;
    if (!state.pinned) state.dismissed = true;
    sync();
  });

  // Escape keeps focus on the button — closing shouldn't cost you your place.
  // Dismissing only counts when the panel was open; otherwise a click anywhere
  // on the page would stop the next hover from opening it.
  const dismiss = () => {
    const wasOpen = pop.classList.contains('is-open');
    state.pinned = false;
    if (wasOpen) state.dismissed = true;
    sync();
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(); });
  document.addEventListener('click', (e) => {
    if (pop.contains(e.target) || e.target === btn) return;
    dismiss();
  });
}

/* ---------- connection status ---------- */
// Reflects whether a real call would reach the API. A failed call downgrades
// it immediately, so the header never claims a connection that isn't there.
function setConnection(connected, model, reason) {
  if (model) el('conn-model').textContent = 'Powered by ' + model;
  el('conn-state').textContent = connected ? 'Connected' : 'Disconnected';
  el('conn-dot').className = 'conn-dot ' + (connected ? 'up' : 'down');
  el('conn').title = reason || '';
}

async function checkConnection() {
  try {
    const res = await fetch('/api/status', { method: 'POST' });
    const data = await res.json();
    setConnection(!!data.connected, data.model, data.reason);
  } catch {
    setConnection(false, null, 'Server unreachable');
  }
}

// The box starts empty. Examples are there if you want one, not imposed.
// Each click steps to the next, wrapping round once they are exhausted.
function resetAll() {
  clearInterval(meterTimer);
  el('meter').classList.remove('is-on');
  el('meter').innerHTML = '';
  el('notes').value = '';
  clearUndo(PLAN_UNDO_KEYS());
  el('error').hidden = true;
  setStatus('');
  hideQuestions();
  hideResults();
  pendingQuestions = [];
  qAnswers = [];
  qIndex = 0;
  awaitingAnswers = false;
  lastPlan = null;
  el('run').disabled = false;
  enterPrompt();
  el('notes').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

setupWhy();
replay(document.body, 'boot', 1600);
checkConnection();
enterPrompt();
el('add-person').addEventListener('click', addPerson);
importLegacy().then(loadPeople).then(restoreLast);

el('switcher-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleSwitcher(); });
el('new-project').addEventListener('click', newProject);
// The name at the top left goes back to the start page; the project stays saved.
el('brand-home').addEventListener('click', newProject);
el('brand-home').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); newProject(); } });
document.addEventListener('click', (e) => {
  if (!el('switcher').contains(e.target)) toggleSwitcher(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleSwitcher(false); });

// On the board the notes are a record, not an input: one line that opens to
// show them, read only. Changes go through "Add more context".
el('toggle-notes').addEventListener('click', () => {
  const open = el('input-panel').classList.toggle('is-open');
  el('toggle-notes').textContent = open ? 'Hide source notes' : 'View source notes';
  el('toggle-notes').setAttribute('aria-expanded', String(open));
});

el('scan').addEventListener('click', scan);
loadDeveloperNotes();
// On the start page the notes are a panel at the top right, open until
// closed. On the board they are always open in the right rail.
el('devnotes').querySelector('.panel-head').addEventListener('click', () => {
  if (!document.body.classList.contains('state-prompt')) return;
  const open = el('devnotes').classList.toggle('is-open');
  el('devnotes-toggle').setAttribute('aria-expanded', String(open));
  el('devnotes-toggle').setAttribute('aria-label', open ? "Hide developer's notes" : "Show developer's notes");
});
document.querySelectorAll('.sort-btn').forEach((b) => b.addEventListener('click', () => sortNow(b.dataset.sort, b.dataset.by || 'status')));
el('add-milestone').addEventListener('click', addMilestone);
el('ms-save').addEventListener('click', saveTimeline);
el('ms-included-toggle').addEventListener('click', () => { msIncludedOpen = !msIncludedOpen; renderMsEditor(); });
document.querySelectorAll('.undo-btn').forEach((b) => b.addEventListener('click', () => undo(b.dataset.undo)));
trackText('notes', el('notes'));
trackText('add-notes', el('add-notes'));
document.querySelectorAll('.add-item').forEach((b) => b.addEventListener('click', () => addItem(b.dataset.section)));
el('add-notes').addEventListener('input', renderPending);
window.addEventListener('beforeunload', (e) => {
  if (unsavedCount()) e.preventDefault();
});
// Leaving mid-burst still saves it.
window.addEventListener('pagehide', () => { if (autosaveTimer) autosave({ keepalive: true }); });
el('replay-timeline').addEventListener('click', playTimeline);
document.querySelectorAll('.nav-item[data-page]').forEach((item) => {
  item.addEventListener('click', () => showPage(item.dataset.page));
});


// Smooth scroll without losing the anchor behavior when motion is reduced.
document.querySelectorAll('.nav-item[data-sec]').forEach((item) => {
  item.addEventListener('click', (e) => {
    const target = el(item.dataset.sec);
    if (!target || target.hidden) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  });
});
el('reset-all').addEventListener('click', () => {
  if (!confirmDiscard()) return;
  clearStaged();
  resetAll();
});
el('run').addEventListener('click', build);
// The worked example: the server makes a fresh copy, dated to today, and it
// opens like any saved project. No call to Claude.
el('open-example').addEventListener('click', async () => {
  const btn = el('open-example');
  btn.disabled = true;
  try {
    const { id } = await post('/api/example/open', {});
    await loadPeople();
    await openProject(id);
  } catch (err) {
    showError('Could not open the example: ' + err.message);
  } finally {
    btn.disabled = false;
  }
});
el('q-back').addEventListener('click', () => { if (qIndex > 0) { qIndex--; renderQuestion(); } });
el('q-skip').addEventListener('click', () => { qAnswers[qIndex] = null; advance(); });
el('q-skip-all').addEventListener('click', () => {
  qIndex = pendingQuestions.length;
  renderQuestion();
  buildPlan(el('notes').value.trim());
});
el('copy-summary').addEventListener('click', (e) => {
  const p = lastPlan || {};
  copy([briefOf(p), '', 'WHAT I NEED FROM YOU', (p.summary || {}).ask || ''].join('\n'), e.target);
});
el('to-timeline').addEventListener('click', () => showPage('schedule'));
el('notes').addEventListener('input', () => {
  renderPending();
  if (!awaitingAnswers) return;
  awaitingAnswers = false;      // these questions were about the old text
  hideQuestions();
  meterFinish(false);
  setStatus('');
});
