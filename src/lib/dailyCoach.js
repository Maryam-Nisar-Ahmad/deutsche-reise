import {
  initDB,
  getAllWords,
  getDailySessionByDate,
  getJourneyHistorySessions,
  getTotalTrackedMinutesToday,
  getSessionStudyBreakdown,
  getCardStats,
  getLocalCalendarYmd,
} from './db.js'
import { callDeepSeek } from './deepseek.js'
import { estimateWeeklyReviewLoad } from './reviewLoad.js'
import sampleResearchText from '../data/research.sample.txt?raw'

// Private research doc (gitignored) if present, else the public sample above.
// import.meta.glob (not a static import) so a missing file doesn't break the build.
const _privateResearch = import.meta.glob('../data/research.private.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const researchFullText = Object.values(_privateResearch)[0] || sampleResearchText

export { getLocalCalendarYmd }

export function getLocalYesterdayYmd() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return getLocalCalendarYmd(d)
}

function localYmdFromAddedAt(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return null
  return getLocalCalendarYmd(new Date(n))
}

function chunkResearchByParagraphs(text) {
  const raw = String(text || '')
  const parts = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 8) return parts
  const chunkSize = 1400
  const out = []
  for (let i = 0; i < raw.length; i += chunkSize) {
    out.push(raw.slice(i, i + chunkSize).trim())
  }
  return out.filter(Boolean)
}

function scoreChunkAgainstQuery(chunk, query) {
  const c = chunk.toLowerCase()
  const tokens = String(query || '')
    .toLowerCase()
    .split(/[^a-zäöüß0-9]+/i)
    .filter((t) => t.length >= 4)
  const uniq = [...new Set(tokens)]
  let score = 0
  for (const t of uniq) {
    if (!t) continue
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const m = c.match(re)
    if (m) score += m.length
  }
  const bonus = ['fsrs', 'srs', 'krashen', 'comprehensible', 'shadow', 'immersion', 'spaced', 'retention', 'b2', 'vocabulary', 'grammar', 'input', 'output'].filter((k) => c.includes(k))
  score += bonus.length * 3
  return score
}

/**
 * Picks the most relevant paragraphs from the bundled research doc (RAG-lite, no embeddings).
 */
export function selectResearchSnippets(snapshotJson, maxChars = 9000) {
  const query = `${snapshotJson} spaced repetition comprehensible input shadowing immersion passive FSRS retention vocabulary grammar output Krashen i+1 B2 listening reading fluency affective`
  const chunks = chunkResearchByParagraphs(researchFullText)
  const scored = chunks
    .map((text, i) => ({ i, text, s: scoreChunkAgainstQuery(text, query) }))
    .sort((a, b) => b.s - a.s)
  const picked = []
  let n = 0
  for (const row of scored) {
    if (n + row.text.length + 2 > maxChars) break
    picked.push(row.text)
    n += row.text.length + 2
  }
  return picked.join('\n\n---\n\n')
}

function hashSnapshot(obj) {
  const s = JSON.stringify(obj)
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i)
  }
  return (h >>> 0).toString(36)
}

/** What we send the model vs blind spots — keeps the coach honest. */
export function buildDataCoverageCatalog() {
  return {
    reflectedInSnapshot: [
      'Per-day session row for yesterday (see yesterday.*): SRS reviews, new words studied, passive minutes you logged, story chapter advances, grammar exercise count, shadow minutes, Frequency Tales engaged time and chapters, words added that calendar day, Speak & Write submission count, Frequency Lab words marked learned, minutes from completed flashcard queues.',
      'Study trail breakdown (minutes by screen: flashcards, Frequency Lab, Frequency Tales, Story Studio, shadow, grammar, speak, vocab, dashboard, other).',
      'Seven- and thirty-day aggregates from stored daily_sessions plus word-add events.',
      'Goals you pass in from the dashboard (phase, word estimates, due cards, settings mirrors).',
    ],
    weaklyTrackedOrMissing: [
      'All German exposure outside this app (other courses, tutors, media, conversations) unless you describe it elsewhere.',
      'Speaking quality, accent, and real conversational fluency — not assessed here.',
      'Time on Settings (and some rare routes) is folded into Dashboard / Other engaged buckets.',
      'Manual study timers only count if you use Stop & Save on those pages.',
      'Whether you skimmed vs deeply processed input; deck ease; FSRS intervals are not sent in full (only summary stats like due count).',
    ],
  }
}

/**
 * Wide illustrative band for “high B2 speaking” — NOT a exam prediction (no speaking test in app).
 * Uses vocabulary growth rate + output volume as weak signals.
 */
export function buildB2SpeakingTrajectoryPreview({
  wordFamiliesApprox,
  sum30,
  last30DayCount,
  sum7Aggregate,
}) {
  const ILLUSTRATIVE_LEXICON_CEILING = 4800
  const wordsApprox = Math.max(0, Math.floor(Number(wordFamiliesApprox) || 0))
  const gapWords = Math.max(0, ILLUSTRATIVE_LEXICON_CEILING - wordsApprox)
  const daysWindow = Math.max(1, Math.floor(Number(last30DayCount) || 1))
  const npm = (sum30?.newWords || 0) / daysWindow

  let monthsLexiconOnly = null
  if (npm > 0.03 && gapWords > 0) {
    monthsLexiconOnly = gapWords / (npm * 30)
  }

  const prod7 = Math.max(0, Math.floor(Number(sum7Aggregate?.productionSubmissions) || 0))
  const gramm7 = Math.max(0, Math.floor(Number(sum7Aggregate?.grammarExercises) || 0))
  const outputStretch = prod7 < 2 && gramm7 < 2 ? 1.85 : prod7 < 5 ? 1.35 : 1.12

  let range = null
  let atLexiconCeiling = false
  if (wordsApprox >= ILLUSTRATIVE_LEXICON_CEILING * 0.92) {
    atLexiconCeiling = true
    range = {
      lowMonths: 6,
      midMonths: 24,
      highMonths: 96,
      note:
        'Word-count proxy is already near the illustrative ceiling; remaining distance to strong B2 speaking is mostly output, tutoring, and real conversation — uncertainty is very high.',
    }
  } else if (monthsLexiconOnly != null && Number.isFinite(monthsLexiconOnly)) {
    const mid = monthsLexiconOnly * outputStretch
    range = {
      lowMonths: Math.max(8, Math.round(mid * 0.5)),
      midMonths: Math.round(mid),
      highMonths: Math.min(120, Math.round(mid * 2.6)),
    }
  }

  let whenInsufficientData = null
  if (!range && npm <= 0.03) {
    whenInsufficientData =
      'Not enough vocabulary adds in the last ~30 calendar days to infer pace (need steadier new words/day).'
  }

  return {
    disclaimer:
      'Illustrative band only. “High B2 speaking” needs real interaction, feedback, and exam-style tasks — not measurable from this app alone. Treat as a thought experiment from your in-app pace, not a timeline guarantee.',
    assumptions: {
      illustrativeLexiconCeilingWords: ILLUSTRATIVE_LEXICON_CEILING,
      note: 'Vocabulary size is only one input to spoken proficiency; band widens automatically when Speak/Grammar volume is low.',
      wordsInVaultApprox: wordsApprox,
      illustrativeGapWordsVsCeiling: gapWords,
      avgNewWordsAddedPerCalendarDayLast30Window: Math.round(npm * 100) / 100,
      daysInLast30Window: daysWindow,
      atIllustrativeLexiconCeiling: atLexiconCeiling,
    },
    outputSignalsLast7Days: {
      speakAndWriteSubmissionsTotal: prod7,
      grammarExercisesTotal: gramm7,
    },
    estimatedMonthsRangeHighB2SpeakingIllustrative: range,
    whenInsufficientData,
  }
}

/**
 * Builds a factual JSON for the coach: yesterday-first, 7-day window for context, week/month outlook inputs.
 */
export async function buildDailyCoachSnapshot(context = {}) {
  await initDB()
  const yesterdayYmd = context.yesterdayYmd || getLocalYesterdayYmd()
  const [yesterdaySession, journey, allWords, cardStats] = await Promise.all([
    getDailySessionByDate(yesterdayYmd),
    getJourneyHistorySessions(),
    getAllWords(),
    getCardStats(),
  ])

  const journeySorted = [...(journey || [])].sort((a, b) => a.date.localeCompare(b.date))
  const last7 = journeySorted.filter((d) => d.date <= yesterdayYmd).slice(-7)
  const last30 = journeySorted.filter((d) => d.date <= yesterdayYmd).slice(-30)

  const wordsYesterday = allWords
    .filter((w) => localYmdFromAddedAt(w.addedAt) === yesterdayYmd)
    .map((w) => ({
      german: (w.german || '').trim(),
      translation: (w.translation || '').trim(),
      source: w.source || w.learnSource || '',
      frequencyRank: w.frequencyRank ?? null,
      frequencyTier: w.frequencyTier ?? null,
    }))
    .filter((w) => w.german)

  const yMin = getTotalTrackedMinutesToday(yesterdaySession)
  const yBreak = getSessionStudyBreakdown(yesterdaySession)

  const freqTalesSec = Number(yesterdaySession?.frequencyTalesEngagedSeconds) || 0
  const freqTalesEngagedMin = Math.round((freqTalesSec / 60) * 10) / 10

  const last7Compact = last7.map((d) => ({
    date: d.date,
    minutes: getTotalTrackedMinutesToday(d),
    xp: d.xpEarned || 0,
    flashcardsReviewed: d.flashcardsReviewed || 0,
    newWordsAdded: d.newWordsAdded ?? 0,
    passiveMinutes: d.passiveMinutes || 0,
    productionSubmissions: d.productionSubmissions || 0,
    frequencyWordsLearned: d.frequencyWordsLearned || 0,
    grammarExercises: d.grammarExercises || 0,
    storiesRead: d.storiesRead || 0,
    frequencyTalesChaptersRead: d.frequencyTalesChaptersRead || 0,
  }))

  const sum7 = {
    minutes: last7Compact.reduce((a, r) => a + r.minutes, 0),
    xp: last7Compact.reduce((a, r) => a + r.xp, 0),
    flashcards: last7Compact.reduce((a, r) => a + r.flashcardsReviewed, 0),
    newWords: last7Compact.reduce((a, r) => a + r.newWordsAdded, 0),
    passive: last7Compact.reduce((a, r) => a + r.passiveMinutes, 0),
    productionSubmissions: last7Compact.reduce((a, r) => a + r.productionSubmissions, 0),
    frequencyWordsLearned: last7Compact.reduce((a, r) => a + r.frequencyWordsLearned, 0),
    grammarExercises: last7Compact.reduce((a, r) => a + r.grammarExercises, 0),
    frequencyTalesChaptersRead: last7Compact.reduce((a, r) => a + r.frequencyTalesChaptersRead, 0),
  }

  const last30Compact = last30.map((d) => ({
    date: d.date,
    minutes: getTotalTrackedMinutesToday(d),
    newWordsAdded: d.newWordsAdded ?? 0,
    productionSubmissions: d.productionSubmissions || 0,
    frequencyWordsLearned: d.frequencyWordsLearned || 0,
  }))
  const sum30 = {
    minutes: last30Compact.reduce((a, r) => a + r.minutes, 0),
    newWords: last30Compact.reduce((a, r) => a + r.newWordsAdded, 0),
    productionSubmissions: last30Compact.reduce((a, r) => a + r.productionSubmissions, 0),
    frequencyWordsLearned: last30Compact.reduce((a, r) => a + r.frequencyWordsLearned, 0),
  }

  const reviewOutlook = estimateWeeklyReviewLoad({
    dueCount: cardStats?.due ?? 0,
    newCardsPerDay: context.newCardsPerDay ?? 15,
  })

  const trajectoryPreview = buildB2SpeakingTrajectoryPreview({
    wordFamiliesApprox: context.wordCount ?? 0,
    sum30,
    last30DayCount: last30.length,
    sum7Aggregate: sum7,
  })

  const snapshot = {
    coachVersion: 2,
    yesterdayYmd,
    yesterday: {
      date: yesterdayYmd,
      minutesEngaged: yMin,
      studyBreakdown: yBreak,
      xpEarned: yesterdaySession?.xpEarned || 0,
      flashcardsReviewed: yesterdaySession?.flashcardsReviewed || 0,
      newWordsLearned: yesterdaySession?.newWordsLearned || 0,
      passiveMinutes: yesterdaySession?.passiveMinutes || 0,
      newWordsAddedCount: yesterdaySession?.newWordsAdded ?? 0,
      storiesRead: yesterdaySession?.storiesRead || 0,
      grammarExercises: yesterdaySession?.grammarExercises || 0,
      shadowingMinutesRecorded: Math.max(
        yesterdaySession?.storyShadowMinutes || 0,
        yesterdaySession?.shadowingMinutes || 0
      ),
      /** Words marked learned from Frequency Lab yesterday. */
      frequencyWordsLearned: yesterdaySession?.frequencyWordsLearned || 0,
      /** Speak & Write submissions logged yesterday. */
      productionSubmissions: yesterdaySession?.productionSubmissions || 0,
      /** Minutes appended when you finish a flashcard queue session. */
      flashcardQueueMinutesLogged: yesterdaySession?.minutesStudied || 0,
      frequencyTales: {
        engagedMinutesApprox: freqTalesEngagedMin,
        chaptersRead: yesterdaySession?.frequencyTalesChaptersRead || 0,
      },
    },
    wordsAddedYesterday: wordsYesterday.slice(0, 50),
    wordsAddedYesterdayTotal: wordsYesterday.length,
    last7Days: last7Compact,
    last7DaysAggregate: sum7,
    last30DaysAggregate: sum30,
    goals: {
      phase: context.phase ?? null,
      phaseName: context.phaseName ?? null,
      wordFamiliesApprox: context.wordCount ?? null,
      firmMastered: context.firmMastered ?? null,
      dueCardsApprox: cardStats?.due ?? null,
      dailyXPGoal: context.dailyXPGoal ?? null,
      newCardsPerDaySetting: context.newCardsPerDay ?? null,
      frequencyWordsPerDaySetting: context.frequencyWordsPerDay ?? null,
      grammarSessionsThisWeek: context.weekGrammarSessions ?? null,
    },
    trajectoryPreview,
    dataCoverage: buildDataCoverageCatalog(),
    outlook: {
      weeklyReviewLoadHint: reviewOutlook?.summary || '',
    },
  }

  snapshot.snapshotHash = hashSnapshot({
    y: snapshot.yesterday,
    w: snapshot.wordsAddedYesterday,
    l7: snapshot.last7Days,
    g: snapshot.goals,
    traj: snapshot.trajectoryPreview,
    dc: snapshot.dataCoverage,
  })

  return snapshot
}

const COACH_SYSTEM = `You are a read-only German learning coach for a single learner. You have NO tools and must NOT assume you can change settings, schedules, or data in the app. Never output JSON meant to be executed, never output code, never tell the user you updated anything.

Rules:
1) The main evaluation ("how did they do?") must be based ONLY on "yesterday" in the JSON. Be specific and reference numbers.
2) Use "last7Days" ONLY as context to interpret yesterday (trends, streak context, backlog drift). Do NOT grade the learner for the whole week as if it were a report card.
3) Include "Week outlook" and "Month outlook" sections as forward-looking PREVIEWS (rough estimates, clearly labeled as estimates). Use goals + outlook hints + aggregates. Do not pretend precision.
4) Ground advice in the RESEARCH EXCERPTS provided below. When you cite an idea from excerpts, briefly tie it to what you see in the data. If something is not supported by excerpts, say it is general study guidance, not from the document.
5) If "wordsAddedYesterday" is non-empty, add a short subsection: are these plausibly high-utility for reading (e.g. frequency rank/tier if present), duplicates, or niche? Keep it light; if list empty, skip the subsection.
6) If yesterday.frequencyTales has engagedMinutesApprox > 0 or chaptersRead > 0, acknowledge **Frequency Tales** explicitly (graded mini-novels from their frequency-queue targets). Reference those numbers; do NOT describe that time as Story Studio unless studyBreakdown also shows Story Studio separately.
7) Mentions yesterday.productionSubmissions (Speak & Write), yesterday.frequencyWordsLearned, and yesterday.flashcardQueueMinutesLogged when relevant — these were blind spots before; now they exist in JSON.
8) **trajectoryPreview** — In "### B2 speaking trajectory (illustrative)", restate trajectoryPreview.disclaimer verbatim in spirit. If estimatedMonthsRangeHighB2SpeakingIllustrative is present, give low/mid/high months as a **very wide** illustrative band (not a deadline). If whenInsufficientData or null range, explain what signal is missing (e.g. vocabulary growth too flat). Never claim exam certainty or exact calendar dates.
9) Tone: supportive, direct, no shame. Use clear headings and bullets.

Output markdown with EXACTLY these top-level headings in order:
### Yesterday review
(include Frequency Tales vs Story Studio when data distinguishes them)

### Week outlook (preview)
### Month outlook (preview)
### B2 speaking trajectory (illustrative)
### Words added yesterday (optional)
### Data the app cannot see (honesty check)
Use bullets from snapshot.dataCoverage.weaklyTrackedOrMissing (paraphrase ok). Keep it short.
### One focus for today`

export async function generateDailyCoachMarkdown(snapshot) {
  const snapStr = JSON.stringify(snapshot, null, 2)
  const excerpts = selectResearchSnippets(snapStr, 9500)
  const userPrompt = `LEARNER_SNAPSHOT_JSON:\n${snapStr}\n\nRESEARCH_EXCERPTS (from the learner's evidence-based plan document; use these to justify recommendations):\n${excerpts}`

  const text = await callDeepSeek(
    [{ role: 'user', content: userPrompt }],
    null,
    { systemPrompt: COACH_SYSTEM, temperature: 0.55, maxTokens: 3800 }
  )
  return typeof text === 'string' ? text : String(text)
}

const LS_KEY = 'dr_coach_cache_v1'

export function readCoachCache() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeCoachCache(payload) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(payload))
  } catch {
    /* ignore quota */
  }
}

export function clearCoachCache() {
  try {
    localStorage.removeItem(LS_KEY)
  } catch {
    /* ignore */
  }
}
