alter table public.tenants
  add column if not exists rejoin_history jsonb not null default '[]'::jsonb;

comment on column public.tenants.rejoin_history is
  'Append-only stay history used when a vacated tenant rejoins without losing the original tenant ledger.';
