/**
 * Rough review-load hint (research: new cards create a wave of reviews).
 * Not a precise FSRS forecast — good enough to avoid surprise overload.
 */
export function estimateWeeklyReviewLoad({ dueCount = 0, newCardsPerDay = 15 }) {
  const n = Math.max(0, Number(newCardsPerDay) || 0)
  const d = Math.max(0, Number(dueCount) || 0)
  const fromNewWeek = n * 7
  const low = d + Math.round(fromNewWeek * 0.35)
  const high = d + Math.round(fromNewWeek * 1.1)
  return {
    low,
    high,
    summary: `Roughly ${low.toLocaleString()}–${high.toLocaleString()} card reviews in the next 7 days if you introduce ~${n} new cards/day and clear dues.`,
  }
}
