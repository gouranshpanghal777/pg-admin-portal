import {describe,it,expect} from 'vitest'
import {decodeLedgerAttempt} from '../src/lib/ledgerSubmission'
const base={kind:'replay',requestId:'00000000-0000-0000-0000-000000000001',token:'0123456789abcdef0123456789abcdef',confirmed:false,changeId:1,direction:'undo',savedAt:1000}
describe('durable ledger request recovery',()=>{
 it('retains the original request and token across a modal remount',()=>expect(decodeLedgerAttempt(JSON.stringify(base),2000)).toEqual({kind:'replay',requestId:base.requestId,token:base.token,confirmed:false,changeId:1,direction:'undo'}))
 it('rejects expired, future and malformed requests',()=>{expect(decodeLedgerAttempt(JSON.stringify(base),25*60*60*1000)).toBeUndefined();expect(decodeLedgerAttempt(JSON.stringify(base),999)).toBeUndefined();expect(decodeLedgerAttempt('{',2000)).toBeUndefined()})
 it('preserves confirmed writes so only reconciliation is retried',()=>expect(decodeLedgerAttempt(JSON.stringify({...base,confirmed:true}),2000)?.confirmed).toBe(true))
 it('allowlists correction fields and strips credentials',()=>{const value=decodeLedgerAttempt(JSON.stringify({...base,kind:'correct',action:'revise',paymentId:base.requestId,values:{rent:6300,security:2500,electricity:0,other:0,date:'2026-09-01',period:'2026-09',mode:'Cash',description:'correction',password:'secret'}}),2000);expect(value?.values).not.toHaveProperty('password');expect(value?.values?.security).toBe(2500)})
})
