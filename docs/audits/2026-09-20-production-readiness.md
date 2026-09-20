# Production Readiness Audit

Date: 2026-09-20
Trigger: user is about to start real live counting and asked for a final go/no-go check on browser performance, FE↔Supabase connection resilience, and anything else that could cause a mid-count outage.

## Verdict: GO, with fixes applied in this pass + two operational actions the user must do manually (not code, can't be automated)

## 1. Supabase project health

- Project `srlsyxlkcgscbngbrqzw` status: `ACTIVE_HEALTHY`, Postgres 17.6.1.
- **Organization plan: FREE tier.** This has two real operational implications, not code bugs:
  1. **Free-tier projects auto-pause after 7 days with no API activity.** If there's a gap of a week or more between now and the actual election day with nobody opening any page, the project will pause itself and need a manual "restore" click in the Supabase dashboard before voting starts — if that's discovered *during* the count, that's the outage this whole audit is trying to prevent. **Action for the user:** open any page of the app at least once every few days between now and election day, or upgrade to a paid plan beforehand so this can't happen.
  2. **Realtime has a concurrent-connection cap on the free tier (200 sockets) and a monthly message cap.** Every visitor to the public dashboard (`index.html`) or the per-TPS page (`live/tps.html`) opens one realtime websocket. For a village-scale audience this is very unlikely to be hit, but if the count draws a large simultaneous crowd watching the live dashboard, new connections beyond the cap would be refused. This is a plan limit, not something fixable in code — flagging so it's a known, not a surprise. Fixed in this pass: **even if a viewer's realtime connection fails or the cap is hit, their dashboard now self-heals instead of freezing** (see Section 3).

## 2. Security & performance advisories (Supabase's own linter, run this pass)

**Real, fixed in this pass:**
- 9 foreign keys had no covering index (`activity_logs.actor_id`/`election_id`, `snapshots.election_id`, `tps.verified_by`, `vote_events.cancelled_by`/`created_by`/`election_id`, `vote_summary.candidate_id`/`election_id`). At this app's realistic data volume (tens of thousands of rows at most) this was never going to cause a real slowdown, but the indexes are free to add and remove any doubt — added directly to the live project.
- `profiles_select_own`'s RLS policy called `auth.uid()` in a way Postgres re-evaluates per row instead of once per query. Rewritten to `(select auth.uid())` per Supabase's own recommended pattern. `profiles` has one row today, so this was invisible in practice — fixed anyway since it's a one-line, zero-risk change.

**Reviewed, confirmed intentional — no action taken:**
- 8 functions (`cast_vote`, `create_snapshot`, `is_admin`, `log_activity`, `set_tps_status`, `submit_tps_tally`, `undo_last_vote`, `verify_tps`) are flagged as "SECURITY DEFINER, callable by any authenticated/anon user." This is the generic linter pattern-matching the GRANT, not the function body — every one of these RPCs (except `is_admin`, which is a harmless boolean check) starts with `if not is_admin() then raise exception 'not authorized'; end if;`, confirmed present in every one of them during this and prior audit passes. A non-admin authenticated user calling any of these gets rejected inside the function; this was already the exact design this app relies on. `submit_tps_tally`'s `anon`/`PUBLIC` grant leak was already found and fixed in an earlier audit (2026-09-17) and re-confirmed still fixed in this pass.
- "Multiple permissive policies" on `elections` and `profiles` (two overlapping SELECT policies each). Both tables have 1 and ~1-few rows respectively — the per-query overhead of evaluating two trivial policies on a single-row table is not measurable. Not restructured; the risk of introducing a real RLS bug while "optimizing" a non-issue outweighs the near-zero benefit right before a live count.
- "Unused index" (6 indexes, all on `vote_events`/`activity_logs`). This is a stats artifact — the database was just reset to 0 rows in the prior audit pass (2026-09-19), so of course nothing shows usage yet. These are exactly the indexes earlier audits confirmed are correctly matched to the app's actual hot-path queries (e.g. `vote_events_tps_recent_idx` is an exact match for `undo_last_vote`'s query). Not touched.

**Real, cannot be fixed via this session's tools — user action needed:**
- **"Leaked Password Protection Disabled"** — Supabase Auth can reject passwords found in known breach databases (checked against HaveIBeenPwned), and it's currently off. This is an Auth *service* setting, not a database migration, and isn't exposed through any tool available in this session. **Action for the user:** Supabase Dashboard → Authentication → Policies (or Auth settings) → enable "Leaked password protection." Relevant mainly if new admin accounts get created with weak/reused passwords; the existing single admin account is unaffected by turning this on later.

## 3. Client-side resilience fixes (this pass)

**Realtime fallback refresh added to both public pages** (`js/live-dashboard.js`, `js/live-tps.js`): previously, `refresh()`/`loadDetail()` were ONLY ever triggered by a realtime `postgres_changes` event setting a `dirty` flag. If a viewer's realtime socket silently died — a dropped connection, a hit against the free-tier connection cap, a flaky network — that viewer's page would show a stale tally for the rest of the session with no recovery path. Both pages now also run an unconditional 30-second interval that force-refreshes regardless of the realtime state, so a viewer catches up within 30 seconds even in a total realtime outage. This directly targets "koneksi FE ke BE Supabasenya" from the request — it doesn't prevent a realtime hiccup, but it guarantees the page never gets permanently stuck because of one.

**Service worker shell cache completed:** `js/pwa.js` (the script that registers the service worker itself and handles the install prompt) was missing from `SHELL_ASSETS` since the file was first written — a pre-existing gap, not something introduced by recent features. On a fully offline load with a cleared browser HTTP cache, this file would fail to load, silently disabling re-registration/install-prompt logic for that load (the core counting functionality is unaffected either way, since every other shell asset was already correctly cached). Added it, and bumped `VERSION` to `'v3'` so the fix actually reaches already-installed devices (a version bump is required — see the 2026-09-20 `net-ping-indicator` audit finding for why the version constant matters here).

## 4. Re-confirmed from prior audits (no regression)

- Rapid Input's offline vote queue (persisted to `localStorage`, strict FIFO replay, optimistic UI) — architecture reviewed multiple times this project, no changes needed; this was always the primary defense against a flaky *admin* connection (as opposed to the *public viewer* connection issue fixed in Section 3).
- `submit_tps_tally`'s `PUBLIC`/`anon` grant fix (2026-09-17) — still `authenticated`-only.
- `log_activity`'s action/entity_type allowlist (2026-09-17) — still enforced.
- `profiles_admin_select_all` (2026-09-19) — still present, multi-admin activity log names still resolve correctly.
- Candidate-delete FK guard (2026-09-19) — still in place.
- Data is clean: `vote_events`/`vote_summary`/`activity_logs`/`snapshots` all still at 0 rows from the 2026-09-19 reset; `elections`/`candidates`/`tps` roster untouched.
- All hot-path indexes from the original schema (client_event_id uniqueness, the undo partial index, the vote_summary upsert targets) — present and correct, now joined by the 9 new FK-covering indexes from this pass.

## 5. Browser/device compatibility

- No build step, no transpilation — the app ships plain ES2020-era JavaScript (optional chaining `?.`, template literals, `async`/`await`) directly to the browser. This runs correctly on any browser from roughly the last 5 years (Chrome/Safari/Firefox/Edge released 2020 or later, which covers essentially every Android/iOS device still receiving updates). No polyfills, no build tooling to go wrong.
- Every page is already a installable PWA with an offline-capable shell (Section 3's cache-completeness fix aside), so a page that's been opened once continues to work even through a total connectivity loss for reading — writes queue and replay per the existing offline-vote-queue architecture.

## What remains as the user's own action items (not fixable from here)

1. **Keep the Supabase project active** (open any page at least once every few days, or upgrade off the free tier) so it doesn't auto-pause before election day.
2. **Enable leaked password protection** in the Supabase Auth dashboard — a few clicks, not a code change.
3. **One live browser smoke test before the real count**, if at all possible: open the public dashboard and both admin input pages on the actual devices that will be used, on the actual network conditions expected at the polling stations, and confirm the ping indicator (added 2026-09-20) reads a reasonable number. This is the one category of check that genuinely cannot be verified from this sandbox (no browser session with login available here) and that no amount of code review substitutes for.
