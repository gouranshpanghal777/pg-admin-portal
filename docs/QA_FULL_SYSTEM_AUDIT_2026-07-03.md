# PG95 Full-System QA Audit - 2026-07-03

## Safety Boundary

- QA branch: `PG 95` (`sec 95`)
- Protected branch: `PG 95 Farukhnagar` (`Haily Mandi Road, Farukhnagar`)
- Final protected totals: 53 active tenants, 17 rooms (unchanged)
- A branch guard rejects a mismatched branch ID, any Farukhnagar name/address, and any branch name other than exact `PG 95`.

## Live Test Data

- Added seven isolated QA rooms: `QA101` through `QA107`, three beds each.
- Admitted 20 realistic QA tenants with varied rent, security, joining days, overdue dates, upcoming dates, and month-end dates.
- Final QA lifecycle state: 20 active QA tenants and one vacated QA tenant retained in Left PG.

## Defects Found And Fixed

1. React state-updater callbacks performed Supabase side effects twice under Strict Mode. Persistence now runs outside state updaters and is serialized.
2. Admission succeeded in Supabase but then displayed an error because `event.currentTarget` was read after an awaited RPC. The form element is now captured before awaiting.
3. Split payments failed with PostgreSQL `22P02` because activity SQL parsed the rupee prefix as JSON. JSON extraction is parenthesized in migration `202607030004`.
4. Late rent was assigned to the receipt month instead of the earliest unpaid billing period. A database trigger now routes rent to the earliest unpaid obligation.
5. All future unpaid dates were labeled Upcoming. Upcoming is now limited to the three-day window; later dates display Clear.
6. Vacated-tenant collections disappeared from monthly totals when rent belonged to an earlier billing month. Collection totals now group by `payment_date`; rent settlement still uses billing month.
7. Finance month controls rendered `Invalid Date`. They now format the actual selected `YYYY-MM` period.
8. PWA metadata and production service-worker registration were missing. Both are now present without changing the UI.

## Live Workflow Results

- Partial split payment: ₹6,000 rent + ₹2,000 security created separate payment and cashbook rows; balances remained ₹500 each.
- Completion payment: ₹500 rent + ₹500 security cleared May rent/security and advanced the rent due date to June.
- Advance: ₹8,000 against ₹7,500 rent produced ₹500 advance and moved the next due date to August.
- Expense: ₹2,200 Grocery entry produced a linked cashbook debit.
- Inventory: five mattresses at ₹2,000 produced one purchase, ₹10,000 expense/debit, and stock quantity five.
- Maintenance: ticket created and resolved with ₹500 repair cost; status moved to Resolved and finance linkage was created.
- Room move: QA Arjun Mehta moved from QA103 to QA107 with activity detail.
- Vacate: QA Amit Sharma moved to Left PG, room capacity was released, security refund was debited, and payment history remained.
- Monthly collection after vacate: ₹17,000 total, ₹14,500 rent, ₹2,500 security.
- Mobile: 390x844 viewport had no page-level horizontal overflow and retained mobile navigation.
- Activity log: admission, split payment, move, vacate, expense, inventory, ticket creation, and resolution descriptions were human-readable.

## Remaining Recommendations

- Split `App.tsx` and lazy-load chart/report modules; the production bundle remains about 932 kB before gzip.
- Replace the current many-table full reload with branch-scoped queries and pagination before activity/payment history becomes large.
- Add PNG PWA icons (192 and 512 pixels) for the best install experience; the SVG icon is valid but less broadly optimized.
- Add a scheduled monthly obligation generator so future billing periods exist in the database before the first payment, not only in the UI calculation.
