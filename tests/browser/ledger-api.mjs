import http from 'node:http'
import {ledgerDatabase,one,TENANT,BRANCH} from '../helpers/ledgerDatabase.ts'
const db=await ledgerDatabase()
const date=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10)
export {db}
await one(db,`select record_split_payment_v3(gen_random_uuid(),$1,$2,8800,0,0,0,'2026-09-01','2026-09','Cash','Wrong rent entry')`,[TENANT,BRANCH])
const methods={get_tenant_ledger_history:['p_tenant_id'],replay_tenant_ledger_change:['p_request_id','p_tenant_id','p_change_id','p_direction','p_token'],correct_tenant_payment:['p_request_id','p_tenant_id','p_branch_id','p_payment_id','p_action','p_values','p_token']}
let refreshFail=false
export const server=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:4181');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Content-Type','application/json')
  if(req.method==='OPTIONS'){res.end();return}
  try{
    if(req.url==='/fail-next-refresh'){refreshFail=true;res.end('{}');return}
    if(req.url==='/fixture'){
      if(refreshFail){refreshFail=false;res.statusCode=503;res.end('{"message":"Test refresh failure"}');return}
      const t=await one(db,'select * from tenants where id=$1',[TENANT]);
      const tenant={id:t.id,branchId:t.branch_id,name:t.name,phone:t.phone,email:'',roomId:t.room_id,bedNo:t.bed_no,monthlyRent:Number(t.monthly_rent),security:Number(t.security),securityReceived:Number(t.security_received),securityBalance:Number(t.security_balance),electricity:t.electricity,electricityAmount:Number(t.electricity_amount),joiningDate:date(t.joining_date),dueDate:date(t.due_date),status:t.status,idProof:'',paidThisMonth:Number(t.paid_this_month)}
      const payments=(await db.query('select * from payments order by created_at')).rows.map(p=>({id:p.id,branchId:p.branch_id,tenantId:p.tenant_id,amount:Number(p.amount),date:date(p.payment_date),month:p.month,status:p.status,invoiceId:'',paymentType:{rent:'Rent',security:'Security Deposit',electricity:'Electricity',other:'Other'}[p.payment_type],paymentMode:p.payment_mode,description:p.description,allocationManaged:p.allocation_managed}))
      const obligations=(await db.query('select * from payment_obligations')).rows.map(o=>({id:o.id,branchId:o.branch_id,tenantId:o.tenant_id,period:o.period,paymentType:{rent:'Rent',security:'Security Deposit',electricity:'Electricity',other:'Other'}[o.payment_type],agreed:Number(o.agreed_amount),received:Number(o.received_amount),advanceApplied:Number(o.advance_applied),dueDate:date(o.due_date),status:o.status}))
      const totals=await one(db,'select sum(amount)::float cash,count(*)::int rows from cashbook_entries')
      res.end(JSON.stringify({tenant,payments,obligations,totals}));return
    }
    const name=req.url?.split('/').at(-1);if(!methods[name]){res.statusCode=404;res.end('{}');return}
    let raw='';for await(const chunk of req)raw+=chunk;const payload=JSON.parse(raw)
    const keys=methods[name];const params=keys.map(k=>k==='p_values'?JSON.stringify(payload[k]):payload[k]);
    const args=keys.map((k,i)=>`$${i+1}${k==='p_values'?'::jsonb':''}`).join(',')
    const result=await one(db,`select public.${name}(${args}) result`,params)
    res.end(JSON.stringify(result.result))
  }catch(e){res.statusCode=400;res.end(JSON.stringify({message:e.message,code:e.code||'P0001',details:e.detail||null,hint:null}))}
}).listen(4180,'127.0.0.1',()=>console.log('Isolated ledger API ready on 4180'))
