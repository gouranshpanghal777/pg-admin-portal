-- Backfill expense categories into linked cashbook debit entries
-- Ensures historical expense-linked debits appear under the correct category in Cashbook view
update public.cashbook_entries ce
set category = e.category
from public.expenses e
where ce.source = 'Expense'
  and ce.linked_id = e.id
  and e.category is not null
  and e.category != ''
  and (ce.category is null or ce.category = 'Uncategorized')
  and ce.category is distinct from e.category;
