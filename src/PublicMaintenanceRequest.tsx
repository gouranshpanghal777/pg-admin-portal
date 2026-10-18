import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase, supabaseConfigured } from './lib/supabase'
import { AlertCircle, CheckCircle2, Loader2, Send, Wrench } from 'lucide-react'

type Step = 'validating' | 'invalid' | 'unavailable' | 'form' | 'submitting' | 'success'
type BranchInfo = { id: string; name: string }
type RoomInfo = { id: string; number: string }
type TicketResponse = { ticket_id: string; ticket_number: string; branch_name: string }

const inputClass = 'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100'

function requestUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// The token is an opaque, branch-specific secret, not a room number or a login.
const token = window.location.pathname.match(/^\/maintenance\/request\/([^/]+)\/?$/i)?.[1]?.toLowerCase() || ''

export default function PublicMaintenanceRequest() {
  const [step, setStep] = useState<Step>('validating')
  const [branch, setBranch] = useState<BranchInfo | null>(null)
  const [rooms, setRooms] = useState<RoomInfo[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [loadRetry, setLoadRetry] = useState(0)
  const [roomId, setRoomId] = useState('')
  const [tenantName, setTenantName] = useState('')
  const [mobile, setMobile] = useState('')
  const [complaint, setComplaint] = useState('')
  const [ticketNumber, setTicketNumber] = useState('')
  const sendingRef = useRef(false)
  const requestIdRef = useRef<string | null>(null)

  const invalidateDraft = () => {
    requestIdRef.current = null
    setErrorMessage('')
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!/^[a-f0-9]{32}$/.test(token)) { setStep('invalid'); return }
      if (!supabaseConfigured) { setStep('unavailable'); return }
      setStep('validating')
      setErrorMessage('')
      try {
        const { data, error } = await supabase.rpc('get_branch_from_maintenance_token', { token })
        if (cancelled) return
        if (error) throw error
        if (!data?.length) { setStep('invalid'); return }
        const currentBranch = data[0] as BranchInfo
        const { data: roomData, error: roomError } = await supabase.rpc('get_rooms_for_maintenance_token', { token })
        if (cancelled) return
        if (roomError) throw roomError
        const roomList = (roomData || []) as RoomInfo[]
        if (!roomList.length) { setStep('unavailable'); return }
        setBranch(currentBranch)
        setRooms(roomList)
        setRoomId((previous) => roomList.some((room) => room.id === previous) ? previous : roomList[0].id)
        setStep('form')
      } catch {
        if (!cancelled) setStep('unavailable')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [loadRetry])

  const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sendingRef.current || !branch) return
    setErrorMessage('')
    const name = tenantName.trim()
    const phone = mobile.trim()
    const details = complaint.trim()

    if (!roomId) { setErrorMessage('Please select your room / कृपया कमरा चुनें'); return }
    if (!name || name.length > 100) { setErrorMessage('Enter your name (maximum 100 characters) / अपना नाम भरें'); return }
    if (!/^[6-9]\d{9}$/.test(phone)) { setErrorMessage('Enter a valid 10-digit mobile number / सही मोबाइल नंबर भरें'); return }
    if (details.length < 5 || details.length > 2000) { setErrorMessage('Describe the problem in 5–2000 characters / समस्या का विवरण लिखें'); return }

    const submissionId = requestIdRef.current || requestUuid()
    requestIdRef.current = submissionId // Reuse on retries; never create two tickets after a network timeout.
    sendingRef.current = true
    setStep('submitting')
    try {
      const { data, error } = await supabase.rpc('submit_public_maintenance_request_v2', {
        token,
        room_id: roomId,
        tenant_name: name,
        mobile: phone,
        complaint: details,
        request_id: submissionId,
      })
      if (error) throw error
      const result = (data as TicketResponse[] | null)?.[0]
      if (!result?.ticket_id || !result.ticket_number) throw new Error('No ticket confirmation received')
      setTicketNumber(result.ticket_number)
      setStep('success')
    } catch {
      setErrorMessage('Could not confirm your request. Check internet and tap Submit again. Your retry will not create a duplicate ticket. / अनुरोध की पुष्टि नहीं हुई। इंटरनेट जाँचें और दोबारा भेजें।')
      setStep('form')
    } finally {
      sendingRef.current = false
    }
  }, [branch, roomId, tenantName, mobile, complaint])

  if (step === 'validating') return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 p-6"><Loader2 className="animate-spin text-blue-600" size={36} /><p className="text-slate-600">Opening maintenance form / फॉर्म खुल रहा है…</p></main>

  if (step === 'invalid' || step === 'unavailable') return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-5">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
        <AlertCircle className="mx-auto text-amber-600" size={44} />
        <h1 className="mt-5 text-xl font-black text-slate-900">{step === 'invalid' ? 'Invalid maintenance QR / अमान्य QR कोड' : 'Unable to load / फॉर्म नहीं खुल पाया'}</h1>
        <p className="mt-3 text-slate-600">{step === 'invalid' ? 'Please ask PG95 staff for the current branch QR code. / कृपया PG95 स्टाफ से सही QR कोड लें।' : 'Please check your internet connection and try again. / इंटरनेट जाँचें और दोबारा कोशिश करें।'}</p>
        {step === 'unavailable' && <button type="button" className="mt-6 w-full rounded-xl bg-blue-600 p-3 font-bold text-white" onClick={() => setLoadRetry((n) => n + 1)}>Retry / पुनः प्रयास करें</button>}
      </div>
    </main>
  )

  if (step === 'success') return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-5">
      <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-lg">
        <CheckCircle2 className="mx-auto text-emerald-600" size={56} />
        <h1 className="mt-4 text-2xl font-black text-slate-900">Complaint Registered!</h1>
        <p className="mt-2 text-lg font-bold text-emerald-700">आपकी शिकायत दर्ज हो गई है।</p>
        <p className="mt-5 text-sm text-slate-600">Your maintenance ticket / आपका टिकट नंबर</p>
        <p className="mt-2 rounded-xl bg-blue-50 p-4 text-3xl font-black tracking-wide text-blue-700">{ticketNumber}</p>
        <p className="mt-5 font-semibold text-slate-800">Expected resolution: 24–48 hours</p>
        <p className="mt-2 text-slate-600">हमारी टीम 24–48 घंटों में समस्या हल करने का प्रयास करेगी।</p>
        <p className="mt-3 text-xs text-slate-500">Please save this ticket number. Timing may vary for complex repairs. / कृपया टिकट नंबर संभालकर रखें।</p>
        <button type="button" onClick={() => { setTicketNumber(''); setComplaint(''); requestIdRef.current = null; setStep('form') }} className="mt-6 w-full rounded-xl border border-slate-300 px-4 py-3 font-bold text-slate-800">Report another issue / नई शिकायत</button>
      </div>
    </main>
  )

  return (
    <main className="min-h-dvh bg-[#f5f7fb] px-4 py-8">
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-6 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-blue-700 text-2xl font-black text-white">95</div>
          <h1 className="mt-3 text-2xl font-black text-slate-900">PG 95 · Maintenance Helpdesk</h1>
          <p className="mt-1 font-semibold text-slate-700">{branch?.name}</p>
          <p className="mt-3 text-lg font-bold text-blue-800">शिकायत / मरम्मत अनुरोध</p>
          <p className="mt-1 text-sm text-slate-500">Report electricity, water, cleaning or repair problems</p>
        </header>

        <form className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-lg sm:p-7" onSubmit={handleSubmit}>
          <label className="grid gap-2 text-sm font-bold text-slate-800">Room Number / कमरा नंबर
            <select className={inputClass} value={roomId} onChange={(e) => { invalidateDraft(); setRoomId(e.target.value) }} required disabled={step === 'submitting'}>
              {rooms.map((room) => <option key={room.id} value={room.id}>Room {room.number}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-bold text-slate-800">Your Name / आपका नाम
            <input className={inputClass} type="text" value={tenantName} maxLength={100} onChange={(e) => { invalidateDraft(); setTenantName(e.target.value) }} placeholder="Full name / पूरा नाम" required autoComplete="name" disabled={step === 'submitting'} />
          </label>
          <label className="grid gap-2 text-sm font-bold text-slate-800">Mobile Number / मोबाइल नंबर
            <input className={inputClass} type="tel" value={mobile} onChange={(e) => { invalidateDraft(); setMobile(e.target.value.replace(/\D/g, '').slice(0, 10)) }} placeholder="10-digit mobile number" required autoComplete="tel" inputMode="numeric" disabled={step === 'submitting'} />
          </label>
          <label className="grid gap-2 text-sm font-bold text-slate-800">Complaint Details / समस्या का विवरण
            <textarea className={inputClass + ' min-h-32 resize-y'} value={complaint} maxLength={2000} onChange={(e) => { invalidateDraft(); setComplaint(e.target.value) }} placeholder="Explain what is not working / क्या समस्या है, यहाँ लिखें" required disabled={step === 'submitting'} />
          </label>
          {errorMessage && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{errorMessage}</p>}
          <button type="submit" disabled={step === 'submitting'} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-base font-black text-white shadow-sm hover:bg-blue-800 disabled:cursor-wait disabled:opacity-70">
            {step === 'submitting' ? <><Loader2 size={19} className="animate-spin" /> Submitting / भेज रहे हैं…</> : <><Send size={19} /> Submit Complaint / शिकायत दर्ज करें</>}
          </button>
          <div className="rounded-xl bg-blue-50 p-4 text-center text-sm text-blue-900">
            <div className="font-black">Target: 24–48 hours / लक्ष्य: 24–48 घंटे</div>
            <p className="mt-1">Your ticket number will appear after successful submission. / शिकायत दर्ज होने पर टिकट नंबर मिलेगा।</p>
          </div>
        </form>
        <p className="mt-5 text-center text-xs text-slate-500"><Wrench className="mr-1 inline" size={14} /> PG 95 Maintenance Support</p>
      </div>
    </main>
  )
}
