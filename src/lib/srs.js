// SM-2 Algorithm — Wozniak (1987)
// Rating 1 = "Forgot" → quality 0
// Rating 2 = "Hard"   → quality 3
// Rating 3 = "Good"   → quality 4
// Rating 4 = "Easy"   → quality 5

export function calculateNextInterval(card, quality) {
  let { easeFactor, interval, repetitions, lapses } = card

  if (quality < 3) {
    repetitions = 0
    interval = 1
    lapses = (lapses || 0) + 1
    easeFactor = Math.max(1.3, easeFactor - 0.2)
    return { interval, easeFactor, repetitions, lapses, state: 'relearning' }
  }

  if (repetitions === 0) {
    interval = 1
  } else if (repetitions === 1) {
    interval = 6
  } else {
    interval = Math.round(interval * easeFactor)
  }

  easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  easeFactor = Math.max(1.3, easeFactor)

  repetitions += 1

  const state = repetitions >= 3 ? 'review' : 'learning'
  return { interval, easeFactor, repetitions, lapses: lapses || 0, state }
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
  const qualityMap = { 1: 0, 2: 3, 3: 4, 4: 5 }
  const quality = qualityMap[rating] ?? 3
  const result = calculateNextInterval(card, quality)
  if (rating === 1) return 'Again (1 day)'
  if (result.interval === 1) return '1 day'
  if (result.interval < 30) return `${result.interval} days`
  if (result.interval < 365) return `${Math.round(result.interval / 30)} months`
  return `${Math.round(result.interval / 365)} years`
}
