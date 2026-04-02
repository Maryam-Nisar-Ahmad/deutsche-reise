// FSRS-lite constants
const DECAY = -0.5
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1

function retrievability(stability, daysSinceReview) {
  return Math.pow(1 + (FACTOR * daysSinceReview) / stability, DECAY)
}

function newStability(stability, r, rating) {
  // rating: 1=Again, 2=Hard, 3=Good, 4=Easy
  const hardPenalty = rating === 2 ? 0.8 : 1
  const easyBonus = rating === 4 ? 1.3 : 1
  return stability * (
    Math.exp(0.4) * (11 - r * 10) *
    Math.pow(r, -0.7) * hardPenalty * easyBonus
  )
}

export function updateCard(card, rating) {
  const now = Date.now()
  const currentStability = card.stability || 1
  const currentDifficulty = card.difficulty || 5
  const daysSince = card.lastReview ? (now - card.lastReview) / 86400000 : 0

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
  const nextStability = card.stability
    ? newStability(currentStability, r, rating)
    : [null, 1, 2, 4, 8][rating]

  const interval = Math.max(1, Math.round(nextStability))

  return {
    ...card,
    stability: nextStability,
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

export function estimateRetention(card) {
  if (!card.lastReview) return 0
  const daysSinceReview = (Date.now() - card.lastReview) / (1000 * 60 * 60 * 24)
  return Math.exp(-daysSinceReview / (card.interval * 0.5)) * 100
}

export function getIntervalPreview(card, rating) {
  const result = updateCard(card, rating)
  if (rating === 1) return 'Again (1 day)'
  if (result.interval === 1) return '1 day'
  if (result.interval < 30) return `${result.interval} days`
  if (result.interval < 365) return `${Math.round(result.interval / 30)} months`
  return `${Math.round(result.interval / 365)} years`
}
