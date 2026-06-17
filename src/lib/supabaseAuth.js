import { getSupabaseClient } from './supabaseClient.js'

export async function getCloudSession() {
  const supabase = getSupabaseClient()
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export async function signOutCloud() {
  const supabase = getSupabaseClient()
  if (!supabase) return
  await supabase.auth.signOut()
}
