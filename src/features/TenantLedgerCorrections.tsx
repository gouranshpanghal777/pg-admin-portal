import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Payment, Tenant } from '../App'
import { correctTenantPayment, getTenantLedgerHistory, replayTenantLedgerChange } from '../lib/database'
import type { LedgerHistory, PaymentCorrectionValues } from '../lib/database'
import { decodeLedgerAttempt } from '../lib/ledgerSubmission'
import type { LedgerAttempt } from '../lib/ledgerSubmission'

const money=(n:number)=>`₹${Number(n).toLocaleString('en-IN',{maximumFractionDigits:2})}`
const input='w-full rounded-md border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-100'
const button='rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40'
const emptyValues=(p:Payment):PaymentCorrectionValues=>({rent:p.paymentType==='Rent'?p.amount:0,security:p.paymentType==='Security Deposit'?p.amount:0,electricity:p.paymentType==='Electricity'?p.amount:0,other:p.paymentType==='Other'?p.amount:0,date:p.date,period:p.month==='one-time'?p.date.slice(0,7):p.month,mode:p.paymentMode,description:''})

export function TenantLedgerCorrections({tenant,payments,userId,canCorrect,onRefresh}:{tenant:Tenant;payments:Payment[];userId:string;canCorrect:boolean;onRefresh:()=>Promise<void>}) {
  const key=`pg95:ledger-attempt:v1:${userId}:${tenant.branchId}:${tenant.id}`
  const [history,setHistory]=useState<LedgerHistory>()
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false)
  const guard=useRef(false)
  const [attempt,setAttempt]=useState<LedgerAttempt|undefined>(()=>decodeLedgerAttempt(localStorage.getItem(key)))
  const attemptRef=useRef(attempt)
  const [selected,setSelected]=useState<Payment>()
  const [values,setValues]=useState<PaymentCorrectionValues>()
  const [remove,setRemove]=useState(false)
  useEffect(()=>{
    let cancelled=false
    getTenantLedgerHistory(tenant.id).then(h=>{if(!cancelled)setHistory(h)}).catch(e=>{if(!cancelled)setError(e.message)})
    return()=>{cancelled=true}
  },[tenant.id])
  function retain(next:LedgerAttempt|undefined) {
    // Retain the request before sending it; closing and reopening must reuse the same key.
    if(next)localStorage.setItem(key,JSON.stringify({...next,savedAt:Date.now()}));else localStorage.removeItem(key)
    attemptRef.current=next;setAttempt(next)
  }
  async function execute(operation:LedgerAttempt) {
    if(guard.current)return
    guard.current=true;setBusy(true);setError('');setNotice('')
    try {
      retain(operation)
      if(!operation.confirmed) {
        if(operation.kind==='replay')await replayTenantLedgerChange({requestId:operation.requestId,tenantId:tenant.id,changeId:operation.changeId!,direction:operation.direction!,token:operation.token})
        else await correctTenantPayment({requestId:operation.requestId,tenantId:tenant.id,branchId:tenant.branchId,paymentId:operation.paymentId!,action:operation.action!,values:operation.values!,token:operation.token})
        operation={...operation,confirmed:true};retain(operation)
      }
      await onRefresh()
      setHistory(await getTenantLedgerHistory(tenant.id))
      retain(undefined);setSelected(undefined);setValues(undefined)
      setNotice('Ledger updated. Rent months, security and linked cashbook were refreshed together.')
    } catch(e) {
      const err=e as Error & {retryable?:boolean}
      if(!operation.confirmed && err.retryable===false)retain(undefined)
      setError(err.message || 'Unable to confirm the change. Retry the same request.')
    } finally {guard.current=false;setBusy(false)}
  }
  function replay(direction:'undo'|'redo') {
    const change=history?.changes.find(c=>direction==='undo'?c.can_undo:c.can_redo)
    if(!change||!history)return
    const target=direction==='undo'?change.payment_total_before:change.payment_total_after
    if(!window.confirm(`${direction==='undo'?'Undo':'Redo'} “${change.label}” for ${tenant.name}?\nTenant payment total will become ${money(target)}. Linked balances and rent periods will be restored together.`))return
    void execute({kind:'replay',requestId:crypto.randomUUID(),token:history.token,changeId:change.id,direction,confirmed:false})
  }
  function choose(payment:Payment,isRemove:boolean) {setSelected(payment);setValues(emptyValues(payment));setRemove(isRemove);setError('');setNotice('')}
  function submit(event:FormEvent) {
    event.preventDefault()
    if(!selected||!values||!history)return
    const total=values.rent+values.security+values.electricity+values.other
    const summary=remove?`Undo ${money(selected.amount)} ${selected.paymentType}.`:`Replace ${money(selected.amount)} ${selected.paymentType} with:\nRent ${money(values.rent)} · Security ${money(values.security)} · Electricity ${money(values.electricity)} · Other ${money(values.other)}\nNew receipt total ${money(total)}.`
    if(!window.confirm(`${summary}\nOnly the selected payment row is revised. Other receipts stay recorded.\nSave this correction for ${tenant.name}?`))return
    void execute({kind:'correct',requestId:crypto.randomUUID(),token:history.token,paymentId:selected.id,action:remove?'remove':'revise',values,confirmed:false})
  }
  const locked=busy||Boolean(attempt)
  const own=payments.filter(p=>p.tenantId===tenant.id&&p.branchId===tenant.branchId).sort((a,b)=>b.date.localeCompare(a.date))
  return <section className="grid gap-3 rounded-lg border border-slate-300 p-4" aria-label="Tenant ledger corrections">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">Payment History & Corrections</h3>{canCorrect&&<div className="flex gap-2"><button type="button" className={button} disabled={locked||!history?.changes.some(c=>c.can_undo)} onClick={()=>replay('undo')}>Undo last change</button><button type="button" className={button} disabled={locked||!history?.changes.some(c=>c.can_redo)} onClick={()=>replay('redo')}>Redo</button></div>}</div>
    <p className="text-xs text-slate-600">Undo/redo works within this tenant’s ledger, newest change first. To fix an older receipt, choose Revise on that row. Saving a new change clears the redo path. History starts with this update.</p>
    {error&&<p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {notice&&<p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {attempt&&<div className="rounded-md bg-amber-50 p-3 text-sm"><p>{attempt.confirmed?'The change was saved. Refresh is still pending.':'The previous request is awaiting confirmation. Retry it before making another correction.'}</p><button type="button" className={`${button} mt-2`} disabled={busy} onClick={()=>void execute(attemptRef.current!)}>{busy?'Confirming…':'Retry confirmation'}</button></div>}
    {!history&&!attempt&&<button type="button" className={button} onClick={()=>{setError('');void getTenantLedgerHistory(tenant.id).then(setHistory).catch(e=>setError(e.message))}}>Reload correction history</button>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Date','Rent month / head','Amount','Mode','Description',...(canCorrect?['Actions']:[])].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{own.map(p=><tr key={p.id} className="border-t border-slate-100"><td className="p-2">{p.date}</td><td className="p-2">{p.month} · {p.paymentType}</td><td className="p-2 font-semibold">{money(p.amount)}</td><td className="p-2">{p.paymentMode}</td><td className="p-2">{p.description||'—'}</td>{canCorrect&&<td className="p-2"><div className="flex gap-2"><button type="button" className={button} disabled={locked||!history} onClick={()=>choose(p,false)} aria-label={`Revise ${p.paymentType} ${p.amount} on ${p.date}`}>Revise</button><button type="button" className={button} disabled={locked||!history} onClick={()=>choose(p,true)} aria-label={`Undo ${p.paymentType} ${p.amount} on ${p.date}`}>Undo entry</button></div></td>}</tr>)}</tbody></table>{!own.length&&<p className="p-3 text-sm text-slate-500">No payments recorded.</p>}</div>
    {selected&&values&&<form className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2" onSubmit={submit}>
      <p className="font-semibold sm:col-span-2">{remove?'Undo entry':'Revise payment'}: {money(selected.amount)} {selected.paymentType} · {selected.date}</p>
      {!remove&&<>{(['rent','security','electricity','other'] as const).map(head=><label key={head} className="text-sm capitalize">{head} received<input aria-label={`${head} received correction`} className={input} type="number" min="0" step="0.01" value={values[head]} disabled={locked} onChange={e=>setValues({...values,[head]:Number(e.target.value)})}/></label>)}<label className="text-sm">Payment date<input className={input} type="date" required value={values.date} disabled={locked} onChange={e=>setValues({...values,date:e.target.value})}/></label><label className="text-sm">Rent starts from month<input className={input} type="month" required value={values.period} disabled={locked} onChange={e=>setValues({...values,period:e.target.value})}/></label><label className="text-sm">Payment mode<select className={input} value={values.mode} disabled={locked} onChange={e=>setValues({...values,mode:e.target.value})}>{['Cash','Online','UPI','Bank Transfer','Card'].map(mode=><option key={mode}>{mode}</option>)}</select></label><p className="self-end text-sm">New receipt total: <b>{money(values.rent+values.security+values.electricity+values.other)}</b></p></>}
      <label className="text-sm sm:col-span-2">Correction reason<input className={input} required maxLength={2000} value={values.description} disabled={locked} placeholder="e.g. security was entered under rent by mistake" onChange={e=>setValues({...values,description:e.target.value})}/></label>
      <p className="text-xs text-slate-600 sm:col-span-2">Rent fills unpaid balances from the chosen month forward. Each affected month keeps its agreed rent and billing date. Security remains separate. Undoing a receipt removes its cashbook credit; it does not record a real-world refund.</p>
      <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className={button} disabled={locked} onClick={()=>{setSelected(undefined);setValues(undefined)}}>Cancel correction</button><button type="submit" className={`${button} border-blue-600 bg-blue-600 text-white`} disabled={locked}>{busy?'Saving…':remove?'Confirm undo entry':'Save correction'}</button></div>
    </form>}
    {history&&history.changes.length>0&&<details><summary className="cursor-pointer text-sm font-semibold">Undo / redo history ({history.changes.length})</summary><ol className="mt-2 grid gap-2">{history.changes.map(c=><li key={c.id} className="rounded bg-slate-50 p-2 text-xs"><b>{c.label}</b> · {c.state} · {c.actor} · {new Date(c.at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}<br/>Tenant payment total: {money(c.payment_total_before)} → {money(c.payment_total_after)}</li>)}</ol></details>}
  </section>
}
