# TPS DPT Turnout Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show per-TPS turnout against the existing `dpt_limit` field on the admin TPS list, and an aggregate Total DPT / Turnout stat on the public dashboard, per the approved spec at `docs/superpowers/specs/2026-09-17-tps-dpt-turnout-design.md`.

**Architecture:** Pure display logic on data both pages already fetch via the existing `get_tps_overview` RPC (already returns `dpt_limit` and `total_votes` per TPS row). No schema change, no new RPC, no new network request.

**Tech Stack:** Vanilla JS (IIFE per page, no framework, no build step), plain CSS with the existing `--color-*` token system.

## Global Constraints

- No automated test suite exists in this repo; verification is manual/browser-based.
- All UI copy is Bahasa Indonesia.
- The over-DPT warning (`limit-warning`/`over-limit` classes) is existing, unchanged behavior — do not modify its condition or styling.
- Under-DPT (turnout below 100%) is NEVER shown as a warning color — it's neutral informational text only (`--color-ink-faint`, matching `.tps-meta`'s existing treatment).
- When `dpt_limit` is not set for a TPS, no percentage is shown for it at all (not `0%`, not a dash) — it's simply absent, and it's excluded from any aggregate sum.
- No RPC/database changes in this plan.

---

### Task 1: Per-TPS turnout line on the admin TPS list

**Files:**
- Modify: `js/tps-manage.js` (`renderRows()`, currently lines 167-196)
- Modify: `css/tps.css` (one new rule, after `.tps-meta`, currently lines 153-156)

**Interfaces:**
- Consumes: `row.dpt_limit`, `row.total_votes` (already present on every row from `get_tps_overview`, already used by the existing `over` calculation in this same function).
- Produces: nothing consumed elsewhere — self-contained to this one function/file.

- [ ] **Step 1: Add the turnout percentage calculation and render it**

In `js/tps-manage.js`, replace this block (currently lines 171-186):

```js
    state.rows.forEach((row) => {
      const over = row.dpt_limit && row.total_votes > row.dpt_limit;
      const el2 = document.createElement('div');
      el2.className = 'tps-row';
      el2.innerHTML = `
        <span class="num">${padTps(row.tps_number)}</span>
        <span class="badge status-${row.status}">${statusLabelId(row.status)}</span>
        <span>
          ${row.name ? `<div class="tps-meta">${escapeHtml(row.name)}</div>` : ''}
          ${row.is_verified ? '<span class="verified-mark">✓ terverifikasi</span>' : ''}${over ? `<div class="limit-warning">Melebihi DPT (${row.total_votes}/${row.dpt_limit})</div>` : ''}
        </span>
        <span class="votes">${row.valid_votes}</span>
        <span class="votes">${row.invalid_votes}</span>
        <span class="votes ${over ? 'over-limit' : ''}">${row.total_votes}</span>
        <span class="actions"></span>
      `;
```

with:

```js
    state.rows.forEach((row) => {
      const over = row.dpt_limit && row.total_votes > row.dpt_limit;
      const pct = row.dpt_limit ? Math.round((row.total_votes / row.dpt_limit) * 100) : null;
      const el2 = document.createElement('div');
      el2.className = 'tps-row';
      el2.innerHTML = `
        <span class="num">${padTps(row.tps_number)}</span>
        <span class="badge status-${row.status}">${statusLabelId(row.status)}</span>
        <span>
          ${row.name ? `<div class="tps-meta">${escapeHtml(row.name)}</div>` : ''}
          ${row.is_verified ? '<span class="verified-mark">✓ terverifikasi</span>' : ''}
          ${pct !== null ? `<div class="dpt-turnout">${pct}% dari DPT (${row.total_votes}/${row.dpt_limit})</div>` : ''}
          ${over ? `<div class="limit-warning">Melebihi DPT (${row.total_votes}/${row.dpt_limit})</div>` : ''}
        </span>
        <span class="votes">${row.valid_votes}</span>
        <span class="votes">${row.invalid_votes}</span>
        <span class="votes ${over ? 'over-limit' : ''}">${row.total_votes}</span>
        <span class="actions"></span>
      `;
```

(Only the `pct` calculation and the one new template line are added — `over`'s existing logic, the vote columns, and everything else in this block is untouched.)

- [ ] **Step 2: Add the CSS**

In `css/tps.css`, immediately after `.tps-meta` (currently lines 153-156), add:

```css
.dpt-turnout {
  font-size: 11px;
  color: var(--color-ink-faint);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Manually verify**

Open `admin/tps.html` logged in as admin:
- A TPS with `dpt_limit` set and some votes counted shows a muted line reading `{pct}% dari DPT ({total}/{dpt_limit})` matching hand-calculated arithmetic (e.g. 1262 votes / 3050 DPT → "41% dari DPT (1262/3050)").
- A TPS with no `dpt_limit` set shows no turnout line at all — no `0%`, no dash, nothing.
- A TPS pushed over its `dpt_limit` (e.g. via Input Rekap TPS) shows BOTH the new turnout line (reading >100%, e.g. "104% dari DPT (3180/3050)") AND the existing red "Melebihi DPT (3180/3050)" warning below it.
- Layout doesn't break on narrow viewports (resize to phone width) — the new line lives in the same column as the existing TPS name/warning, which already survives the responsive breakpoints in `css/tps.css`.

- [ ] **Step 4: Commit**

```bash
git add js/tps-manage.js css/tps.css
git commit -m "$(cat <<'EOF'
Show per-TPS turnout percentage against DPT on the admin TPS list

Reuses the existing dpt_limit field and get_tps_overview data — no
new query. Shown as neutral muted text (never a warning color) since
turnout below 100% of registered voters is normal; the existing
over-DPT red warning is untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Aggregate Total DPT / Turnout stat on the public dashboard

**Files:**
- Modify: `index.html` (two new stat-line elements, currently lines 40-44)
- Modify: `js/live-dashboard.js` (`el` object at lines 36-47, `renderHeader()` at lines 60-76)

**Interfaces:**
- Consumes: the `overview` array already passed into `renderHeader(overview, overall)` (fetched every `refresh()` tick from `get_tps_overview`, same array `totalValid`/`totalInvalid` already reduce over).
- Produces: nothing consumed by other tasks — this is the last task in this plan.

- [ ] **Step 1: Add the two new stat-line elements**

In `index.html`, replace this block (currently lines 40-44):

```html
        <dl class="stat-list">
          <div class="stat-line"><dt>TPS Selesai</dt><dd id="statTpsDone">0 TPS</dd></div>
          <div class="stat-line"><dt>Suara Sah</dt><dd id="statValid">0 SAH</dd></div>
          <div class="stat-line"><dt>Suara Tidak Sah</dt><dd id="statInvalid">0 TIDAK SAH</dd></div>
        </dl>
```

with:

```html
        <dl class="stat-list">
          <div class="stat-line"><dt>TPS Selesai</dt><dd id="statTpsDone">0 TPS</dd></div>
          <div class="stat-line"><dt>Suara Sah</dt><dd id="statValid">0 SAH</dd></div>
          <div class="stat-line"><dt>Suara Tidak Sah</dt><dd id="statInvalid">0 TIDAK SAH</dd></div>
          <div class="stat-line"><dt>Total DPT</dt><dd id="statTotalDpt">–</dd></div>
          <div class="stat-line"><dt>Turnout</dt><dd id="statTurnout">–</dd></div>
        </dl>
```

- [ ] **Step 2: Add the element references**

In `js/live-dashboard.js`, in the `el` object (currently lines 36-47), add two lines after `statInvalid`:

```js
    statTpsDone: document.getElementById('statTpsDone'),
    statValid: document.getElementById('statValid'),
    statInvalid: document.getElementById('statInvalid'),
    statTotalDpt: document.getElementById('statTotalDpt'),
    statTurnout: document.getElementById('statTurnout'),
```

- [ ] **Step 3: Compute and render the aggregate in `renderHeader`**

In `js/live-dashboard.js`, replace this block (currently lines 60-76):

```js
  function renderHeader(overview, overall) {
    const total = overview.length;
    const done = overview.filter((r) => r.status === 'locked' || r.status === 'completed').length;
    const allLocked = total > 0 && overview.every((r) => r.status === 'locked');

    el.statTpsDone.textContent = `${done} TPS`;

    const totalValid = overview.reduce((s, r) => s + Number(r.valid_votes), 0);
    const totalInvalid = overview.reduce((s, r) => s + Number(r.invalid_votes), 0);
    el.statValid.textContent = `${totalValid.toLocaleString('id-ID')} SAH`;
    el.statInvalid.textContent = `${totalInvalid.toLocaleString('id-ID')} TIDAK SAH`;

    el.resultStatus.classList.toggle('final', allLocked);
    el.resultStatus.querySelector('span:last-child').textContent = allLocked ? 'Selesai' : 'Live Count';

    return { totalValid, totalInvalid };
  }
```

with:

```js
  function renderHeader(overview, overall) {
    const total = overview.length;
    const done = overview.filter((r) => r.status === 'locked' || r.status === 'completed').length;
    const allLocked = total > 0 && overview.every((r) => r.status === 'locked');

    el.statTpsDone.textContent = `${done} TPS`;

    const totalValid = overview.reduce((s, r) => s + Number(r.valid_votes), 0);
    const totalInvalid = overview.reduce((s, r) => s + Number(r.invalid_votes), 0);
    el.statValid.textContent = `${totalValid.toLocaleString('id-ID')} SAH`;
    el.statInvalid.textContent = `${totalInvalid.toLocaleString('id-ID')} TIDAK SAH`;

    const tpsWithDpt = overview.filter((r) => r.dpt_limit);
    const totalDpt = tpsWithDpt.reduce((s, r) => s + Number(r.dpt_limit), 0);
    const votesWithDpt = tpsWithDpt.reduce((s, r) => s + Number(r.total_votes), 0);
    el.statTotalDpt.textContent = `${totalDpt.toLocaleString('id-ID')} (${tpsWithDpt.length}/${total} TPS)`;
    el.statTurnout.textContent = totalDpt > 0
      ? `${Math.round(votesWithDpt / totalDpt * 100)}%`
      : 'Belum ada data DPT';

    el.resultStatus.classList.toggle('final', allLocked);
    el.resultStatus.querySelector('span:last-child').textContent = allLocked ? 'Selesai' : 'Live Count';

    return { totalValid, totalInvalid };
  }
```

- [ ] **Step 4: Manually verify**

Open `index.html`:
- With some TPS having `dpt_limit` set and votes counted, confirm "Total DPT" shows the correct sum with the correct `(X/Y TPS)` count, and "Turnout" shows a percentage matching hand-calculated `(votes from TPS with dpt_limit) / totalDpt` — i.e. only votes from the TPS counted in `totalDpt`, not votes from every TPS.
- If no TPS has `dpt_limit` set at all, confirm "Turnout" reads "Belum ada data DPT" (not `NaN%` or `Infinity%`), and "Total DPT" reads `0 (0/{total} TPS)`.
- Push enough TPS over their `dpt_limit` that the aggregate turnout exceeds 100%, confirm it displays as-is (e.g. "104%") rather than being clamped.
- Trigger the existing realtime refresh path (cast a vote from another tab/session) and confirm both new stats update on the same cycle as the existing three.
- Reload the page, confirm no console errors.

- [ ] **Step 5: Commit**

```bash
git add index.html js/live-dashboard.js
git commit -m "$(cat <<'EOF'
Add aggregate Total DPT / Turnout stat to the public dashboard

Sums dpt_limit across TPS that have it set, shows how many of the
total TPS count that covers, and computes overall turnout — all from
the get_tps_overview data already fetched every refresh cycle, no
new request. Falls back to a plain message instead of NaN/Infinity
when no TPS has DPT data yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
