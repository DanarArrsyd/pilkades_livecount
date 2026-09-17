# TPS DPT Turnout Visibility — Design Spec

Date: 2026-09-17
Status: Approved (pending implementation)

## Problem

An admin needs a way to sanity-check each TPS's vote count against how many votes it should realistically be able to produce — e.g. TPS 01 is registered for 3050 voters (DPT), but the counted total comes in at 3098, which is an immediate red flag (more votes than registered voters is not physically possible and points to a data-entry or integrity problem). Conversely, undershooting the DPT is normal (turnout is never 100%), so it should be visible as context, not flagged as suspicious.

This is largely already solved at the data-model level: `tps.dpt_limit` already exists (an optional per-TPS field, "Batas DPT"), and there is already a "Melebihi DPT" (over-DPT) warning on both [admin/tps.html](../../../admin/tps.html) and the public dashboard's per-TPS table. What's missing:
1. The per-TPS admin row shows the raw numbers but not a turnout percentage, so reading "is this TPS's count reasonable relative to its registered voters" requires mental math.
2. There is no aggregate view anywhere — an admin or the public has no way to see "how much of the total registered electorate has voted so far" across the whole election.

## Non-goals

- No new database column or RPC — `tps.dpt_limit` and `get_tps_overview` (already returns `dpt_limit` and `total_votes` per TPS) are sufficient. This is a display-only enhancement to existing data already being fetched by both pages.
- No change to the existing over-DPT warning logic (`js/tps-manage.js`'s `limit-warning` / `over-limit` classes, `js/live-dashboard.js`'s `over-limit` row class) — both already correctly flag `total_votes > dpt_limit`, untouched by this spec.
- No enforcement making `dpt_limit` mandatory when adding/editing a TPS — it stays optional, exactly as today.
- No threshold-based "turnout too low" warning. Undershooting the DPT is normal (turnout is never 100%), so the shortfall case is addressed purely by displaying the percentage as neutral information, never as a warning color or alert — the admin judges what's reasonable, the system doesn't.
- No changes to `live/tps.html` (the public per-TPS detail page) — confirmed in scope discussion that this stays index.html + admin/tps.html only.

## Architecture

Both changes are pure display logic layered on data both pages already fetch via the existing `get_tps_overview(p_election_id)` RPC (which already returns `dpt_limit` and `total_votes` per row) — no new network request, no schema change.

### 1. Per-TPS turnout line — [js/tps-manage.js](../../../js/tps-manage.js) `renderRows()`

Currently (lines 171-186), each row computes `over = row.dpt_limit && row.total_votes > row.dpt_limit` and conditionally renders a `<div class="limit-warning">Melebihi DPT (...)</div>`. This spec adds a second, always-shown (when `dpt_limit` is set) informational line in the same column:

```
72% dari DPT (1262/3050)
```

Computed as `Math.round((row.total_votes / row.dpt_limit) * 100)`. When `row.dpt_limit` is falsy (not yet entered for this TPS), nothing is rendered for this line — no `0%`, no dash, just absent, matching how the existing over-limit warning already handles the same case.

This line and the existing `limit-warning` div are independent and can both show at once: a TPS at 104% renders both `104% dari DPT (3180/3050)` (informational, muted) and `Melebihi DPT (3180/3050)` (warning, red) — the percentage line answers "how does this compare," the warning answers "this needs attention," and showing both is intentional, not redundant, since they use different visual weight for different questions.

### 2. Aggregate DPT/turnout stat — [js/live-dashboard.js](../../../js/live-dashboard.js) `renderHeader()`

Currently (lines 60-76), `renderHeader(overview, overall)` computes `totalValid`/`totalInvalid` by reducing over the `overview` array (already fetched every `refresh()` tick from `get_tps_overview`) and writes them into `el.statValid`/`el.statInvalid`. This spec adds, in the same function, using the same already-in-scope `overview` array:

```js
const tpsWithDpt = overview.filter((r) => r.dpt_limit);
const totalDpt = tpsWithDpt.reduce((s, r) => s + Number(r.dpt_limit), 0);
const votesWithDpt = tpsWithDpt.reduce((s, r) => s + Number(r.total_votes), 0);
```

Two new stat lines in the dashboard header (see UI section for exact markup):
- **Total DPT**: `30.500 (38/40 TPS)` — the sum, with a parenthetical showing how many of the total TPS count actually have `dpt_limit` set, so a partially-filled-in DPT dataset is never presented as if it were complete.
- **Turnout**: `72%` — computed as `(votesWithDpt / totalDpt * 100)`, rounded, ONLY when `totalDpt > 0`, where `votesWithDpt` sums `total_votes` from the SAME subset of TPS that have `dpt_limit` set (not all TPS) — the numerator and denominator must cover the same TPS or the percentage is meaningless in a partially-filled-DPT dataset; when no TPS has `dpt_limit` set yet, this line reads `"Belum ada data DPT"` instead of computing `NaN%` or `Infinity%`.

Both values recompute every `refresh()` call exactly like the existing stats — no separate polling, no separate realtime subscription, they ride the same 800ms-throttled cycle already in place.

## UI

### admin/tps.html row (js/tps-manage.js)

No new grid column — `.tps-row`'s existing 7-column CSS grid (`css/tps.css`) is unchanged. The new line goes inside the same flexible middle column (the `<span>` at line 178-181 of `js/tps-manage.js`) that already holds the TPS name and the over-limit warning, as a new always-there-when-applicable `<div class="dpt-turnout">`:

```html
<span>
  ${row.name ? `<div class="tps-meta">${escapeHtml(row.name)}</div>` : ''}
  ${row.is_verified ? '<span class="verified-mark">✓ terverifikasi</span>' : ''}
  ${pct !== null ? `<div class="dpt-turnout">${pct}% dari DPT (${row.total_votes}/${row.dpt_limit})</div>` : ''}
  ${over ? `<div class="limit-warning">Melebihi DPT (${row.total_votes}/${row.dpt_limit})</div>` : ''}
</span>
```

`.dpt-turnout` styled as small, muted text (`color: var(--color-ink-faint)`, matching the existing `.tps-meta` treatment) — explicitly NOT colored as a warning, since undershooting is normal and this line's whole purpose is to convey that without alarm. This survives every existing responsive breakpoint unchanged, since it lives in the column that's never hidden (only the `.votes` columns are dropped on narrow viewports).

### index.html dashboard header (js/live-dashboard.js)

Two new `<div class="stat-line">` entries added to the existing `<dl class="stat-list">` (index.html, currently lines 40-44), following the exact same markup pattern as the three that already exist:

```html
<div class="stat-line"><dt>Total DPT</dt><dd id="statTotalDpt">–</dd></div>
<div class="stat-line"><dt>Turnout</dt><dd id="statTurnout">–</dd></div>
```

No new CSS needed — `.stat-line`/`.stat-list` styling already handles an arbitrary number of rows.

## Error handling

| Case | admin/tps.html row | index.html aggregate stats |
|---|---|---|
| `dpt_limit` not set for this TPS | Turnout line absent entirely (no `0%`) | This TPS excluded from `totalDpt`, from `votesWithDpt`, and from the "X/Y TPS" denominator's numerator (still counts toward Y) |
| No TPS has `dpt_limit` set at all | N/A (per-row, unaffected) | `#statTurnout` shows `"Belum ada data DPT"`; `#statTotalDpt` shows `"0 (0/{total TPS} TPS)"` |
| `total_votes > dpt_limit` (over) | Turnout line can read e.g. `104%`; existing red `limit-warning` also shows, unchanged | Aggregate turnout can legitimately exceed 100% if enough TPS are over — not clamped, since that itself is a signal worth seeing at the aggregate level too |
| New TPS added while counting is live | Next `loadOverview()`/`refresh()` call picks it up automatically — no code path needs to know about "new" TPS specially, since both functions always operate on the full current `overview`/`state.rows` array | Same — next `refresh()` tick includes it |
| Realtime vote update arrives | N/A — this admin page has no realtime subscription today, unaffected by this spec | Already-existing realtime-triggered `refresh()` recomputes both new stats along with the existing three, no separate trigger needed |

## Testing

No automated test suite exists in this repo (established pattern across every prior feature) — verification is manual:

- Set `dpt_limit` on a TPS, cast/tally some votes into it, confirm the admin row shows the correct `X% dari DPT (total/dpt)` format matching hand-calculated arithmetic.
- Leave a TPS's `dpt_limit` empty, confirm its row shows no turnout line and no crash.
- Push a TPS over its `dpt_limit` (e.g. via Input Rekap TPS), confirm both the new turnout line (reading >100%) and the existing red "Melebihi DPT" warning appear together.
- On the public dashboard, with a mix of TPS that do/don't have `dpt_limit` set, confirm "Total DPT" sums only the ones that have it and the "(X/Y TPS)" count is accurate.
- With zero TPS having `dpt_limit` set, confirm the dashboard shows "Belum ada data DPT" rather than `NaN%`/`Infinity%`.
- Reload both pages, confirm no console errors.
