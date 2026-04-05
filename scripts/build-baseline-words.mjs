/**
 * Bake project-root words.txt (Duolingo-style export) → public/data/baseline-vocab.json
 * Same shape as parseDuolingoFormat output so the app can import without paste.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseDuolingoFormat } from '../src/lib/wordParser.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const srcPath = path.join(root, 'words.txt')
const outDir = path.join(root, 'public', 'data')
const outPath = path.join(outDir, 'baseline-vocab.json')

function main() {
  fs.mkdirSync(outDir, { recursive: true })
  if (!fs.existsSync(srcPath)) {
    const empty = {
      version: 1,
      count: 0,
      entries: [],
      note: 'No words.txt in project root. Commit words.txt and run npm run build:baseline (or full build).',
    }
    fs.writeFileSync(outPath, JSON.stringify(empty), 'utf8')
    console.warn('[baseline] words.txt not found → wrote empty baseline-vocab.json')
    return
  }
  const raw = fs.readFileSync(srcPath, 'utf8')
  const entries = parseDuolingoFormat(raw)
  fs.writeFileSync(
    outPath,
    JSON.stringify({
      version: 1,
      count: entries.length,
      sourceFile: 'words.txt',
      entries,
    }),
    'utf8'
  )
  console.log('[baseline] Wrote', entries.length, 'parsed entries →', outPath)
}

main()
