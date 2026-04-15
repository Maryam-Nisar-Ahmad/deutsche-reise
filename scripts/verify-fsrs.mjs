/**
 * Regression checks for FSRS integration + firm mastery rules (Node, no browser).
 * Run: npm run verify
 */
import { updateCard, isFirmMasteredRow, estimateRetention, FIRM_MASTERY_MIN_STABILITY } from '../src/lib/srs.js'

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) {
    return this._m.has(k) ? this._m.get(k) : null
  },
  setItem(k, v) {
    this._m.set(k, String(v))
  },
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

const DAY = 86400000

function freshNewCard() {
  return {
    wordId: 1,
    state: 'new',
    stability: 0,
    difficulty: 5,
    interval: 0,
    scheduledDays: 0,
    learningSteps: 0,
    repetitions: 0,
    lapses: 0,
    lastReview: null,
    nextReview: Date.now(),
    totalReviews: 0,
    easeFactor: 2.5,
  }
}

let c = updateCard(freshNewCard(), 3, { retentionTarget: 0.9 })
assert(c.state === 'learning', `first Good → learning, got ${c.state}`)

c = updateCard(c, 3, { retentionTarget: 0.9 })
assert(c.state === 'review', `second Good → review, got ${c.state}`)
assert(!isFirmMasteredRow(c), 'early review card must not count as firm mastered')

let guard = 0
while (!isFirmMasteredRow(c) && guard < 24) {
  guard++
  const elapsed = Math.max(DAY, (c.interval || 1) * DAY)
  const synthetic = {
    ...c,
    lastReview: Date.now() - elapsed,
    nextReview: Date.now() - 1000,
  }
  c = updateCard(synthetic, 3, { retentionTarget: 0.9 })
}
assert(isFirmMasteredRow(c), `firm mastery not reached in ${guard} steps`)
assert(c.stability >= FIRM_MASTERY_MIN_STABILITY, 'stability threshold')

const again = updateCard(freshNewCard(), 1, { retentionTarget: 0.9 })
assert(['learning', 'relearning'].includes(again.state), `Again on new → learning/relearning, got ${again.state}`)

const ret = estimateRetention({
  lastReview: Date.now() - DAY,
  stability: 5,
  interval: 5,
})
assert(ret > 0 && ret <= 100, `estimateRetention 0-100, got ${ret}`)

console.log('[verify-fsrs] OK — FSRS paths, firm mastery, retention estimate')
