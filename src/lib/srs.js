// FSRS-lite constants
const DECAY = -0.5
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1

function retrievability(stability, daysSinceReview) {
  return Math.pow(1 + (FACTOR * daysSinceReview) / stability, DECAY)
}

function newStability(stability, r, rating, difficulty) {
  // rating: 1=Again, 2=Hard, 3=Good, 4=Easy
  const hardPenalty = rating === 2 ? 0.8 : 1
  const easyBonus = rating === 4 ? 1.3 : 1
  const d = typeof difficulty === 'number' ? difficulty : 5
  const difficultyScale = 1 + (5 - Math.min(10, Math.max(1, d))) * 0.04
  return stability * (
    Math.exp(0.4) * (11 - r * 10) *
    Math.pow(r, -0.7) * hardPenalty * easyBonus * difficultyScale
  )
}

/**
 * @param {{ retentionTarget?: number }} [options] retentionTarget 0.85–0.93 (default 0.9). Lower → shorter intervals.
 */
export function updateCard(card, rating, options = {}) {
  const now = Date.now()
  const currentStability = card.stability || 1
  const currentDifficulty = card.difficulty || 5
  const daysSince = card.lastReview ? (now - card.lastReview) / 86400000 : 0
  const target = typeof options.retentionTarget === 'number' ? options.retentionTarget : 0.9
  const retentionMultiplier = Math.max(0.65, Math.min(1.2, 0.9 / target))

  if (rating === 1) {
    return {
      ...card,
      stability: 1,
      difficulty: Math.min(currentDifficulty + 0.2, 10),
      state: 'relearning',
      lapses: (card.lapses || 0) + 1,
      interval: 1,
      nextReview: getNextReviewTimestamp(1),
      lastReview: now,
      totalReviews: (card.totalReviews || 0) + 1,
      repetitions: 0,
    }
  }

  const r = card.lastReview ? retrievability(currentStability, daysSince) : 0.9
  const rawNext = card.stability
    ? newStability(currentStability, r, rating, currentDifficulty)
    : [null, 1, 2, 4, 8][rating]

  const interval = Math.max(1, Math.round(rawNext * retentionMultiplier))

  return {
    ...card,
    stability: rawNext,
    difficulty: Math.max(1, Math.min(10, currentDifficulty + (3 - rating) * 0.1)),
    state: 'review',
    interval,
    nextReview: getNextReviewTimestamp(interval),
    lastReview: now,
    totalReviews: (card.totalReviews || 0) + 1,
    repetitions: (card.repetitions || 0) + 1,
    easeFactor: card.easeFactor || 2.5,
  }
}

export function getNextReviewTimestamp(interval) {
  const now = new Date()
  now.setDate(now.getDate() + interval)
  now.setHours(4, 0, 0, 0)
  return now.getTime()
}

export function isDue(card) {
  return card.nextReview <= Date.now()
}

/** Read learner retention target (0.8–0.97). Used for interval scaling. */
export function readRetentionTarget() {
  const t = parseFloat(
    typeof localStorage !== 'undefined' ? localStorage.getItem('dr_target_retention') || '0.9' : '0.9'
  )
  if (Number.isFinite(t) && t >= 0.8 && t <= 0.97) return t
  return 0.9
}

export function estimateRetention(card) {
  if (!card.lastReview) return 0
  const daysSinceReview = (Date.now() - card.lastReview) / (1000 * 60 * 60 * 24)
  return Math.exp(-daysSinceReview / (card.interval * 0.5)) * 100
}

export function getIntervalPreview(card, rating, options = {}) {
  const result = updateCard(card, rating, options)
  if (rating === 1) return 'Again (1 day)'
  if (result.interval === 1) return '1 day'
  if (result.interval < 30) return `${result.interval} days`
  if (result.interval < 365) return `${Math.round(result.interval / 30)} months`
  return `${Math.round(result.interval / 365)} years`
}
