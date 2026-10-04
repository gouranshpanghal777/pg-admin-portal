import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

export const ADMIN='00000000-0000-0000-0000-000000000001'
export const STAFF='00000000-0000-0000-0000-000000000002'
export const BRANCH='00000000-0000-0000-0000-000000000010'
export const ROOM='00000000-0000-0000-0000-000000000020'
export const TENANT='00000000-0000-0000-0000-000000000030'
export const MIGRATION='supabase/migrations/20261004144112_tenant_ledger_undo_redo.sql'
export async function ledgerDatabase() {
  const db=new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
    grant usage on schema auth to authenticated; grant execute on all functions in schema auth to authenticated;`)
  const files=[
    '202606270001_pg_admin_schema.sql','202606280001_split_payments.sql','202606280002_idempotent_tenant_payments.sql','202606280003_idempotent_admission_retry.sql',
    '202607020001_erp_finance_engine.sql','202607030001_erp_finance_engine_repair.sql','202607030002_recurring_rent_due_dates.sql',
    '202607030004_qa_payment_activity_fixes.sql','202607040001_prevent_future_rent_routing.sql','202607050003_tenant_rejoin_history.sql','202607070004_category_ledgers.sql',
    '202607130003_updated_at_triggers.sql','202607140002_fix_rent_summary_ledger_reconstruction.sql','202607140003_exclude_left_tenants_from_rent_summary.sql',
    '202607170002_accounts_ledgers.sql','202607170005_backfill_and_link_category_ledgers.sql','202607190001_simple_category_accounts.sql','202607190002_staff_readiness_hardening.sql',
  ]
  for (const file of files) {
    const sql=readFileSync(`supabase/migrations/${file}`,'utf8').replace(/create extension if not exists pgcrypto;/,'')
    try { await db.exec(sql) } catch(error) { throw new Error(`Fixture ${file}: ${String(error)}`) }
  }
  await db.exec("alter table payment_obligations add column source text;")
  await db.exec(readFileSync(MIGRATION,'utf8'))
  await db.exec(readFileSync('supabase/migrations/20261004152406_tenant_ledger_branch_delete_compatibility.sql','utf8'))
  await db.exec(`insert into auth.users(id) values('${ADMIN}'),('${STAFF}');
    update profiles set role='admin',name='Test Admin' where id='${ADMIN}';
    update profiles set name='Test Staff' where id='${STAFF}';
    insert into branches(id,name,address) values('${BRANCH}','TEST BRANCH','TEST ADDRESS');
    insert into rooms(id,branch_id,number,type,beds,rent) values('${ROOM}','${BRANCH}','101','Double',2,6300);
    insert into tenants(id,branch_id,name,phone,room_id,monthly_rent,security,joining_date,due_date)
      values('${TENANT}','${BRANCH}','TEST TENANT','TEST PHONE','${ROOM}',6300,2500,'2026-09-01','2026-09-01');
    grant select,insert,update,delete on all tables in schema public to authenticated;
    revoke insert,update,delete on payment_allocations from authenticated;
    grant usage on all sequences in schema public to authenticated;
    set role authenticated; select set_config('request.jwt.claim.sub','${ADMIN}',false);`)
  return db
}
export async function one<T=any>(db:PGlite,sql:string,params:any[]=[]):Promise<T> {
  return (await db.query<T>(sql,params)).rows[0]
}
