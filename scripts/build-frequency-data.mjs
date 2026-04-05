/**
 * One-time / CI: parse Anki-exported 5009 list → public/data/frequency-vocab.json
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const srcPath = path.join(root, '5009 most frequent German Vocabulary.txt')
const outDir = path.join(root, 'public', 'data')
const outPath = path.join(outDir, 'frequency-vocab.json')

function extractRank(detail) {
  const m = String(detail || '').match(/^\s*"?\s*(\d+)\s+/)
  return m ? parseInt(m[1], 10) : null
}

function parseFile(raw) {
  const lines = raw.split(/\r?\n/)
  const rows = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim() || line.startsWith('#')) {
      i++
      continue
    }
    const tabIdx = line.indexOf('\t')
    if (tabIdx < 0) {
      i++
      continue
    }
    const headword = line.slice(0, tabIdx).trim()
    let detail = line.slice(tabIdx + 1)

    if (detail.startsWith('"')) {
      detail = detail.slice(1)
      while (!detail.endsWith('"') && i + 1 < lines.length) {
        i++
        detail += '\n' + lines[i]
      }
      if (detail.endsWith('"')) detail = detail.slice(0, -1)
    }

    const rank = extractRank(detail)
    if (headword && rank != null) {
      rows.push({
        rank,
        headword,
        detail: detail.trim(),
      })
    }
    i++
  }

  rows.sort((a, b) => a.rank - b.rank)
  return rows
}

function main() {
  if (!fs.existsSync(srcPath)) {
    console.error('Missing source file:', srcPath)
    process.exit(1)
  }
  const raw = fs.readFileSync(srcPath, 'utf8')
  const entries = parseFile(raw)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify({ version: 1, count: entries.length, entries }), 'utf8')
  console.log('Wrote', entries.length, 'entries →', outPath)
}

main()
