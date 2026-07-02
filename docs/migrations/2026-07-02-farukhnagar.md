# PG 95 Farukhnagar Data Migration

Production import completed on 2 July 2026 from the supplied current-tenant workbook and May 2026 Khatabook statement.

## Imported

- Branches: 1
- Rooms: 17
- Room capacity: 57
- Active tenants: 49
- Payments: 52
- Cashbook entries: 100, including the opening balance
- May cashbook credits: INR 339,850
- May cashbook debits: INR 169,241
- Closing cash balance: INR 193,202

## Validation

- Source cashbook totals reconcile exactly with the production entries.
- Room occupancy does not exceed the supplied room capacities.
- Payment and cashbook records use stable identifiers and duplicate checks.
- The imported branch remains separate from existing production branches.

## Manual Review

Twelve source records were retained in the private migration review for manual verification. These include conflicting room allocations, appendix tenants without a current-period mark, and cash receipts that could not be linked confidently to a current tenant. Uncertain receipts were preserved in the cashbook without inventing tenant relationships.
