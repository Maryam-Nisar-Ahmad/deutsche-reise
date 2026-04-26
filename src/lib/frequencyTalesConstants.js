/** User-selectable batch sizes for queued frequency targets (pending words may be fewer). */
export const FREQ_TALES_TARGET_OPTIONS = [10, 20, 30, 40]

export const FREQ_TALES_DEFAULT_TARGET_COUNT = 10

export const STORY_TYPE_FREQUENCY_TALES = 'frequency_tales'

const LS_KEY = 'dr_freq_tales_target_goal'

/** Read last-used goal from localStorage (falls back to default). */
export function loadSavedFrequencyTaleGoal() {
  try {
    const v = Number.parseInt(localStorage.getItem(LS_KEY), 10)
    if (FREQ_TALES_TARGET_OPTIONS.includes(v)) return v
  } catch {}
  return FREQ_TALES_DEFAULT_TARGET_COUNT
}

export function persistFrequencyTaleGoal(goal) {
  try {
    if (FREQ_TALES_TARGET_OPTIONS.includes(goal)) {
      localStorage.setItem(LS_KEY, String(goal))
    }
  } catch {}
}

/**
 * Chapter count for frequency tales.
 * Large batches used to map 1 chapter ≈ 1 lemma (40 tiny chapters); models then wrote ultra-short chapters.
 * We prefer fewer, richer chapters (~3–5 targets each) so each beat has enough room for A1 prose.
 */
export function chaptersForFrequencyTargets(actualTargetCount) {
  const n = Math.max(1, Math.floor(Number(actualTargetCount) || 1))
  if (n <= 8) return n
  // ~4 targets per chapter on average; cap so prompt stays coherent for the LLM
  const grouped = Math.ceil(n / 4)
  return Math.min(14, Math.max(4, grouped))
}

/** @deprecated use FREQ_TALES_DEFAULT_TARGET_COUNT */
export const FREQ_TALES_TARGET_COUNT = FREQ_TALES_DEFAULT_TARGET_COUNT
/** @deprecated chapters now equal actual batch size */
export const FREQ_TALES_CHAPTER_COUNT = FREQ_TALES_DEFAULT_TARGET_COUNT
