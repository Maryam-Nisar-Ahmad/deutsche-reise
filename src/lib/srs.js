/**
 * Full FSRS scheduling via ts-fsrs (FSRS-6 parameters, same family as Anki 23+).
 * @see https://github.com/open-spaced-repetition/ts-fsrs
 */
import {
  fsrs,
  createEmptyCard,
  Rating,
  State,
  TypeConvert,
  forgetting_curve,
  generatorParameters,
} from 'ts-fsrs'

/** Minimum stability (days) + reps to count as “firm” mastery for CEFR / B2 progress. */
export const FIRM_MASTERY_MIN_STABILITY = 5
export const FIRM_MASTERY_MIN_REPS = 2

export function readRetentionTarget() {
  const t = parseFloat(
    typeof localStorage !== 'undefined' ? localStorage.getItem('dr_target_retention') || '0.9' : '0.9'
  )
  if (Number.isFinite(t) && t >= 0.8 && t <= 0.97) return t
  return 0.9
}

export function createFsrsScheduler(requestRetention = readRetentionTarget()) {
  return fsrs({
    request_retention: requestRetention,
    maximum_interval: 36500,
    enable_fuzz: true,
    enable_short_term: true,
  })
}

function dbStateToFsrs(state) {
  switch (state) {
    case 'learning':
      return State.Learning
    case 'review':
      return State.Review
    case 'relearning':
      return State.Relearning
    case 'new':
    default:
      return State.New
  }
}

function fsrsStateToDb(state) {
  const names = ['new', 'learning', 'review', 'relearning']
  return names[state] ?? 'new'
}

/**
 * Build an FSRS card from an IndexedDB srs_cards row.
 * New cards always use createEmptyCard so stale stability from legacy data does not apply.
 */
export function dbRowToFsrsCard(dbCard) {
  const now = new Date()
  if (dbCard.state === 'new') {
    return createEmptyCard(now)
  }
  const input = {
    due: new Date(dbCard.nextReview ?? Date.now()),
    stability: Math.max(0.001, Number(dbCard.stability) || 0.001),
    difficulty: Math.min(10, Math.max(1, Number(dbCard.difficulty) || 5)),
    scheduled_days: Number(dbCard.scheduledDays ?? dbCard.interval) || 0,
    learning_steps: Number(dbCard.learningSteps) || 0,
    reps: Number(dbCard.repetitions) || 0,
    lapses: Number(dbCard.lapses) || 0,
    state: dbStateToFsrs(dbCard.state),
    last_review: dbCard.lastReview != null ? new Date(dbCard.lastReview) : undefined,
  }
  return TypeConvert.card(input)
}

function fsrsCardToDbRow(fsrsCard, prevRow, nowMs) {
  return {
    ...prevRow,
    nextReview: fsrsCard.due.getTime(),
    lastReview: fsrsCard.last_review ? fsrsCard.last_review.getTime() : nowMs,
    stability: fsrsCard.stability,
    difficulty: fsrsCard.difficulty,
    interval: Math.max(0, fsrsCard.scheduled_days),
    scheduledDays: fsrsCard.scheduled_days,
    learningSteps: fsrsCard.learning_steps,
    repetitions: fsrsCard.reps,
    lapses: fsrsCard.lapses,
    state: fsrsStateToDb(fsrsCard.state),
    totalReviews: (prevRow.totalReviews || 0) + 1,
    easeFactor: prevRow.easeFactor || 2.5,
  }
}

/**
 * Apply a rating (1–4) to a DB SRS row using FSRS.
 * @param {object} card — srs_cards row (may include nested `word` from UI; ignored)
 * @param {1|2|3|4} rating
 * @param {{ retentionTarget?: number }} [options]
 */
export function updateCard(card, rating, options = {}) {
  const nowMs = Date.now()
  const now = new Date(nowMs)
  const target = typeof options.retentionTarget === 'number' ? options.retentionTarget : readRetentionTarget()
  const scheduler = createFsrsScheduler(target)

  const row = { ...card }
  delete row.word
  delete row.flashExamples
  delete row._sessionStartedAsNew

  const fsrsCard = dbRowToFsrsCard(row)
  const grade = rating
  const { card: next } = scheduler.next(fsrsCard, now, grade)
  return fsrsCardToDbRow(next, row, nowMs)
}

function formatDuePreview(dueDate) {
  const ms = dueDate.getTime() - Date.now()
  if (ms <= 0) return 'Now'
  const mins = Math.ceil(ms / 60000)
  if (mins < 90) return `${mins} min`
  const hrs = Math.ceil(ms / 3600000)
  if (hrs < 48) return `${hrs} h`
  const days = Math.max(1, Math.round(ms / 86400000))
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`
  if (days < 365) return `${Math.round(days / 30)} mo`
  return `${Math.round(days / 365)} yr`
}

export function getIntervalPreview(card, rating, options = {}) {
  const target = typeof options.retentionTarget === 'number' ? options.retentionTarget : readRetentionTarget()
  const scheduler = createFsrsScheduler(target)
  const row = { ...card }
  delete row.word
  delete row.flashExamples
  delete row._sessionStartedAsNew

  const fsrsCard = dbRowToFsrsCard(row)
  const previews = scheduler.repeat(fsrsCard, new Date())
  const item = previews[rating] ?? previews[String(rating)]
  if (!item?.card?.due) return '—'
  if (rating === 1 && item.log?.scheduled_days != null && item.log.scheduled_days >= 1) {
    return `Again (${formatDuePreview(item.card.due)})`
  }
  return formatDuePreview(item.card.due)
}

/**
 * Estimated retrievability (0–100%) from FSRS forgetting curve using current parameters.
 */
export function estimateRetention(card) {
  if (card.lastReview == null || card.stability == null) return 0
  const elapsed_days = (Date.now() - card.lastReview) / 86400000
  if (elapsed_days < 0) return 100
  const params = generatorParameters({ request_retention: readRetentionTarget() })
  const r = forgetting_curve(params.w, elapsed_days, Math.max(0.001, card.stability))
  return Math.round(Math.max(0, Math.min(1, r)) * 1000) / 10
}

export function getNextReviewTimestamp(intervalDays) {
  const now = new Date()
  now.setDate(now.getDate() + intervalDays)
  now.setHours(4, 0, 0, 0)
  return now.getTime()
}

export function isDue(card) {
  return card.nextReview <= Date.now()
}

/** True if this row counts as firm vocabulary mastery for level / B2 planning. */
export function isFirmMasteredRow(c) {
  return (
    c &&
    c.state === 'review' &&
    (c.stability ?? 0) >= FIRM_MASTERY_MIN_STABILITY &&
    (c.repetitions ?? 0) >= FIRM_MASTERY_MIN_REPS
  )
}
