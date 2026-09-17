# Input Rekap TPS — Design Spec

Date: 2026-09-17
Status: Approved (pending implementation)

## Problem

Rapid Input ([admin/input.html](../../../admin/input.html), [js/vote-input.js](../../../js/vote-input.js)) requires one keypress per individual vote — correct for live tally-as-you-count at a TPS, but slow when an admin already has a TPS's *final* result on paper (e.g. from a physical rekapan sheet) and just needs to key in the end totals per candidate.

This spec adds a second, independent input method: bulk/final-tally entry per TPS, additive across repeated submissions (submitting again for the same TPS/candidate adds to what's already recorded, rather than replacing it), with negative deltas allowed for correcting over-input mistakes.

## Non-goals

- Does not replace or modify Rapid Input's per-vote flow, its offline queue, or `vote_events`.
- Does not add automated tests (repo has none for any existing RPC or page; out of scope here — see codebase review notes).
- Does not change how public dashboards ([index.html](../../../index.html), [live/tps.html](../../../live/tps.html)) read data — they already read `vote_summary` + realtime, so they pick up bulk-entered totals with no changes.

## Architecture

### Database: new RPC `submit_tps_tally`

```sql
submit_tps_tally(p_tps_id uuid, p_deltas jsonb) returns jsonb
-- p_deltas: [{"candidate_id": uuid|null, "delta": int}, ...]
--   candidate_id null = "Tidak Sah" (invalid votes)
```

Behavior:
1. `is_admin()` check (same guard as `cast_vote`, `set_tps_status`, etc.) — reject if not admin.
2. Look up the `tps` row; reject if not found or `status = 'locked'` (same rule as `cast_vote`).
3. For each item in `p_deltas` where `delta != 0`: call the existing `bump_vote_summary(election_id, tps_id, candidate_id, delta)` helper. This function already does an atomic `UPDATE ... SET vote_count = vote_count + delta` (upserting the row if absent), so:
   - Repeated calls are additive by construction — no extra logic needed for the "209 then +70 → 279" requirement.
   - Negative deltas correctly decrement (correction case), floor-clamped to 0 for the initial-insert branch only (existing behavior, unchanged).
   - Concurrent submissions for the same TPS from two admins are race-safe (DB-level atomic increment, no lost updates).
4. If `tps.status = 'not_started'`, transition it to `'counting'` (mirrors `cast_vote`'s auto-transition), so a TPS entered purely via rekap still shows as in-progress everywhere else.
5. Insert **one** `activity_logs` row for the whole submit, `action = 'tally_bulk_adjusted'`, `entity_type = 'tps'`, `entity_id = p_tps_id`, `details = {"deltas": p_deltas}` — one auditable event per rekap submission, not one per candidate.
6. Return the same shape as `cast_vote`/`undo_last_vote`: `{tps_status, summary}` (summary = fresh `vote_summary` rows for that TPS), so the client can repaint without a second round trip.

Deliberately does **not** touch `vote_events`: that table is one-row-per-discrete-vote with a timestamp and undo semantics, which doesn't model a bulk correction. `vote_summary` (the number every dashboard actually reads) is the sole source of truth this feature writes to, exactly like Rapid Input does via `bump_vote_summary`.

### New action label

Add to `ACTION_LABELS_ID` in [js/utils.js](../../../js/utils.js):
```js
tally_bulk_adjusted: 'Rekap suara diinput/dikoreksi',
```
Add `'tally_bulk_adjusted'` to `KNOWN_ACTIONS` in [js/logs.js](../../../js/logs.js) so it appears in the log filter dropdown immediately.

## UI

New page: `admin/tally.html` + `js/tally-input.js`, added to nav (`initNav`) between "Rapid Input" and "TPS" across all admin pages, `live/tps.html`, and the SW's `SHELL_ASSETS` list ([sw.js](../../../sw.js)) for offline shell caching.

**Left column** — grid of TPS number boxes, one per TPS in the active election (pattern reused from [live/tps.html](../../../live/tps.html)'s nav grid):
- Fetched via `get_tps_overview` (same RPC already used by `live-tps.js` / `tps-manage.js`).
- Selected box highlighted (green border, matches existing `.is-active` convention).
- Box styling reflects TPS status (e.g. locked TPS visually distinct — muted/red border) so an admin doesn't pick a TPS it can't submit to.
- Clicking a box selects that TPS and loads the right-column form for it.

**Right column** — rekap form for the selected TPS:
- Header: `TPS {number}` + status badge (reuse `statusLabelId()`).
- Locked banner (reuse `.locked-banner` pattern from Rapid Input) when status is `locked`; all fields disabled in that case.
- One row per active candidate + one "Tidak Sah" row:
  ```
  No.1  {candidate name}   Saat ini: {current vote_summary count} suara   Tambahkan: [number input]
  ...
  Tidak Sah                 Saat ini: {current invalid count} suara        Tambahkan: [number input]
  ```
  - "Saat ini" comes from `vote_summary` filtered by the selected `tps_id`, read fresh on TPS selection.
  - "Tambahkan" inputs start empty. Empty = no change for that candidate (not submitted as a 0 delta). Accepts negative integers for corrections.
- "Simpan" button, disabled while a submit is in flight or the TPS is locked.
- Nothing selected yet → right column shows a placeholder: "Pilih TPS dulu."

**Submit flow:**
1. Collect all non-empty, non-zero "Tambahkan" fields into `[{candidate_id, delta}]`.
2. If the collected list is empty → toast error "Isi minimal satu angka dulu.", no request sent.
3. Show a confirmation dialog summarizing the deltas about to be applied (e.g. "TPS 01 — Paslon 1 +209, Paslon 3 +650. Lanjut?") before calling the RPC — bulk deltas are higher-consequence than a single Rapid Input keypress, so a confirm step guards against fat-finger entry.
4. On confirm: disable Simpan, call `sb.rpc('submit_tps_tally', { p_tps_id, p_deltas })`.
5. Server error (locked, not admin, network) → red toast with the error message, fields keep their entered values (so the admin doesn't retype), Simpan re-enabled.
6. Success → green toast, repaint "Saat ini" values from the returned summary (animated via the existing `animateNumber` helper in [js/utils.js](../../../js/utils.js)), clear all "Tambahkan" fields, re-enable Simpan. TPS selection in the left grid is retained (so a follow-up correction submit doesn't require re-selecting).

**Offline handling — deliberately different from Rapid Input:**
Rapid Input's per-vote queue is safe to replay later because each item is a commutative +1. A rekap delta can be large (e.g. +650) and represents a single deliberate correction; queuing it for later replay risks landing on top of a since-changed baseline in a way the admin can no longer visually verify at submit time. So: no offline queue for this page. If `!navigator.onLine`, the Simpan button is disabled with the message "Tidak ada koneksi — coba lagi." Nothing is queued or silently retried.

## Error handling summary

| Condition | Behavior |
|---|---|
| Not authenticated | Redirect to `../login.html` (same guard as every other admin page's `init()`) |
| No active election | Toast "Election aktif tidak ditemukan.", page stays empty |
| TPS status = `locked` | Fields disabled, locked banner shown, Simpan not reachable |
| All "Tambahkan" fields empty on submit | Client-side toast, no request |
| RPC rejects (locked/not admin/tps not found) | Red toast with server message, form state preserved |
| Network error / offline | Simpan disabled pre-emptively; if a request is in flight and fails, red toast, fields preserved |
| Two admins submit same TPS concurrently | Both succeed; DB-atomic increment in `bump_vote_summary` prevents lost updates |

## Testing / verification

No automated test suite exists anywhere in this repo (no RPC, no page has one) — consistent with that, this feature adds none. Verification is manual, split by layer:

**RPC (SQL, run directly against the Supabase project during implementation):**
- Submit `+209` for a fresh TPS/candidate → `vote_summary.vote_count` becomes 209.
- Submit `+70` again for the same pair → becomes 279 (additive confirmed).
- Submit `-30` → becomes 249 (negative correction confirmed).
- Submit against a `locked` TPS → rejected.
- Submit without an authenticated admin session → rejected by `is_admin()`.
- Confirm exactly one `activity_logs` row per submit call, with the full delta list in `details`.

**UI (manual, browser):**
- TPS grid renders with correct status coloring; locked TPS visually distinct.
- Selecting a TPS loads correct current totals matching the live dashboard.
- Single-candidate submit: toast, number updates, field clears.
- Multi-candidate submit in one Simpan: all deltas applied together.
- Locked TPS: fields disabled, no submit possible.
- Public dashboard ([index.html](../../../index.html)) and [live/tps.html](../../../live/tps.html) reflect the rekap totals immediately via existing realtime subscriptions, with no changes needed on those pages.
- Offline: Simpan disabled with message, no silent failure or queued request.
