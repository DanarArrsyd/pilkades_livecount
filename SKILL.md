# SKILL.md

## Skill Profile

Skill name: **Caveman Engineering Mode**

Purpose:

This skill defines how the AI should think, communicate, design, and implement the Pilkades Live Count project.

The AI must produce outputs that are:

- concise
- clear
- practical
- implementation-focused
- low-noise
- easy to scan
- technically correct
- visually thoughtful
- safe for production use

The AI must avoid unnecessary explanation, repeated context, theoretical detours, and bloated architecture.

Think deeply internally.

Respond simply externally.

---

## Core Communication Rule

Use **Caveman Mode**.

Meaning:

- Short explanation first.
- Direct answer first.
- Use simple wording.
- Prefer examples over long theory.
- Prefer code over vague instructions.
- Prefer one good solution over five mediocre options.
- Explain tradeoffs only when they matter.
- Do not repeat the user's request.
- Do not over-explain obvious code.
- Do not generate giant walls of text unless explicitly requested.

Preferred style:

```text
Problem:
...

Solution:
...

Code:
...

Why:
...
```

Avoid:

```text
There are many possible approaches...
It depends...
You could consider...
Another alternative might be...
```

unless the tradeoff is genuinely important.

---

## Output Priority

For every technical task, prioritize:

1. Correctness
2. Data integrity
3. Usability
4. Simplicity
5. Security
6. Performance
7. Maintainability
8. Visual polish

Do not sacrifice data integrity for a prettier interface.

---

## Project Context

This project is a real-time Pilkades vote counting system with:

- 1 admin/operator
- 40 TPS
- 5 candidates
- one-vote-at-a-time input
- real-time public dashboard
- Supabase backend
- public read-only viewers
- audit logging
- TPS verification and lock
- candidate photos
- overall and per-TPS result views

This is not an online voting system.

The system records physical vote-counting results.

---

# SKILL: FRONTEND UI/UX

## Goal

Create a fast, readable, professional interface for live vote counting.

The UI must reduce operator mistakes.

The public dashboard must be easy to understand within seconds.

---

## Admin UI Priorities

The admin input page must prioritize:

- active TPS visibility
- candidate input speed
- last input visibility
- connection status
- undo
- TPS status
- current TPS totals
- zero unnecessary distractions

Do not make the admin hunt through menus during live counting.

---

## Admin Input Layout

Preferred hierarchy:

```text
ACTIVE TPS
↓
Candidate buttons
↓
Current totals
↓
Last input
↓
Undo
↓
Connection state
↓
Recent TPS
```

The active TPS number should be visually dominant.

Example:

```text
ACTIVE TPS
07
COUNTING
```

---

## Keyboard UX

Primary operation must work without mouse.

Required:

```text
1 = Candidate 1
2 = Candidate 2
3 = Candidate 3
4 = Candidate 4
5 = Candidate 5
0 = Invalid vote
Backspace = Undo
```

Rapid TPS switching should be supported.

Example:

```text
/7
/4
/11
```

Never require dropdown-heavy navigation during counting.

---

## Public Dashboard UX

The public dashboard should answer these questions immediately:

1. Who is currently leading?
2. How many votes does each candidate have?
3. What percentage does each candidate have?
4. How many TPS are complete?
5. How many total votes are counted?
6. Which TPS are still counting?
7. What is the result in each TPS?
8. When was the dashboard last updated?

---

## Candidate Card Design

Each candidate card should contain:

- photo
- candidate number
- candidate name
- vote count
- percentage
- visual progress
- rank if useful

Keep candidate cards visually equal.

Do not make the leader card so dominant that the interface looks biased.

---

## Chart Rules

Use charts only if they improve comprehension.

Preferred:

- horizontal bar chart for candidate comparison

Optional:

- doughnut chart for vote share

Avoid:

- excessive pie charts
- animated gimmicks
- 3D charts
- decorative charts without decision value

---

## Responsive Design

Public dashboard:

- mobile first
- tablet friendly
- desktop friendly

Admin input:

- desktop/laptop first
- tablet second
- mobile fallback only

---

## Visual Style

Preferred:

- clean
- modern
- professional
- data-first
- high contrast
- clear typography
- restrained shadows
- strong spacing

Avoid:

- glassmorphism
- excessive gradients
- neon visuals
- over-animation
- campaign-style decorative visuals
- UI that resembles a gambling dashboard

---

## Accessibility

Ensure:

- sufficient contrast
- readable font sizes
- visible focus states
- status does not rely only on color
- buttons are large enough for touch
- candidate numbers remain visible even if photos fail

---

# SKILL: DATABASE DESIGN

## Goal

Protect vote integrity and keep queries simple.

Use PostgreSQL through Supabase.

---

## Core Tables

Use at minimum:

```text
profiles
elections
candidates
tps
vote_events
vote_summary
activity_logs
system_settings
snapshots
```

---

## Vote Storage Rule

One physical announced vote equals one database event.

Do not store only final totals.

Example:

```text
TPS 07
Candidate 3
09:45:12
```

becomes one row in `vote_events`.

---

## Event Integrity

Every vote event should have:

```text
id
client_event_id
election_id
tps_id
candidate_id
vote_type
status
created_at
created_by
```

Corrections must not destroy historical data.

Use:

```text
status = cancelled
```

instead of deleting vote history.

---

## Summary Strategy

Public dashboard must read summary data.

Do not make public clients repeatedly aggregate all raw events.

Maintain:

- per-TPS candidate totals
- overall candidate totals
- valid votes
- invalid votes
- TPS progress

Use:

- trigger
- database function
- RPC
- optimized view

whichever is simplest and reliable.

---

## Indexing

Add indexes for common access patterns.

Recommended:

```text
vote_events(tps_id)
vote_events(candidate_id)
vote_events(created_at)
vote_events(status)
vote_events(client_event_id)
vote_summary(tps_id, candidate_id)
activity_logs(created_at)
```

Use unique index on `client_event_id`.

---

# SKILL: SUPABASE

## Goal

Use Supabase simply and safely.

Use:

- PostgreSQL
- Auth
- Realtime/Broadcast
- Row Level Security
- RPC / Functions where needed

---

## Public Access

Public users may read:

- candidate data
- TPS public metadata
- vote summary
- public election status

Public users must not:

- insert votes
- update votes
- delete votes
- modify candidates
- access private logs
- change settings

---

## Admin Access

Only authenticated authorized admin can mutate data.

Never expose:

- service role key
- database password
- private secrets

Client-side code may only use the public anon key.

---

## RLS Rule

Enable RLS on every public-facing table.

Never rely on hidden buttons as security.

Frontend restriction is not authorization.

---

## Realtime Strategy

Admin input:

- write immediately

Public dashboard:

- consume summary updates
- avoid raw vote event subscriptions
- batch updates if needed

Recommended public update interval:

```text
500 ms - 1 second
```

---

# SKILL: OFFLINE RELIABILITY

## Goal

Do not lose votes because Wi-Fi decides to become philosophical.

---

## Offline Queue

When offline:

- keep input available
- store pending event locally
- assign unique `client_event_id`
- show pending count
- sync when online
- prevent duplicate insert

---

## Connection States

Always show:

```text
ONLINE
SYNCING
OFFLINE
```

Never silently fail.

---

## Idempotency

Every local vote event must have a stable client ID.

Retries must not create duplicate votes.

Database should enforce uniqueness.

---

# SKILL: DATA VALIDATION

## Goal

Catch human mistakes early.

---

## Validate

- candidate exists
- TPS exists
- TPS is not locked
- TPS belongs to active election
- candidate is active
- duplicate event ID does not exist
- TPS vote limit is not silently exceeded

---

## DPT Limit

If configured:

```text
total_votes > dpt_limit
```

Show warning.

Do not silently discard the vote.

Flag the TPS for verification.

---

# SKILL: AUDIT TRAIL

## Goal

Every important action should be explainable later.

Log:

- login
- logout
- vote input
- undo
- TPS switch if useful
- TPS start
- TPS pause
- TPS resume
- TPS complete
- verify
- lock
- unlock
- candidate edit
- settings change
- export

---

## Activity Log Format

Recommended:

```text
timestamp
actor
action
entity
details
```

Example:

```text
09:45:12
Admin
VOTE_CANCELLED
TPS 07
Candidate 3
```

---

# SKILL: SECURITY

## Goal

Protect vote data from unauthorized changes.

---

## Required Security

- Supabase Auth
- RLS
- read-only public access
- admin-only mutations
- HTTPS
- no secrets in frontend
- no direct service-role usage in browser
- locked TPS protection
- audit trail
- unique event IDs

---

## Dangerous Actions

Require confirmation for:

- unlock TPS
- reset election
- delete test data
- change candidate identity
- change TPS configuration
- reset summaries

Production destructive actions should be hard to trigger accidentally.

---

# SKILL: TESTING

## Goal

Test the things most likely to fail under pressure.

---

## Vote Input Tests

Test:

```text
1 1 1 1 1
1 2 3 4 5
rapid alternating input
TPS switching
undo
double keypress
offline
reconnect
duplicate retry
```

---

## TPS Tests

Test:

- not started
- start
- pause
- resume
- complete
- verify
- lock
- unlock
- input blocked while locked

---

## Summary Tests

Assert:

```text
active vote events
=
TPS summary
=
overall summary
```

Cancelled events must not count.

---

## Public Tests

Test:

- zero data
- partial count
- 40 TPS
- candidate percentages
- mobile view
- realtime reconnect
- stale data state

---

# SKILL: PERFORMANCE

## Goal

Keep public viewing light.

---

## Rules

Do:

- query summary
- cache stable metadata
- use compact realtime payloads
- optimize image size
- lazy load non-critical sections
- index important columns

Do not:

- query every vote event for every viewer
- resend candidate photos on every realtime event
- redraw every chart unnecessarily
- reload the full page on update

---

# SKILL: CODE QUALITY

## Goal

Keep code readable and boring.

Boring code is good code during election day.

---

## JavaScript

Prefer:

- small modules
- named functions
- clear event handlers
- async/await
- explicit error states

Avoid:

- giant 1000-line files
- deep callback nesting
- hidden global state
- clever one-liners
- unnecessary libraries

---

## CSS

Prefer:

- CSS variables
- consistent spacing
- reusable classes
- clear component naming
- responsive layout

Avoid:

- inline style everywhere
- random magic values
- duplicated design rules

---

## Supabase Client

Create a dedicated module.

Example:

```text
js/
  supabase.js
  auth.js
  vote-input.js
  realtime.js
  dashboard.js
  offline-queue.js
```

---

# SKILL: ERROR HANDLING

## Goal

Errors must tell the operator what happened.

Bad:

```text
Error.
```

Good:

```text
TPS 07 Candidate 3 was not synced.
Saved locally.
Will retry automatically.
```

---

## Error Priority

Distinguish:

- warning
- recoverable error
- critical error

Never use the same UI treatment for all errors.

---

# SKILL: DEPLOYMENT

## Preferred

Frontend:

```text
Vercel
```

Backend:

```text
Supabase
```

---

## Environment Variables

Use environment variables for:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

Do not store secrets inside committed JS files.

---

# SKILL: FILE ORGANIZATION

Recommended:

```text
/
├── CLAUDE.md
├── SKILL.md
├── DESIGN.md
├── README.md
├── DATABASE.md
├── SECURITY.md
│
├── index.html
├── login.html
│
├── admin/
│   ├── index.html
│   ├── input.html
│   ├── tps.html
│   ├── candidates.html
│   ├── logs.html
│   └── settings.html
│
├── live/
│   ├── index.html
│   └── tps.html
│
├── css/
│   ├── variables.css
│   ├── base.css
│   ├── admin.css
│   └── dashboard.css
│
├── js/
│   ├── supabase.js
│   ├── auth.js
│   ├── vote-input.js
│   ├── tps-switch.js
│   ├── realtime.js
│   ├── dashboard.js
│   ├── offline-queue.js
│   └── utils.js
│
└── assets/
    └── images/
```

Exact structure may be simplified.

Do not create folders with no real purpose.

---

# SKILL: DEVELOPMENT WORKFLOW

When asked to implement a feature:

1. Read `CLAUDE.md`.
2. Read `DESIGN.md`.
3. Read `SKILL.md`.
4. Identify affected database and UI components.
5. Implement the smallest reliable solution.
6. Validate security.
7. Test edge cases.
8. Report only important changes.

---

## AI Response Format

When completing coding work, prefer:

```text
Done.

Changed:
- ...
- ...
- ...

Important:
- ...

Files:
- ...
```

Do not write an essay after every implementation.

---

# SKILL: DECISION MAKING

When multiple approaches exist:

Choose the one that is:

1. safer
2. simpler
3. easier to debug
4. easier to maintain
5. fast enough

Avoid overengineering.

Examples:

Prefer:

```text
Supabase RPC
```

over introducing a custom backend server if RPC solves the problem cleanly.

Prefer:

```text
Vanilla JavaScript
```

over React if the interface does not require React.

Prefer:

```text
one reliable chart
```

over five decorative charts.

---

# SKILL: PRODUCTION MINDSET

Before adding a feature, ask:

```text
Does this help the operator?
Does this help viewers understand results?
Does this reduce mistakes?
Does this improve reliability?
```

If all answers are no:

Do not add it.

---

# Final Skill Principle

Build the system like election day will be noisy, rushed, and imperfect.

The UI should stay calm.

The database should stay strict.

The audit trail should remember everything.

The AI should keep its answers short and useful.
