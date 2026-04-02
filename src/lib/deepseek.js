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

async function callDeepSeek({ systemPrompt, userPrompt, messages, temperature = 0.7, maxTokens = 2000 }) {
  const key = getApiKey()
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
      messages: messages || [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userPrompt }
      ]
    })
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`DeepSeek error ${response.status}: ${err}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

export async function generateStory({ theme, words, level, chapterCount = 6, previousTopicWords = [] }) {
  const wordList = shuffleArray(words).slice(0, 200)
    .map(w => `${w.german} (${w.translation})`).join(', ')

  const systemPrompt = `You are a German language story generator for a learner at ${level} level trying to reach B2. You write engaging, immersive German mini-novels that naturally incorporate vocabulary the learner already knows, making them feel successful and confident. Your stories are vivid, emotional, and genuinely interesting — not textbook boring.

IMPORTANT: Return plain text only. No markdown formatting. No asterisks, no bold, no headers with #. Just clean German prose.`

  const userPrompt = `Write a German story with exactly ${chapterCount} chapters (Kapitel 1 through ${chapterCount}) on the theme: "${theme}".

REQUIREMENTS:
- Total length: 800–1200 German words
- Each chapter: 130–200 words, titled "Kapitel N: [Creative German Title]"
- Language level: ${level} — use mostly simple, clear German with some B1-B2 vocabulary for stretch
- Naturally weave in as many of these vocabulary words as possible: ${wordList}
- Use vocabulary that appeared in the learner's previous story on this topic: ${previousTopicWords.join(', ') || 'none available yet'}. This is deliberate narrow reading practice.
- Make it COMPELLING — real characters, real conflict, real emotion
- Vary sentence length. Use both simple and complex sentences.
- After EVERY chapter, add a line: [ENGLISH_SUMMARY: one sentence summary of what happened]
- Separate chapters with: ---CHAPTER---

Write ONLY the story. No meta-commentary. Start directly with "Kapitel 1:"`

  const raw = await callDeepSeek({ systemPrompt, userPrompt, temperature: 0.85, maxTokens: 4000 })
  return cleanMarkdown(raw)
}

export async function explainUnknownWords(unknownWords) {
  const userPrompt = `For each German word below, provide a very short English meaning (1-5 words max). Return ONLY valid JSON, no markdown, no extra text.

Words: ${unknownWords.join(', ')}

Return format: {"word1": "meaning", "word2": "meaning"}`

  const result = await callDeepSeek({ userPrompt, temperature: 0.1, maxTokens: 500 })
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

  const raw = await callDeepSeek({ userPrompt, temperature: 0.3, maxTokens: 600 })
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

  const result = await callDeepSeek({ userPrompt, temperature: 0.4, maxTokens: 2000 })
  try {
    const cleaned = result.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(cleaned)
  } catch {
    throw new Error('Failed to parse grammar exercises from AI response')
  }
}

export async function explainGrammarFocus(focus) {
  const userPrompt = `Explain German ${focus.replace(/_/g, ' ')} to a B1 learner in 150 words maximum. Be clear and direct. Include 2 example sentences. No markdown headers.`
  const raw = await callDeepSeek({ userPrompt, temperature: 0.2, maxTokens: 300 })
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
  return callDeepSeek({ messages, temperature: 0.7, maxTokens: 300 })
}

export async function testConnection() {
  return callDeepSeek({ userPrompt: "Say exactly: ok", temperature: 0, maxTokens: 10 })
}
