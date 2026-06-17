import { createClient } from '@supabase/supabase-js'

let clientSingleton = null

function readEnv() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  return { url: url?.trim?.() || '', anon: anon?.trim?.() || '' }
}

/** True when URL + anon key are set (build-time env in Vite). */
export function isSupabaseConfigured() {
  const { url, anon } = readEnv()
  return Boolean(url && anon && url.startsWith('http'))
}

/** Shared Supabase browser client; null if not configured. */
export function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null
  if (clientSingleton) return clientSingleton
  const { url, anon } = readEnv()
  clientSingleton = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'dr-supabase-auth',
    },
  })
  return clientSingleton
}
