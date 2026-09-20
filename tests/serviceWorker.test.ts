import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

function worker() {
  const listeners = new Map<string, (event: any) => void>()
  const skipWaiting = vi.fn()
  const remove = vi.fn(async () => true)
  const cache = { put: vi.fn(async () => {}) }
  const caches = { open: vi.fn(async () => cache), keys: async () => ['unrelated-cache', 'pg95-shell-v8', 'pg95-shell-v9'], delete: remove }
  const self = { addEventListener: (name: string, callback: (event: any) => void) => listeners.set(name, callback), skipWaiting, location: { origin: 'https://pg95.example' }, clients: { claim: vi.fn() } }
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, caches, URL, fetch: async () => ({ ok: true }) })
  return { listeners, skipWaiting, remove }
}
it('install caches the shell without forcing activation', async () => {
  const { listeners, skipWaiting } = worker()
  let work: Promise<void> | undefined
  listeners.get('install')!({ waitUntil: (promise: Promise<void>) => { work = promise } })
  await work
  expect(skipWaiting).not.toHaveBeenCalled()
})
it('only an explicit activation message skips waiting', () => {
  const { listeners, skipWaiting } = worker()
  listeners.get('message')!({ data: { type: 'UNRELATED' } })
  expect(skipWaiting).not.toHaveBeenCalled()
  listeners.get('message')!({ data: { type: 'PG95_ACTIVATE_UPDATE' } })
  expect(skipWaiting).toHaveBeenCalledTimes(1)
})
it('activation removes only old PG95 shell caches', async () => {
  const { listeners, remove } = worker()
  let work: Promise<void> | undefined
  listeners.get('activate')!({ waitUntil: (promise: Promise<void>) => { work = promise } })
  await work
  expect(remove.mock.calls).toEqual([['pg95-shell-v8']])
})
it('does not intercept Supabase or non-GET requests', () => {
  const { listeners } = worker()
  const respondWith = vi.fn()
  listeners.get('fetch')!({ request: { method: 'GET', url: 'https://example.supabase.co/rest/v1/tenants' }, respondWith })
  listeners.get('fetch')!({ request: { method: 'POST', url: 'https://pg95.example/payment' }, respondWith })
  expect(respondWith).not.toHaveBeenCalled()
})
