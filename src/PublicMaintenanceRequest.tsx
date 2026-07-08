import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { Wrench, CheckCircle, Loader } from 'lucide-react'

type Step = 'validating' | 'invalid' | 'form' | 'submitting' | 'success' | 'error'

type BranchInfo = { id: string; name: string }
type RoomInfo = { id: string; number: string }

const inputClass = 'min-h-10 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 w-full'

export default function PublicMaintenanceRequest() {
  const [step, setStep] = useState<Step>('validating')
  const [branch, setBranch] = useState<BranchInfo | null>(null)
  const [rooms, setRooms] = useState<RoomInfo[]>([])
  const [errorMessage, setErrorMessage] = useState('')

  const [roomId, setRoomId] = useState('')
  const [tenantName, setTenantName] = useState('')
  const [mobile, setMobile] = useState('')
  const [complaint, setComplaint] = useState('')

  const [ticketNumber, setTicketNumber] = useState('')

  const token = window.location.pathname.replace(/^\/maintenance\/request\//, '')

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!token || token.length < 10) {
        setStep('invalid')
        return
      }
      try {
        const { data, error } = await supabase.rpc('get_branch_from_maintenance_token', { token })
        if (cancelled) return
        if (error || !data || data.length === 0) {
          setStep('invalid')
          return
        }
        const b = data[0] as BranchInfo
        setBranch(b)
        const { data: roomData } = await supabase.rpc('get_rooms_for_maintenance_token', { token })
        if (cancelled) return
        const roomList = (roomData || []) as RoomInfo[]
        setRooms(roomList)
        if (roomList.length > 0) setRoomId(roomList[0].id)
        setStep('form')
      } catch {
        if (!cancelled) setStep('invalid')
      }
    }
    load()
    return () => { cancelled = true }
  }, [token])

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault()
    if (step === 'submitting') return
    setErrorMessage('')

    const trimmedName = tenantName.trim()
    const trimmedMobile = mobile.trim()
    const trimmedComplaint = complaint.trim()

    if (!roomId) { setErrorMessage('Please select a room'); return }
    if (!trimmedName) { setErrorMessage('Please enter your name'); return }
    if (!trimmedMobile) { setErrorMessage('Please enter your mobile number'); return }
    if (!/^[6-9]\d{9}$/.test(trimmedMobile)) { setErrorMessage('Please enter a valid 10-digit Indian mobile number'); return }
    if (!trimmedComplaint) { setErrorMessage('Please describe the problem'); return }
    if (trimmedComplaint.length < 5) { setErrorMessage('Please describe the problem in more detail'); return }

    setStep('submitting')

    const { data, error } = await supabase.rpc('submit_public_maintenance_request', {
      token,
      room_id: roomId,
      tenant_name: trimmedName,
      mobile: trimmedMobile,
      complaint: trimmedComplaint,
    })

    if (error || !data || data.length === 0) {
      setErrorMessage(error?.message || 'Unable to submit request. Please try again.')
      setStep('form')
      return
    }

    setTicketNumber((data[0] as { ticket_number: string }).ticket_number)
    setStep('success')
  }, [step, token, roomId, tenantName, mobile, complaint])

  const ticketDisplay = ticketNumber || `MT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

  if (step === 'validating') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-[#f7f3ec] p-4">
        <Loader className="animate-spin text-blue-600" size={32} />
        <p className="mt-4 text-sm text-slate-500">Loading...</p>
      </main>
    )
  }

  if (step === 'invalid') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-[#f7f3ec] p-4">
        <div className="w-full max-w-md rounded-lg bg-white p-6 text-center shadow-lg">
          <Wrench className="mx-auto text-slate-300" size={48} />
          <h1 className="mt-4 text-xl font-bold text-slate-900">Invalid Request</h1>
          <p className="mt-2 text-sm text-slate-500">This maintenance QR code is not valid. Please contact your PG administrator.</p>
        </div>
      </main>
    )
  }

  if (step === 'success') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-[#f7f3ec] p-4">
        <div className="w-full max-w-md rounded-lg bg-white p-6 text-center shadow-lg">
          <CheckCircle className="mx-auto text-emerald-500" size={48} />
          <h1 className="mt-4 text-xl font-bold text-slate-900">Maintenance Request Submitted Successfully</h1>
          <p className="mt-4 text-sm text-slate-500">Ticket Number:</p>
          <p className="mt-1 text-2xl font-black text-blue-600">{ticketDisplay}</p>
          <p className="mt-4 text-sm text-slate-500">Your request has been received and will be attended to shortly.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh flex-col bg-[#f7f3ec]">
      <div className="mx-auto w-full max-w-md p-4">
        <div className="mb-4 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-blue-600 font-black text-white text-lg">95</div>
          <h1 className="mt-3 text-lg font-bold text-slate-900">PG 95</h1>
          {branch && <p className="text-sm text-slate-500">{branch.name}</p>}
          <p className="mt-1 text-xs text-slate-400">Raise a Maintenance Request</p>
        </div>

        <form className="grid gap-4 rounded-lg bg-white p-5 shadow-lg" onSubmit={handleSubmit}>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Room No.
            <select className={inputClass} value={roomId} onChange={(e) => setRoomId(e.target.value)} required>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>Room {room.number}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Tenant Name
            <input className={inputClass} type="text" value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Your name" required autoComplete="name" />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Mobile Number
            <input className={inputClass} type="tel" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile number" required autoComplete="tel" inputMode="numeric" />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Problem / Complaint
            <textarea className={inputClass + ' min-h-24'} value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="Describe the issue" required />
          </label>

          {errorMessage && (
            <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{errorMessage}</p>
          )}

          <button
            type="submit"
            disabled={step === 'submitting'}
            className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {step === 'submitting' ? (
              <><Loader className="animate-spin" size={16} /> Submitting...</>
            ) : (
              'Submit Ticket'
            )}
          </button>
        </form>
      </div>
    </main>
  )
}
