# PG95 ERP Feature Implementation

Branch: `feature/erp-payment-ledger`

Production `main` and the live Supabase database were not modified.

## Completed

- Added independent rent, security, electricity, and other-charge obligations with agreed, received, advance-applied, pending, and status values.
- Added immutable payment history by payment head and a visible payment-history table.
- Added a security ledger for agreed, received, refunded, and deducted movements.
- Added advance credit, usage, refund, and remaining-balance accounting with automatic application to new rent obligations.
- Added idempotent ledger synchronization for every new payment and backfill logic for existing payments.
- Preserved historical payments, cashbook entries, and reports when a tenant vacates.
- Added an atomic vacate RPC that records security refunds/deductions and creates the refund cashbook debit.
- Added payment dashboard cards for all requested collection, pending, overdue, and advance values.
- Extended cashbook entries with category, payment mode, reference, and remarks while preserving raw descriptions.
- Added month selection and calculated opening, income, expense, movement, and closing balances in Finance.
- Expanded Dashboard with today/month collections, occupancy, vacant beds, pending rent/security, cash balance, expenses, maintenance, admissions, vacates, due rent, and recent activity.
- Humanized admission and payment activity descriptions using tenant, room, bed, payment heads, and pending rent.
- Re-enabled admin cashbook editing for imported and linked entries.
- Strengthened permanent tenant deletion to remove linked payments, invoices, ledgers, payment cashbook rows, and tenant-linked logs without orphans.
- Expanded global search across active/vacated tenants, phone, room, bed, branch, payments, cashbook, invoices, inventory, maintenance, and activity logs.
- Extended CSV reports with pending, advance, and cash balances; PDF uses the printable report layout.
- Added branch/month indexes and idempotent database triggers to reduce repeated scans and duplicate financial writes.
- Added QA assertions for independent heads, security semantics, advances, historical collections, and imported balances.

## Deployment Order

1. Review and apply `supabase/migrations/202607020001_erp_finance_engine.sql` in a staging Supabase project.
2. Run the application against staging and complete the admin/staff workflow checklist.
3. Deploy the feature branch to a Vercel preview.
4. Merge only after staging reconciliation of obligations, security, advances, and cashbook totals.

## Remaining Recommendations

- Schedule monthly rent-obligation creation using Supabase Cron before the first commercial billing cycle.
- Add server-generated XLSX and PDF files for branded, paginated reports; current exports are CSV and browser print-to-PDF.
- Paginate activity logs and large ledgers once branch volume exceeds several thousand rows.
- Split the monolithic `App.tsx` into route-level modules after this financial migration is proven in staging.
