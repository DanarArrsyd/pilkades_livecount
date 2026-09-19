# QA Audit + Production Data Reset

Date: 2026-09-19
Auditor role: Software Quality Assurance pass across data integrity, security (RLS/RPC), and performance, following up on the 2026-09-17 RPC audit.

## 1. Production data reset

Requested and confirmed scope: clear all test/dummy activity from the live Supabase project (`srlsyxlkcgscbngbrqzw`) ahead of the real count, while preserving configuration data.

**Cleared:**
| Table | Before | After |
|---|---|---|
| `vote_events` | 14 | 0 |
| `vote_summary` | 9 | 0 |
| `activity_logs` | 27 | 0 |
| `snapshots` | 0 | 0 |

**Reset (not cleared, state fields only):** all 41 `tps` rows had `status`, `is_verified`, `verification_note`, `verified_at`, `verified_by`, `locked_at` reset to their initial values (`not_started` / `false` / `null`). 3 rows had non-default state before this reset.

**Preserved, untouched:** `elections` (1 row), `candidates` (5 rows), `tps.tps_number`/`tps.name`/`tps.dpt_limit` (41 rows — the real TPS roster and DPT registrations), `profiles` (1 admin account).

Executed as plain `DELETE`/`UPDATE` statements (not `TRUNCATE` — table structure, sequences, and RLS policies are untouched either way, but `DELETE` was chosen so nothing about the schema itself needed re-verifying afterward). Database size before and after: 12 MB (unchanged at this scale — `DELETE` doesn't shrink on-disk size until autovacuum reclaims the space, which is automatic and not something this reset needed to force).

## 2. New findings from this pass

Two real, previously-unnoticed gaps were found and fixed. Both are the same class of issue as the 2026-09-17 audit's findings (a rule enforced in one place but missing in an equivalent place) — this pass specifically looked for that pattern elsewhere in the schema.

### 2.1 (Fixed, DB) `profiles` table had no admin-wide read policy

**Severity:** real functional bug, not a security hole — but it silently breaks a core feature the moment there's more than one admin account.

`pg_policies` showed exactly one `SELECT` policy on `profiles`: `profiles_select_own`, `USING (id = auth.uid())` — each user can only read their own row. Every page that displays *who did something* joins through this table: [js/export.js](../../../js/export.js) and [js/logs.js](../../../js/logs.js) both `select ... , profiles(full_name)` on `activity_logs`, and `admin/tps.html`'s verification mark relies on `tps.verified_by` resolving to a name. Under RLS, an embedded-resource join respects the joined table's own policies — so any admin viewing the activity log would see `null` in place of every OTHER admin's name, only their own actions would show a name. For a village election counting operation, running Rapid Input from multiple terminals with multiple admin accounts simultaneously is a realistic operating mode, not an edge case — this would have surfaced as soon as a second admin account was created.

**Fix applied directly to the live project:**
```sql
create policy "profiles_admin_select_all" on public.profiles for select using (is_admin());
```
Postgres combines multiple permissive `SELECT` policies with `OR`, so this is additive — `profiles_select_own` still applies for a non-admin caller (there are none in this schema today, but it's harmless to leave both), and any admin can now additionally see every profile. Verified via `pg_policies` that both policies now coexist correctly.

### 2.2 (Fixed, client) Deleting a candidate with existing votes threw a raw Postgres error

**Severity:** real UX/data-integrity gap — same class as the 2026-09-17 finding about `submit_tps_tally`'s unvalidated input, but on the delete path instead of the write path.

`vote_events.candidate_id` and `vote_summary.candidate_id` both reference `candidates.id` with `ON DELETE NO ACTION` (the default — confirmed via `information_schema.referential_constraints`). [js/tps-manage.js](../../../js/tps-manage.js)'s `deleteTps()` already guards this correctly for TPS (`if (row.total_votes > 0) { showToast('TPS dengan suara masuk tidak bisa dihapus.', 'error'); return; }` before ever attempting the delete) — but [js/candidates.js](../../../js/candidates.js)'s `deleteCandidate()` had no equivalent check, so attempting to delete a candidate that already has recorded votes would hit the database's foreign key constraint and surface Postgres's raw error text directly in the toast (confirmed by reproducing it directly against the live project: `update or delete on table "candidates" violates foreign key constraint "vote_summary_candidate_id_fkey" ... DETAIL: Key (id)=(...) is still referenced from table "vote_summary".` — test row created and removed immediately after confirming, no lasting change).

**Fix:** `deleteCandidate()` now queries `vote_summary` for that candidate first; if any votes exist, it shows `` `Paslon dengan suara masuk tidak bisa dihapus (${voteCount} suara).` `` and stops before the confirm dialog even appears — matching the TPS page's existing pattern exactly.

## 3. Re-confirmed from the 2026-09-17 audit (still holding, no regression)

- `submit_tps_tally`'s `EXECUTE` grant is still `authenticated`-only (not `PUBLIC`/`anon`) — unaffected by any of the 9 PRs merged since.
- `log_activity`'s action/entity_type allowlist is intact and still rejects out-of-list values.
- All hot-path indexes (`vote_events_client_event_id_key`, `vote_events_tps_recent_idx`, `vote_summary_candidate_uq`/`vote_summary_invalid_uq`, `tps_election_number_idx`) are unchanged and still exactly matched to their queries.

## 4. Performance re-check after 9 merged features

Re-examined with the full current feature set in place (Rapid Input sync badges, Input Rekap TPS, DPT turnout stats, photo cleanup, RLS/RPC hardening):

- **Scale headroom confirmed adequate for the stated real-world volume.** At 12 MB for the current dataset, and with `vote_events` no longer needed at all for the bulk-tally input path, even a worst-case 42 TPS × 800 votes (~33,600 rows if entered entirely through Rapid Input) stays in the tens-of-megabytes range — nowhere near Supabase's free-tier 500 MB database limit, and the existing indexes keep every query on this data O(log n) or better regardless.
- **No new client-side hot-path cost was introduced by any of the 9 merged features.** The Rapid Input sync badge (PR #3) is a single `innerHTML` string swap on an already-existing element; the DPT turnout stats (PR #9) are one `filter`+`reduce` pass over data the dashboard already fetches every refresh cycle. Neither adds a network round trip.
- **RLS policy surface is now fully audited, table by table** (Section 2 was the gap this pass closed): every table's SELECT/INSERT/UPDATE/DELETE policy set was enumerated and cross-checked against which pages/RPCs actually need to touch it. No other table shows the same "policy exists for one path but not an equivalent one" pattern that `profiles` had.
- **Dashboard header layout** (flagged as an unverified Minor in the 2026-09-17 `tps-dpt-turnout` review) was reassessed statically against `css/live.css`: `.report-header` has `flex-wrap: wrap` as a safety net, and `.stat-list`'s rows are independent grids (`grid-template-columns: auto 10px auto` per line, not a shared table), so a longer value on one line (e.g. `30.500 (38/40 TPS)`) cannot force a shared column width onto the other lines or cause horizontal overflow — worst case is the header block wrapping as a whole beneath the logo at narrow desktop widths, which is the intended fallback. Downgraded from "needs a browser check" to "verified safe by inspection" — a live visual check is still worthwhile before the real count, but not because the CSS shows a structural risk.

## Summary of actions taken this pass

| # | Item | Action |
|---|---|---|
| 1 | Test/dummy data in `vote_events`, `vote_summary`, `activity_logs`, `snapshots` | Cleared; `tps` state fields reset; `elections`/`candidates`/`tps` roster/`profiles` preserved |
| 2 | `profiles` table had no admin-wide SELECT policy | Fixed — added `profiles_admin_select_all` policy on the live project |
| 3 | Deleting a voted-on candidate threw a raw FK error | Fixed — `js/candidates.js` now checks and blocks with a clean message, matching `js/tps-manage.js`'s existing pattern |
| 4 | Prior audit's fixes (`submit_tps_tally` grant, `log_activity` allowlist) | Re-confirmed intact, no regression |
| 5 | Performance at stated real-world scale (42 TPS × 350-800 votes) | Re-confirmed comfortably within headroom, no changes needed |
| 6 | Dashboard header layout risk (previously an open Minor) | Reassessed via CSS inspection — safe by construction, downgraded from open concern |
