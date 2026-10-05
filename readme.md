# Scope builder

Describe one program in whatever shape your notes are in. Get back a delivery
risk read, an exec summary, and a change-management plan — who to win over, in
what order, and what breaks if you skip a step.

Before it evaluates anything, it reads your notes and asks up to three
questions about the gaps that would change the plan most. They appear below the
input box, one at a time, with a progress bar. Answer them or skip them;
anything you skip shows up in the plan as a flagged risk.

Runs locally. No dependencies, no build step, nothing stored.

## Setup

You need a Claude API key from https://console.anthropic.com.

Create a file called `.env` in this folder:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

## Look around for free

Open the page and press **Open the example** on the start page: a worked
project with two versions, owners, statuses and a change history, with no API
call. Or run without a key:

```
MOCK=1 PORT=3210 node server.js
```

`MOCK=1` serves fixtures and never calls the API.
The header will read Disconnected, which is accurate.

## Run it

```
node --env-file=.env server.js
```

Then open http://localhost:3000

To work on the page without spending anything, `MOCK=1` serves canned fixtures
instead of calling the API:

```
MOCK=1 node server.js
```

The sample programs load automatically, so you can hit **Run triage** straight
away. A four-program run takes about 30-40 seconds: the ranking appears first,
then the memo fills in.

## Projects

Projects live in the visitor's own browser (`localStorage`), so each person
sees only their own work and nothing they make is stored on the server. Each
context update appends a version rather than overwriting. The switcher at the
top of the sidebar moves between them, and the start page offers them under
"Or pick up where you left off".

```json
{ "id": "2026-10-01-crm-territory-a3f2",
  "name": "CRM territory reassignment to segment model",
  "versions": [ { "n": 1, "at": "...", "notes": "...", "score": 35, "plan": {...} } ] }
```

Clearing the browser's site data deletes them. Earlier versions saved projects
as files in `projects/`; start a local server with `IMPORT_LEGACY=1` and the
browser copies them in once.

The worked example on the start page is `example/billing-dashboard-migration.json`.
Each click opens a fresh copy with every date moved forward by the days since
it was saved, so it always looks the same relative to today.

## Putting it online (Vercel)

The page is static; the three calls to Claude run as Vercel functions in
`api/`, which share `lib/core.js` with the local server.

1. Import the GitHub repository in Vercel (Add New, Project). No build settings
   are needed.
2. In the project's Settings, Environment Variables, add `ANTHROPIC_API_KEY`.
   Use a key from its own Console workspace with a spend limit on it.
3. In Storage, add Upstash Redis (free) and connect it to the project. It adds
   `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which the build limit uses.
4. Deploy. On Vercel each visitor gets 3 builds a day (an Evaluate or a Scan
   each); set `BUILD_LIMIT` to change it. Without Redis the count is kept per
   function instance only, which a busy site would not hold to.

## Overview

Four sections, in this order:

- **Project summary**: 2 to 4 sentences for someone who has not read the notes.
- **Tasks**: each score's "to raise this" action, plus every area of ownership
  with nobody assigned. Each carries the score it would lift (`+metrics`) in
  that score's color. Checking off an action logs it and carries it into your next
  update, so the score moves for a reason the model can see.
- **Next milestones**: the first three stops on the timeline.
- **Recent changes**: evaluations, updates with what moved, owners assigned and
  tasks completed, newest first. Stored with the project.

## Pages

Three pages, switched not scrolled, with the health row and the notes rail
persistent across all of them.

| Overview | Timeline | People and tasks | Measure |
|---|---|---|---|
| The call, biggest risk, the ask | The sequence, left to right | Areas of ownership | Who has to move |
| What your last update changed | What has to exist first | The people directory | Tracking and success, top risks |

Each page owns a color: green for Overview, deep orange for Timeline, violet
for People, blue for Measure. The nav, the timeline spine and the focus rings
all follow it.

The sidebar number on each page is the context still missing *there*, so it
reads as a to-do rather than a count of what already exists.

The timeline runs left to right along a spine, stops alternating above and
below it, ending on Launch at the far right. The spine draws itself on arrival
and each stop lands on the part of the line that just appeared; the nodes then
keep emanating so the sequence reads as live. Replay re-runs the build. All of
it is skipped under reduced motion.

## People and tasks

The model returns the distinct areas of ownership a program needs, each with
what it covers and which health variable it would lift once genuinely owned.

Roles the notes named become **unconfirmed placeholders**, so the gaps are
visible without anyone being invented: a placeholder has a name and nothing
else until you attach an email, a Slack handle or a directory link. Attaching
any of them marks the owner confirmed.

The directory lives in the browser beside the projects and is **shared across
every project**; who owns what is stored per version of a project. That split is
what the planned name and handle lookup needs, since searching for a colleague
should not depend on which project is open.

Assigning an owner deliberately does **not** move the health score. The
assignment is not evidence the model saw, so changing the number would make it
untraceable to the notes. The ownership card already says what would raise it.

## Adding context

The rail holds the notes the plan was built from, the open questions, and a box
to answer them. Updating appends to the notes and rebuilds, **skipping the
questions call** since you are already supplying the answer. That makes an
update cheaper than a first run.

Each update appends a version, so the header shows the move (`+13 since v1`)
and Overview lists what changed: which variables shifted, and which open
questions your text closed.

## Layout

Two states, one page.

**Before a run** the page is a single centered column: a title, the box, and
Evaluate. No sidebar, no rail. An empty dashboard is never shown.

**After a run** the shell opens around the same elements. A sidebar on the left
navigates the sections of this evaluation and carries the connection status. A
sticky bar at the top holds the program name and the actions. The main column
holds the plan in reading order. A sticky rail on the right holds the health
score, the gaps, and the one thing you need from the reader, on the only dark
surface on the page.

The notes you pasted collapse into a Source notes card at the top of the main
column rather than being discarded. Without them the evidence quotes cannot be
checked, which is most of the point.

## Input

Paste in whatever you have: bullets, dashes, a numbered list, scratch notes, or
one unbroken block of text. Nothing splits on paragraphs.

The box starts empty. **Generate an Example** steps through fifteen sample
programs, one per click, wrapping round at the end. **Reset all** puts the page
back to its blank opening state.

The examples are deliberately uneven. Most carry an escalating executive and a
fixed external date; a few have neither, and three are process rollouts with no
build estimate at all. If every example carried the same pressure the health
score would read the same every time and the tool would look like it only knows
one answer.

## How it works

Two calls to the Claude API per run.

1. **Questions.** When you press Evaluate, it first reads the notes for the gaps
   that would change the plan — a team that has to act with nobody named, a
   deadline that might not be real. If the notes are complete enough, it asks
   nothing.

2. **The plan.** Your notes plus your answers go in; risk scores, exec summary,
   stakeholder map, plan and metrics come back. Scoring happens in this call, not the
   first, so your answers actually move the numbers — name an owner and
   ownership goes from 1 to 4.

## The progress meter

Nothing calls the API until you press Evaluate. The questions interrupt the run
partway through rather than being generated in the background as you type, so
editing your notes never costs anything.

The bar therefore fills in two phases: about a third during the questions call,
then it holds while you answer, then on to full while the plan is built. The
leading segment keeps pulsing during the hold so a pause does not read as a
stall. Answering the last question continues the run on its own.

The bar under **Evaluate** spans the full width of the box. Its segment count
is computed from the measured width, so the bars stay narrow and upright at any
window size.

It is paced against a typical run rather than driven by real progress — a
single API call reports none. It deliberately stops one segment short and only
fills completely when the response lands, immediately before the results
render, so it can't claim to be finished before it is.

## Design

Type is Geist and Geist Mono, self-hosted in `fonts/` so the page renders
correctly with no network. Figures are set in mono because this is a measuring
instrument and numbers should line up in a column.

The palette is graphite on neutral paper with one accent, a deep green, used
for progress and affirmative state. Amber and red appear only as semantic
status, never as decoration. One radius rule throughout: panels 10px, controls
6px, badges pill.

Three things were deliberately removed as machine-written tells: the serif on
the summary, the uppercase letter-spaced labels above every heading, and the em
dashes. The prompts now forbid em dashes in generated text too, so the model's
own writing does not reintroduce them.

## Motion

Animations are decoration and are treated as such: question cross-fades, the
staggered reveal of the result panels, the risk score counting up, and the
pulse on the leading meter segment. All of it switches off under
`prefers-reduced-motion: reduce`, and the page works identically without it.
That path is covered by its own test.

## Metrics

Two kinds, in their own panel, because they answer different questions at
different times:

- **Is it on track?** Leading indicators watched *during* the rollout — owners
  named, sessions booked, sign-offs gathered. Each carries a cadence. A good
  one moves early enough that you can still act on it.
- **Did it work?** Outcomes judged afterwards — adoption, hours saved, tickets
  avoided. The thing the program existed to change.

Every metric says what a miss means, so a red number comes with its own
interpretation rather than needing one.

## The Delivery Health Score

Four variables, each 1-5, each showing what it was based on. **Higher is better
on every one**, so the score reads the same way as the pieces that make it: a
high number is a healthy program, a low one is fragile.

```
raw   = alignment x2 + ownership x1.5 + simplicity x1.5 + room
score = (raw - 6) / 24 x 100        ->  0-100
```

| Band | Score |
|---|---|
| healthy | 67 and above |
| worth watching | 34 to 66 |
| fragile | 33 and below |

- **Alignment** carries the most weight because programs rarely die
  technically. They die because someone who had to move didn't.
- **Ownership** is whether a named person is accountable on each team that has
  to act. A team without one cannot commit anyone's time.
- **Simplicity** is how self-contained the work is. 5 means one team can land it
  alone; 1 means many orgs have to move together.
- **Schedule room** is how much slack the date leaves, and it carries the least
  weight because a tight date is a risk and a forcing function at once.

Each heading carries its own color so the four read apart without rules
between them.

Evidence comes back in one of three shapes, so you can always tell where a
number came from:

| Shape | Means |
|---|---|
| `"has escalated twice"` | Quoted from your notes |
| `You confirmed: the Support lead owns it` | From your answer to a question |
| `Not stated. Assumed no fixed date` | A gap. Shaded amber |

## Jev gates

Two cheap judgments decide whether a Claude call is worth making. Both run on
the server, both are optional, and both fail **open**.

| Gate | Asks | Saves when it blocks |
|---|---|---|
| New notes | Does this describe a piece of work at all? | 3.2c |
| Added context | Does this state something the notes do not already have? | 2.5c |

They use TypeSafe's Noul primitive through `jev-latest`. Set `TYPESAFE_API_KEY`
to turn them on; without it the app behaves exactly as before. `GATES=0` is a
kill switch with the key still present.

Thresholds are starting points, not settled values: `T_IS_PROGRAMME` (0.35) and
`T_ADDS_SOMETHING` (0.4). Both sit low on purpose, because blocking a real run
is worse than allowing a pointless one. Tune them on your own inputs.

**Failing open is the whole design.** A 500, a timeout, an unreachable host, a
missing key: every one of them skips the gate and runs Claude as normal. A cost
optimization that breaks the tool when a third party has a bad day is not one.
`GATE_TIMEOUT_MS` (4000) caps how long a gate may stall a run.

What the gates deliberately do **not** do: verify that an evidence quote is
verbatim, which `String.includes` does for free, or classify `section` and
`lifts`, where a round trip costs more than the few tokens it saves.

## Cost

Roughly **3.2 cents for a first run, 2.5 for an update** on Sonnet 5, spread over two calls:

| | Input | Output |
|---|---:|---:|
| Questions call | 907 | 371 |
| Plan call | 2,990 | 2,320 |
| **Total** | **3,897** | **2,691** |

At $2 per million input and $10 per million output that is $0.0310. It rose from 2.3 cents when each score gained a `lift` line and `gaps` became the richer `missing` list. On Haiku
4.5 it would be about 1.2 cents, on Opus 5 about 5.8 cents.

These are measured, not estimated. Output comes from real runs; input is
counted exactly with the `count_tokens` endpoint, which runs no inference and
costs nothing, taken against the longest of the fifteen examples, so it is a
worst case rather than an average. The server prints the true token count of
every call.

Four things keep it down:

- **`effort: "low"`.** At Sonnet's default effort, adaptive thinking spent
  about 2,400 output tokens per run on reasoning nobody ever sees, half the
  bill, and occasionally ran the response into the token ceiling mid-JSON.
  This is structured extraction and short-form writing, not deep reasoning, so
  low effort costs nothing in quality here. It cut spend 54% and time by two
  thirds. Override with `EFFORT=high` to compare.
- **Two calls, not three.** Asking questions would naturally be its own call,
  plus one to score and one to plan. Scoring is folded into the plan call
  instead, which also means your answers move the numbers.
- **Hard caps in the prompt.** Five comms steps, three risks, three metrics of
  each kind, one sentence each. Output costs five times what input does, so
  length is the main lever.
- **`max_tokens` is a backstop, not a budget.** Set to 8,000. You are billed on
  what comes back, so a generous ceiling is free and stops truncation.

Prompt caching is not used, deliberately: the system prompts sit near or under
Sonnet 5's 1,024-token minimum cacheable prefix, so a cache marker would
silently do nothing. Worth re-checking if the prompts grow. Batching does not
apply either, since you are waiting on the answer.

## Tests

```
cd tests && node run-all.mjs
```

Run them against a MOCK server on port 3211 (`PORT=3211 MOCK=1 node server.js`)
so they cost nothing; `limit-test` and `gate-test` start their own servers.
They cover every page, the scoring, autosave, scans and reverts, the worked
example, browser storage, the build limit, motion and six viewport widths.

## Changing it

| What | Where |
|---|---|
| Risk weights | `RISK_VARS` in `app.js` |
| Scale definitions | `plan-prompt.md` |
| What gets asked | `questions-prompt.md` |
| Plan structure and tone | `plan-prompt.md` |
| Metric definitions | `plan-prompt.md` |
| Example programs | `examples.txt`, separated by `---` |
| Model | `MODEL` env var, defaults to `claude-sonnet-5-5` |
| Effort | `EFFORT` env var, defaults to `low` |

To swap the model for a run:

```
MODEL=claude-opus-5     node --env-file=.env server.js
MODEL=claude-haiku-4-5  node --env-file=.env server.js
```

Sonnet 5 is $2/$10 per million tokens, Opus 5 is $5/$25, Haiku 4.5 is $1/$5.
Haiku halves the bill but paraphrases instead of quoting your notes, invents
stakeholders who aren't in the text, and misread the Q3 blocker when tested —
not worth one cent a run on a tool whose whole point is that the output holds
up.
