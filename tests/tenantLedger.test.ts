import { beforeAll,beforeEach,afterAll,describe,it,expect } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { ledgerDatabase,one,ADMIN,STAFF,BRANCH,TENANT,ROOM } from './helpers/ledgerDatabase'
let db:PGlite
const receipt=(rent=8800,security=0,request=randomUUID(),tenant=TENANT,period='2026-09',electricity=0,other=0)=>one(db,`select record_split_payment_v3($1,$2,$3,$4,$5,$6,$7,'2026-09-01',$8,'Cash','Test receipt') result`,[request,tenant,BRANCH,rent,security,electricity,other,period])
const history=async(tenant=TENANT)=> (await one(db,'select get_tenant_ledger_history($1) result',[tenant])).result
const replay=async(direction:string,h:any,request=randomUUID(),tenant=TENANT)=>one(db,'select replay_tenant_ledger_change($1,$2,$3,$4,$5) result',[request,tenant,direction==='undo'?h.undo_id:h.redo_id,direction,h.token])
const balances=async(tenant=TENANT)=>(await db.query(`select period,received_amount::float received,advance_applied::float advance from payment_obligations where tenant_id=$1 and payment_type='rent' order by period`,[tenant])).rows
const totals=async()=>one(db,`select (select count(*)::int from payments) payments,(select coalesce(sum(amount),0)::float from payments) paid,(select coalesce(sum(amount),0)::float from cashbook_entries) cash,(select security_received::float from tenants where id='${TENANT}') security`)
const correct=async(payment:string,rent=6300,security=2500,request=randomUUID(),action='revise',token?:string)=>{
  const h=await history();return one(db,'select correct_tenant_payment($1,$2,$3,$4,$5,$6::jsonb,$7) result',[request,TENANT,BRANCH,payment,action,JSON.stringify({rent,security,electricity:0,other:0,date:'2026-09-01',period:'2026-09',mode:'Cash',description:'Security was entered under rent'}),token||h.token])
}
const paymentId=async(head='rent')=>(await one(db,'select id from payments where tenant_id=$1 and payment_type=$2 order by created_at,id limit 1',[TENANT,head])).id
async function owner(sql:string){await db.exec('reset role');try{await db.exec(sql)}finally{await db.exec('set role authenticated')}}
async function setupTenant(tenant:string,bed=2){await owner(`insert into tenants(id,branch_id,name,phone,room_id,bed_no,monthly_rent,security,joining_date,due_date) values('${tenant}','${BRANCH}','OTHER TENANT','TEST','${ROOM}',${bed},6300,2500,'2026-09-01','2026-09-01')`)}

describe('transactional tenant ledger',()=>{
  it('preserves confirmed admin branch deletion and denies staff',async()=>{
    await receipt(6300,2500)
    await db.exec(`select set_config('request.jwt.claim.sub','${STAFF}',false)`)
    await expect(one(db,'select delete_branch_cascade($1,null,null,null,null)',[BRANCH])).rejects.toThrow('active admin')
    await db.exec(`select set_config('request.jwt.claim.sub','${ADMIN}',false)`)
    await one(db,'select delete_branch_cascade($1,null,null,null,null)',[BRANCH])
    expect((await one(db,'select count(*)::int n from tenants')).n).toBe(0)
    expect((await one(db,'select count(*)::int n from payments')).n).toBe(0)
  })
  it('allows the existing admin permanent-deletion workflow for managed receipts',async()=>{
    await receipt(6300,2500)
    await one(db,'select delete_tenant_with_payments($1) result',[TENANT])
    expect((await one(db,'select count(*)::int n from payments')).n).toBe(0)
    expect((await one(db,'select count(*)::int n from cashbook_entries')).n).toBe(0)
    expect((await one(db,'select count(*)::int n from tenants')).n).toBe(0)
    await owner("do $$ begin if exists(select 1 from pg95_private.tenant_changes) or exists(select 1 from pg95_private.ledger_context) then raise exception 'Deletion leaked history/context'; end if; end $$")
  })
  beforeAll(async()=>{db=await ledgerDatabase()},60000)
  beforeEach(async()=>{
    await db.exec(`reset role;select set_config('request.jwt.claim.sub','',false);truncate branches cascade;truncate pg95_private.ledger_context,pg95_private.tenant_changes,pg95_private.ledger_requests restart identity;
      insert into branches(id,name,address) values('${BRANCH}','TEST BRANCH','TEST');
      insert into rooms(id,branch_id,number,type,beds,rent) values('${ROOM}','${BRANCH}','101','Double',2,6300);
      insert into tenants(id,branch_id,name,phone,room_id,monthly_rent,security,joining_date,due_date) values('${TENANT}','${BRANCH}','TEST TENANT','TEST','${ROOM}',6300,2500,'2026-09-01','2026-09-01');
      set role authenticated;select set_config('request.jwt.claim.sub','${ADMIN}',false);`)
  })
  afterAll(async()=>{await db?.close()})
  it('allocates ₹8800 as ₹6300 September and ₹2500 October, without an extra advance',async()=>{
    await receipt();expect(await balances()).toEqual([{period:'2026-09',received:6300,advance:0},{period:'2026-10',received:2500,advance:0}])
    expect((await one(db,'select count(*)::int n from tenant_advances')).n).toBe(0)
    const h=await history();expect(h.changes).toHaveLength(1);expect(h.changes[0].can_undo).toBe(true)
  })
  it('undo restores the exact opening ledger; redo restores the exact receipt, IDs and cashbook once',async()=>{
    const original=await history();await receipt();const paid=await history();await replay('undo',paid)
    expect((await history()).token).toBe(original.token);expect((await totals()).cash).toBe(0)
    await replay('redo',await history());expect((await history()).token).toBe(paid.token);expect((await totals()).cash).toBe(8800)
  })
  it('corrects ₹8800 rent to ₹6300 rent + ₹2500 security and reopens the next rent month',async()=>{
    await receipt();await correct(await paymentId())
    expect(await totals()).toEqual({payments:2,paid:8800,cash:8800,security:2500})
    expect(await balances()).toEqual([{period:'2026-09',received:6300,advance:0},{period:'2026-10',received:0,advance:0}])
  })
  it('undo and redo of the correction restore both heads and allocation exactly',async()=>{
    await receipt();const wrong=await history();await correct(await paymentId());const revised=await history()
    await replay('undo',revised);expect((await history()).token).toBe(wrong.token)
    await replay('redo',await history());expect((await history()).token).toBe(revised.token)
  })
  it('supports a partial receipt, top-up and undo of only the top-up',async()=>{
    await receipt(1000);const partial=await history();await receipt(5300);await replay('undo',await history())
    expect((await history()).token).toBe(partial.token);expect((await balances())[0].received).toBe(1000)
  })
  it('keeps later receipts while revising an older specific entry',async()=>{
    await receipt();const first=await paymentId();await receipt(3800,0,randomUUID(),TENANT,'2026-10')
    const later=(await db.query('select id from payments where id<>$1',[first])).rows[0].id
    await correct(first)
    expect((await db.query('select id from payments where id=$1',[later])).rows).toHaveLength(1)
    expect(await balances()).toEqual([{period:'2026-09',received:6300,advance:0},{period:'2026-10',received:3800,advance:0}])
    expect((await totals()).cash).toBe(12600)
  })
  it('undo entry removes only the selected rent row, retaining its security sibling',async()=>{
    await receipt(6300,2500);await correct(await paymentId(),0,0,randomUUID(),'remove')
    expect(await totals()).toEqual({payments:1,paid:2500,cash:2500,security:2500})
    expect((await balances())[0].received).toBe(0)
    await replay('undo',await history());expect((await totals()).cash).toBe(8800)
  })
  it('undo security restores outstanding security without altering rent',async()=>{
    await receipt(6300,2500);await correct(await paymentId('security'),0,0,randomUUID(),'remove')
    expect((await totals()).security).toBe(0);expect((await balances())[0].received).toBe(6300)
  })
  it('handles electricity and other corrections independently',async()=>{
    await receipt(0,0,randomUUID(),TENANT,'2026-09',350,200)
    const electricity=await paymentId('electricity');await correct(electricity,0,0,randomUUID(),'remove')
    expect(await totals()).toEqual({payments:1,paid:200,cash:200,security:0})
  })
  it('replays repeated receipt requests without creating duplicate payments',async()=>{
    const request=randomUUID();await receipt(8800,0,request);await receipt(8800,0,request)
    expect((await totals()).payments).toBe(1);expect((await history()).changes).toHaveLength(1)
    await expect(receipt(6300,0,request)).rejects.toThrow('different values')
  })
  it('replays repeated undo requests once, including the original stale token',async()=>{
    await receipt();const h=await history(),request=randomUUID();await replay('undo',h,request);await replay('undo',h,request)
    expect((await totals()).cash).toBe(0);expect((await history()).changes).toHaveLength(1)
  })
  it('replays a repeated revision without duplicating either split head',async()=>{
    await receipt();const id=await paymentId(),h=await history(),request=randomUUID();await correct(id,6300,2500,request,'revise',h.token);await correct(id,6300,2500,request,'revise',h.token)
    expect((await totals()).payments).toBe(2);expect((await history()).changes).toHaveLength(2)
  })
  it('rejects stale history after another admin changes the same tenant',async()=>{
    await receipt();const h=await history();await db.exec(`update tenants set phone='CHANGED' where id='${TENANT}'`)
    const token=(await history()).token;await expect(replay('undo',h)).rejects.toThrow('ledger changed');expect((await history()).token).toBe(token)
  })
  it('supports multiple sequential undo/redo, and discards redo after a new branch',async()=>{
    await receipt(1000);await receipt(2000);await replay('undo',await history());await replay('undo',await history())
    expect((await totals()).cash).toBe(0);await replay('redo',await history());expect((await totals()).cash).toBe(1000)
    await receipt(1500);const h=await history();expect(h.redo_id).toBe(null);expect(h.changes.filter((c:any)=>c.state==='superseded')).toHaveLength(1)
  })
  it('captures and reverses profile and rent-balance edits within the same tenant',async()=>{
    const original=await history();await db.exec(`begin;update tenants set phone='NEW PHONE',name='RENAMED' where id='${TENANT}';update payment_obligations set agreed_amount=6200 where tenant_id='${TENANT}' and payment_type='rent';commit;`)
    expect((await history()).changes).toHaveLength(1);await replay('undo',await history());expect((await history()).token).toBe(original.token)
  })
  it('does not undo unrelated tenant entries',async()=>{
    const other=randomUUID();await setupTenant(other);await receipt(8800);await receipt(1000,0,randomUUID(),other);const h=await history(other)
    await replay('undo',await history());expect((await history(other)).token).toBe(h.token)
    expect((await one(db,'select sum(amount)::float total from payments where tenant_id=$1',[other])).total).toBe(1000)
  })
  it('validates security before committing any part of a correction',async()=>{
    await receipt();const h=await history();await expect(correct(await paymentId(),6300,3000)).rejects.toThrow('exceeds remaining balance')
    expect((await history()).token).toBe(h.token);expect((await totals()).cash).toBe(8800)
  })
  it('rejects negative amounts and excess precision without a partial receipt',async()=>{
    await expect(receipt(-1)).rejects.toThrow('non-negative');await expect(receipt(0.001)).rejects.toThrow('two decimals');expect((await totals()).cash).toBe(0)
  })
  it('preserves zero-rent months and historical agreed rates during allocation',async()=>{
    await owner(`update payment_obligations set agreed_amount=6000 where tenant_id='${TENANT}' and payment_type='rent';insert into payment_obligations(branch_id,tenant_id,period,payment_type,agreed_amount,due_date) values('${BRANCH}','${TENANT}','2026-10','rent',0,'2026-10-01');`)
    await receipt(7000);expect(await balances()).toEqual([{period:'2026-09',received:6000,advance:0},{period:'2026-10',received:0,advance:0},{period:'2026-11',received:1000,advance:0}])
  })
  it('clips month-end billing to February and preserves the recurring anchor on undo',async()=>{
    await db.exec(`update tenants set due_date='2026-09-30' where id='${TENANT}'`)
    const before=await history();await receipt(6300,0,randomUUID(),TENANT,'2027-02')
    expect((await one(db,"select due_date::text d from payment_obligations where period='2027-02'")).d).toBe('2027-02-28')
    await replay('undo',await history());expect((await history()).token).toBe(before.token)
  })
  it('does not double-count allocated receipts in backend dues',async()=>{
    await receipt(8800);const rows=(await one(db,"select get_branch_rent_breakdown($1,'2026-10-01') result",[BRANCH])).result
    expect(rows).toHaveLength(1);expect(rows[0].period).toBe('2026-10');expect(rows[0].outstanding).toBe(3800)
  })
  it('allows first-time security with zero agreed security and undo restores zero terms',async()=>{
    await db.exec(`update tenants set security=0 where id='${TENANT}';update payment_obligations set agreed_amount=0 where tenant_id='${TENANT}' and payment_type='security';`)
    const h=await history();await receipt(0,2500);expect((await totals()).security).toBe(2500)
    await replay('undo',await history());expect((await history()).token).toBe(h.token)
  })
  it('traces a legacy spillover receipt without changing the imported opening balance',async()=>{
    const id=randomUUID();await owner(`select set_config('request.jwt.claim.sub','',false);
      insert into payments(id,branch_id,tenant_id,amount,payment_date,month,status,payment_type,created_by) values('${id}','${BRANCH}','${TENANT}',8800,'2026-09-01','2026-09','Received','rent','${ADMIN}');
      delete from tenant_advances;update payment_obligations set agreed_amount=6300,received_amount=6300 where tenant_id='${TENANT}' and payment_type='rent';
      insert into payment_obligations(branch_id,tenant_id,period,payment_type,agreed_amount,received_amount,due_date) values('${BRANCH}','${TENANT}','2026-10','rent',6300,2800,'2026-10-01');
      insert into cashbook_entries(branch_id,type,amount,description,entry_date,source,linked_id,created_by) values('${BRANCH}','Credit',8800,'Rent collected','2026-09-01','Payment','${id}','${ADMIN}');select set_config('request.jwt.claim.sub','${ADMIN}',false);`)
    await correct(id);expect((await balances())[1].received).toBe(300);expect((await totals()).cash).toBe(8800)
  })
  it('refuses untraceable imported entries instead of deleting an opening balance',async()=>{
    const id=randomUUID();await owner(`select set_config('request.jwt.claim.sub','',false);insert into payments(id,branch_id,tenant_id,amount,payment_date,month,status,payment_type,created_by) values('${id}','${BRANCH}','${TENANT}',6300,'2026-09-01','2026-09','Received','rent','${ADMIN}');select set_config('request.jwt.claim.sub','${ADMIN}',false);`)
    const h=await history();await expect(correct(id)).rejects.toThrow('no linked receipt');expect((await history()).token).toBe(h.token)
  })
  it('blocks receipt correction after the tenant exits',async()=>{
    await receipt();const id=await paymentId();await db.exec(`update tenants set status='Left' where id='${TENANT}'`)
    await expect(correct(id)).rejects.toThrow('exit settlement');expect((await totals()).cash).toBe(8800)
  })
  it('blocks room restore when the original bed has been occupied',async()=>{
    const newRoom=randomUUID();await owner(`insert into rooms(id,branch_id,number,type,beds,rent) values('${newRoom}','${BRANCH}','102','Single',1,6300)`)
    await db.exec(`update tenants set room_id='${newRoom}' where id='${TENANT}'`);await setupTenant(randomUUID(),1)
    await expect(replay('undo',await history())).rejects.toThrow('bed is unavailable')
  })
  it('enforces staff branch/payment permission and reserves corrections for admin',async()=>{
    await db.exec(`select set_config('request.jwt.claim.sub','${STAFF}',false)`)
    await expect(receipt()).rejects.toThrow('active admin')
    await owner(`insert into branch_assignments(user_id,branch_id) values('${STAFF}','${BRANCH}');insert into staff_permissions(user_id,permission,allowed) values('${STAFF}','add_payment',true)`)
    await receipt(1000);await expect(correct(await paymentId(),1000,0)).rejects.toThrow('active admin')
    await expect(replay('undo',await history())).rejects.toThrow('active admin')
    await db.exec(`select set_config('request.jwt.claim.sub','${ADMIN}',false)`)
    expect((await totals()).cash).toBe(1000)
  })
  it('rejects inactive users, cross-branch writes and anonymous callers',async()=>{
    await expect(one(db,'select record_split_payment_v3($1,$2,$3,1000,0,0,0,\'2026-09-01\',\'2026-09\',\'Cash\',\'x\')',[randomUUID(),TENANT,randomUUID()])).rejects.toThrow('selected branch')
    await owner(`update profiles set active=false where id='${ADMIN}'`);await expect(receipt()).rejects.toThrow('active account')
    await owner(`update profiles set active=true where id='${ADMIN}'`)
    await db.exec(`reset role;set role anon;select set_config('request.jwt.claim.sub','',false)`)
    await expect(db.query('select get_tenant_ledger_history($1)',[TENANT])).rejects.toThrow('permission denied')
  })
  it('does not expose snapshots, direct journal writes or the managed trigger context',async()=>{
    await expect(db.query('select * from pg95_private.tenant_changes')).rejects.toThrow('permission denied')
    await expect(db.query('insert into pg95_private.ledger_context values(txid_current(),\'restore\',\'x\')')).rejects.toThrow('permission denied')
    await expect(db.query('select pg95_private.tenant_snapshot($1)',[TENANT])).rejects.toThrow('permission denied')
  })
 it('blocks direct payment and cashbook edits while keeping the journal operation available',async()=>{
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${ADMIN}',false)`)
  await receipt(1000);const id=await paymentId()
  await expect(db.query('update payments set amount=900 where id=$1',[id])).rejects.toThrow('tenant ledger')
  await expect(db.query('delete from cashbook_entries where linked_id=$1',[id])).rejects.toThrow('tenant ledger')
  await expect(db.query('update cashbook_entries set amount=900 where linked_id=$1',[id])).rejects.toThrow('tenant ledger')
 })
})
