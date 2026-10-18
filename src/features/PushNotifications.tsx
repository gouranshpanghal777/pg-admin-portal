import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const VAPID_PUBLIC_KEY = 'BOyPU2Yug9EeSHcLO6haZysxzYg1HHggvwHKchYy0afVSAa_Eyt68QR3-lWvrs8xt17U_XaCCA9Ms7gGjy_1tpQ'
function toBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(padded), ch => ch.charCodeAt(0))
}
type Props = { userId: string; branchId: string }
export default function PushNotifications({ userId, branchId }: Props) {
  const [status, setStatus] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    void navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(s => setEnabled(Boolean(s))).catch(() => {})
  }, [])
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  async function enable() {
    setBusy(true); setStatus('')
    try {
      if (!supported) throw new Error('This browser does not support push. On iPhone use Safari → Share → Add to Home Screen, then open the installed app.')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('Please allow notifications in your phone settings.')
      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(VAPID_PUBLIC_KEY) })
      const json = subscription.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('Incomplete push subscription')
      const { error } = await supabase.from('maintenance_push_subscriptions').upsert({
        endpoint: json.endpoint, user_id: userId, branch_id: branchId,
        p256dh: json.keys.p256dh, auth_secret: json.keys.auth,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' })
      if (error) throw error
      setEnabled(true); setStatus('Notifications enabled on this phone / फोन पर नोटिफिकेशन चालू हैं')
    } catch(e) { setStatus(e instanceof Error ? e.message : 'Could not enable notifications') }
    finally { setBusy(false) }
  }
  async function disable() {
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        const { error } = await supabase.from('maintenance_push_subscriptions').delete().eq('endpoint', subscription.endpoint).eq('user_id', userId)
        if (error) throw error
        await subscription.unsubscribe()
      }
      setEnabled(false); setStatus('Push notifications disabled')
    } catch(e) { setStatus(e instanceof Error ? e.message : 'Could not disable notifications') }
    finally { setBusy(false) }
  }
  return <div className="no-print mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
    <span className="text-sm font-semibold text-blue-950">📲 Background ticket alerts: {enabled ? 'ON' : 'OFF'}</span>
    <button type="button" disabled={busy} onClick={() => void (enabled ? disable() : enable())}
      className="min-h-10 rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
      {busy ? 'Please wait…' : enabled ? 'Disable phone notifications' : 'Enable phone notifications'}
    </button>
    {status && <span role="status" className="text-xs text-blue-900">{status}</span>}
  </div>
}
