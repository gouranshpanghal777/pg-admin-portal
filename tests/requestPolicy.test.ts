import { describe, expect, it } from 'vitest'
import { requestMethod, shouldTimeoutRequest } from '../src/lib/requestPolicy'

describe('Supabase request timeout policy', () => {
  it('times out idempotent reads', () => {
    expect(shouldTimeoutRequest('https://example.test/rest/v1/tenants')).toBe(true)
    expect(shouldTimeoutRequest('https://example.test/rest/v1/tenants', { method: 'HEAD' })).toBe(true)
  })

  it('does not abort mutations with an unknown server outcome', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(shouldTimeoutRequest('https://example.test/rest/v1/rpc/save', { method })).toBe(false)
    }
  })

  it('honours an explicit method regardless of casing', () => {
    expect(requestMethod('https://example.test', { method: 'post' })).toBe('POST')
  })
})
