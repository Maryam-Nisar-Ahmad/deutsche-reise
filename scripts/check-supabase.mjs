/**
 * Quick check: reads .env VITE_* vars and verifies API reachability.
 * Does not print secrets. Run: node scripts/check-supabase.mjs
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const envPath = path.join(root, '.env')

function loadEnvFile(filePath) {
  const out = {}
  if (!fs.existsSync(filePath)) return out
  const raw = fs.readFileSync(filePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function maskUrl(u) {
  try {
    const url = new URL(u)
    return `${url.protocol}//${url.host}/…`
  } catch {
    return '(invalid URL)'
  }
}

const env = loadEnvFile(envPath)
const url = env.VITE_SUPABASE_URL?.trim()
const anon = env.VITE_SUPABASE_ANON_KEY?.trim()

console.log(`Reading env from: ${envPath}`)
console.log(`VITE_SUPABASE_URL: ${url ? maskUrl(url) : '(missing)'}`)
console.log(`VITE_SUPABASE_ANON_KEY: ${anon ? `${anon.slice(0, 8)}… (${anon.length} chars)` : '(missing)'}`)

if (!url || !anon) {
  console.error('\nFAILED: Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env')
  process.exit(1)
}

const supabase = createClient(url, anon, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'dr-supabase-check-script',
  },
})

const { error: pingErr } = await supabase.auth.getSession()
if (pingErr) {
  console.error('\nFAILED: Auth service:', pingErr.message)
  process.exit(1)
}

console.log('\nOK: Supabase project reachable (auth session check).')

const { error: tblErr } = await supabase.from('dr_backup_snapshots').select('id').limit(1)

if (tblErr) {
  const msg = tblErr.message || String(tblErr)
  if (/does not exist|schema cache/i.test(msg)) {
    console.log('\nNOTE: Table dr_backup_snapshots missing — run scripts/supabase-backup-schema.sql in SQL Editor.')
  } else if (/jwt|permission|rls|not authorized/i.test(msg)) {
    console.log('\nOK: Table exists (RLS blocks unauthenticated select — expected). Sign in via email in the app.')
  } else {
    console.log('\nNOTE:', msg)
  }
} else {
  console.log('\nOK: dr_backup_snapshots responded (unexpected without JWT — check RLS).')
}

console.log('\nCloud backup in the app uses Email auth (same account on all devices).')
console.log('Connection check finished.')
process.exit(0)
