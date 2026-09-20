import { createClient } from '@supabase/supabase-js'
import { readTimeoutMs, shouldTimeoutRequest } from './requestPolicy'

const configuredUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(configuredUrl && anonKey)
const projectUrl = configuredUrl ? new URL(configuredUrl).origin : 'https://placeholder.supabase.co'

function anySignal(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

const fetchWithReadTimeout: typeof globalThis.fetch = (input, init) => {
  // Aborting a mutation can hide a successful server commit. Let mutation
  // requests finish and rely on their idempotency keys for safe retries.
  if (!shouldTimeoutRequest(input, init)) return globalThis.fetch(input, init)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), readTimeoutMs())
  const combined = init?.signal ? anySignal(init.signal, controller.signal) : controller.signal
  return globalThis.fetch(input, { ...init, signal: combined }).finally(() => clearTimeout(timeout))
}

export const supabase = createClient(projectUrl, anonKey || 'placeholder', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: fetchWithReadTimeout },
})
