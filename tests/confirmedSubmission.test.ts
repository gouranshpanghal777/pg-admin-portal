import { describe, expect, it, vi } from 'vitest'
import { confirmedSubmission } from '../src/lib/confirmedSubmission'

describe('confirmed submission', () => {
  it('coalesces same-tick double submits', async () => {
    const operation = confirmedSubmission<string, string>()
    const write = vi.fn(async () => 'receipt')
    const refresh = vi.fn(async () => {})
    const first = operation.run('request-1', write, refresh)
    expect(operation.run('request-1', write, refresh)).toBe(first)
    await first
    expect(write).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('only retries refresh after a confirmed commit', async () => {
    const operation = confirmedSubmission<string, string>()
    const write = vi.fn(async () => 'receipt')
    const refresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    await expect(operation.run('request-1', write, refresh)).rejects.toThrow('offline')
    expect(operation.confirmed).toBe(true)
    await operation.run('request-1', write, refresh)
    expect(write).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenLastCalledWith('receipt')
  })
  it('replays the identical request after an ambiguous response', async () => {
    const operation = confirmedSubmission<{ requestId: string; amount: number }, string>()
    const input = { requestId: 'same-id', amount: 500 }
    const write = vi.fn().mockRejectedValueOnce(new TypeError('Load failed')).mockResolvedValue('existing receipt')
    const refresh = vi.fn(async () => {})
    await expect(operation.run(input, write, refresh)).rejects.toThrow('Load failed')
    await expect(operation.run({ ...input, amount: 600 }, write, refresh)).rejects.toThrow('unresolved')
    expect(write).toHaveBeenCalledTimes(1)
    await operation.run(input, write, refresh)
    expect(write.mock.calls.map(([value]) => value)).toEqual([input, input])
  })
  it('does not automatically retry permission failures', async () => {
    const operation = confirmedSubmission<string, never>()
    const write = vi.fn(async () => { throw new Error('permission denied') })
    await expect(operation.run('request', write, async () => {})).rejects.toThrow('permission denied')
    expect(write).toHaveBeenCalledTimes(1)
  })
})
