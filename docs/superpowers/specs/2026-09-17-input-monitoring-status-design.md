# Input Monitoring Status — Design Spec

Date: 2026-09-17
Status: Approved (pending implementation)

## Problem

Two admin vote-entry pages exist: Rapid Input ([admin/input.html](../../../admin/input.html)) and Input Rekap TPS ([admin/tally.html](../../../admin/tally.html)). Both already have *some* sync feedback (a connection-state indicator, a last-input text line, toasts), but neither makes it immediately obvious, at a glance, whether the specific input the admin just made has actually landed in the database, or is still in flight, or was rejected. For a vote-tally system this ambiguity is a real operational risk — an admin should never have to guess whether their last keystroke counted.

This spec adds explicit, per-entry sync status to both pages, without touching the underlying sync mechanisms (Rapid Input's offline queue, Rekap TPS's synchronous submit) — this is a visibility feature, not a data-flow change.

Performance is a real concern for a hot-path console (one keypress per vote), but a full site-wide performance audit is explicitly out of scope for this spec (see Non-goals) — the only performance constraint here is that this feature must not add latency to that hot path.

## Non-goals

- No full-site performance audit — tracked separately, outside this spec.
- No change to the offline queue mechanism, RPC contracts, or the additive tally semantics from the previous features.
- No persistence of the log/badge state across page reloads — this is live session feedback, not an audit trail (the DB-side `activity_logs` table already is the durable audit trail; this feature is about *live* visibility, not history).
- No history list of multiple past entries — only the single most recent entry per page gets a live-updating status (confirmed with the user: a badge on one line, not a scrollable log).

## Architecture

### Rapid Input ([js/vote-input.js](../../../js/vote-input.js))

**Current behavior:** `castVote()` ([js/vote-input.js:254-299](../../../js/vote-input.js:254)) writes a plain-text line to `el.lastInput` once, at cast time, and never updates it again — even after the vote's `attemptFlush()` round trip resolves. `undoLastVote()` similarly writes a final line only when its own await has already resolved.

**New behavior:**
- Add `state.lastLogEventId` (string|null) — tracks which vote's `clientEventId` the currently-displayed log line represents. `null` means the current line isn't tracking any in-flight vote (e.g. it's an undo line, or the initial "Belum ada input." state).
- `castVote()`: after pushing the item to `state.queue`, render the log line with a **pending** badge and set `state.lastLogEventId = item.clientEventId`.
- `attemptFlush()` ([js/vote-input.js:386-432](../../../js/vote-input.js:386)): after each item resolves (success or the existing `result.error` branch), check `if (item.clientEventId === state.lastLogEventId)`. If true, update the log line's badge in place to **synced** (success) or **rejected** (error, with `result.error.message`) — using the SAME text content already in `el.lastInput`, only the badge/prefix changes, so the candidate/TPS/time part isn't rebuilt. If false, a newer vote has already taken over the log line — do nothing to `el.lastInput` (the existing `showToast` call on rejection already fires regardless, so a rejection is never silently lost, just not reflected in a now-stale log line).
- `undoLastVote()` ([js/vote-input.js:301-373](../../../js/vote-input.js:301)): both branches (queued-item undo and synced-item undo) already have their result before writing to `el.lastInput` — render the line with a **synced** badge directly (no pending phase), and set `state.lastLogEventId = null` so no later `attemptFlush()` resolution can overwrite this undo line.
- This is the exact same "stale response can't clobber the current display" pattern already used for the Input Rekap TPS staleness guards (`js/tally-input.js`'s `selectTps`/`submitTally`), applied here to a per-vote-id comparison instead of a per-TPS-id comparison.

**Badge states** (three, rendered as a small leading icon/label inside `el.lastInput`'s line, not a separate element — keeps the existing single-line layout):
- Pending: `⏳ Menunggu sinkron` — amber/warning color
- Synced: `✓ Tersimpan` — success color
- Rejected: `✗ Ditolak` — danger color, followed by the server's error message on the same line

**Performance constraint:** the badge update on flush resolution is a single `textContent`/class write on an element that already exists (no new DOM nodes created per vote, no re-render of the candidate grid or summary). This adds no measurable cost to the existing hot path (`castVote` → optimistic UI → queue push), since the badge write for the *pending* state happens in the same synchronous block that already writes `el.lastInput.textContent` today — only the later flush-resolution update is new, and that happens on the network callback, already off the hot path.

### Input Rekap TPS ([js/tally-input.js](../../../js/tally-input.js))

**Current behavior:** on submit, a toast shows for 3 seconds ([js/tally-input.js](../../../js/tally-input.js), `submitTally()`) and then no visible trace remains that a save happened.

**New behavior:**
- Add a new persistent element `#tallyLastSaved` in [admin/tally.html](../../../admin/tally.html), placed directly below `.tally-layout`, full width, small muted text. Initial content: `"Belum ada input rekap pada sesi ini."`
- In `submitTally()`, this element is updated **unconditionally** on both the success and error paths of the RPC call — specifically NOT gated behind the existing `if (state.selectedTpsId !== submittedTpsId) return;` staleness guard added in the prior fix round. That guard protects the per-TPS *form panel* from showing another TPS's data; `#tallyLastSaved` is a page-level "what did the last save action actually do" line, independent of whatever TPS is currently selected in the panel — if TPS A's save succeeds while the admin has already moved on to TPS B, that success is still a real fact worth surfacing, just not by touching TPS B's displayed form.
- Success format: `` `Terakhir disimpan: ✓ TPS ${padTps(submittedTpsNumber)} — ${formatTime(new Date())} (${describeDeltas(deltas)})` `` — reusing the existing `describeDeltas()` helper already built for the confirm dialog, so the summary text matches what the admin already confirmed.
- Error format: `` `Terakhir disimpan: ✗ Gagal TPS ${padTps(submittedTpsNumber)} — ${formatTime(new Date())} — ${error.message}` ``
- No pending/in-flight state needed here (unlike Rapid Input): the Simpan button is already disabled for the duration of the RPC call, and the confirm dialog already blocks synchronously before that, so there's no ambiguous "in between" moment to represent — the line simply doesn't update until the RPC settles, same as it does today via the toast, just persisted afterward.

## UI

**Rapid Input** ([css/admin.css](../../../css/admin.css), the stylesheet already used by `admin/input.html`): add three small badge classes reusing existing color tokens:
```css
.log-badge { font-weight: 700; margin-right: 4px; }
.log-badge.pending { color: var(--color-warning); }
.log-badge.synced { color: var(--color-success); }
.log-badge.rejected { color: var(--color-danger); }
```
The TPS number within the log line is wrapped in a `<strong>` (or an existing bold-weight span pattern already used elsewhere in this file) so it stands out — addressing the "make the location more prominent" requirement without adding new data.

**Input Rekap TPS** ([css/tally.css](../../../css/tally.css)): one new rule for `#tallyLastSaved`, matching the muted small-text style already used for `.tally-placeholder` (same font-size/color tokens), plus a top margin to separate it from `.tally-layout` above it. Success/error color reuses `--color-success`/`--color-danger` the same way the rest of this file already does (e.g. `.tally-locked-banner`).

Both changes are copy/styling additions inside files this project already owns — no new design tokens, no new libraries.

## Error handling

| Case | Rapid Input | Rekap TPS |
|---|---|---|
| Vote queued, not yet sent | Badge shows pending immediately | N/A — submit is synchronous, no queued phase |
| Sync succeeds | Badge flips to synced in place (only if it's still the displayed line) | `#tallyLastSaved` shows success + delta summary |
| Server rejects | Badge flips to rejected + server message (only if still displayed); existing toast still fires unconditionally | `#tallyLastSaved` shows failure + server message |
| A newer vote/undo already replaced the displayed line before the older one resolves | The stale resolution is discarded silently for the badge (toast still fires on rejection) — mirrors the existing Rekap TPS staleness-guard pattern | N/A — no queue, so no out-of-order resolution is possible here |
| Offline while a vote is pending | Badge stays pending; the existing `connState` indicator (unchanged) already communicates the offline/queued-count state at the page level | Submit is blocked pre-flight by the existing `!navigator.onLine` check (unchanged); `#tallyLastSaved` is not touched since no RPC was attempted |
| Page reload | Badge/log and `#tallyLastSaved` both reset to their initial states — this is in-memory session feedback, not a persisted audit trail; the durable record remains `activity_logs` in the database (unchanged, out of scope) |

## Testing

No automated test suite exists anywhere in this repo (established pattern from the two prior features) — verification is manual, browser-based:

- Cast a vote with network throttled (devtools) → confirm the pending badge appears immediately, then flips to synced once the request completes.
- Cast two votes in quick succession → confirm the first vote's later resolution does not overwrite the second vote's displayed badge/line.
- Lock the active TPS from `admin/tps.html` in another tab, then attempt a vote on it in Rapid Input → confirm the badge shows rejected with the server's message, and the existing toast still fires.
- Undo a still-queued vote → confirm the badge shows synced immediately (no pending phase), since it never touched the network.
- Undo an already-synced vote → confirm the badge shows synced immediately (matches existing await-then-display behavior).
- Rekap TPS: submit successfully → confirm `#tallyLastSaved` shows the correct TPS/time/delta summary and persists after the toast disappears.
- Rekap TPS: select a different TPS while a prior submit's RPC is still in flight (throttle network), let it resolve → confirm the panel (still showing the newly-selected TPS) is untouched, but `#tallyLastSaved` still updates to reflect the earlier submit's outcome.
- Rekap TPS: submit against a locked TPS → confirm `#tallyLastSaved` shows the failure and message.
- Reload both pages → confirm both reset cleanly to their initial placeholder states with no errors in the console.
