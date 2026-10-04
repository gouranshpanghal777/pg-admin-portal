import {useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {TenantLedgerCorrections} from '../../src/features/TenantLedgerCorrections'
import {tenantAccount} from '../../src/lib/tenantAccount'
import '../../src/index.css'
export function Harness(){
 const [data,setData]=useState<any>()
 const [open,setOpen]=useState(true)
 async function refresh(){const r=await fetch('http://127.0.0.1:4180/fixture');if(!r.ok)throw new Error('Test refresh failed after confirmed save');setData(await r.json())}
 useEffect(()=>{void refresh()},[])
 if(!data)return <p>Loading isolated test ledger…</p>
 const account=tenantAccount(data.tenant,data.payments,data.obligations,[],'2026-10-01')
 return <main className="mx-auto max-w-5xl p-6"><h1 className="mb-4 text-2xl font-bold">PG95 · Test tenant ledger</h1><div className="mb-4 flex flex-wrap gap-4 rounded bg-slate-50 p-4"><p>Rent due: ₹{account.pending}</p><p>Next rent month: {account.period}</p><p>Security received: ₹{data.tenant.securityReceived}</p><p>Cashbook: ₹{data.totals.cash}</p><p>Receipt rows: {data.payments.length}</p></div><button className="mb-4 rounded border p-2" onClick={()=>setOpen(!open)}>{open?'Close ledger':'Open ledger'}</button>{open&&<TenantLedgerCorrections tenant={data.tenant} payments={data.payments} userId="00000000-0000-0000-0000-000000000001" canCorrect onRefresh={refresh}/>}</main>
}
createRoot(document.getElementById('root')!).render(<Harness/> )
