# Input Rekap TPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, additive bulk/final-tally vote input method per TPS, alongside the existing per-keypress Rapid Input, per the approved spec at `docs/superpowers/specs/2026-09-17-input-rekap-tps-design.md`.

**Architecture:** One new Postgres RPC (`submit_tps_tally`) that loops candidate deltas through the existing `bump_vote_summary` helper (already additive and DB-atomic) and writes one audit log row per submit. One new static admin page (`admin/tally.html` + `js/tally-input.js` + `css/tally.css`) with a TPS-number grid on the left and a per-candidate delta form on the right, following the exact structural patterns already used by `admin/tps.html` / `live/tps.html`.

**Tech Stack:** Vanilla JS (IIFE per page, no framework, no build step), Supabase JS client v2 (`@supabase/supabase-js`), Postgres RPC (`plpgsql`/`sql`, `SECURITY DEFINER`), plain CSS with the existing `--color-*` token system.

## Global Constraints

- No automated test framework exists anywhere in this repo (no unit/e2e test file for any existing page or RPC). Per the approved spec's Testing section, this feature adds none either — "test" steps below are exact SQL verification queries (run via the Supabase `execute_sql` MCP tool) for the backend, and manual browser checks for the UI. This is a deliberate, spec-approved deviation from generic TDD, not an oversight.
- Supabase project for this app: `project_id = srlsyxlkcgscbngbrqzw` (name `pilkades-livecount`). Always pass this exact `project_id` to Supabase MCP tools.
- Every new RPC must match the existing convention exactly: `SECURITY DEFINER`, `SET search_path TO 'public', 'pg_temp'`, and an `if not is_admin() then raise exception 'not authorized'; end if;` guard as the first statement (copy the pattern from `cast_vote`/`set_tps_status`, already in the live DB).
- All UI copy is Bahasa Indonesia, matching every existing page.
- Every string interpolated into `innerHTML` must go through the existing `escapeHtml()` helper (copy the one-liner already duplicated in every admin JS file — this repo does not share it via `utils.js`, so match that existing duplication pattern rather than introducing a shared import).
- Reuse existing shared helpers from `js/utils.js` — `padTps()`, `statusLabelId()`, `animateNumber()` — do not reimplement them.
- CSS must use the existing tokens from `css/variables.css` (`--color-*`, `--space-*`, `--radius-*`) — no new colors, no new fonts (Arial stack only), square-ish corners (`--radius-sm`/`--radius-lg`, already 2–3px).
- Election lookup in every page `init()` uses this exact pattern (copy verbatim, already used in 7 other files): `sb.from('elections').select(...).eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()`.
- Auth guard on every admin page: `const { data: { session } } = await sb.auth.getSession(); if (!session) { window.location.href = '../login.html'; return; }` at the top of `init()`.

---

### Task 1: Backend RPC `submit_tps_tally` + activity log labels

**Files:**
- Database: Supabase project `srlsyxlkcgscbngbrqzw`, applied via the `mcp__cbbf6dc6-fa1d-4bdb-94b8-7b0773513ca1__apply_migration` tool (no local SQL file — this repo has no migrations directory; every existing RPC lives only in the remote DB, so this follows the established pattern).
- Modify: `js/utils.js` (add one entry to `ACTION_LABELS_ID`, around line 27-43)
- Modify: `js/logs.js` (add one entry to `KNOWN_ACTIONS`, around line 129-134)

**Interfaces:**
- Produces: RPC `submit_tps_tally(p_tps_id uuid, p_deltas jsonb) returns jsonb`, called as `sb.rpc('submit_tps_tally', { p_tps_id, p_deltas })` where `p_deltas` is `[{ candidate_id: string|null, delta: number }, ...]`. Returns `{ tps_status: string, summary: [{ candidate_id: string|null, vote_count: number }] }` (same shape `cast_vote`/`undo_last_vote` already return, minus the `event` key since there's no single vote_events row).
- Consumes: existing `is_admin()` and `bump_vote_summary(p_election_id uuid, p_tps_id uuid, p_candidate_id uuid, p_delta integer)` functions, already live in the DB (verified below).

- [ ] **Step 1: Apply the migration creating `submit_tps_tally`**

Use the `apply_migration` tool with `project_id: "srlsyxlkcgscbngbrqzw"`, `name: "submit_tps_tally"`, and this `query`:

```sql
create or replace function public.submit_tps_tally(p_tps_id uuid, p_deltas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tps tps;
  v_item jsonb;
  v_candidate_id uuid;
  v_delta integer;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;

  select * into v_tps from tps where id = p_tps_id for update;
  if not found then
    raise exception 'tps not found';
  end if;
  if v_tps.status = 'locked' then
    raise exception 'tps is locked';
  end if;

  for v_item in select * from jsonb_array_elements(p_deltas)
  loop
    v_candidate_id := nullif(v_item->>'candidate_id', '')::uuid;
    v_delta := (v_item->>'delta')::integer;

    if v_delta = 0 then
      continue;
    end if;

    if v_candidate_id is not null and not exists (
      select 1 from candidates where id = v_candidate_id and election_id = v_tps.election_id and is_active
    ) then
      raise exception 'candidate not found or inactive';
    end if;

    perform bump_vote_summary(v_tps.election_id, p_tps_id, v_candidate_id, v_delta);
  end loop;

  if v_tps.status = 'not_started' then
    update tps set status = 'counting', updated_at = now() where id = p_tps_id;
    v_tps.status := 'counting';
  end if;

  insert into activity_logs (election_id, actor_id, action, entity_type, entity_id, details)
  values (v_tps.election_id, auth.uid(), 'tally_bulk_adjusted', 'tps', p_tps_id,
    jsonb_build_object('deltas', p_deltas));

  return jsonb_build_object(
    'tps_status', v_tps.status,
    'summary', coalesce((select jsonb_agg(jsonb_build_object('candidate_id', candidate_id, 'vote_count', vote_count)) from vote_summary where tps_id = p_tps_id), '[]'::jsonb)
  );
end;
$function$;
```

- [ ] **Step 2: Verify additive behavior via SQL**

Run via `execute_sql` (`project_id: "srlsyxlkcgscbngbrqzw"`) — this simulates an authenticated admin session using the known admin profile id, since raw SQL has no PostgREST session:

```sql
select set_config('request.jwt.claim.sub', '29e9a195-2661-452f-b583-803173853497', true);

select submit_tps_tally(
  '92ce9f20-e333-4851-8571-32ee00bcf862',
  '[{"candidate_id":"7ca09344-df6d-4030-b4f8-a4a0cfaec696","delta":209}]'::jsonb
);
```
Expected: returns `{"tps_status":"counting","summary":[{"candidate_id":"7ca09344-df6d-4030-b4f8-a4a0cfaec696","vote_count":209}]}` (TPS 2 was `not_started`, auto-flips to `counting`).

Run again in the same session:
```sql
select submit_tps_tally(
  '92ce9f20-e333-4851-8571-32ee00bcf862',
  '[{"candidate_id":"7ca09344-df6d-4030-b4f8-a4a0cfaec696","delta":70}]'::jsonb
);
```
Expected: `vote_count` is now `279` (209 + 70 — additive confirmed).

Run a correction:
```sql
select submit_tps_tally(
  '92ce9f20-e333-4851-8571-32ee00bcf862',
  '[{"candidate_id":"7ca09344-df6d-4030-b4f8-a4a0cfaec696","delta":-30}]'::jsonb
);
```
Expected: `vote_count` is now `249` (negative delta confirmed).

- [ ] **Step 3: Verify rejection on a locked TPS**

```sql
update tps set status = 'locked' where id = '92ce9f20-e333-4851-8571-32ee00bcf862';

select submit_tps_tally(
  '92ce9f20-e333-4851-8571-32ee00bcf862',
  '[{"candidate_id":"7ca09344-df6d-4030-b4f8-a4a0cfaec696","delta":10}]'::jsonb
);
```
Expected: raises `tps is locked`.

Revert the test TPS back to a clean state:
```sql
update tps set status = 'not_started' where id = '92ce9f20-e333-4851-8571-32ee00bcf862';
delete from vote_summary where tps_id = '92ce9f20-e333-4851-8571-32ee00bcf862';
delete from activity_logs where entity_id = '92ce9f20-e333-4851-8571-32ee00bcf862' and action = 'tally_bulk_adjusted';
select set_config('request.jwt.claim.sub', '', true);
```

- [ ] **Step 4: Verify rejection for a non-admin caller**

```sql
select set_config('request.jwt.claim.sub', '', true);

select submit_tps_tally(
  '92ce9f20-e333-4851-8571-32ee00bcf862',
  '[{"candidate_id":"7ca09344-df6d-4030-b4f8-a4a0cfaec696","delta":10}]'::jsonb
);
```
Expected: raises `not authorized` (no JWT claim set → `auth.uid()` is null → `is_admin()` is false).

- [ ] **Step 5: Add the activity log label**

In `js/utils.js`, inside the `ACTION_LABELS_ID` object (currently lines 27-43), add one entry after `candidate_deleted`:

```js
  candidate_deleted: 'Paslon dihapus',
  tally_bulk_adjusted: 'Rekap suara diinput/dikoreksi',
};
```

- [ ] **Step 6: Add the log filter entry**

In `js/logs.js`, inside the `KNOWN_ACTIONS` array (currently lines 129-134), add the new action so it shows in the filter dropdown immediately:

```js
  const KNOWN_ACTIONS = [
    'vote_added', 'vote_cancelled',
    'tps_counting_started', 'tps_paused', 'tps_completed', 'tps_locked', 'tps_unlocked',
    'verification_performed', 'export_generated', 'snapshot_created',
    'candidate_added', 'candidate_updated', 'candidate_deleted',
    'tally_bulk_adjusted',
  ];
```

- [ ] **Step 7: Commit**

```bash
git add js/utils.js js/logs.js
git commit -m "$(cat <<'EOF'
Add submit_tps_tally RPC and activity log label for bulk tally input

RPC loops candidate deltas through the existing bump_vote_summary
helper, which is already additive and DB-atomic, so resubmitting for
the same TPS/candidate correctly accumulates rather than overwrites.
Applied directly to the Supabase project (this repo has no local
migrations directory, consistent with every other existing RPC).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Page skeleton — `admin/tally.html`, `css/tally.css`, nav wiring, SW shell cache

**Files:**
- Create: `admin/tally.html`
- Create: `css/tally.css`
- Modify: `js/nav.js:6-16` (add `tally` icon to `NAV_ICONS`)
- Modify: `admin/input.html:90-99`, `admin/tps.html:83-92`, `admin/candidates.html` (nav links block), `admin/logs.html:64-73`, `admin/export.html:69-78`, `admin/snapshots.html:62-71`, `admin/settings.html:66-75` (insert one nav link line each)
- Modify: `sw.js:15-54` (add 3 new URLs to `SHELL_ASSETS`)

**Interfaces:**
- Produces: a loadable `admin/tally.html` page, auth-guarded, with empty containers `#tallyTpsGrid` (left) and `#tallyPanel` (right) that Task 3/4/5 will populate. Confirms the nav link and SW caching work before any business logic exists.
- Consumes: `js/supabase.js` (`sb`), `js/utils.js`, `js/nav.js` (`initNav`) — all already loaded globally via `<script>` tags, same pattern as every other admin page.

- [ ] **Step 1: Create `css/tally.css`**

```css
/* Enterprise navy · Input Rekap TPS — TPS number grid + additive delta form */

.tally-layout {
  display: grid;
  grid-template-columns: clamp(200px, 18vw, 280px) minmax(0, 1fr);
  gap: clamp(var(--space-4), 3vw, 40px);
  align-items: start;
}

@media (max-width: 900px) {
  .tally-layout { grid-template-columns: minmax(0, 1fr); }
}

.tally-tps-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}

.tally-tps-btn {
  aspect-ratio: 1.25;
  min-height: 34px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-ink-muted);
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 140ms var(--ease-out), background 140ms var(--ease-out), color 140ms var(--ease-out);
}

.tally-tps-btn:hover:not(:disabled) {
  border-color: var(--color-ink);
  color: var(--color-ink);
  background: var(--color-surface-alt);
}

.tally-tps-btn.status-locked {
  color: var(--color-danger);
  border-color: rgba(193, 18, 31, 0.35);
}

.tally-tps-btn.is-selected,
.tally-tps-btn.is-selected:hover:not(:disabled) {
  background: #dff0dd;
  border-color: var(--color-success);
  color: #1c4f21;
  font-weight: 800;
}

.tally-panel {
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  background: var(--color-surface);
  padding: var(--space-5);
}

.tally-placeholder {
  color: var(--color-ink-faint);
  font-size: 13px;
  text-align: center;
  padding: var(--space-7) 0;
}

.tally-form-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.tally-form-head .num {
  font-size: 22px;
  font-weight: 800;
}

.tally-locked-banner {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-danger);
  text-align: center;
  padding: var(--space-3);
  background: #fdecea;
  border-radius: var(--radius-sm);
  margin-bottom: var(--space-4);
}

.tally-row {
  display: grid;
  grid-template-columns: 28px 1fr 130px 120px;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-border-soft);
  font-size: 14px;
}

.tally-row:last-child { border-bottom: none; }

.tally-row .num { color: var(--color-ink-faint); font-size: 13px; }

.tally-row .current {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--color-ink-muted);
  font-size: 13px;
}

.tally-row input {
  width: 100%;
  padding: var(--space-2);
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-sm);
  background: var(--color-white);
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 14px;
}

.tally-row input:disabled {
  background: var(--color-surface-alt);
  color: var(--color-ink-faint);
}

.tally-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-4);
}

.tally-actions button {
  background: var(--color-navy);
  color: var(--color-white);
  border-color: var(--color-navy);
  font-weight: 700;
  padding: var(--space-2) var(--space-5);
}

.tally-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

#toast {
  position: fixed;
  bottom: var(--space-5);
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-white);
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  padding: var(--space-3) var(--space-4);
  font-size: 13px;
  max-width: calc(100vw - var(--space-6));
}

#toast.error { border-color: var(--color-danger); color: var(--color-danger); }
#toast.success { border-color: var(--color-success); color: var(--color-success); }

@media (max-width: 480px) {
  .tally-row { grid-template-columns: 24px 1fr 90px 90px; font-size: 13px; }
}
```

- [ ] **Step 2: Create `admin/tally.html`**

```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Input Rekap TPS — Pilkades Live Count</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Crect width=%27100%27 height=%27100%27 rx=%2722%27 fill=%27%230d1b3e%27/%3E%3Ctext x=%2750%27 y=%2768%27 font-size=%2760%27 font-family=%27Arial%27 fill=%27%23ffffff%27 text-anchor=%27middle%27%3EP%3C/text%3E%3C/svg%3E" />
  <meta name="theme-color" content="#111111" />
  <link rel="preconnect" href="https://srlsyxlkcgscbngbrqzw.supabase.co" crossorigin />
  <link rel="dns-prefetch" href="https://srlsyxlkcgscbngbrqzw.supabase.co" />
  <link rel="manifest" href="../manifest.webmanifest" />
  <link rel="apple-touch-icon" href="../assets/images/apple-touch-icon.png" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="apple-mobile-web-app-title" content="Pilkades" />
  <meta name="mobile-web-app-capable" content="yes" />
  <link rel="stylesheet" href="../css/variables.css" />
  <link rel="stylesheet" href="../css/base.css" />
  <link rel="stylesheet" href="../css/nav.css" />
  <link rel="stylesheet" href="../css/tally.css" />
</head>
<body>
  <div class="page-header">
    <div class="topbar-left">
      <button class="hamburger-btn" id="hamburgerBtn" aria-label="Buka menu"><span></span><span></span><span></span></button>
      <span class="wordmark">Pilkades Live Count</span>
    </div>
  </div>

  <div class="page-body">
    <div class="page-header-row">
      <div>
        <div class="page-title">Input Rekap TPS</div>
        <div class="page-sub">Input hasil akhir per paslon untuk satu TPS sekaligus. Mengisi lagi akan menambah dari angka yang sudah tersimpan (boleh angka negatif untuk koreksi).</div>
      </div>
    </div>

    <div class="tally-layout">
      <div>
        <div class="tally-tps-grid" id="tallyTpsGrid"></div>
      </div>
      <div class="tally-panel" id="tallyPanel">
        <div class="tally-placeholder">Pilih TPS dulu.</div>
      </div>
    </div>
  </div>

  <div id="toast" class="hidden" role="status" aria-live="assertive"></div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
  <script src="../js/supabase.js"></script>
  <script src="../js/utils.js"></script>
  <script src="../js/nav.js"></script>
  <script src="../js/tally-input.js"></script>
  <script>
    initNav({ active: 'tally', hamburgerTarget: '#hamburgerBtn', links: [
        { key: 'dashboard', label: 'Dashboard (Publik)', href: '../index.html' },
        { key: 'input', label: 'Rapid Input', href: 'input.html' },
        { key: 'tally', label: 'Input Rekap TPS', href: 'tally.html' },
        { key: 'tps', label: 'TPS', href: 'tps.html' },
        { key: 'candidates', label: 'Kelola Paslon', href: 'candidates.html' },
        { key: 'logs', label: 'Log Aktivitas', href: 'logs.html' },
        { key: 'export', label: 'Export', href: 'export.html' },
        { key: 'snapshots', label: 'Snapshot', href: 'snapshots.html' },
        { key: 'settings', label: 'Pengaturan', href: 'settings.html' },
      ] });
  </script>
  <script src="../js/pwa.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create the minimal `js/tally-input.js` stub (auth guard only, for this task's testable deliverable)**

```js
// Input Rekap TPS: bulk/final-tally entry per TPS, additive across resubmits.
// Reads/writes vote_summary directly via submit_tps_tally — never touches
// vote_events (that table models discrete per-keypress votes; this doesn't).
(function () {
  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = '../login.html';
      return;
    }
  }

  init();
})();
```

- [ ] **Step 4: Add the nav icon**

In `js/nav.js`, inside `NAV_ICONS` (currently lines 6-16), add one entry after `input`:

```js
  input: '<path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h10v2H4v-2Z"/>',
  tally: '<path d="M4 4h9v2H4V4Zm0 14h6v2H4v-2Zm0-7h7v2H4v-2Zm11 1h2v3h3v2h-3v3h-2v-3h-3v-2h3v-3Z"/>',
```

- [ ] **Step 5: Insert the nav link into the 7 existing admin pages**

In each of these 7 files, insert the line `{ key: 'tally', label: 'Input Rekap TPS', href: 'tally.html' },` immediately after the `Rapid Input` line and before the `TPS` line:

`admin/input.html` (around line 92-93):
```js
        { key: 'input', label: 'Rapid Input', href: 'input.html' },
        { key: 'tally', label: 'Input Rekap TPS', href: 'tally.html' },
        { key: 'tps', label: 'TPS', href: 'tps.html' },
```

Apply the identical 3-line replacement (old: the `input`+`tps` lines back to back; new: `input`+`tally`+`tps`) to:
- `admin/tps.html` (line 85-86)
- `admin/candidates.html` (line 101-102)
- `admin/logs.html` (line 66-67)
- `admin/export.html` (line 71-72)
- `admin/snapshots.html` (line 64-65)
- `admin/settings.html` (line 68-69)

- [ ] **Step 6: Add the new files to the service worker's shell cache**

In `sw.js`, replace this line (currently line 26):
```js
  './admin/settings.html',
```
with:
```js
  './admin/settings.html',
  './admin/tally.html',
```

Replace this line (currently line 36):
```js
  './css/snapshots.css',
```
with:
```js
  './css/snapshots.css',
  './css/tally.css',
```

Replace this line (currently line 48):
```js
  './js/snapshots.js',
```
with:
```js
  './js/snapshots.js',
  './js/tally-input.js',
```

- [ ] **Step 7: Manually verify the skeleton**

Start the local dev server (or open the file directly) and navigate to `admin/tally.html` while logged in as admin:
- Page loads without console errors.
- Nav drawer shows "Input Rekap TPS" between "Rapid Input" and "TPS", active state highlighted.
- Right panel shows "Pilih TPS dulu." placeholder.
- Left grid area is empty (expected — Task 3 fills it).
- Logged out: navigating to `admin/tally.html` redirects to `../login.html`.

- [ ] **Step 8: Commit**

```bash
git add admin/tally.html css/tally.css js/tally-input.js js/nav.js sw.js \
  admin/input.html admin/tps.html admin/candidates.html admin/logs.html \
  admin/export.html admin/snapshots.html admin/settings.html
git commit -m "$(cat <<'EOF'
Scaffold Input Rekap TPS page, nav entry, and SW shell caching

Empty page + auth guard only; TPS grid and the delta form are wired
up in the next two commits.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: TPS number grid (left column)

**Files:**
- Modify: `js/tally-input.js` (replace the stub from Task 2 Step 3)

**Interfaces:**
- Consumes: `sb.rpc('get_tps_overview', { p_election_id })` (existing RPC, returns `[{ tps_id, tps_number, status, is_verified, dpt_limit, valid_votes, invalid_votes, total_votes }]`); `padTps()` from `js/utils.js`.
- Produces: module-level `state.overview` (array) and `state.selectedTpsId` (string|null), plus a `selectTps(tpsNumber)` function that Task 4 will extend to also load the right-column form. Renders into `#tallyTpsGrid` with class `tally-tps-btn`, `status-locked`, `is-selected` (matching the CSS from Task 2).

- [ ] **Step 1: Replace `js/tally-input.js` with the grid-rendering version**

```js
// Input Rekap TPS: bulk/final-tally entry per TPS, additive across resubmits.
// Reads/writes vote_summary directly via submit_tps_tally — never touches
// vote_events (that table models discrete per-keypress votes; this doesn't).
(function () {
  const state = {
    election: null,
    overview: [],
    candidates: [],
    selectedTpsId: null,
  };

  const el = {
    grid: document.getElementById('tallyTpsGrid'),
    panel: document.getElementById('tallyPanel'),
    toast: document.getElementById('toast'),
  };

  function showToast(message, type) {
    el.toast.textContent = message;
    el.toast.className = type || '';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.toast.className = 'hidden'; }, 3000);
  }

  function renderGrid() {
    el.grid.innerHTML = state.overview.map((r) => {
      const selected = r.tps_id === state.selectedTpsId ? ' is-selected' : '';
      return `<button type="button" class="tally-tps-btn status-${r.status}${selected}" data-tps-id="${r.tps_id}">${padTps(r.tps_number)}</button>`;
    }).join('');

    el.grid.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => selectTps(btn.dataset.tpsId));
    });
  }

  async function loadOverview() {
    const { data, error } = await sb.rpc('get_tps_overview', { p_election_id: state.election.id });
    if (error) {
      showToast('Gagal muat data TPS: ' + error.message, 'error');
      return;
    }
    state.overview = data || [];
    renderGrid();
  }

  function selectTps(tpsId) {
    state.selectedTpsId = tpsId;
    renderGrid();
    el.panel.innerHTML = '<div class="tally-placeholder">Memuat...</div>';
  }

  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = '../login.html';
      return;
    }

    const { data: election, error } = await sb
      .from('elections')
      .select('id')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !election) {
      showToast('Election aktif tidak ditemukan.', 'error');
      return;
    }
    state.election = election;

    await loadOverview();
  }

  init();
})();
```

- [ ] **Step 2: Manually verify**

Reload `admin/tally.html`:
- Grid on the left shows one box per TPS, numbers zero-padded (`01`, `02`, ...).
- A `locked` TPS (if any exist) shows the red-ish `status-locked` styling.
- Clicking a box highlights it green (`is-selected`) and the right panel shows "Memuat..." (expected — Task 4 replaces this with the real form).
- Clicking a different box moves the highlight and resets the right panel.

- [ ] **Step 3: Commit**

```bash
git add js/tally-input.js
git commit -m "$(cat <<'EOF'
Render TPS number grid on Input Rekap TPS page

Reuses get_tps_overview (already used by tps-manage.js and
live-tps.js) — no new backend read needed for this step.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Rekap form (right column) — render current totals

**Files:**
- Modify: `js/tally-input.js` (extend `selectTps`, add form rendering)

**Interfaces:**
- Consumes: `sb.from('candidates').select(...)` (already used by every other admin page for the same purpose); `sb.from('vote_summary').select('candidate_id, vote_count').eq('tps_id', ...)` (already used by `live-tps.js`); `statusLabelId()` from `js/utils.js`.
- Produces: `#tallyPanel` populated with one `.tally-row` per active candidate + one for "Tidak Sah", each with a `data-candidate-id` (or `data-candidate-id="invalid"`) input named for Task 5 to read. Module-level `state.currentSummary` (`{ candidateId|'invalid': count }`) for Task 5 to diff against.

- [ ] **Step 1: Load candidates once in `init()`**

In `js/tally-input.js`, add a `loadCandidates()` call inside `init()`, right after `state.election = election;`:

```js
    state.election = election;

    const { data: candidates, error: candError } = await sb
      .from('candidates')
      .select('id, candidate_number, name')
      .eq('election_id', election.id)
      .eq('is_active', true)
      .order('candidate_number');

    if (candError) {
      showToast('Gagal muat kandidat: ' + candError.message, 'error');
      return;
    }
    state.candidates = candidates || [];

    await loadOverview();
```

- [ ] **Step 2: Replace `selectTps` and add `renderForm`**

Replace the `selectTps` function with:

```js
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  async function selectTps(tpsId) {
    state.selectedTpsId = tpsId;
    renderGrid();

    const row = state.overview.find((r) => r.tps_id === tpsId);
    if (!row) return;

    el.panel.innerHTML = '<div class="tally-placeholder">Memuat...</div>';

    const { data: summaryRows, error } = await sb
      .from('vote_summary')
      .select('candidate_id, vote_count')
      .eq('tps_id', tpsId);

    if (error) {
      showToast('Gagal muat rekap TPS: ' + error.message, 'error');
      el.panel.innerHTML = '<div class="tally-placeholder">Gagal muat data.</div>';
      return;
    }

    const current = {};
    (summaryRows || []).forEach((r) => {
      current[r.candidate_id === null ? 'invalid' : r.candidate_id] = r.vote_count;
    });
    state.currentSummary = current;

    renderForm(row);
  }

  function renderForm(row) {
    const locked = row.status === 'locked';
    const lockedBanner = locked
      ? '<div class="tally-locked-banner">TPS ini terkunci — input ditolak. Buka kunci lewat halaman TPS.</div>'
      : '';

    const candidateRows = state.candidates.map((c) => `
      <div class="tally-row">
        <span class="num">${c.candidate_number}</span>
        <span>${escapeHtml(c.name)}</span>
        <span class="current">Saat ini: ${state.currentSummary[c.id] || 0}</span>
        <input type="number" inputmode="numeric" data-candidate-id="${c.id}" placeholder="Tambahkan" ${locked ? 'disabled' : ''} />
      </div>
    `).join('');

    const invalidRow = `
      <div class="tally-row">
        <span class="num"></span>
        <span>Tidak Sah</span>
        <span class="current">Saat ini: ${state.currentSummary.invalid || 0}</span>
        <input type="number" inputmode="numeric" data-candidate-id="invalid" placeholder="Tambahkan" ${locked ? 'disabled' : ''} />
      </div>
    `;

    el.panel.innerHTML = `
      <div class="tally-form-head">
        <span class="num">TPS ${padTps(row.tps_number)}</span>
        <span class="badge status-${row.status}">${statusLabelId(row.status)}</span>
      </div>
      ${lockedBanner}
      ${candidateRows}
      ${invalidRow}
      <div class="tally-actions">
        <button id="tallySubmitBtn" ${locked ? 'disabled' : ''}>Simpan</button>
      </div>
    `;
  }
```

- [ ] **Step 2: Manually verify**

Reload `admin/tally.html`, click a TPS box:
- Right panel shows `TPS {number}` + status badge, one row per active candidate with correct name and "Saat ini" count matching what `admin/tps.html` shows for the same TPS's `valid_votes` breakdown (cross-check via the public dashboard at `live/tps.html?n={number}` too).
- "Tidak Sah" row present with correct current count.
- Click a `locked` TPS: banner shown, all inputs and the Simpan button are disabled.
- Simpan button currently does nothing when clicked (expected — Task 5 wires it).

- [ ] **Step 3: Commit**

```bash
git add js/tally-input.js
git commit -m "$(cat <<'EOF'
Render per-candidate delta form for the selected TPS

Shows current vote_summary totals per candidate + Tidak Sah, disabled
when the TPS is locked. Submit button not wired yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Submit flow — confirm, RPC call, success/error, offline guard

**Files:**
- Modify: `js/tally-input.js` (add submit handling; delegate click on `#tallyPanel` since the button is re-rendered per TPS selection)

**Interfaces:**
- Consumes: RPC `submit_tps_tally` from Task 1 (`sb.rpc('submit_tps_tally', { p_tps_id, p_deltas })` → `{ tps_status, summary }`); `animateNumber()` from `js/utils.js` is **not** used here (the "Saat ini" values are plain text, not animated counters, per the design — this task just re-renders them via `renderForm`).
- Produces: nothing further downstream — this is the last task for this feature.

- [ ] **Step 1: Add delegated submit handling**

In `js/tally-input.js`, add this after `renderForm` and wire it once in `init()`:

```js
  function collectDeltas() {
    const inputs = el.panel.querySelectorAll('input[data-candidate-id]');
    const deltas = [];
    inputs.forEach((input) => {
      const raw = input.value.trim();
      if (!raw) return;
      const delta = Number(raw);
      if (!Number.isFinite(delta) || delta === 0) return;
      const candidateId = input.dataset.candidateId === 'invalid' ? null : input.dataset.candidateId;
      deltas.push({ candidate_id: candidateId, delta });
    });
    return deltas;
  }

  function describeDeltas(deltas) {
    return deltas.map((d) => {
      if (d.candidate_id === null) return `Tidak Sah ${d.delta > 0 ? '+' : ''}${d.delta}`;
      const c = state.candidates.find((x) => x.id === d.candidate_id);
      return `${c ? 'Paslon ' + c.candidate_number : '?'} ${d.delta > 0 ? '+' : ''}${d.delta}`;
    }).join(', ');
  }

  async function submitTally() {
    const deltas = collectDeltas();
    if (deltas.length === 0) {
      showToast('Isi minimal satu angka dulu.', 'error');
      return;
    }

    if (!navigator.onLine) {
      showToast('Tidak ada koneksi — coba lagi.', 'error');
      return;
    }

    const row = state.overview.find((r) => r.tps_id === state.selectedTpsId);
    if (!row) return;

    const confirmed = window.confirm(`TPS ${padTps(row.tps_number)} — ${describeDeltas(deltas)}. Lanjut?`);
    if (!confirmed) return;

    const btn = document.getElementById('tallySubmitBtn');
    if (btn) btn.disabled = true;

    const { data, error } = await sb.rpc('submit_tps_tally', {
      p_tps_id: state.selectedTpsId,
      p_deltas: deltas,
    });

    if (error) {
      showToast('Gagal simpan: ' + error.message, 'error');
      if (btn) btn.disabled = false;
      return;
    }

    const current = {};
    (data.summary || []).forEach((r) => {
      current[r.candidate_id === null ? 'invalid' : r.candidate_id] = r.vote_count;
    });
    state.currentSummary = current;

    row.status = data.tps_status;
    renderGrid();
    renderForm(row);
    showToast('Rekap tersimpan.', 'success');
  }

  el.panel.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'tallySubmitBtn') submitTally();
  });
```

Place the `el.panel.addEventListener(...)` call at the bottom of the file, outside any function, right before `init();` — it only needs to be registered once since `#tallyPanel` itself is never replaced, only its children.

- [ ] **Step 2: Manually verify — happy path**

Pick a non-locked TPS, enter `209` for one candidate, click Simpan, confirm the dialog:
- Toast "Rekap tersimpan." appears.
- "Saat ini" for that candidate now reads 209.
- The input field is empty again (re-rendered by `renderForm`).
- Reload the page, reselect the same TPS: "Saat ini" still shows 209 (confirms it persisted server-side, not just local state).

- [ ] **Step 3: Manually verify — additive resubmit**

Same TPS/candidate, enter `70`, submit:
- "Saat ini" becomes 279.

Enter `-30`, submit:
- "Saat ini" becomes 249.

- [ ] **Step 4: Manually verify — multi-candidate single submit**

Enter values for two different candidates + Tidak Sah in the same form, click Simpan once:
- Confirm dialog lists all three deltas.
- After confirming, all three "Saat ini" values update together.
- Check `admin/logs.html`, filter by "Rekap suara diinput/dikoreksi": exactly one new row for this submit, with all three deltas in its details (expand or export to confirm — the log row's compact view already shows this via `formatDetails`, though `vote_type`/`new_status` are the only keys currently mapped in `DETAIL_LABELS_ID`; the `deltas` key won't render human-readable in the compact list, which is acceptable — the full JSON is still exportable via `admin/export.html`'s "Log Aktivitas" CSV).

- [ ] **Step 5: Manually verify — locked TPS and offline**

- Select a `locked` TPS: confirm the Simpan button is disabled (already true from Task 4, re-confirm here since it gates this task's flow too).
- With devtools Network set to "Offline", try submitting on a non-locked TPS: toast "Tidak ada koneksi — coba lagi." appears, no request is sent (check the Network tab), nothing crashes.

- [ ] **Step 6: Manually verify — cross-check with public dashboards**

After a rekap submit, open `index.html` and `live/tps.html?n={number}` (either in another tab, already logged out is fine — they're public): confirm the new totals appear within ~1 second via their existing realtime subscriptions, with no code changes needed on those pages.

- [ ] **Step 7: Commit**

```bash
git add js/tally-input.js
git commit -m "$(cat <<'EOF'
Wire up Input Rekap TPS submit: confirm, RPC call, error/offline handling

Completes the feature: additive per-candidate tally entry per TPS,
gated by the same lock rule as Rapid Input, with no offline queue
(unlike Rapid Input's per-vote queue) since a bulk delta is a
deliberate one-shot correction, not a commutative +1.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
