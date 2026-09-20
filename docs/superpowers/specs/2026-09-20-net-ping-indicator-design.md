# Network Ping Indicator — Design Spec

Date: 2026-09-20
Status: Approved (pending implementation)

## Problem

Neither admins nor the public viewing the dashboard have any visibility into how good their own connection to the backend currently is. Rapid Input already shows queue/offline state (`#connState`), but that's about the *vote queue's* state, not raw network quality — an operator with a slow-but-technically-online connection sees "ONLINE" the same as one with a fast connection, with no way to tell why input feels laggy. This adds a small round-trip-latency badge to the public dashboard and both admin input pages.

## Non-goals

- No true ICMP ping — browsers can't do that. This measures HTTP round-trip time to the Supabase project the app already depends on, which is the more relevant number anyway (it's the actual dependency, not "the internet" in the abstract).
- No historical graph/log of past latency — just the current reading, refreshed on an interval.
- No change to Rapid Input's existing `#connState` (offline queue status) — this is a separate, additional indicator, not a replacement.
- Not added to `live/tps.html`, `admin/tps.html`, `admin/candidates.html`, or any other page — scope is confirmed as exactly the public dashboard (`index.html`) plus the two admin input pages (`admin/input.html`, `admin/tally.html`).

## Architecture

One new shared file, `js/net-ping.js`, included by all three target pages (unlike most JS in this codebase, which is duplicated per-page — this one is a single shared file because its logic and UI are byte-identical everywhere it's used, with no page-specific behavior to diverge).

**Measurement:** every 5 seconds, time a lightweight Supabase query using `performance.now()` before/after:
```js
const start = performance.now();
const { error } = await sb.from('elections').select('id', { head: true, count: 'exact' }).limit(1);
const ms = Math.round(performance.now() - start);
```
`head: true` means no row body is returned — this still exercises the full real path (auth, RLS, network) the app's other queries go through, just with a minimal response, an accurate proxy for "how fast is my connection to the thing this app actually depends on" without meaningfully adding load.

**Thresholds:**
- `< 150ms` → good (green)
- `150-400ms` → ok (yellow)
- `>= 400ms` or the request errors/throws → bad (red), label reads "Timeout"

**Guards:**
- Skip the tick entirely when `document.hidden` (matches the existing pattern already used by `js/live-dashboard.js`'s realtime-refresh throttle) — no point spending a request on a backgrounded tab.
- A `measuring` flag prevents a slow request from overlapping with the next scheduled tick.
- If `document.getElementById('netPing')` doesn't exist on a page, the script does nothing (defensive early return) — this lets the same file be safely included even if a future page adds the script tag without the placeholder element yet.

## UI

**Badge markup** (rendered by JS into the page-supplied placeholder):
```html
<span id="netPing" class="net-ping">
  <span class="net-ping-dot"></span><span class="net-ping-text">--</span>
</span>
```

**CSS** goes in `css/base.css` (not a per-page stylesheet) since this is the one piece of UI in this codebase that is genuinely identical across pages that otherwise have entirely separate stylesheets:
```css
.net-ping { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.net-ping-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-ink-faint); }
.net-ping-dot.good { background: var(--color-success); }
.net-ping-dot.ok { background: var(--color-warning); }
.net-ping-dot.bad { background: var(--color-danger); }
```
`margin-left: auto` is what places the badge at the right edge of whichever flex container it's in — this works uniformly across the three host bars even though they have different layout rules (`.topbar`/`.page-header` use `justify-content: space-between`, `.topbar-mini` doesn't use `justify-content` at all), so no page-specific wrapper markup is needed.

**Placement per page** (each gets one new `<span id="netPing">` placeholder in its existing top bar, populated by the shared script):
- `admin/input.html`: inserted between the existing `.topbar-left` div and the existing `#connState` span, so the two end up adjacent at the right edge.
- `admin/tally.html`: appended as the second child of `.page-header`, right after `.topbar-left` (this page currently has only one child there).
- `index.html`: appended as the third child of `.topbar-mini`, after `.topbar-mini-title`.

No existing element, class, or script on any of the three pages is modified beyond adding the one new `<span>` and one new `<script src="js/net-ping.js">` tag (loaded after `js/supabase.js`, since it needs the global `sb` client).

## Error handling

| Case | Behavior |
|---|---|
| Query throws/errors (network down, Supabase unreachable) | Dot turns red, text reads "Timeout" |
| Query succeeds but is slow (≥400ms) | Dot turns red, text shows the actual ms value (not "Timeout" — it did respond, just slowly) |
| Tab backgrounded (`document.hidden`) | Tick skipped entirely, badge keeps showing its last known reading (not reset to "--") |
| Placeholder element missing on some future page that forgets it | Script no-ops silently, no console error |
| Overlapping ticks (a request takes longer than 5s) | Next scheduled tick is skipped via the `measuring` guard, not queued |

## Testing

No automated test suite exists in this repo (consistent with every other feature) — manual verification:
- Open each of the three pages, confirm the badge appears at the right edge of its top bar and starts reading a plausible ms value within 5 seconds.
- Throttle network in devtools (e.g. "Slow 3G"), confirm the dot turns yellow/red and the ms value increases accordingly.
- Fully disable network, confirm the dot turns red and the text reads "Timeout", then re-enable and confirm it recovers to green/yellow on the next tick.
- Switch to a different browser tab and back, confirm no console errors accumulate and the badge resumes updating.
- Confirm `admin/input.html`'s existing `#connState` badge is completely unaffected (still reflects queue/offline state exactly as before).
