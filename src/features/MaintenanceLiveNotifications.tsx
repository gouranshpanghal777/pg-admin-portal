import { useEffect, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { Bell, X } from 'lucide-react'
import type { AppData } from '../App'
import { supabase } from '../lib/supabase'
import { refreshTables } from '../lib/database'
import { playMaintenanceChime, unseenPublicMaintenanceRequests } from './maintenanceRealtime'

export type TicketAlert = {
  id: string
  branchId: string
  branchName: string
  roomNumber: string
  title: string
  ticketNumber: string
}

type Options = {
  sessionUserId: string | undefined
  loadedUserId: string
  dataRef: RefObject<AppData>
  persistenceQueue: RefObject<Promise<void>>
  setData: Dispatch<SetStateAction<AppData>>
}

/**
 * One listener per logged-in admin/staff session, active on EVERY page.
 * Postgres Changes is fast; polling and focus/reconnect are recovery paths.
 * Subscription/RLS restricts rows to branches the logged-in user may read.
 */
export function useMaintenanceLiveSync({ sessionUserId, loadedUserId, dataRef, persistenceQueue, setData }: Options) {
  const [alerts, setAlerts] = useState<TicketAlert[]>([])
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [soundError, setSoundError] = useState('')
  const enabledRef = useRef(false)
  const audioRef = useRef<AudioContext | null>(null)

  const toggleSound = async () => {
    setSoundError('')
    if (enabledRef.current) {
      enabledRef.current = false
      setSoundEnabled(false)
      void audioRef.current?.suspend().catch(() => {})
      return
    }
    try {
      if (!audioRef.current) audioRef.current = new AudioContext()
      await audioRef.current.resume()
      if (audioRef.current.state !== 'running') throw new Error('Browser blocked audio')
      enabledRef.current = true
      setSoundEnabled(true)
      if ('Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => {})
      }
    } catch {
      enabledRef.current = false
      setSoundEnabled(false)
      setSoundError('Your browser blocked the sound. In-app ticket alerts will still work.')
    }
  }

  const dismiss = (ticketId: string) => {
    setAlerts((current) => current.filter((ticket) => ticket.id !== ticketId))
  }

  useEffect(() => {
    if (!sessionUserId || loadedUserId !== sessionUserId) return
    let stopped = false
    let inFlight = false
    let pendingRefresh = false
    const knownIds = new Set(dataRef.current.tickets.map((ticket) => ticket.id))

    const refresh = async () => {
      if (inFlight) { pendingRefresh = true; return }
      inFlight = true
      try {
        await persistenceQueue.current
        if (stopped) return
        const refreshed = await refreshTables(['maintenance_tickets'], dataRef.current)
        if (stopped) return

        const current = dataRef.current
        const user = current.users.find((person) => person.id === sessionUserId)
        // Never announce records from an unassigned or inactive branch.
        const accessibleBranchIds = new Set(
          current.branches
            .filter((branch) => branch.active !== false && (user?.role === 'Admin' || user?.branchIds.includes(branch.id)))
            .map((branch) => branch.id),
        )
        const justRaised = unseenPublicMaintenanceRequests(knownIds, refreshed.tickets, accessibleBranchIds)
        if (justRaised.length) {
          const incoming = justRaised.map((ticket): TicketAlert => ({
            id: ticket.id,
            branchId: ticket.branchId,
            branchName: current.branches.find((branch) => branch.id === ticket.branchId)?.name || 'PG 95',
            roomNumber: current.rooms.find((room) => room.id === ticket.roomId)?.number || '-',
            title: ticket.title,
            ticketNumber: ticket.ticketNumber || 'New ticket',
          }))
          setAlerts((previous) => [
            ...incoming.filter((item) => !previous.some((candidate) => candidate.id === item.id)),
            ...previous,
          ].slice(0, 8))
          if (enabledRef.current) {
            playMaintenanceChime(audioRef.current)
            // Page notifications work while the application tab is open; not
            // background push when the browser or app is fully closed.
            if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
              const latest = incoming[0]
              try {
                const note = new Notification('PG 95 · New maintenance complaint', {
                  body: `${latest.branchName} · Room ${latest.roomNumber} · ${latest.ticketNumber}`,
                  tag: `pg95-ticket-${latest.id}`,
                })
                note.onclick = () => {
                  window.focus()
                  note.close()
                }
              } catch { /* Browser notifications are optional. */ }
            }
          }
        }
        if (JSON.stringify(refreshed.tickets) !== JSON.stringify(current.tickets)) {
          const next = { ...dataRef.current, tickets: refreshed.tickets }
          dataRef.current = next
          setData(next)
        }
      } catch (error) {
        console.warn('Maintenance ticket sync failed; retrying', error)
      } finally {
        inFlight = false
        if (!stopped && pendingRefresh) {
          pendingRefresh = false
          void refresh()
        }
      }
    }

    const channel = supabase
      .channel(`pg95-maintenance-${sessionUserId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_tickets' }, () => { void refresh() })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' || status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') void refresh()
      })

    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 15000)
    const onFocus = () => { void refresh() }
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [sessionUserId, loadedUserId, dataRef, persistenceQueue, setData])

  return { alerts, soundEnabled, soundError, toggleSound, dismiss }
}

export function MaintenanceTicketAlerts({ alerts, onDismiss, onView }: {
  alerts: TicketAlert[]
  onDismiss: (id: string) => void
  onView: (alert: TicketAlert) => void
}) {
  if (!alerts.length) return null
  return (
    <aside aria-live="polite" className="no-print fixed bottom-4 right-4 z-[80] w-[min(23rem,calc(100vw-2rem))] space-y-2">
      {alerts.slice(0, 3).map((alert) => (
        <div key={alert.id} role="status" className="rounded-xl border border-blue-200 bg-white p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 font-black text-blue-800"><Bell size={20} /> New Maintenance Ticket</div>
            <button type="button" aria-label="Dismiss ticket alert" onClick={() => onDismiss(alert.id)} className="rounded p-1 text-slate-600 hover:bg-slate-100"><X size={18} /></button>
          </div>
          <p className="mt-2 break-words text-sm font-semibold text-slate-900">{alert.title}</p>
          <p className="mt-1 text-xs text-slate-600">{alert.branchName} · Room {alert.roomNumber} · {alert.ticketNumber}</p>
          <button type="button" onClick={() => onView(alert)} className="mt-3 w-full rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white hover:bg-blue-800">View Ticket / शिकायत देखें</button>
        </div>
      ))}
      {alerts.length > 3 && <p className="rounded-lg bg-slate-950 p-2 text-center text-xs font-bold text-white">+{alerts.length - 3} more new tickets</p>}
    </aside>
  )
}
