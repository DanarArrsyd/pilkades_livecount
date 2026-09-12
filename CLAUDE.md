# CLAUDE.md

## Project Overview

Project name: **Pilkades Live Count**

Pilkades Live Count is a web-based real-time vote counting and public monitoring system for a village head election.

The system is designed for:

- 1 administrator/operator.
- 40 polling stations (TPS).
- 5 candidates.
- One-vote-at-a-time input.
- Real-time public dashboard.
- Detailed per-TPS and overall vote results.
- Full activity and vote-event audit trail.

This system is **not an electronic voting system**.

Voters do not vote through this application.

The application is used to record vote counting results as votes are announced at each TPS and to display the running count in real time.

---

## Primary Goals

The system must prioritize:

1. Fast one-vote-at-a-time input.
2. Very low operator interaction overhead.
3. Protection against accidental input.
4. Clear TPS context while entering votes.
5. Reliable vote-event history.
6. Real-time aggregate results.
7. Read-only public dashboard.
8. Accurate per-TPS and overall summaries.
9. Easy correction without destroying audit history.
10. Resilience against unstable internet connectivity.

---

## Technology Stack

### Frontend

Use:

- HTML5
- CSS3
- Vanilla JavaScript
- Chart.js

Avoid adding frontend frameworks unless there is a clear technical reason.

The application should remain lightweight and easy to deploy.

### Backend

Use:

- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Realtime / Broadcast
- PostgreSQL functions and/or triggers when useful

### Hosting

Preferred deployment:

- Vercel

Alternative:

- Netlify
- Cloudflare Pages

---

## User Roles

The system currently has only two access levels.

### Admin

Only one administrator/operator account is required.

Admin capabilities:

- Login.
- Start TPS counting.
- Pause TPS counting.
- Input individual votes.
- Switch TPS.
- Undo incorrect vote input.
- Verify TPS totals.
- Lock TPS.
- Unlock TPS with mandatory correction reason.
- View all TPS data.
- View public-style dashboard.
- View activity logs.
- Export results.
- Manage candidates.
- Manage TPS configuration.
- Manage election settings.

### Public Viewer

Public users:

- Do not need login.
- Have read-only access.
- Can view total vote results.
- Can view candidate percentages.
- Can view TPS progress.
- Can view per-TPS results.
- Cannot modify any data.

---

## Election Configuration

Default project configuration:

- Number of TPS: 40
- Number of candidates: 5
- Number of admins: 1

Do not hard-code candidate names, photos, DPT values, or TPS totals into UI components.

Store configurable data in the database.

---

## Core Vote Input Rule

The most important system rule is:

> One announced vote equals one input event.

Example:

A vote-counting officer announces:

- Candidate 1
- Candidate 2
- Candidate 3
- Candidate 3
- Candidate 1

The admin should be able to enter:

`1 2 3 3 1`

Each keystroke creates one independent vote event.

Never design the primary counting workflow around manually entering final candidate totals.

---

## Rapid Input Modes

The system should support two primary input methods.

### Focused TPS Mode

The admin activates one TPS.

Example:

`TPS 07`

While TPS 07 is active:

- Key `1` = Candidate 1 +1
- Key `2` = Candidate 2 +1
- Key `3` = Candidate 3 +1
- Key `4` = Candidate 4 +1
- Key `5` = Candidate 5 +1
- Key `0` = Invalid vote +1, if invalid-vote tracking is enabled
- Backspace = undo last vote event

The currently active TPS must always be highly visible.

Example:

`ACTIVE TPS: 07`

### Rapid TPS Switch Mode

The operator must be able to switch TPS without navigating to another page.

Preferred concept:

`/7` -> switch to TPS 07  
`/4` -> switch to TPS 04  
`/11` -> switch to TPS 11

When several TPS results arrive in an interleaved sequence, support a compact input format.

Example:

`071` = TPS 07, Candidate 1  
`042` = TPS 04, Candidate 2  
`113` = TPS 11, Candidate 3

The exact implementation can be refined, but switching TPS must never require opening a new page or navigating through dropdown-heavy forms.

---

## TPS Status Flow

Every TPS must have a status.

Allowed statuses:

1. `not_started`
2. `counting`
3. `paused`
4. `completed`
5. `locked`

Recommended flow:

`not_started -> counting -> paused/counting -> completed -> locked`

Locked TPS records must not accept normal vote input.

Unlocking a TPS must:

- Require administrator confirmation.
- Require a correction reason.
- Create an activity log entry.

---

## Vote Event Model

Do not store only final totals.

Each vote must be recorded as an event.

Recommended fields:

```text
id
election_id
tps_id
candidate_id
vote_type
status
created_at
created_by
cancelled_at
cancelled_by
cancel_reason
client_event_id
```

Suggested `vote_type`:

- `candidate`
- `invalid`

Suggested `status`:

- `active`
- `cancelled`

Never physically delete vote events during normal operation.

If the admin performs Undo:

- mark the vote event as cancelled;
- preserve the original event;
- record the cancellation in the activity log.

---

## Summary Data

Public dashboards should not repeatedly aggregate the entire raw event table in the browser.

Maintain efficient summary data.

Recommended summary structures:

### TPS Summary

For each TPS:

```text
tps_id
candidate_1_votes
candidate_2_votes
candidate_3_votes
candidate_4_votes
candidate_5_votes
invalid_votes
valid_votes
total_votes
updated_at
```

A normalized alternative is acceptable if it is cleaner.

### Overall Summary

The system must provide:

- Candidate total votes from all TPS.
- Candidate percentage.
- Total valid votes.
- Total invalid votes.
- Total votes counted.
- TPS completed.
- TPS locked.
- TPS still counting.

---

## Percentage Formula

Candidate percentage must use valid votes as the denominator unless election rules explicitly require otherwise.

Formula:

```text
candidate_percentage =
candidate_total_votes / total_valid_votes * 100
```

Handle zero valid votes safely.

Never display `NaN`, `Infinity`, or broken percentage values.

---

## TPS Validation

Each TPS may have a configured voter/DPT limit.

The system should warn when:

```text
total_votes > configured_tps_limit
```

Recommended validation states:

- normal
- approaching_limit
- exceeded_limit

Exceeding the limit must create a prominent warning.

Do not silently block data unless explicitly configured, because the operator may need to record a disputed count for later verification.

---

## Verification

After counting is completed for a TPS:

1. Admin reviews totals.
2. Compare system total against official TPS count.
3. Mark TPS as verified if correct.
4. Add optional verification notes.
5. Lock TPS.

Recommended fields:

```text
is_verified
verified_at
verified_by
verification_note
```

---

## Undo and Corrections

### Undo

Backspace should undo the most recent eligible input.

The UI must display what was undone.

Example:

```text
UNDO
TPS 04
Candidate 2
09:41:18
```

### Correction After Completion

Do not directly overwrite totals.

Corrections should be represented through event actions.

Examples:

- cancel incorrect vote event;
- add correction vote event;
- record reason.

Every correction must remain auditable.

---

## Activity Logging

Create an immutable activity log for important actions.

Track at minimum:

- admin login
- admin logout
- TPS counting started
- TPS paused
- TPS resumed
- TPS completed
- TPS locked
- TPS unlocked
- vote added
- vote cancelled
- verification performed
- settings changed
- candidate data changed
- TPS data changed
- export generated

Recommended fields:

```text
id
actor_id
action
entity_type
entity_id
details
created_at
```

Use JSON for `details` when useful.

---

## Offline and Connectivity Behaviour

The input page must clearly show connectivity status.

States:

- ONLINE
- SYNCING
- OFFLINE

Never allow the UI to silently pretend an unsynced vote has been safely stored.

### Offline Queue

Where practical:

- generate a unique client event ID;
- store unsynced input locally;
- retry when connection returns;
- prevent duplicate inserts;
- show pending event count.

Example:

```text
OFFLINE
7 votes waiting to sync
```

When reconnected:

```text
SYNCING 7 EVENTS
```

After success:

```text
ONLINE
All votes synced
```

Idempotency is important.

A retried event must not create duplicate votes.

---

## Public Dashboard

The public dashboard must prioritize readability.

### Header Summary

Display:

- election title
- village name
- live/temporary result status
- total TPS
- TPS completed
- TPS locked
- total valid votes
- invalid votes
- total votes counted
- last updated timestamp

### Candidate Cards

Display all 5 candidates.

Each candidate card includes:

- candidate photo
- candidate number
- candidate name
- total votes
- percentage
- visual progress indicator
- current ranking where appropriate

### Result Status

While counting is incomplete, show:

`HASIL SEMENTARA`

When all 40 TPS have been completed, verified, and/or locked according to configured election rules, show:

`PENGHITUNGAN SELESAI`

Do not imply official certification unless the application is actually authorized to provide an official result.

Prefer wording such as:

- Live Count
- Hasil Sementara
- Rekapitulasi Sistem
- Data TPS Masuk

---

## Per-TPS Dashboard

Public viewers should be able to inspect each TPS.

Example:

```text
TPS 07

Candidate 1    124
Candidate 2     98
Candidate 3    137
Candidate 4     76
Candidate 5     54
Invalid          3

Valid votes     489
Total votes     492
Status          Locked
```

Support browsing TPS 01 through TPS 40.

---

## Public Dashboard Performance

Public clients should read summary data, not the raw vote-event history.

Avoid:

```sql
SELECT * FROM vote_events
```

for the public dashboard.

Prefer:

- summary table
- optimized view
- database RPC
- server-generated aggregate
- Supabase Broadcast with compact payload

Realtime messages should preferably contain only values required to refresh visible summaries.

Do not expose sensitive audit information publicly.

---

## Realtime Rules

Admin vote input should feel instantaneous.

The database remains the source of truth.

Public dashboards may receive batched/aggregated updates at a small interval if required for scale.

For example:

- admin vote events stored individually;
- summaries updated immediately;
- public dashboard refreshed/broadcast every 500 ms to 1 second.

This is still considered real-time for public viewing while reducing excessive realtime traffic.

---

## Security Rules

Use Supabase Row Level Security.

### Public

Public users may:

- read candidates;
- read approved TPS metadata;
- read public summary data.

Public users may not:

- insert votes;
- update votes;
- delete votes;
- read private admin logs;
- modify candidates;
- modify election settings.

### Admin

Only authenticated authorized admin accounts can mutate election data.

Never expose the Supabase service-role key in frontend code.

Use only the public anon key in client-side code.

Sensitive privileged operations should use secure backend/server logic, RPC functions, or Edge Functions where necessary.

---

## Data Integrity Rules

The following are mandatory:

- Every vote event has a unique ID.
- Use server timestamps where possible.
- Prevent duplicate client events.
- Locked TPS cannot receive normal input.
- Undo never permanently erases history.
- Summary values must be derivable from event data.
- Candidate percentages must be calculated consistently.
- Public clients are read-only.
- All privileged actions require authentication.
- No direct manual manipulation of production tables through frontend developer tools.

---

## Input UX Requirements

The admin input screen must be optimized for speed.

### Required visual elements

- Active TPS displayed prominently.
- Candidate buttons numbered 1–5.
- Candidate names visible.
- Candidate current TPS totals.
- Last input.
- Undo indicator.
- Connection state.
- Unsynced queue count.
- TPS status.
- Total current TPS votes.

### Keyboard-first operation

The admin must be able to perform normal counting without using the mouse.

Mouse/touch controls should still exist as fallback.

---

## Input Safety

Protect against:

- accidental double click
- keyboard auto-repeat
- duplicate network submission
- switching TPS unintentionally
- entering votes into locked TPS
- browser focus leaving the input area
- page refresh while unsynced events exist

Use debounce/guard logic carefully.

Do not debounce legitimate fast vote inputs into a single event.

Each valid keypress must remain one independent vote.

---

## Visual Design Direction

Style:

- clean
- modern
- professional
- election-monitoring dashboard
- highly readable
- mobile responsive
- desktop optimized for admin input

Avoid:

- excessive gradients
- glassmorphism
- decorative animations that distract from data
- tiny text
- excessive modal dialogs
- complex navigation during live counting

Prioritize state visibility and data clarity.

---

## Candidate Photos

Candidate photos should come from stored candidate data.

Recommended candidate fields:

```text
id
candidate_number
name
photo_url
description
is_active
```

Do not embed candidate photos directly into source code.

---

## Recommended Pages

### Public

```text
/
or /live
/live/tps
/live/tps/:id
```

### Admin

```text
/login
/admin
/admin/input
/admin/tps
/admin/candidates
/admin/logs
/admin/settings
/admin/export
```

---

## Recommended Database Tables

Minimum recommended tables:

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

Optional:

```text
exports
verification_records
sync_events
```

---

## Backup and Snapshots

Use database backups provided by the hosting/database platform where available.

Additionally maintain lightweight election snapshots.

A snapshot should contain:

- timestamp
- candidate totals
- TPS totals
- TPS statuses
- valid votes
- invalid votes

Snapshots are recovery aids and must not replace the event log.

---

## Export Requirements

Admin should be able to export:

- overall result
- result per TPS
- candidate totals
- candidate percentages
- valid/invalid vote summary
- TPS statuses
- verification status
- activity log if required

Preferred formats:

- CSV / Excel-compatible
- PDF report

---

## Error Handling

Errors must be explicit.

Bad:

`Something went wrong.`

Better:

`Vote TPS 07 Candidate 3 was not saved. Connection lost. Event queued locally.`

Never update the visual total as permanently saved unless the system can distinguish:

- confirmed
- pending sync
- failed

---

## Coding Rules

- Prefer simple modules.
- Use semantic naming.
- Avoid unnecessary abstraction.
- Do not introduce a framework only for aesthetics.
- Keep database access in dedicated modules.
- Keep realtime subscriptions isolated.
- Keep input handling isolated from rendering logic.
- Validate data both client-side and server-side.
- Do not trust frontend validation alone.
- Use transactions or database functions for coupled vote-event and summary updates where needed.
- Keep UI state separate from database state.
- Add comments only where logic is not self-explanatory.

---

## Development Priorities

Build in this order:

1. Database schema.
2. Supabase RLS.
3. Authentication.
4. TPS and candidate master data.
5. Vote-event insert.
6. Focused rapid input.
7. Undo.
8. TPS switching.
9. Summary generation.
10. Public dashboard.
11. Realtime updates.
12. TPS verification and lock.
13. Activity logs.
14. Offline queue.
15. Export.
16. Backup/snapshot tooling.
17. UI polish.

Do not start by building decorative charts before the vote-event pipeline is reliable.

---

## Testing Priorities

Test at minimum:

### Vote Input

- rapid repeated candidate input
- candidate switching
- TPS switching
- invalid vote
- accidental double input
- undo
- offline queue
- reconnect sync
- duplicate retry

### TPS

- start
- pause
- resume
- complete
- verify
- lock
- unlock
- over-limit warning

### Dashboard

- zero votes
- partial TPS
- all TPS
- percentage correctness
- realtime updates
- candidate ranking
- mobile view

### Data Integrity

- raw events match summary
- cancelled events excluded
- locked TPS protected
- duplicate client IDs rejected
- public cannot mutate data

---

## Non-Goals

Do not implement unless explicitly requested:

- voter identity management
- online voting by citizens
- biometric voting
- blockchain
- multiple admin hierarchy
- complex role permission matrix
- campaign management
- political messaging
- candidate registration workflow

---

## Final Product Principle

The system should behave like a dependable live counting console.

The operator should be able to focus on listening and pressing keys.

The public should be able to focus on reading clear results.

The application must never trade data integrity for visual polish.
