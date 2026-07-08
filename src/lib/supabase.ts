import { createClient } from '@supabase/supabase-js'

const configuredUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(configuredUrl && anonKey)
const projectUrl = configuredUrl ? new URL(configuredUrl).origin : 'https://placeholder.supabase.co'

const SAVE_TIMEOUT_MS = 30_000

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

const fetchWithTimeout: typeof globalThis.fetch = (input, init) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS)
  const combined = init?.signal ? anySignal(init.signal, controller.signal) : controller.signal
  return globalThis.fetch(input, { ...init, signal: combined }).finally(() => clearTimeout(timeout))
}

export const supabase = createClient(projectUrl, anonKey || 'placeholder', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: fetchWithTimeout },
})
