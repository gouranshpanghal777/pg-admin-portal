/**
 * Detect newly raised public QR requests. The mutable seen set is seeded with
 * the initial database snapshot, so opening the app never rings for old tickets.
 * It also de-duplicates websocket events, reconnects, and polling results.
 */
export function unseenPublicMaintenanceRequests<T extends { id: string; branchId: string; category: string }>(
  knownIds: Set<string>,
  tickets: readonly T[],
  allowedBranchIds: ReadonlySet<string>,
): T[] {
  const fresh: T[] = []
  for (const ticket of tickets) {
    if (knownIds.has(ticket.id)) continue
    knownIds.add(ticket.id)
    if (ticket.category === 'Tenant Request' && allowedBranchIds.has(ticket.branchId)) fresh.push(ticket)
  }
  return fresh
}

/** Audible only after the admin clicks Enable alert sound (browser autoplay policy). */
export function playMaintenanceChime(audio: AudioContext | null) {
  if (!audio || audio.state !== 'running') return
  try {
    const start = audio.currentTime
    for (const [index, pitch] of [740, 980].entries()) {
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = pitch
      const at = start + index * 0.16
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.095, at + 0.018)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.15)
      oscillator.connect(gain)
      gain.connect(audio.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.16)
    }
  } catch {
    // Sound is optional. Never interrupt maintenance ticket reception.
  }
}
