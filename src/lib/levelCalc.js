// CEFR bands keyed to firm FSRS mastery (stable + enough reviews — see getMasteredWordCount / isFirmMasteredRow)
const LEVEL_THRESHOLDS = [
  { min: 0,      max: 499,    level: 'A1',  label: 'Beginner',           color: '#ef4444' },
  { min: 500,    max: 1199,   level: 'A2',  label: 'Elementary',         color: '#f97316' },
  { min: 1200,   max: 2499,   level: 'B1',  label: 'Intermediate',       color: '#eab308' },
  { min: 2500,   max: 3999,   level: 'B1+', label: 'Upper-Intermediate', color: '#84cc16' },
  { min: 4000,   max: 5499,   level: 'B2',  label: 'Advanced',           color: '#22c55e' },
  { min: 5500,   max: 999999, level: 'C1',  label: 'Proficient',         color: '#06b6d4' },
]

const B2_MASTERED_MIN = 4000

export function getLevel(masteredWordCount) {
  const n = Math.max(0, masteredWordCount)
  return (
    LEVEL_THRESHOLDS.find(t => n >= t.min && n <= t.max) ||
    LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1]
  )
}

export function getProgressToNextLevel(masteredWordCount) {
  const current = getLevel(masteredWordCount)
  const range = current.max - current.min
  if (range <= 0) return 100
  const progress = masteredWordCount - current.min
  return Math.min(100, Math.round((progress / range) * 100))
}

export function getNextLevel(masteredWordCount) {
  const current = getLevel(masteredWordCount)
  const idx = LEVEL_THRESHOLDS.findIndex(t => t.level === current.level)
  return LEVEL_THRESHOLDS[idx + 1] || null
}

export function getWordsNeededForB2(masteredWordCount) {
  return Math.max(0, B2_MASTERED_MIN - Math.max(0, masteredWordCount))
}

export function getDailyTargetWords(masteredWordCount, daysRemaining = 210) {
  const needed = getWordsNeededForB2(masteredWordCount)
  return Math.ceil(needed / daysRemaining)
}

export function getB2TargetDate() {
  const startDate = localStorage.getItem('dr_start_date')
  if (!startDate) {
    const d = new Date()
    d.setMonth(d.getMonth() + 7)
    return d
  }
  const d = new Date(startDate)
  d.setMonth(d.getMonth() + 7)
  return d
}

export function getDaysRemaining() {
  const target = getB2TargetDate()
  const now = new Date()
  const diff = target - now
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

/** Story / content difficulty from imported vocabulary size (not SRS mastery). */
export function getSuggestedStoryLevelFromExposure(totalWords) {
  const n = Math.max(0, totalWords)
  if (n < 400) return 'A1-A2'
  if (n < 1000) return 'A2-B1'
  return 'B1-B2'
}
