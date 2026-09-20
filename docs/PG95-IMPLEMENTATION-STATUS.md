# PG95 reliability implementation — 20 September 2026

Working branch: `agent/pg95-core-reliability-v2`, based on production `c1d31112856fe690c9be8311666868ddd11258c1`.

## Safety and baseline

### Subsequent owner authorization: narrowly scoped production QA

The owner subsequently authorized sample-data testing in the existing branch named only PG 95, not the similarly named operating branches. Read-only verification resolved this to `d1512e15-8151-41b3-b77e-64ff88878add`, stored name `pg 95 ` (case and trailing whitespace only). Baseline at authorization: 9 rooms, 31 tenants, 17 payments, 34 Cashbook entries. None of those pre-existing rows are assumed disposable.

This overrides the earlier blanket no-production-test-writes rule only for newly created, explicitly tracked sample records in that branch. Use `PG95-QA-20260920-` labels and record returned IDs; no real contact details, notifications or actual transfers. Do not change/delete pre-existing records or touch other branches. Shared schema/RLS/Auth/config changes, production deployment and migration application remain unauthorized. QA helpers validate both branch ID and normalized exact name plus created-record membership; they are not a substitute for server permissions and must be explicitly invoked by any test harness.

Do not sign in through the old production frontend for QA: its automatic login-time cleanup may delete activity history outside this scope. Use the cleanup-removed working preview. No sample writes have been made yet.

Production project mapping was reverified through GitHub, Vercel and Supabase. Production is read-only for this task. No production migrations, Auth/config changes, record corrections or deployment are authorized.

- `npm ci --no-audit --no-fund`: passed.
- `npm run build`: passed (existing large-bundle warning).
- `npm run self-test`: passed; this is a legacy simulation suite, not proof of actual RPC behaviour.
- `npm run lint`: passed with six existing warnings.
- No separate Supabase staging branch is available. Local isolated database tests do not replace Supabase staging/Auth/RLS/browser verification.

Read-only baseline: 228 tenants, 57 rooms, 511 payments, 728 Cashbook entries, 947 payment obligations, 244 general ledger entries. No orphan tenant-room/payment-tenant references. One pre-existing duplicate active room/bed group needs an owner-approved correction; it must not be automatically cleaned or hidden.

Financial fingerprints (ordered full-row MD5, for change detection, not cryptographic integrity):

- payments: `03a8647610540f8eb7d68a7561696b25`
- Cashbook: `55e44c8d2894700b7b30f1409268145e`

Concurrent legitimate use can change these fingerprints. Any difference must be explained, never automatically rolled back.

## Business decisions still required

- When should separately fixed electricity start recurring, and is it prorated? Existing historical electricity must not be manufactured.
- What is the charging rule for a 15-day introductory stay or an AC-to-non-AC mid-cycle room move?
- Exit currently contains a fixed ₹500/day rule. Do not substitute a new proration policy without owner confirmation.
- Historical missing-obligation reconstruction and effective-dated terms require a reviewed migration; changing a current rent must not silently reprice missing old months.

## Release gate

No production release until isolated mutation tests, permissions, backups/restore readiness, preview environment isolation and owner review are complete. A passing build alone is insufficient.

## Working checkpoint (not release-ready)

- Canonical account calculation and read-only rent snapshots added; consumer reconciliation, invoice integration and day-rollover handling remain incomplete.
- Tenant edit uses the selected period's balance rather than cumulative arrears, avoiding a regression where the total would be written into one obligation. Full profile/financial-edit separation remains pending.
- Paginated table reads and append-only treatment of the limited activity-log UI window added.
- Salary/category transaction now has a synchronous submit guard and a stable request ID. A confirmed write followed by failed refresh retries reconciliation only. Unresolved attempts reject changed payloads. This protection is currently in-memory, not remount-persistent; durable drafts remain pending.
- Session refresh no longer triggers the initial account-loading effect; cancelled loads cannot populate another session. Removed automatic login-time activity-log cleanup.
- React checklist applied to touched components: primitive effect dependency, cleanup guard, and synchronous submission guard.
- Unit tests exercise application domain helpers and submission coordination, not real Supabase transactions. No claim of RPC atomicity, RLS, browser/PWA or preview verification is made.
- Existing service-worker forced reload, other save workflows, atomic compound admission/vacate/rejoin, drafts and Staff Salary navigation remain pending. Do not deploy this checkpoint as a completed fix.

Checkpoint verification: `npm test` passed 25 tests across 3 files; `npm run build` passed with the existing large-bundle warning; `npm run lint` passed with the same 6 baseline warnings; `npm run self-test` passed its legacy simulations; `git diff --check` passed. No staging mutations, browser tests, preview deployment or production changes were performed in this checkpoint.

## References checked

## Second implementation pass

Implemented and locally verified:

- Service worker waits for an explicit update message. The update notice blocks activation while any form/dialog is open; controller changes never reload without approval. Cache cleanup is limited to PG95 shell caches. Actual worker install/message/activate/fetch handlers are covered by VM tests; this is not installed-device evidence.
- Payment drafts use versioned user/branch/entity keys, a 24-hour TTL, an allowlist, and the same request ID on reopen. Edits persist immediately and on background/pagehide. Unresolved submissions freeze values; close keeps the draft, discard is explicit, and success clears it. Credentials and identity fields are not included. Other forms still need draft integration and automatic form reopening is not implemented.
- Dashboard displayed pending totals now sum the same canonical tenant accounts. The separate server summary is retained as a mismatch diagnostic. Monthly collection uses payment date rather than allocated rent month.
- Bill Creator now prints a clearly labelled current-dues statement from the canonical account, without reusing stale historical invoice dates/numbers or subtracting payments twice. Stored historical invoices are unchanged.
- Staff Salary is discoverable through navigation and a Finance tab; existing staff ledger components and transaction permissions are reused.
- Ordinary tenant editing preserves room, joining date, rent and recurring due anchor. Period-balance correction requires explicit opt-in and before/after confirmation. Unsafe bulk repricing is removed. Monthly-rent editing is temporarily read-only until future-effective backend support is implemented; this is a release limitation, not completion of rent-term editing.

Verification: 36 tests across 7 files passed; production build passed; lint retains the 6 baseline warnings; legacy self-test and diff whitespace checks passed. A subsequent day-rollover guard reloads the app only after the Asia/Kolkata business date changes and no form/dialog is open; its GitHub Quality Gate (self-test, build, lint) passed. React guidance informed primitive dependencies, explicit cleanup and synchronous submit guards.

Still release-blocking: atomic admission+payment/rejoin/settlement, server-safe multi-period allocation replacing the legacy frontend repair, durable drafts beyond payment, ambiguous-failure classification/unlocking, future-effective rent terms, authenticated browser/role tests, and physical-device PWA verification.

Prepared but deliberately not applied: `supabase/migrations/202609210001_atomic_rejoin_payment.sql` introduces an idempotent request record and a single transactional RPC for rejoin + optional first rent payment, including permission checks and changed-payload rejection. The frontend still uses the existing production RPC until this migration is reviewed, applied, and verified; therefore this blocker is not marked complete. No new migration has been applied. Do not merge this branch as a completed implementation.

First preview verified READY for commit `9b18b7b0bb404daf87222f0d2e76a01c3e083281` at `pg-admin-portal-hqy3mj1sf-gouransh-team.vercel.app`; this predates the second pass and is not evidence of the latest UI.

- [Supabase changelog](https://supabase.com/changelog) (Markdown endpoint unavailable; HTML index checked).
- [RPC client API](https://supabase.com/docs/reference/javascript/rpc).
- [Request-specific cancellation](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal).
