# Input Monitoring Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give both admin vote-entry pages explicit, per-entry sync status — a pending/synced/rejected badge on Rapid Input's last-input line, and a persistent "Terakhir disimpan" line on Input Rekap TPS — per the approved spec at `docs/superpowers/specs/2026-09-17-input-monitoring-status-design.md`.

**Architecture:** Rapid Input tracks which vote's `clientEventId` the log line currently represents (`state.lastLogEventId`) and updates only the badge portion in place when that specific vote's network round trip resolves, discarding stale resolutions for votes the display has already moved past. Input Rekap TPS adds one new persistent DOM element outside the per-TPS form panel, updated unconditionally on every submit's outcome regardless of whether the admin has since selected a different TPS.

**Tech Stack:** Vanilla JS (IIFE per page, no framework, no build step), plain CSS with the existing `--color-*` token system.

## Global Constraints

- No automated test suite exists in this repo; verification is manual/browser-based, consistent with every prior feature in this codebase.
- All UI copy is Bahasa Indonesia.
- Any string that isn't already known-safe (candidate names, server error messages) must go through the existing `escapeHtml()` helper already duplicated in both `js/vote-input.js` and `js/tally-input.js` before being placed in `innerHTML`.
- This is a hot-path console for Rapid Input — the badge update must not add new DOM nodes per vote or re-render anything beyond the single `#lastInput` element's contents.
- No change to `vote_events`, `submit_tps_tally`, `bump_vote_summary`, or any other RPC — this is a client-only visibility feature.
- No persistence of badge/log state across page reloads (in-memory session feedback only, per spec Non-goals).

---

### Task 1: Rapid Input — sync status badge on the last-input log line

**Files:**
- Modify: `js/vote-input.js` (state init, `castVote`, `undoLastVote`, `attemptFlush`, one new helper function)
- Modify: `css/admin.css` (three new badge color rules)

**Interfaces:**
- Produces: `state.lastLogEventId` (string|null) and `state.lastLogText` (string, HTML-safe) — both are internal to this file, nothing outside it depends on them.
- Consumes: `escapeHtml()`, `padTps()`, `formatTime()` (all already present/imported in this file).

- [ ] **Step 1: Add the two new state fields**

In `js/vote-input.js`, in the `state` object (currently lines 8-19), add two fields after `snapshots`:

```js
  const state = {
    election: null,
    candidates: [],       // [{id, candidate_number, name}]
    activeTps: null,      // {id, tps_number, status} | null while switching
    summary: {},          // candidate_id -> count, 'invalid' -> count
    recentTps: [],        // recent tps_number list, most recent first
    localHistory: [],     // stack of candidateNumber, for optimistic undo (this session only)
    switchToken: 0,       // guards against out-of-order TPS switch responses
    queue: [],            // pending vote items not yet confirmed by the server
    flushing: false,
    snapshots: new Map(), // tps_number -> {tps, summary} from the last server read
    lastLogEventId: null, // clientEventId the log line currently displays, for stale-resolution guarding
    lastLogText: '',      // the log line's descriptive text (no badge), reused when a resolution updates just the badge
  };
```

- [ ] **Step 2: Add the `logBadge` helper**

In `js/vote-input.js`, immediately after the `escapeHtml` function (currently lines 108-112), add:

```js
  function logBadge(status) {
    if (status === 'pending') return '<span class="log-badge pending">⏳ Menunggu sinkron</span> ';
    if (status === 'synced') return '<span class="log-badge synced">✓ Tersimpan</span> ';
    if (status === 'rejected') return '<span class="log-badge rejected">✗ Ditolak</span> ';
    return '';
  }
```

- [ ] **Step 3: Update `castVote` to render the pending badge and track the event id**

In `js/vote-input.js`, replace this block (currently lines 294-295):

```js
    const suffix = navigator.onLine ? '' : ' (menunggu sinkron)';
    el.lastInput.textContent = `+1 ${candidateLabel} — TPS ${padTps(state.activeTps.tps_number)} — ${formatTime(new Date())}${suffix}`;
```

with:

```js
    state.lastLogEventId = item.clientEventId;
    state.lastLogText = `+1 ${escapeHtml(candidateLabel)} — TPS <strong>${padTps(state.activeTps.tps_number)}</strong> — ${formatTime(new Date())}`;
    el.lastInput.innerHTML = logBadge('pending') + state.lastLogText;
```

(The old `suffix` variable is removed — the badge itself now conveys "not yet synced," so the parenthetical is redundant.)

- [ ] **Step 4: Update `undoLastVote`'s queued-item branch**

In `js/vote-input.js`, replace this line (currently line 319):

```js
      el.lastInput.textContent = `UNDO (belum tersinkron) — ${label} — TPS ${padTps(state.activeTps.tps_number)} — ${formatTime(new Date())}`;
```

with:

```js
      state.lastLogEventId = null;
      state.lastLogText = `UNDO (belum tersinkron) — ${escapeHtml(label)} — TPS <strong>${padTps(state.activeTps.tps_number)}</strong> — ${formatTime(new Date())}`;
      el.lastInput.innerHTML = logBadge('synced') + state.lastLogText;
```

(This undo never touched the network — it's a local queue removal — so it's shown as already-final/synced with no pending phase. Setting `lastLogEventId = null` also means no later `attemptFlush()` resolution for an older vote can ever match and overwrite this line.)

- [ ] **Step 5: Update `undoLastVote`'s synced-item branch**

In `js/vote-input.js`, replace this line (currently line 363):

```js
    el.lastInput.textContent = `UNDO — ${label} — TPS ${padTps(state.activeTps.tps_number)} — ${formatTime(new Date())}`;
```

with:

```js
    state.lastLogEventId = null;
    state.lastLogText = `UNDO — ${escapeHtml(label)} — TPS <strong>${padTps(state.activeTps.tps_number)}</strong> — ${formatTime(new Date())}`;
    el.lastInput.innerHTML = logBadge('synced') + state.lastLogText;
```

(This branch already awaited `undo_last_vote` before reaching this line, so the result is already final — same reasoning as Step 4.)

- [ ] **Step 6: Update `attemptFlush` to flip the badge in place on resolution**

In `js/vote-input.js`, replace this block (currently lines 406-411):

```js
      if (result.error) {
        showToast(`Vote TPS ${padTps(item.tpsNumber)} ditolak server: ${result.error.message}`, 'error');
        state.queue.shift();
        persistQueue();
        continue;
      }
```

with:

```js
      if (result.error) {
        showToast(`Vote TPS ${padTps(item.tpsNumber)} ditolak server: ${result.error.message}`, 'error');
        if (item.clientEventId === state.lastLogEventId) {
          el.lastInput.innerHTML = logBadge('rejected') + state.lastLogText + ' — ' + escapeHtml(result.error.message);
        }
        state.queue.shift();
        persistQueue();
        continue;
      }
```

Then, in the same function, replace this block (currently lines 413-414):

```js
      state.queue.shift();
      persistQueue();
```

with:

```js
      state.queue.shift();
      persistQueue();

      if (item.clientEventId === state.lastLogEventId) {
        el.lastInput.innerHTML = logBadge('synced') + state.lastLogText;
      }
```

(There are two `state.queue.shift(); persistQueue();` pairs in this function — one in the error branch just edited in this same step, one in the success path. Make sure to edit the SUCCESS path's pair, which is the one immediately followed by the `const cached = state.snapshots.get(item.tpsNumber);` line — not the error branch's pair from the first half of this step.)

- [ ] **Step 7: Add the badge CSS**

In `css/admin.css`, immediately after the `.last-input` rule (currently lines 352-356), add:

```css
.log-badge { font-weight: 700; margin-right: 4px; }
.log-badge.pending { color: var(--color-warning); }
.log-badge.synced { color: var(--color-success); }
.log-badge.rejected { color: var(--color-danger); }
```

- [ ] **Step 8: Manually verify**

Open `admin/input.html` logged in as admin (throttle network in devtools to "Slow 3G" or similar so the pending phase is visible):
- Cast a vote → confirm the log line shows `⏳ Menunggu sinkron` immediately, then flips to `✓ Tersimpan` once the request completes, with the TPS number visibly bold.
- Cast two votes back-to-back before the first resolves → confirm the first vote's later resolution does NOT overwrite the second vote's displayed line (the second vote's own pending→synced transition is what you should see).
- Lock the active TPS from `admin/tps.html` in another tab, then cast a vote on it → confirm the line flips to `✗ Ditolak` with the server's message appended, and the existing toast still fires.
- Undo a vote still sitting in the queue (before it syncs) → confirm the line shows `✓ Tersimpan` immediately for the UNDO text (no pending phase).
- Undo an already-synced vote → confirm the same (immediate `✓ Tersimpan` on the UNDO line).
- Reload the page → confirm it resets to the default "Belum ada input." placeholder with no console errors.

- [ ] **Step 9: Commit**

```bash
git add js/vote-input.js css/admin.css
git commit -m "$(cat <<'EOF'
Add per-vote sync status badge to Rapid Input's log line

Tracks the currently-displayed vote by clientEventId so a stale
network resolution can never overwrite a newer vote's badge — same
guard pattern already used for TPS staleness in Input Rekap TPS.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Input Rekap TPS — persistent "Terakhir disimpan" line

**Files:**
- Modify: `admin/tally.html` (one new element)
- Modify: `js/tally-input.js` (`el` object, `submitTally`)
- Modify: `css/tally.css` (one new rule)

**Interfaces:**
- Consumes: `describeDeltas(deltas)`, `padTps()`, `formatTime()` (all already present in this file); the existing `row` and `deltas` variables already in scope inside `submitTally()`.
- Produces: nothing consumed by other tasks — this is the last task in this plan.

- [ ] **Step 1: Add the new element to the page**

In `admin/tally.html`, replace this block (currently lines 39-46):

```html
    <div class="tally-layout">
      <div>
        <div class="tally-tps-grid" id="tallyTpsGrid"></div>
      </div>
      <div class="tally-panel" id="tallyPanel">
        <div class="tally-placeholder">Pilih TPS dulu.</div>
      </div>
    </div>
  </div>
```

with:

```html
    <div class="tally-layout">
      <div>
        <div class="tally-tps-grid" id="tallyTpsGrid"></div>
      </div>
      <div class="tally-panel" id="tallyPanel">
        <div class="tally-placeholder">Pilih TPS dulu.</div>
      </div>
    </div>

    <div class="tally-last-saved" id="tallyLastSaved">Belum ada input rekap pada sesi ini.</div>
  </div>
```

- [ ] **Step 2: Add the element reference**

In `js/tally-input.js`, in the `el` object (currently lines 12-16), add one line:

```js
  const el = {
    grid: document.getElementById('tallyTpsGrid'),
    panel: document.getElementById('tallyPanel'),
    lastSaved: document.getElementById('tallyLastSaved'),
    toast: document.getElementById('toast'),
  };
```

- [ ] **Step 3: Update `submitTally` to write the line unconditionally on both outcomes**

In `js/tally-input.js`, replace this block (currently lines 196-206):

```js
    if (error) {
      showToast('Gagal simpan: ' + error.message, 'error');
      if (btn) btn.disabled = false;
      return;
    }

    if (state.selectedTpsId !== submittedTpsId) {
      const currentBtn = document.getElementById('tallySubmitBtn');
      if (currentBtn) currentBtn.disabled = false;
      return;
    }
```

with:

```js
    if (error) {
      showToast('Gagal simpan: ' + error.message, 'error');
      el.lastSaved.textContent = `Terakhir disimpan: ✗ Gagal TPS ${padTps(row.tps_number)} — ${formatTime(new Date())} — ${error.message}`;
      if (btn) btn.disabled = false;
      return;
    }

    el.lastSaved.textContent = `Terakhir disimpan: ✓ TPS ${padTps(row.tps_number)} — ${formatTime(new Date())} (${describeDeltas(deltas)})`;

    if (state.selectedTpsId !== submittedTpsId) {
      const currentBtn = document.getElementById('tallySubmitBtn');
      if (currentBtn) currentBtn.disabled = false;
      return;
    }
```

(`el.lastSaved` is updated for both outcomes BEFORE the staleness check, so it reflects reality regardless of what TPS is currently selected in the panel — only the per-TPS form/grid updates further down stay gated by that check, unchanged.)

`formatTime` is not yet used in this file — confirm it's available globally (it's defined in `js/utils.js`, already `<script>`-included on `admin/tally.html` before `js/tally-input.js`, same as every other admin page) rather than importing anything new.

- [ ] **Step 4: Add the CSS**

In `css/tally.css`, at the end of the file (after the existing `@media (max-width: 480px)` block), add:

```css
.tally-last-saved {
  margin-top: var(--space-5);
  font-size: 13px;
  color: var(--color-ink-muted);
}
```

- [ ] **Step 5: Manually verify**

Open `admin/tally.html` logged in as admin:
- Select a TPS, enter a delta, submit successfully → confirm `#tallyLastSaved` updates with the correct TPS/time/delta summary, and that it's still visible after the 3-second toast disappears.
- Submit again on the same or a different TPS → confirm the line updates to the new outcome (it always shows only the single most recent action, per spec — no history list).
- Throttle network, submit on TPS A, then before it resolves select TPS B in the grid → confirm the panel stays on TPS B (unaffected, per the existing staleness guard), but once TPS A's request resolves, `#tallyLastSaved` updates to reflect TPS A's outcome.
- Submit against a `locked` TPS → confirm `#tallyLastSaved` shows the failure with the server's message.
- Reload the page → confirm it resets to "Belum ada input rekap pada sesi ini." with no console errors.

- [ ] **Step 6: Commit**

```bash
git add admin/tally.html js/tally-input.js css/tally.css
git commit -m "$(cat <<'EOF'
Add persistent last-saved status line to Input Rekap TPS

Survives past the 3s toast and updates on both success and failure
regardless of whether the admin has since selected a different TPS —
this is a page-level "what did the last save actually do" line, not
part of the per-TPS form panel the staleness guard protects.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
