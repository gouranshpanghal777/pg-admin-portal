# Tenant ledger corrections — 4 October 2026

The owner requested tenant-specific Undo/Redo, revision of mistaken payment heads, automatic rent-period reconciliation and deployment after verification. This authorization supersedes the older checkpoint's release restrictions for this scoped change.

## Behavior

Admins can revise or remove a specific payment in Tenant Ledger → Payment History & Corrections. Undo last change / Redo restore the latest transaction for that tenant, including tenant details, rent obligations, explicit receipt allocations, security, advances and linked cashbook/category entries. A reason is required for receipt corrections; before/after totals and actor/time remain visible. New changes invalidate the redo branch. Multi-tenant room swaps and permanent deletion are deliberately excluded from single-tenant undo.

A mistaken ₹8,800 rent receipt initially covers ₹6,300 of September rent plus ₹2,500 of October. Revising it to ₹6,300 rent + ₹2,500 security preserves ₹8,800 cash, clears October's mistaken receipt allocation and updates the security balance. Agreed historical rates and billing dates are preserved. Partial and multi-month receipts use explicit allocations rather than frontend repair writes.

Existing data is not globally rebuilt. Legacy corrections preserve unexplained opening balances and require a linked, consistent cashbook receipt. Untraceable imported receipts, consumed legacy advance links and settled/refunded security are blocked for review. History begins with this release; older traceable receipts can be revised individually. Correction/replay actions require an active admin with branch access; receipt entry preserves staff payment permissions. Private snapshots cannot be read or changed directly by clients.

Requests have stable IDs and allowlisted, user/branch/tenant-scoped persisted pending state. An uncertain retry resends the same request. A confirmed save followed by refresh failure retries reconciliation only, including after remount. Direct editing of managed receipts or their linked cashbook is blocked so allocations cannot silently drift. Existing confirmed admin tenant/branch deletion remains supported.

## Verification before release

- 78 automated tests across 11 files, including 32 real Postgres-compatible transactional/RLS scenarios and four durable-request tests.
- Real React UI → HTTP RPC adapter → isolated database browser checks: correction, exact undo/redo, cashbook totals, failed refresh, remount, double retry, mobile width and no browser errors.
- Build and lint passed; six existing lint warnings and the existing large-bundle warning remain. Legacy self-test passed.
- Additive migration applied to live Supabase. Rollback-only synthetic RPC checks passed allocation, correction, duplicate request, undo and redo; no test rows retained.
- Production record counts and financial totals matched the read-only baseline after the migration and rollback-only probe. No existing financial rows were rewritten.
- Security advisor comparison added only INFO notices for private RLS tables with intentionally no direct client policies. No new security warnings. Those tables also have client privileges revoked.

## Operational notes

Keep the additive database schema if reverting the frontend: legacy v2 receipts still follow their existing trigger behavior, and new managed receipts retain integrity guards. Do not drop allocation/history tables to roll back the UI. The service-worker shell version is incremented; the existing explicit app-update behavior remains.
