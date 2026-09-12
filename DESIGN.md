# DESIGN.md

## 0. Visual Design System (mandatory for all UI work)

**Enterprise navy** direction, user-directed (superseded the earlier warm-charcoal/terracotta/Fraunces theme — that direction is retired, do not resurrect it).

Locked tokens for this project (`css/variables.css`, `css/base.css`, `css/nav.css`):

- **Palette** — navy (`#0d1b3e`) + white, with a light gray page canvas (`--color-bg: #eef0f5`, not stark white) so content panels read as filled cards rather than floating in empty space. Navy for topbars (solid fill, white text/hamburger — not just a border line), header bars, and the hamburger drawer. Status colors (success/warning/danger/locked) stay distinct from navy so status never reads as "the brand color"; on-navy contexts (topbar, header band) use the brighter `-on-navy` variants for contrast.
- **Type** — Arial/Helvetica throughout. No web fonts, no font pairing — single system sans everywhere, including numbers.
- **Shape** — soft corners, not stiff: `--radius-sm: 4px`, `--radius: 8px`, `--radius-lg: 14px` (drawer's leading edge). No shadows, no gradients.
- **Layout language** — bordered "report boxes" (2px navy border, solid navy header bar, big centered value, rounded) for hero numbers (active TPS, totals); every list/table lives inside a `.panel` (navy border + radius + navy header row) rather than sitting bare on the page canvas — nothing should read as an empty gap between the topbar and the content. Containers run wide (~1100px) rather than narrow-and-centered, and side-by-side layouts (e.g. Rapid Input's TPS boxes + candidate list) stretch to fill height evenly. The public dashboard's header is a full navy band with white KPI cards popping out of it, not a thin border line.
- **Navigation** — a single shared hamburger drawer component (`css/nav.css` + `js/nav.js`), present on **every** page including the public dashboard. Admin pages get the full admin menu (Rapid Input/TPS/Log/Export/Snapshot + link back to the public Dashboard); the public dashboard and `/live/tps.html` get a minimal public menu (Dashboard/Hasil per TPS/Admin Login) — don't expose the full admin menu to anonymous visitors even though RLS already gates every actual write.

- **Motion** — a live/counting indicator gets a pulsing ring (`::after` + `pulse-ring` keyframe, respects `prefers-reduced-motion`) on the status dot — used on Rapid Input's `.status-dot.counting` and the public dashboard's `.result-status.live`. Numbers that change on refresh (vote counts, totals, stat tiles) animate via `animateNumber()` in `js/utils.js` (ease-out cubic, ~400-600ms) instead of snapping — makes live updates read as real, not static. Per-candidate rows carry a thin progress bar (`.row-progress` / `.progress-track`) showing share of total.
- **Chart** — Chart.js 4.4.4 (pinned), loaded via jsdelivr (`chart.js@4.4.4/dist/chart.umd.min.js` — the cdnjs path for this version 404s, don't switch back). Animated (`easeOutQuart`, staggered per-bar delay, active-state transition on hover), fixed-height wrapper (`.chart-wrap { height: 320px }` + `maintainAspectRatio: false`), custom navy tooltip. The chart instance and its DOM are built once and updated in place on refresh — never destroy/recreate — so its own transition animations fire on live data changes instead of being skipped.

New pages/components must reuse these tokens — never inline a raw hex value or a `font-family` outside the token block. If a new token is genuinely needed, add it to `css/variables.css` first, then reference it. New pages must call `initNav(...)` from `js/nav.js` rather than hand-rolling their own nav markup.

---

## 1. Product Name

**Pilkades Live Count**

A real-time vote counting and public result dashboard for a village head election.

---

## 2. Product Context

The system is intended for a village election with:

- 5 candidates
- 40 TPS
- 1 admin/operator
- many public viewers

Votes are entered one by one as they are announced during physical vote counting.

The application does not collect votes directly from voters.

Its function is:

**physical vote counting -> operator input -> database -> live public dashboard**

---

## 3. Main User Journey

### Admin Journey

```text
Login
  ↓
Open Rapid Vote Input
  ↓
Select/activate TPS
  ↓
Start counting
  ↓
Hear announced vote
  ↓
Press candidate number
  ↓
Vote event saved
  ↓
TPS summary updated
  ↓
Overall summary updated
  ↓
Public dashboard updated
  ↓
Continue until TPS complete
  ↓
Verify TPS
  ↓
Lock TPS
```

### Public Journey

```text
Open dashboard
  ↓
See overall result from all TPS
  ↓
See candidate photos and percentages
  ↓
See TPS progress
  ↓
Inspect individual TPS if desired
  ↓
Dashboard updates automatically
```

---

## 4. Operational Input Scenario

Example sequence:

TPS 07 announces:

```text
1
2
3
```

Then TPS 04 announces:

```text
2
```

Then TPS 11 announces:

```text
5
```

Then TPS 07 continues:

```text
1
```

Stored events:

```text
TPS 07 -> Candidate 1
TPS 07 -> Candidate 2
TPS 07 -> Candidate 3
TPS 04 -> Candidate 2
TPS 11 -> Candidate 5
TPS 07 -> Candidate 1
```

The interface must support this without requiring page navigation.

---

## 5. Admin Input Design

The admin page is a specialized counting console.

Desktop layout recommendation:

```text
┌───────────────────────────────────────────────────────────────┐
│ PILKADES LIVE COUNT                          ONLINE ●         │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│                 ACTIVE TPS                                    │
│                     07                                        │
│                 COUNTING ●                                    │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│ [1] CALON 1     [2] CALON 2     [3] CALON 3                  │
│     124             98              137                       │
│                                                               │
│ [4] CALON 4     [5] CALON 5     [0] TIDAK SAH                │
│      76              54               3                       │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│ Total TPS 07: 492                                             │
│ Last input: TPS 07 -> Calon 3 -> 09:45:12                    │
│                                                               │
│ Backspace = Undo                                              │
├───────────────────────────────────────────────────────────────┤
│ RECENT TPS                                                    │
│ 07   04   11   22   31                                       │
└───────────────────────────────────────────────────────────────┘
```

---

## 6. Keyboard Interaction

### Candidate Input

```text
1 -> Candidate 1
2 -> Candidate 2
3 -> Candidate 3
4 -> Candidate 4
5 -> Candidate 5
0 -> Invalid vote
```

### Control

```text
Backspace -> Undo last eligible vote
Space     -> Pause / resume input, if implemented
```

### TPS Switch

Preferred:

```text
/7
/4
/11
```

Example:

```text
/7
1
2
3
/4
2
/11
5
/7
1
```

The exact parser may require Enter depending on implementation.

---

## 7. Compact Rapid Input

Optional advanced input:

```text
071
```

Meaning:

```text
TPS 07
Candidate 1
```

Examples:

```text
042 -> TPS 04 Candidate 2
113 -> TPS 11 Candidate 3
```

This mode should only be enabled if it reduces operator error.

Focused TPS mode remains the default.

---

## 8. Last Input Feedback

After every accepted vote:

```text
+1 CALON 3
TPS 07
09:45:12
```

Feedback should be prominent but not block further input.

Avoid modal dialogs.

---

## 9. Undo Design

When Backspace is pressed:

```text
UNDO SUCCESS

TPS 07
Candidate 3
09:45:12
```

Internally:

- original vote event stays stored;
- event status becomes cancelled;
- summary is corrected;
- activity log records the undo.

---

## 10. Connectivity UI

Always visible:

### Online

```text
ONLINE ●
All events synced
```

### Syncing

```text
SYNCING
3 pending
```

### Offline

```text
OFFLINE
7 votes waiting to sync
```

The connectivity display should never be hidden inside settings.

---

## 11. TPS Status Design

Statuses:

```text
BELUM MULAI
MENGHITUNG
PAUSE
SELESAI
LOCKED
```

Recommended visual language:

- neutral for not started
- active indicator for counting
- warning for paused
- success state for completed
- locked icon/state for locked

Do not rely only on color.

Include status text.

---

## 12. TPS Verification Flow

After counting:

```text
TPS 07
Total valid: 489
Invalid: 3
Total: 492
```

Admin compares against official TPS result.

Actions:

```text
[Verify]
[Add Note]
[Lock TPS]
```

After lock:

```text
TPS 07
VERIFIED
LOCKED
```

---

## 13. Unlock Flow

Unlock requires:

```text
Reason for correction:
[________________________________]
```

Example:

```text
Incorrect candidate input found during reconciliation.
```

Unlock actions are logged.

---

## 14. Dashboard Information Architecture

Public dashboard:

```text
HEADER
↓
Election status
↓
High-level statistics
↓
Candidate result cards
↓
Overall result chart
↓
TPS progress
↓
40 TPS result table
↓
Per-TPS drill-down
↓
Last update timestamp
```

---

## 15. Dashboard Header

Example:

```text
PILKADES LIVE COUNT
Desa XXXXX

HASIL SEMENTARA

Last updated:
09:48:21
```

When completed:

```text
PENGHITUNGAN SELESAI
40 / 40 TPS
```

Do not display wording implying official legal certification unless explicitly authorized.

---

## 16. Summary Cards

Recommended cards:

```text
TPS SELESAI
28 / 40

TOTAL SUARA MASUK
10,284

SUARA SAH
10,115

TIDAK SAH
169

PROGRESS TPS
70%
```

Optional:

```text
TPS MENGHITUNG
8

TPS BELUM MULAI
4
```

---

## 17. Candidate Cards

Each candidate card displays:

- photo
- candidate number
- name
- total votes
- percentage
- ranking
- progress indicator

Example:

```text
┌───────────────────────────┐
│         PHOTO             │
│                           │
│       CALON NO. 1         │
│      Ahmad Santoso        │
│                           │
│       2,485 suara         │
│         27.84%            │
│                           │
│ ████████████░░░░ 27.84%  │
└───────────────────────────┘
```

Desktop:

- 5 cards in one row if screen width allows, or
- 3 + 2 balanced layout.

Mobile:

- vertical cards or compact 2-column layout.

---

## 18. Overall Result Chart

Use Chart.js.

Recommended primary chart:

- horizontal bar chart

Reason:

- easy comparison between 5 candidates;
- more precise than pie chart;
- works well with candidate names.

Optional secondary chart:

- doughnut chart for percentage composition.

Do not overuse charts.

---

## 19. TPS Progress

Show all 40 TPS.

Example:

```text
01 ✓
02 ✓
03 ●
04 ✓
05 ○
...
40 ○
```

Legend:

```text
✓ Locked / completed
● Counting
○ Not started
```

Clicking a TPS opens its detail.

---

## 20. TPS Result Table

Example:

| TPS | C1 | C2 | C3 | C4 | C5 | Invalid | Total | Status |
|-----|---:|---:|---:|---:|---:|--------:|------:|--------|
| 01 | 120 | 98 | 75 | 61 | 44 | 3 | 401 | Locked |
| 02 | 105 | 112 | 80 | 70 | 38 | 4 | 409 | Locked |
| 03 | 130 | 91 | 88 | 57 | 41 | 2 | 409 | Counting |

Support:

- sort
- TPS filter
- status filter

Do not expose edit controls publicly.

---

## 21. TPS Detail

Example:

```text
TPS 07

Candidate 1
124 votes
25.36%

Candidate 2
98 votes
20.04%

Candidate 3
137 votes
28.02%

Candidate 4
76 votes
15.54%

Candidate 5
54 votes
11.04%

Valid votes:
489

Invalid:
3

Total:
492

Status:
LOCKED

Last update:
09:45:12
```

---

## 22. Data Flow

```text
ADMIN KEY PRESS
       ↓
INPUT VALIDATION
       ↓
GENERATE CLIENT EVENT ID
       ↓
VOTE EVENT
       ↓
SUPABASE DATABASE
       ↓
SUMMARY UPDATE
       ↓
REALTIME/BROADCAST
       ↓
PUBLIC DASHBOARD
```

---

## 23. Offline Data Flow

```text
ADMIN KEY PRESS
       ↓
INTERNET OFFLINE
       ↓
LOCAL QUEUE
       ↓
UI MARKS EVENT AS PENDING
       ↓
INTERNET RESTORED
       ↓
SYNC PENDING EVENTS
       ↓
DATABASE DEDUPLICATION
       ↓
SUMMARY UPDATED
       ↓
PUBLIC DASHBOARD UPDATED
```

---

## 24. Database Relationship Concept

```text
elections
   │
   ├── candidates
   │
   ├── tps
   │     │
   │     └── vote_events
   │
   ├── vote_summary
   │
   ├── snapshots
   │
   └── activity_logs
```

---

## 25. Candidate Table

Suggested:

```text
candidates
--------------------------------
id
election_id
candidate_number
name
photo_url
description
is_active
created_at
updated_at
```

---

## 26. TPS Table

Suggested:

```text
tps
--------------------------------
id
election_id
tps_number
name
dpt_limit
status
is_verified
verification_note
verified_at
locked_at
created_at
updated_at
```

---

## 27. Vote Events Table

Suggested:

```text
vote_events
--------------------------------
id
client_event_id
election_id
tps_id
candidate_id
vote_type
status
created_by
created_at
cancelled_by
cancelled_at
cancel_reason
```

`candidate_id` may be null when `vote_type = invalid`.

---

## 28. Vote Summary

Recommended normalized format:

```text
vote_summary
--------------------------------
election_id
tps_id
candidate_id
vote_count
updated_at
```

Invalid votes can use:

- separate field/table; or
- designated summary row.

Overall results can be generated by summing TPS summaries.

---

## 29. Activity Log

Suggested:

```text
activity_logs
--------------------------------
id
election_id
actor_id
action
entity_type
entity_id
details_json
created_at
```

---

## 30. Snapshot Table

Suggested:

```text
snapshots
--------------------------------
id
election_id
snapshot_json
created_at
```

Snapshot JSON can include:

- overall candidate totals
- per-TPS totals
- status of all TPS
- valid votes
- invalid votes

---

## 31. Calculation Rules

### TPS Valid Votes

```text
sum(candidate vote counts)
```

### TPS Total Votes

```text
valid votes + invalid votes
```

### Overall Candidate Votes

```text
sum(candidate vote count across all TPS)
```

### Candidate Percentage

```text
candidate overall votes
----------------------- × 100
overall valid votes
```

### TPS Progress

A recommended default:

```text
locked TPS / total TPS × 100
```

Alternatively use completed TPS if that better matches operational needs.

Choose one definition and keep it consistent across the application.

---

## 32. DPT / Vote Limit Warning

If configured:

```text
if total_votes > dpt_limit
```

Display:

```text
WARNING
TPS 07 has exceeded configured voter limit.

Recorded: 451
Configured limit: 450
```

Do not hide the vote.

Require verification.

---

## 33. Public Realtime Strategy

Raw vote events remain private.

Public dashboard receives only summary information.

Recommended update payload:

```json
{
  "tps": 7,
  "candidateTotals": {
    "1": 124,
    "2": 98,
    "3": 137,
    "4": 76,
    "5": 54
  },
  "validVotes": 489,
  "invalidVotes": 3,
  "updatedAt": "..."
}
```

Overall totals may be sent separately.

Batch public updates when necessary.

Recommended public refresh/broadcast interval:

- 500 ms to 1 second

Admin database writes remain one event per vote.

---

## 34. Admin Navigation

Recommended sidebar:

```text
Dashboard
Rapid Input
TPS
Candidates
Activity Logs
Export
Settings
```

During live counting, Rapid Input should be easy to access and optionally open in distraction-free mode.

---

## 35. Public Navigation

Keep minimal:

```text
Live Result
TPS Results
Statistics
```

Avoid account features for public viewers.

---

## 36. Visual Direction

### General

- professional
- clean
- trustworthy
- data-first
- strong typography
- generous spacing

### Avoid

- gradient-heavy interfaces
- glassmorphism
- excessive shadows
- flashy election-style animations
- confetti
- moving backgrounds
- unnecessary auto-scrolling

This is an operational result system, not a campaign microsite.

---

## 37. Responsive Behaviour

### Admin

Primary target:

- laptop / desktop

Secondary:

- tablet

Mobile admin can be supported but should not be the primary counting interface unless specifically tested.

### Public

Must work well on:

- smartphone
- tablet
- desktop

Most public viewers may access through mobile browsers.

---

## 38. Loading States

Example:

```text
Loading live results...
```

For realtime reconnect:

```text
Reconnecting to live updates...
```

For stale data:

```text
Live connection interrupted.
Showing last received result.
```

Never clear valid previously loaded results just because realtime temporarily disconnects.

---

## 39. Empty State

Before counting:

```text
Penghitungan belum dimulai.

0 / 40 TPS selesai
```

Candidate cards should still display photos and zero totals.

---

## 40. Final State

When all required TPS are complete:

```text
40 / 40 TPS
PENGHITUNGAN SELESAI
```

Display:

- final system totals
- percentages
- per-TPS results
- timestamp of completion

If system results have not been officially certified, keep a disclaimer such as:

```text
Data pada sistem merupakan rekapitulasi hasil input penghitungan TPS.
Penetapan hasil resmi mengikuti ketentuan panitia pemilihan.
```

---

## 41. Security UX

Do not reveal:

- admin email
- database IDs
- internal log details
- Supabase secrets
- internal error stack traces

Admin destructive/security-sensitive actions require confirmation.

Examples:

- unlock TPS
- reset election
- change candidate
- clear test data

---

## 42. Pre-Election Test Mode

Recommended.

Provide a test mode before the real event.

Test mode allows:

- input simulation
- rapid keyboard testing
- realtime load testing
- offline sync testing
- dashboard checking

Production election data must be separated from test data.

Before go-live:

```text
Test Mode OFF
Production Election ACTIVE
```

---

## 43. Go-Live Checklist

Before counting begins:

- Candidate data confirmed.
- Candidate photos confirmed.
- 40 TPS confirmed.
- DPT limits confirmed if used.
- Admin login tested.
- Keyboard input tested.
- Undo tested.
- TPS switching tested.
- Realtime dashboard tested.
- Mobile dashboard tested.
- Internet connection tested.
- Offline queue tested.
- Supabase RLS tested.
- Public write access confirmed impossible.
- Backup/snapshot mechanism tested.
- Export tested.
- Test data cleared or isolated.

---

## 44. Recommended Development Milestones

### Milestone 1 - Foundation

- Supabase project
- schema
- RLS
- auth
- candidate and TPS data

### Milestone 2 - Counting Engine

- vote event insert
- active TPS
- keyboard shortcuts
- undo
- summary generation

### Milestone 3 - TPS Workflow

- statuses
- verify
- lock
- unlock
- validation

### Milestone 4 - Public Dashboard

- candidate cards
- photos
- totals
- percentages
- charts
- TPS table
- TPS detail

### Milestone 5 - Realtime

- live summary updates
- reconnect handling
- stale state

### Milestone 6 - Reliability

- offline queue
- duplicate prevention
- snapshots
- audit logs

### Milestone 7 - Reporting

- export
- final result report
- activity report

### Milestone 8 - Production Hardening

- test mode
- performance testing
- mobile testing
- security review
- go-live checklist

---

## 45. Definition of Done

The product is ready when:

1. Admin can input one vote using one keypress.
2. Admin can rapidly switch TPS.
3. Every vote creates a traceable event.
4. Undo preserves history.
5. Summary always matches active vote events.
6. Candidate percentages are correct.
7. Public dashboard updates automatically.
8. Public users cannot modify data.
9. TPS can be completed, verified, and locked.
10. Offline input can recover without duplicate votes.
11. 40 TPS can be displayed individually and as an overall result.
12. Candidate photos and total percentages render correctly.
13. Activity logs are usable.
14. Final results can be exported.
15. The system remains understandable under live counting pressure.
