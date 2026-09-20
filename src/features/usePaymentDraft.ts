import { useEffect, useRef, useState } from 'react'
import { decodePaymentDraft, encodePaymentDraft, type PaymentDraft } from '../lib/paymentDraft'

export function usePaymentDraft(key: string, initial: () => PaymentDraft) {
  const [value, setValue] = useState(() => {
    try { return decodePaymentDraft(localStorage.getItem(key)) || initial() } catch { return initial() }
  })
  const current = useRef(value)
  const cleared = useRef(false)
  const [storageError, setStorageError] = useState('')
  const persist = (next: PaymentDraft) => {
    try { localStorage.setItem(key, encodePaymentDraft(next)); setStorageError('') }
    catch { setStorageError('Draft could not be stored on this device. Keep this form open until saved.') }
  }
  const patch = (changes: Partial<PaymentDraft>) => {
    const next = { ...current.current, ...changes }
    current.current = next; setValue(next); persist(next)
  }
  const clear = () => {
    // Keep a confirmed-operation tombstone in memory even if storage is unavailable.
    cleared.current = true
    try { localStorage.removeItem(key) } catch { /* no storage access */ }
  }
  useEffect(() => {
    const save = () => {
      if (cleared.current) return
      try { localStorage.setItem(key, encodePaymentDraft(current.current)) } catch { /* visible warning on edits */ }
    }
    const guard = (event: BeforeUnloadEvent) => { if (!cleared.current) { save(); event.preventDefault(); event.returnValue = '' } }
    document.addEventListener('visibilitychange', save)
    window.addEventListener('pagehide', save)
    window.addEventListener('beforeunload', guard)
    return () => { document.removeEventListener('visibilitychange', save); window.removeEventListener('pagehide', save); window.removeEventListener('beforeunload', guard) }
  }, [key])
  return { value, patch, clear, storageError }
}
