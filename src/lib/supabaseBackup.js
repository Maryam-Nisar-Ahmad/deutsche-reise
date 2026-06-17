import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'
import { exportFullBackup, initDB } from './db.js'

/** Table: versioned snapshots (see scripts/supabase-backup-schema.sql). */
export const SUPABASE_SNAPSHOTS_TABLE = 'dr_backup_snapshots'

const LAST_EXPORT_KEY = 'dr_supabase_last_export_at'
const LAST_ERROR_KEY = 'dr_supabase_last_error'

/** 24 hours in ms */
export const SUPABASE_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Max snapshots kept per user (oldest deleted after each new insert). */
export const MAX_SNAPSHOTS_PER_USER = 60

let backupChain = Promise.resolve()

function readLastExportIso() {
  try {
    return localStorage.getItem(LAST_EXPORT_KEY)
  } catch {
    return null
  }
}

function setLastExportIso(iso) {
  try {
    localStorage.setItem(LAST_EXPORT_KEY, iso)
  } catch { /* ignore */ }
}

function setLastError(message) {
  try {
    if (message) localStorage.setItem(LAST_ERROR_KEY, message)
    else localStorage.removeItem(LAST_ERROR_KEY)
  } catch { /* ignore */ }
}

export function getSupabaseBackupUiState() {
  let lastExportAt = null
  let lastError = null
  try {
    lastExportAt = localStorage.getItem(LAST_EXPORT_KEY)
    lastError = localStorage.getItem(LAST_ERROR_KEY)
  } catch { /* ignore */ }
  return { lastExportAt, lastError }
}

function isBackupDue() {
  const last = readLastExportIso()
  if (!last) return true
  const t = new Date(last).getTime()
  if (!Number.isFinite(t)) return true
  return Date.now() - t >= SUPABASE_BACKUP_INTERVAL_MS
}

export function summarizePayloadStats(payload) {
  const wordCount = Array.isArray(payload.words) ? payload.words.length : 0
  const srsCount = Array.isArray(payload.srs_cards) ? payload.srs_cards.length : 0
  const storyCount = Array.isArray(payload.stories) ? payload.stories.length : 0
  const total = wordCount + srsCount + storyCount
  return { wordCount, srsCount, storyCount, total }
}

/**
 * Avoid uploading an empty DB over existing history; avoid catastrophic wipes.
 */
async function evaluateSnapshotInsert(supabase, userId, stats) {
  const { count: existingCount, error: countErr } = await supabase
    .from(SUPABASE_SNAPSHOTS_TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (countErr) throw countErr
  const n = existingCount ?? 0

  if (stats.total === 0) {
    if (n === 0) return { insert: false, reason: 'empty_nothing_to_save' }
    return { insert: false, reason: 'empty_wipe_guard' }
  }

  return { insert: true }
}

async function pruneOldSnapshots(supabase, userId) {
  const { count, error: cErr } = await supabase
    .from(SUPABASE_SNAPSHOTS_TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (cErr || count == null || count <= MAX_SNAPSHOTS_PER_USER) return

  const excess = count - MAX_SNAPSHOTS_PER_USER
  const { data: oldest, error: oErr } = await supabase
    .from(SUPABASE_SNAPSHOTS_TABLE)
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(excess)

  if (oErr || !oldest?.length) return

  const ids = oldest.map((r) => r.id)
  await supabase.from(SUPABASE_SNAPSHOTS_TABLE).delete().in('id', ids)
}

/**
 * Upload new snapshot row (never replaces older snapshots).
 * Requires signed-in Supabase user (email auth — same account on all devices).
 */
export async function performFullBackupToSupabase(opts = {}) {
  const { force = false } = opts
  if (!isSupabaseConfigured()) {
    return { ok: false, skipped: true, reason: 'not_configured' }
  }
  if (!force && !isBackupDue()) {
    return { ok: true, skipped: true, reason: 'recent' }
  }

  const supabase = getSupabaseClient()
  if (!supabase) {
    return { ok: false, skipped: true, reason: 'not_configured' }
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    return { ok: false, skipped: true, reason: 'not_signed_in' }
  }

  await initDB()
  const payload = await exportFullBackup()
  const stats = summarizePayloadStats(payload)

  const decision = await evaluateSnapshotInsert(supabase, session.user.id, stats)
  if (!decision.insert) {
    return { ok: true, skipped: true, reason: decision.reason, stats }
  }

  const createdAt = new Date().toISOString()
  const { error } = await supabase.from(SUPABASE_SNAPSHOTS_TABLE).insert({
    user_id: session.user.id,
    payload,
    word_count: stats.wordCount,
    srs_count: stats.srsCount,
    story_count: stats.storyCount,
    created_at: createdAt,
  })

  if (error) {
    setLastError(error.message || String(error))
    throw error
  }

  await pruneOldSnapshots(supabase, session.user.id)

  setLastExportIso(createdAt)
  setLastError(null)
  return { ok: true, skipped: false, updatedAt: createdAt }
}

export function enqueueSupabaseBackup(task) {
  const run = backupChain.then(task, task)
  backupChain = run.catch(() => {})
  return run
}

export function maybeAutoBackupToSupabase() {
  if (!isSupabaseConfigured()) return Promise.resolve({ ok: false, skipped: true, reason: 'not_configured' })
  return enqueueSupabaseBackup(async () => {
    try {
      return await performFullBackupToSupabase({ force: false })
    } catch (e) {
      console.warn('[Supabase] Auto backup failed:', e)
      return { ok: false, skipped: false, error: e }
    }
  })
}

export function syncSupabaseBackupNow() {
  if (!isSupabaseConfigured()) {
    return Promise.resolve({ ok: false, skipped: true, reason: 'not_configured' })
  }
  return enqueueSupabaseBackup(() => performFullBackupToSupabase({ force: true }))
}

/** List snapshots for current session (metadata only). */
export async function listBackupSnapshots() {
  if (!isSupabaseConfigured()) throw new Error('Supabase is not configured.')
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error('Supabase is not configured.')

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) throw new Error('Sign in to load cloud backups.')

  const { data, error } = await supabase
    .from(SUPABASE_SNAPSHOTS_TABLE)
    .select('id, created_at, word_count, srs_count, story_count')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return data ?? []
}

/** Fetch full payload for restore (RLS ensures own rows only). */
export async function fetchSnapshotPayloadById(snapshotId) {
  if (!isSupabaseConfigured()) throw new Error('Supabase is not configured.')
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error('Supabase is not configured.')

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) throw new Error('Sign in to restore from cloud.')

  const { data, error } = await supabase
    .from(SUPABASE_SNAPSHOTS_TABLE)
    .select('payload, created_at')
    .eq('id', snapshotId)
    .single()

  if (error) throw error
  if (!data?.payload) throw new Error('Snapshot not found.')

  return {
    payload: data.payload,
    createdAt: data.created_at ?? null,
  }
}
