import { useEffect, useState } from 'react'
import { acceptUpdate, UPDATE_EVENT, updateBlocked } from '../lib/pwaUpdate'

export default function UpdateNotice() {
  const [ready, setReady] = useState(false)
  const [blocked, setBlocked] = useState(true)
  useEffect(() => {
    const show = () => { setReady(true); setBlocked(updateBlocked()) }
    window.addEventListener(UPDATE_EVENT, show)
    return () => window.removeEventListener(UPDATE_EVENT, show)
  }, [])
  useEffect(() => {
    if (!ready) return
    const check = () => setBlocked(updateBlocked())
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    check()
    return () => observer.disconnect()
  }, [ready])
  if (!ready) return null
  return <aside role="status" className="no-print fixed bottom-4 right-4 z-[100] max-w-sm rounded-lg bg-slate-900 p-4 text-sm text-white shadow-xl">
    <p className="font-bold">App update ready</p>
    <p className="my-2">{blocked ? 'Save or discard and close open forms before updating.' : 'Your app will reload when you choose Update.'}</p>
    <button type="button" disabled={blocked} onClick={() => { if (!acceptUpdate()) setBlocked(true) }} className="min-h-11 rounded-md bg-white px-4 font-bold text-slate-900 disabled:opacity-50">Update</button>
  </aside>
}
