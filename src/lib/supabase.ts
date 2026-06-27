import { createClient } from '@supabase/supabase-js'

const configuredUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(configuredUrl && anonKey)
const projectUrl = configuredUrl ? new URL(configuredUrl).origin : 'https://placeholder.supabase.co'

export const supabase = createClient(projectUrl, anonKey || 'placeholder', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
