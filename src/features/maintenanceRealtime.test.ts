import { describe, expect, it } from 'vitest'
import { unseenPublicMaintenanceRequests } from './maintenanceRealtime'

const ticket = (id: string, branchId = 'one', category = 'Tenant Request') => ({ id, branchId, category })

describe('public maintenance notification detection', () => {
  it('does not re-alert initial tickets or duplicate websocket and polling deliveries', () => {
    const known = new Set(['existing'])
    const allowed = new Set(['one'])
    expect(unseenPublicMaintenanceRequests(known, [ticket('existing'), ticket('new')], allowed).map((t) => t.id)).toEqual(['new'])
    expect(unseenPublicMaintenanceRequests(known, [ticket('new')], allowed)).toEqual([])
  })

  it('only notifies public QR tickets in authorized branches', () => {
    const known = new Set<string>()
    const fresh = unseenPublicMaintenanceRequests(known, [
      ticket('external', 'other'),
      ticket('manual', 'one', 'Electrical'),
      ticket('valid', 'one'),
    ], new Set(['one']))
    expect(fresh.map((t) => t.id)).toEqual(['valid'])
    expect(known.size).toBe(3)
  })

  it('notifies each new public ticket once, even in the same batch', () => {
    const known = new Set<string>()
    expect(unseenPublicMaintenanceRequests(known, [ticket('abc'), ticket('abc')], new Set(['one']))).toHaveLength(1)
  })
})
