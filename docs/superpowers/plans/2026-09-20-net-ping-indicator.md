# Network Ping Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared round-trip-latency badge (`● 42 ms`, color-coded) to the public dashboard and both admin input pages, per the approved spec at `docs/superpowers/specs/2026-09-20-net-ping-indicator-design.md`.

**Architecture:** One new shared file `js/net-ping.js` (unlike most JS in this codebase, genuinely shared rather than duplicated per page, since its logic and UI never diverge by page) measures round-trip time to Supabase every 5 seconds via a lightweight `head: true` query and writes the result into a `<span id="netPing">` placeholder each host page declares in its own top bar.

**Tech Stack:** Vanilla JS (IIFE, no framework, no build step), plain CSS with the existing `--color-*` token system, Supabase JS client already loaded on every target page.

## Global Constraints

- No automated test suite exists in this repo; verification is manual/browser-based.
- Thresholds: `< 150ms` → green, `150-400ms` → yellow, `>= 400ms` or request error → red with "Timeout" text specifically for the error case (a slow-but-successful response shows red with the actual ms, not "Timeout").
- Poll every 5000ms; skip the tick when `document.hidden`; guard against overlapping ticks if a request takes longer than the interval.
- `js/net-ping.js` must no-op (not throw) if `#netPing` doesn't exist on a page.
- CSS lives in `css/base.css` (shared by all pages), not a per-page stylesheet — this is the one component in this codebase that is identical across every page it appears on.
- Do not modify `admin/input.html`'s existing `#connState` element, its CSS, or `js/vote-input.js`'s connection-state logic in any way — this is a separate, additional indicator.
- `js/net-ping.js` must be loaded after `js/supabase.js` on every page that includes it, since it uses the global `sb` client.

---

### Task 1: Shared ping script, CSS, and placement on all three pages

**Files:**
- Create: `js/net-ping.js`
- Modify: `css/base.css` (new rules, before the final `.hidden` rule, currently the last line)
- Modify: `admin/input.html` (one new `<span>`, one new `<script>` tag)
- Modify: `admin/tally.html` (one new `<span>`, one new `<script>` tag)
- Modify: `index.html` (one new `<span>`, one new `<script>` tag)

**Interfaces:**
- Consumes: the global `sb` Supabase client (from `js/supabase.js`, already loaded on all three pages before this script).
- Produces: nothing consumed by other tasks — this is the only task in this plan.

- [ ] **Step 1: Create `js/net-ping.js`**

```js
// Round-trip latency to Supabase, shown as a small badge in the top bar.
// Shared verbatim across every page that includes it — unlike the rest of
// this codebase's per-page JS, this one never diverges by page, so it isn't
// duplicated. Real ICMP ping isn't available from a browser; timing a
// lightweight query to the backend this app actually depends on is the more
// relevant number anyway.
(function () {
  const INTERVAL_MS = 5000;
  const GOOD_MS = 150;
  const OK_MS = 400;

  const el = document.getElementById('netPing');
  if (!el) return;

  el.innerHTML = '<span class="net-ping-dot"></span><span class="net-ping-text">--</span>';
  const dot = el.querySelector('.net-ping-dot');
  const text = el.querySelector('.net-ping-text');

  let measuring = false;

  function render(ms) {
    if (ms === null) {
      dot.className = 'net-ping-dot bad';
      text.textContent = 'Timeout';
      return;
    }
    dot.className = 'net-ping-dot ' + (ms < GOOD_MS ? 'good' : ms < OK_MS ? 'ok' : 'bad');
    text.textContent = `${ms} ms`;
  }

  async function measure() {
    if (measuring || document.hidden) return;
    measuring = true;

    const start = performance.now();
    try {
      const { error } = await sb.from('elections').select('id', { head: true, count: 'exact' }).limit(1);
      if (error) throw error;
      render(Math.round(performance.now() - start));
    } catch (_) {
      render(null);
    } finally {
      measuring = false;
    }
  }

  measure();
  setInterval(measure, INTERVAL_MS);
})();
```

- [ ] **Step 2: Add the CSS**

In `css/base.css`, immediately before the final rule (currently `.hidden { display: none !important; }`, the last line of the file), add:

```css
.net-ping {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.net-ping-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-ink-faint);
  flex-shrink: 0;
}

.net-ping-dot.good { background: var(--color-success); }
.net-ping-dot.ok { background: var(--color-warning); }
.net-ping-dot.bad { background: var(--color-danger); }
```

- [ ] **Step 3: Add the placeholder and script tag to `admin/input.html`**

In `admin/input.html`, replace this line (currently line 28, inside `.topbar`):

```html
    <span id="connState" class="conn-online">ONLINE ●</span>
```

with:

```html
    <span id="netPing" class="net-ping"></span>
    <span id="connState" class="conn-online">ONLINE ●</span>
```

Then, replace this line (currently line 85):

```html
  <script src="../js/vote-input.js"></script>
```

with:

```html
  <script src="../js/vote-input.js"></script>
  <script src="../js/net-ping.js"></script>
```

- [ ] **Step 4: Add the placeholder and script tag to `admin/tally.html`**

In `admin/tally.html`, replace this block (currently lines 24-29):

```html
  <div class="page-header">
    <div class="topbar-left">
      <button class="hamburger-btn" id="hamburgerBtn" aria-label="Buka menu"><span></span><span></span><span></span></button>
      <span class="wordmark">Pilkades Live Count</span>
    </div>
  </div>
```

with:

```html
  <div class="page-header">
    <div class="topbar-left">
      <button class="hamburger-btn" id="hamburgerBtn" aria-label="Buka menu"><span></span><span></span><span></span></button>
      <span class="wordmark">Pilkades Live Count</span>
    </div>
    <span id="netPing" class="net-ping"></span>
  </div>
```

Then, replace this line (currently line 56):

```html
  <script src="../js/tally-input.js"></script>
```

with:

```html
  <script src="../js/tally-input.js"></script>
  <script src="../js/net-ping.js"></script>
```

- [ ] **Step 5: Add the placeholder and script tag to `index.html`**

In `index.html`, replace this block (currently lines 23-26):

```html
  <div class="topbar-mini">
    <button class="hamburger-btn" id="hamburgerBtn" aria-label="Buka menu"><span></span><span></span><span></span></button>
    <span class="topbar-mini-title">E-Voting Pilkades</span>
  </div>
```

with:

```html
  <div class="topbar-mini">
    <button class="hamburger-btn" id="hamburgerBtn" aria-label="Buka menu"><span></span><span></span><span></span></button>
    <span class="topbar-mini-title">E-Voting Pilkades</span>
    <span id="netPing" class="net-ping"></span>
  </div>
```

Then, replace this line (currently line 85):

```html
  <script src="js/live-dashboard.js"></script>
```

with:

```html
  <script src="js/live-dashboard.js"></script>
  <script src="js/net-ping.js"></script>
```

- [ ] **Step 6: Manually verify**

Open all three pages (`index.html`, `admin/input.html` logged in as admin, `admin/tally.html` logged in as admin):
- Confirm a small dot+ms badge appears at the right edge of each page's top bar, and starts reading a plausible value (e.g. `50 ms`–`300 ms` depending on your connection) within 5 seconds of load.
- Confirm the dot is green for a fast reading.
- Throttle network in devtools (e.g. "Slow 3G"), wait for the next tick, confirm the dot turns yellow or red and the ms value increases accordingly (not "Timeout" — the request still succeeds, just slowly).
- Fully disable network (devtools "Offline"), wait for the next tick, confirm the dot turns red and the text reads exactly `Timeout`. Re-enable network, confirm it recovers to green/yellow on a subsequent tick.
- On `admin/input.html`, confirm `#connState` (the existing ONLINE/OFFLINE/SYNCING badge) is completely unaffected — cast a vote, toggle network, confirm its behavior is identical to before this change.
- Switch to a different browser tab for 10+ seconds, switch back, confirm no console errors appeared and the badge resumes updating normally.
- Open devtools console on each page, confirm no errors from `net-ping.js` (e.g. no "Cannot read property of null" if a page's markup doesn't match expectations).

- [ ] **Step 7: Commit**

```bash
git add js/net-ping.js css/base.css admin/input.html admin/tally.html index.html
git commit -m "$(cat <<'EOF'
Add network ping indicator to dashboard and both input pages

Shared js/net-ping.js (identical logic/UI on all three pages, so not
duplicated per-page like most JS here) times a lightweight Supabase
query every 5s as a proxy for real ICMP ping, which browsers can't
do. Placed via margin-left: auto so it lands at the right edge of
each page's differently-structured top bar with no wrapper markup.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
