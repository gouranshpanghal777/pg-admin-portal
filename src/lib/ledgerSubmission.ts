import type { PaymentCorrectionValues } from './database'
export type LedgerAttempt={kind:'correct'|'replay';requestId:string;token:string;confirmed:boolean;paymentId?:string;action?:'revise'|'remove';values?:PaymentCorrectionValues;changeId?:number;direction?:'undo'|'redo'}
export function decodeLedgerAttempt(raw:string|null,now=Date.now()):LedgerAttempt|undefined {
  try {
    if(!raw)return
    const d=JSON.parse(raw)
    if(!Number.isFinite(d.savedAt)||now-d.savedAt>24*60*60*1000||d.savedAt>now||!/^[a-f0-9-]{36}$/i.test(d.requestId)||!/^[a-f0-9]{32}$/i.test(d.token)||typeof d.confirmed!=='boolean')return
    const base={requestId:d.requestId,token:d.token,confirmed:d.confirmed}
    if(d.kind==='replay'&&Number.isSafeInteger(d.changeId)&&['undo','redo'].includes(d.direction))return {...base,kind:'replay',changeId:d.changeId,direction:d.direction}
    const v=d.values
    if(d.kind!=='correct'||!/^[a-f0-9-]{36}$/i.test(d.paymentId)||!['revise','remove'].includes(d.action)||!v)return
    if(!['rent','security','electricity','other'].every(h=>Number.isFinite(v[h])&&v[h]>=0)||typeof v.date!=='string'||typeof v.period!=='string'||typeof v.mode!=='string'||typeof v.description!=='string')return
    return {...base,kind:'correct',paymentId:d.paymentId,action:d.action,values:{rent:v.rent,security:v.security,electricity:v.electricity,other:v.other,date:v.date,period:v.period,mode:v.mode,description:v.description.slice(0,2000)}}
  }catch{return}
}
