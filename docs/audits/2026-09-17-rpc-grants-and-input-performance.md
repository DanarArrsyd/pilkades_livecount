# RPC Grant/Validation Audit + Input Performance Review

Date: 2026-09-17
Scope: all 12 `public` schema RPCs in the Supabase project `pilkades-livecount` (`srlsyxlkcgscbngbrqzw`), plus client-side performance of the two vote-entry flows (Rapid Input, Input Rekap TPS) under low vs. fast network conditions.

## Finding 1 (fixed) — `submit_tps_tally` was callable by unauthenticated clients

**Severity:** real gap, not just a defensive-coding nit — this is a privilege-grant inconsistency, not a matching bug to the RPC's own logic.

`information_schema.routine_privileges` showed `submit_tps_tally` granted `EXECUTE` to `PUBLIC` and `anon`, in addition to `authenticated`. Every other write RPC in this schema (`cast_vote`, `undo_last_vote`, `set_tps_status`, `create_snapshot`, `verify_tps`, `log_activity`) is granted only to `authenticated` (+ `postgres`/`service_role`). This meant `submit_tps_tally` could be invoked over PostgREST using nothing but the public anon key already embedded in every page's `js/supabase.js` — no session required.

The function's own `is_admin()` check would still reject the call (`auth.uid()` is `null` for an anon request, so `is_admin()` returns `false`), so no data could actually be written or read by an anonymous caller. The real cost was: (a) an unauthenticated request could still reach and execute inside Postgres before being rejected, unlike sibling RPCs which PostgREST/PostgREST-role-grants reject before invocation — a cheap, needless DoS/noise surface; (b) an inconsistency with the security model every other RPC in this schema follows.

**Root cause:** the migration that created `submit_tps_tally` didn't include an explicit `REVOKE EXECUTE ... FROM PUBLIC` (or an explicit `GRANT` scoped to `authenticated` only). Postgres grants `EXECUTE` on a newly created function to `PUBLIC` by default unless revoked — the earlier RPCs were evidently created with that default privilege already locked down (or revoked as part of initial schema setup), and this one wasn't.

**Fix applied:**
```sql
revoke execute on function public.submit_tps_tally(uuid, jsonb) from public, anon;
```
Applied directly to the project and verified via `information_schema.routine_privileges` — grants now match every sibling RPC exactly (`postgres`, `authenticated`, `service_role`).

## Finding 2 — no other RPC has the same class of gap as `submit_tps_tally`'s original code-review finding

The original concern (from the Input Rekap TPS feature's whole-branch review) was that `submit_tps_tally` casts its `p_deltas jsonb` array elements with no explicit shape/type validation beyond the cast itself, so malformed input surfaces as a raw Postgres error rather than a clean `raise exception`. Checked every other RPC for the same pattern:

- `cast_vote`, `undo_last_vote`, `verify_tps`, `create_snapshot`, `set_tps_status`, `log_activity` — all take scalar, strongly-typed parameters (`uuid`, `text`, `integer`). PostgREST rejects a malformed value (wrong type, unparseable UUID) with a clean 400 before the function body ever runs. None of these can hit the "raw Postgres error leaks to the client" failure mode `submit_tps_tally` can, because none of them accept a `jsonb` blob that gets destructured inside `plpgsql`.
- `set_tps_status` is a good example already in the codebase of input validation done right: `if p_new_status not in ('not_started','counting','paused','completed','locked') then raise exception 'invalid status'; end if;` — an explicit allowlist with a clean error message.
- `get_overall_summary`, `get_tps_overview`, `get_tps_snapshot` — read-only, granted to `anon` intentionally (they back the public dashboard, no auth required by design) — not a gap.
- `bump_vote_summary` — the one function with no `is_admin()` check at all, but it is granted only to `postgres`/`service_role` (confirmed via the same privilege query), so it is never reachable from a client request regardless. Not a gap.
- `is_admin` — a `STABLE SECURITY DEFINER` helper, granted to `anon`/`authenticated` by design (every RLS policy and RPC calls it to check the caller's own role) — appropriate.

**Not fixed, noted for awareness (low severity, no action taken):**
- `log_activity` accepts an arbitrary `p_action text` / `p_entity_type text` with no allowlist. Since the caller must already be `is_admin()`, this isn't a privilege-escalation issue — an admin can already do anything an admin can do — but it does mean an admin client could write a fabricated activity-log row (e.g. an `action` value that doesn't correspond to anything real) if there were ever a client-side bug, since several pages call this RPC directly with a literal action string (`tps_added`, `candidate_added`, `settings_changed`, `export_generated`, etc.) rather than going through a purpose-built RPC per action the way `cast_vote`/`set_tps_status` do. An allowlist here would be a reasonable follow-up if audit-log integrity ever becomes a concern beyond what it is today.
- `create_snapshot` doesn't verify `p_election_id` actually exists before building a snapshot — would produce a snapshot object with empty `tps`/`candidates` arrays for a bad ID rather than erroring. Harmless (only ever called by `set_tps_status`'s lock transition with a known-good ID, or an admin-typed election ID nobody currently has a UI path to mistype), not fixed.
- `verify_tps`'s `p_note` and `set_tps_status`'s `p_reason` have no length cap — a pathological client could store an arbitrarily long string. No practical exposure at this app's scale (village election, single admin console), not fixed.

## Finding 3 — database indexing is solid, not a bottleneck

Every hot-path query used by the two vote-entry flows has a matching index:
- `vote_events_client_event_id_key` (unique) — backs `cast_vote`'s idempotency lookup by `client_event_id`.
- `vote_events_tps_recent_idx` (partial, `tps_id, created_at desc where status='active'`) — an exact match for `undo_last_vote`'s `where tps_id = ... and status = 'active' order by created_at desc limit 1` query.
- `vote_summary_candidate_uq` / `vote_summary_invalid_uq` (partial uniques) — exact match for `bump_vote_summary`'s `on conflict` upsert targets, for both the per-candidate and the invalid-vote row.
- `tps_election_number_idx` — backs the `get_tps_overview`/`get_overall_summary` joins used by every dashboard and the TPS-picker grids.

No missing index, no sequential scan risk at this app's realistic data volume (tens of TPS, single-digit candidates per election). No changes made or needed here.

## Finding 4 — client-side performance under slow vs. fast networks

**Rapid Input** (`js/vote-input.js`): already well-optimized for this specifically — optimistic UI updates the visible tally instantly regardless of network speed, and the persisted offline queue means a slow or dropped connection never blocks input or loses a vote. The per-entry sync badge (added in a prior change) now also makes the pending/synced/rejected state visible per vote regardless of network speed.

One characteristic worth recording (not a bug, a known trade-off already documented in the code): `attemptFlush()` drains the offline queue strictly FIFO, one request at a time (`await`ed sequentially in a `while` loop), specifically to preserve vote order and audit timestamps. Under high latency (e.g. ~500ms RTT on a slow connection at a polling station), a backlog of many queued votes syncs at roughly one vote per RTT — a 100-vote backlog could take on the order of a minute to fully reach the server after reconnecting. This does not affect the operator's own screen (already showing correct optimistic totals throughout) or their ability to keep casting new votes (the queue keeps accepting input while draining in the background) — it only delays when *other* viewers (a second admin on the same TPS, the public dashboard) see the caught-up totals. Given the deliberate ordering requirement, this is accepted as-is, not changed.

**Input Rekap TPS** (`js/tally-input.js`): single request/response per submit, no queue — the Simpan button is correctly disabled for the duration of the round trip regardless of network speed, which is the intended behavior for a one-shot bulk correction (per the feature's own design spec) rather than something to further optimize.

**Asset loading:** the Supabase JS SDK and Chart.js are loaded from `cdn.jsdelivr.net` and are covered by the service worker's CDN-caching branch (`isCdn()` in `sw.js`) — cached on first use, served from cache on every subsequent load including fully offline. The only network-latency cost from these is a one-time hit on a device's very first visit before the service worker has installed; every session after that (which is the realistic operating pattern — the same device staying at the same TPS across a multi-hour count) pays nothing for them. No change made — this was already correctly handled.

**Conclusion:** no code changes were identified as necessary for input performance under low-bandwidth/high-latency conditions. The architecture (optimistic UI, offline queue, SW asset caching, DB indexing) already addresses the realistic failure modes for this app's actual operating environment.

## Summary of actions taken

| # | Finding | Action |
|---|---|---|
| 1 | `submit_tps_tally` grant included `PUBLIC`/`anon` | Fixed — revoked, now matches every sibling RPC |
| 2 | Other RPCs checked for the same input-shape gap | No other RPC has this gap; two low-severity, non-blocking observations noted (`log_activity` action allowlist, `create_snapshot` election-existence check) — not fixed |
| 3 | Database indexing for hot-path queries | Confirmed solid, no changes needed |
| 4 | Client performance under slow/fast networks | Confirmed already well-optimized for this app's realistic use, no changes needed |
