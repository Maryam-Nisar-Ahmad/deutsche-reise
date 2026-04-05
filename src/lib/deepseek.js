const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
const MODEL = 'deepseek-chat'

function getApiKey() {
  return localStorage.getItem('dr_api_key') || ''
}

function shuffleArray(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function cleanMarkdown(text) {
  if (text == null || typeof text !== 'string') return ''
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/`(.*?)`/g, '$1')
    .trim()
}

async function deepSeekFetch(messages, apiKeyOverride, temperature, maxTokens) {
  const key = (apiKeyOverride != null && String(apiKeyOverride).trim()) || getApiKey()
  if (!key) throw new Error('NO_API_KEY')

  const response = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      messages,
    })
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`DeepSeek error ${response.status}: ${err}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

/**
 * @param {Array<{role: string, content: string}>} messages — user/assistant turns (system added via options)
 * @param {string | null} apiKey — explicit key, or null/undefined to use localStorage
 * @param {{ systemPrompt?: string | null, temperature?: number, maxTokens?: number }} [options]
 */
export async function callDeepSeek(messages, apiKey = null, options = {}) {
  const {
    systemPrompt = null,
    temperature = 0.7,
    maxTokens = 2000,
  } = options
  const msgs = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...(Array.isArray(messages) ? messages : []),
  ]
  const result = await deepSeekFetch(msgs, apiKey, temperature, maxTokens)
  console.log('[DeepSeek] Response type:', typeof result)
  console.log(
    '[DeepSeek] Response preview:',
    typeof result === 'string'
      ? (result || '').substring(0, 100)
      : JSON.stringify(result ?? null).substring(0, 100)
  )
  return result
}

/** Internal: uses dr_api_key from localStorage. */
async function invokeDeepSeek({ systemPrompt, userPrompt, messages, temperature = 0.7, maxTokens = 2000 }) {
  const msgs = messages ?? [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...(userPrompt != null ? [{ role: 'user', content: userPrompt }] : []),
  ]
  return deepSeekFetch(msgs, null, temperature, maxTokens)
}

function stripStorySummariesForLangCheck(text) {
  return (text || '').replace(/\[ENGLISH_SUMMARY:[^\]]+\]/gi, ' ')
}

/** Reject stories where the model wrote English narrative (common failure mode). */
function isProbablyGermanStory(text) {
  const body = stripStorySummariesForLangCheck(text).slice(0, 3500).toLowerCase()
  const deHits = (body.match(/\b(der|die|das|und|ich|ist|nicht|ein|eine|zu|mit|für|sie|er|es|wir|haben|hat|war|wenn|auch|nur|noch|dem|den|des|vom|zum|zur|aber|oder|dann|hier|da|wie|was|wo)\b/g) || []).length
  const enHits = (body.match(/\b(the|and|was|for|with|from|they|went|gone|shadow|travel|center|elephant|chapter|search|truth|character)\b/g) || []).length
  const uml = (body.match(/[äöüß]/g) || []).length
  const tokenCount = (body.match(/[a-zäöüß]+/gi) || []).length
  if (tokenCount < 25) return false
  return deHits >= 10 && deHits >= enHits * 1.15 && (uml >= 2 || deHits >= 15)
}

export async function generateStory({ theme, words, level, chapterCount = 6, previousTopicWords = [] }) {
  const wordList = shuffleArray(words).slice(0, 200)
    .map(w => `${w.german} (${w.translation})`).join(', ')

  const systemPrompt = `You are a German language story generator for a learner at ${level} level. You write engaging German mini-novels.

STRICT RULES:
- Every line of story narration and dialogue MUST be German. Never write English paragraphs for the story itself.
- English is allowed ONLY inside tags: [ENGLISH_SUMMARY: ...] after each chapter.
- Return plain text only. No markdown, no # headers, no asterisks.`

  const userPrompt = `Write a German story with exactly ${chapterCount} chapters (Kapitel 1 through ${chapterCount}) on the theme: "${theme}".

REQUIREMENTS:
- Total length: 800–1200 words of GERMAN prose (not English).
- Each chapter: 130–200 words, titled "Kapitel N: [German Title]"
- Language level: ${level}
- Naturally weave in vocabulary where possible: ${wordList}
- Previous-topic words to recycle: ${previousTopicWords.join(', ') || 'none yet'}
- After EVERY chapter, one line only: [ENGLISH_SUMMARY: one English sentence]
- Separate chapters with: ---CHAPTER---

Write ONLY the story in German (plus summary lines). Start with "Kapitel 1:"`

  let raw = cleanMarkdown(await invokeDeepSeek({ systemPrompt, userPrompt, temperature: 0.72, maxTokens: 4000 }))
  if (!isProbablyGermanStory(raw)) {
    const fixPrompt = `${userPrompt}

CRITICAL FIX: Your previous draft failed language check (too much English in the body). Rewrite the entire story: German only for all story text. English only in [ENGLISH_SUMMARY: ...] lines.`
    raw = cleanMarkdown(await invokeDeepSeek({ systemPrompt, userPrompt: fixPrompt, temperature: 0.38, maxTokens: 4000 }))
  }
  return raw
}

const AUDIT_BATCH = 40

/**
 * @param {Array<{german: string, translation?: string}>} wordsSlice
 * @returns {Promise<Array<{ index: number, band: string, note: string }>>}
 */
export async function auditVocabularyFrequency(wordsSlice) {
  const list = (wordsSlice || []).filter((w) => w?.german?.trim()).slice(0, AUDIT_BATCH)
  if (!list.length) return []
  const lines = list.map((w, i) => `${i + 1}. ${w.german.trim()} — ${(w.translation || '').trim()}`).join('\n')
  const userPrompt = `You judge German vocabulary for a learner targeting B2 reading. For each numbered item, the LEFT side should be German (if it looks like English, say so in the note).

Return ONLY valid JSON:
{"results":[{"index":1,"band":"core"|"useful"|"niche"|"noise","note":"max 12 words"}]}

Bands:
- core = top-frequency / essential for news & conversation
- useful = good to know, fair frequency
- niche = rare but valid (names of things, rare idioms)
- noise = likely typo, Duolingo glitch, not real German, or English stored wrong

Items:
${lines}`

  const result = await invokeDeepSeek({ userPrompt, temperature: 0.15, maxTokens: 2000 })
  try {
    const cleaned = result.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
    const parsed = JSON.parse(cleaned)
    return Array.isArray(parsed.results) ? parsed.results : []
  } catch {
    return []
  }
}

export async function generateExampleSentenceForWord(german, translation, cefrLevel = 'A1') {
  const g = String(german || '').trim()
  if (!g) throw new Error('No word')
  const userPrompt = `One natural German sentence (max 14 words) that uses "${g}" (${translation || 'learner word'}). About CEFR ${cefrLevel}. Plain text German only — no quotes, no English, no explanation.`
  return cleanMarkdown(await invokeDeepSeek({ userPrompt, temperature: 0.45, maxTokens: 100 }))
}

export async function explainUnknownWords(unknownWords) {
  const userPrompt = `For each German word below, provide a very short English meaning (1-5 words max). Return ONLY valid JSON, no markdown, no extra text.

Words: ${unknownWords.join(', ')}

Return format: {"word1": "meaning", "word2": "meaning"}`

  const result = await invokeDeepSeek({ userPrompt, temperature: 0.1, maxTokens: 500 })
  try {
    return JSON.parse(result.trim())
  } catch {
    return {}
  }
}

export async function explainWord(germanWord, context, userVocabSample) {
  const userPrompt = `Explain the German word "${germanWord}" to a B1-level learner.

Context sentence: "${context || 'none'}"

Provide ALL of the following, clearly labeled:
GERMAN: ${germanWord}
GENDER & PLURAL: (if noun — der/die/das, plural form)
MEANING: (English translation, 1-3 words)
FULL MEANING: (2-3 sentence English explanation of nuance, usage, common contexts)
EXAMPLE 1: (German sentence using this word — B1 level)
EXAMPLE 2: (Different German sentence, different context)
MEMORY TIP: (One vivid mnemonic or association to remember this word)
RELATED WORDS: (2-3 related German words or common phrases)

Write clearly and helpfully. No extra formatting symbols.`

  const raw = await invokeDeepSeek({ userPrompt, temperature: 0.3, maxTokens: 600 })
  return cleanMarkdown(raw)
}

export async function generateGrammarExercises({ focus, level, userWords, count = 8 }) {
  const focusDescriptions = {
    present_tense: "present tense (Präsens) — regular and irregular verb conjugation",
    articles_gender: "German articles and noun gender (der/die/das, ein/eine/ein)",
    basic_sentence_order: "basic German sentence order (V2 rule, subject-verb-object)",
    nominative: "nominative case — subject identification and articles",
    accusative: "accusative case (articles, pronouns, adjective endings after accusative)",
    dative: "dative case (articles, pronouns, adjective endings, dative verbs)",
    perfekt: "Perfekt past tense — haben/sein + past participle, strong verb forms",
    modal_verbs: "modal verbs (können, müssen, dürfen, wollen, sollen, mögen)",
    adjective_endings: "adjective endings (all three declension tables)",
    prepositions: "German prepositions (two-way with accusative vs dative, fixed prepositions)",
    word_order: "German word order (V2 rule, subordinate clauses, position of nicht)",
    praeteritum: "Präteritum (simple past) — narrative tense, strong and weak verbs",
    konjunktiv_II: "Konjunktiv II (würde + infinitive, hätte, wäre, modal + Konjunktiv II)",
    passive: "passive voice (werden-passive in present, past, with modals)",
    konjunktiv_I: "Konjunktiv I (reported speech, indirect speech forms)",
    relative_clauses: "relative clauses (relative pronouns, word order, with prepositions)",
    genitive: "genitive case — possession, genitive prepositions, genitive attributes",
    infinitive_constructions: "infinitive constructions (zu + infinitiv, um...zu, ohne...zu, anstatt...zu)"
  }

  const focusList = Array.isArray(focus) ? focus : [focus]
  const wordSample = (userWords || []).slice(0, 30).map(w => w.german).join(', ')
  const focusDesc = focusList.map(item => focusDescriptions[item] || item).join(' + ')
  const focusLabel = Array.isArray(focus) ? 'interleaved' : focus

  const userPrompt = `Create ${count} German grammar exercises focusing on: ${focusDesc}.

${wordSample ? `Use these vocabulary words where natural: ${wordSample}` : ''}

Return ONLY valid JSON (no markdown, no backticks):
{
  "focus": "${focusLabel}",
  "exercises": [
    {
      "type": "fill_blank",
      "sentence": "Ich gebe ___ Hund Wasser.",
      "blank_position": 2,
      "correct": "dem",
      "options": ["der", "dem", "den", "des"],
      "explanation": "Hund is dative (indirect object), so 'dem'"
    },
    {
      "type": "multiple_choice",
      "question": "Which sentence uses Konjunktiv II correctly?",
      "options": ["Wenn ich reich bin, kaufe ich ein Auto.", "Wenn ich reich wäre, würde ich ein Auto kaufen.", "Wenn ich reich war, kaufte ich ein Auto.", "Wenn ich reich sein, kaufen ich ein Auto."],
      "correct_index": 1,
      "explanation": "Konjunktiv II uses wäre/würde for hypotheticals"
    },
    {
      "type": "reorder",
      "words": ["gegessen", "hat", "Er", "schon", "das", "Brot"],
      "correct": "Er hat das Brot schon gegessen.",
      "explanation": "Perfekt: auxiliary (hat) in position 2, past participle at end"
    }
  ]
}`

  const result = await invokeDeepSeek({ userPrompt, temperature: 0.4, maxTokens: 2000 })
  try {
    const cleaned = result.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(cleaned)
  } catch {
    throw new Error('Failed to parse grammar exercises from AI response')
  }
}

export async function explainGrammarFocus(focus) {
  const userPrompt = `Explain German ${focus.replace(/_/g, ' ')} to a B1 learner in 150 words maximum. Be clear and direct. Include 2 example sentences. No markdown headers.`
  const raw = await invokeDeepSeek({ userPrompt, temperature: 0.2, maxTokens: 300 })
  return cleanMarkdown(raw)
}

/** Short feedback on learner German production (Swain / output hypothesis). */
export async function reviewGermanProduction(germanText, promptEn, learnerCefr = 'A1') {
  const trimmed = (germanText || '').trim()
  if (!trimmed) throw new Error('Write something in German first.')

  const userPrompt = `A German learner (long-term goal B2) is currently about CEFR ${learnerCefr} (from SRS progress in the app). They were given this task in English:
"""${promptEn}"""

They wrote this in German:
"""${trimmed}"""

Reply in English only. Keep it under 130 words. Structure:
1) One line on what works well for their CURRENT level (${learnerCefr}) — do not judge them as if they were already B2.
2) 1–3 gentle corrections (quote short fixed German fragments where helpful).
3) One encouraging closing line.

If the text is very short or mostly English, say so kindly and suggest 2–4 more German sentences at their level.`

  const raw = await invokeDeepSeek({ userPrompt, temperature: 0.35, maxTokens: 400 })
  return cleanMarkdown(raw)
}

export async function chatWithTutor(latestMessage, conversationHistory = [], userLevel = 'B1') {
  const systemPrompt = `You are a friendly German grammar coach helping an English-speaking learner. ALWAYS respond in English, never in German. You may include German words, examples, or sentences to illustrate grammar points, but your explanations, answers, and all conversational text must be in English. If the user asks a question in any language, always answer in English.

You are a friendly, encouraging German tutor. The student is at ${userLevel} level aiming for B2 in 7 months.

Rules:
- When they make a grammar mistake, gently correct it in brackets: [Correction: ...]
- Keep responses SHORT (2-4 sentences) so conversation flows
- Ask follow-up questions to keep them talking
- If they ask grammar questions, explain simply with 1 example
- Be warm, positive, never condescending

Remember: explain IN ENGLISH, use German only for examples.`

  const clippedHistory = (conversationHistory || []).slice(-20)
  const messages = [
    { role: 'system', content: systemPrompt },
    ...clippedHistory,
    { role: 'user', content: latestMessage }
  ]
  return invokeDeepSeek({ messages, temperature: 0.7, maxTokens: 300 })
}

export async function testConnection() {
  return invokeDeepSeek({ userPrompt: "Say exactly: ok", temperature: 0, maxTokens: 10 })
}
