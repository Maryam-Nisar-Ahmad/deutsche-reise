# Deutsche Reise: Complete Implementation Specification
## A Research-Proven German Learning App

---

## OVERVIEW & MISSION

Build a **web app** called **"Deutsche Reise"** (German Journey) that takes the user from high-A1 to B2 German in 7 months. It runs entirely in the browser with no backend. Every feature is grounded in second-language-acquisition (SLA) research: spaced repetition (SM-2), comprehensible input (Krashen), the output hypothesis (Swain), shadowing (Arguelles), and narrow reading (Krashen). The app combines a **flashcard SRS engine**, **AI-generated immersive stories**, **grammar exercises**, **shadowing mode**, and a **gamified progress system** into one smooth, beautiful experience the user actually wants to open every day.

---

## TECH STACK: USE EXACTLY THESE

| Layer | Choice | Reason |
|---|---|---|
| Framework | React 18 + Vite | Fast dev, HMR, easy deployment |
| Styling | Tailwind CSS v3 | Utility-first, rapid UI |
| Routing | React Router v6 | SPA navigation |
| Database | IndexedDB via `idb` npm package | Stores thousands of words/stories offline |
| Settings/State | localStorage | Streak, API key, preferences, voice settings |
| AI | DeepSeek API (deepseek-chat model) | All story generation, exercises, lookups |
| Voice/Audio | Browser Web Speech API (built-in, no install) | The German de-DE voice the user already loves |
| Animations | Framer Motion | Smooth card flips, page transitions |
| Icons | lucide-react | Clean, consistent icons |

**NO backend. NO user accounts. NO external auth. Runs 100% in the browser.**

---

## PROJECT SETUP

### package.json dependencies
```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.22.0",
    "idb": "^8.0.0",
    "framer-motion": "^11.0.0",
    "lucide-react": "^0.460.0",
    "clsx": "^2.1.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "vite": "^5.2.0"
  }
}
```

### vite.config.js
```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 3000, open: true }
})
```

### tailwind.config.js
```js
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          300: '#7cc8fb',
          400: '#36aaf5',
          500: '#0c8ee3',
          600: '#006ec2',
          700: '#00589d',
          800: '#054a82',
          900: '#0a3f6c',
          950: '#07264a',
        },
        surface: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      }
    }
  },
  plugins: [],
  darkMode: 'class',
}
```

### index.html
```html
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Deutsche Reise</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
</head>
<body class="bg-surface-950 text-white antialiased">
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

---

## FILE STRUCTURE

```
src/
├── main.jsx
├── App.jsx
├── index.css
├── lib/
│   ├── db.js              # IndexedDB (all persistent data)
│   ├── srs.js             # SM-2 spaced repetition algorithm
│   ├── deepseek.js        # DeepSeek API client
│   ├── wordParser.js      # Parse Duolingo word list format
│   ├── voice.js           # Web Speech API wrapper
│   └── levelCalc.js       # CEFR level from word count
├── hooks/
│   ├── useVoice.js        # TTS state management
│   ├── useStreak.js       # Daily streak logic
│   └── useSettings.js     # API key, preferences
├── pages/
│   ├── Dashboard.jsx      # Home screen
│   ├── Flashcards.jsx     # SRS review session
│   ├── StoryStudio.jsx    # Generate + read stories
│   ├── GrammarGym.jsx     # Grammar exercises
│   ├── VocabVault.jsx     # Word list manager
│   └── Settings.jsx       # API key + preferences
└── components/
    ├── Layout.jsx          # Sidebar + top bar wrapper
    ├── Sidebar.jsx
    ├── dashboard/
    │   ├── StreakCard.jsx
    │   ├── LevelMeter.jsx
    │   ├── DailyPlan.jsx
    │   └── WeekHeatmap.jsx
    ├── flashcards/
    │   ├── FlashCard.jsx
    │   └── RatingButtons.jsx
    ├── story/
    │   ├── StoryText.jsx
    │   ├── WordPopup.jsx
    │   ├── AudioControls.jsx
    │   └── ShadowMode.jsx
    ├── grammar/
    │   ├── FillBlank.jsx
    │   ├── MultipleChoice.jsx
    │   └── SentenceReorder.jsx
    └── shared/
        ├── Button.jsx
        ├── Modal.jsx
        ├── LoadingSpinner.jsx
        └── XPToast.jsx
```

---

## DATABASE SCHEMA: `src/lib/db.js`

Use `idb` to create and manage an IndexedDB database called `deutsche-reise-db` version 1.

### Stores

#### `words` store
Each word the user has added. Key: `id` (autoIncrement).
```js
{
  id: Number,                    // autoincrement primary key
  german: String,                // "Hausarbeit"
  translation: String,           // "chores"
  normalizedKey: String,         // "hausarbeit" (lowercase, trimmed, for dedup)
  addedAt: Number,               // Date.now()
  source: String,                // "import" | "manual" | "story_lookup"
  gender: String | null,         // "der" | "die" | "das" | null (set by AI lookup)
  plural: String | null,         // plural form if noun
  example: String | null,        // example sentence
}
```
Index: `normalizedKey` (unique: true)

#### `srs_cards` store
One card per word for the SRS engine. Key: `wordId` (same as `words.id`).
```js
{
  wordId: Number,                // foreign key → words.id
  easeFactor: Number,            // SM-2 ease factor, starts at 2.5
  interval: Number,              // days until next review, starts at 0
  repetitions: Number,           // consecutive successful reviews
  nextReview: Number,            // Date.now() of next review (timestamp)
  lastReview: Number | null,     // Date.now() of last review
  lapses: Number,                // times card was forgotten (rated 1)
  state: String,                 // "new" | "learning" | "review" | "relearning"
  totalReviews: Number,          // lifetime review count
}
```
Index: `nextReview`

#### `stories` store
AI-generated stories saved for later. Key: `id` (autoIncrement).
```js
{
  id: Number,
  title: String,
  theme: String,                 // user's theme input
  level: String,                 // "A1" | "A2" | "B1" | "B2"
  content: String,               // full story text, chapters separated by \n\n---CHAPTER---\n\n
  chapters: Array<{              // parsed chapters
    title: String,               // "Kapitel 1: Der Anfang"
    text: String,
  }>,
  wordMeanings: Object,          // { "normalizedWord": "English meaning" } for unknown words
  createdAt: Number,
  lastRead: Number | null,
  readCount: Number,
  currentChapter: Number,        // 0-indexed, for resuming
}
```

#### `grammar_sessions` store
Key: `id` (autoIncrement).
```js
{
  id: Number,
  type: String,                  // "fill_blank" | "multiple_choice" | "reorder"
  focus: String,                 // "cases" | "konjunktiv_II" | "passive" | etc.
  questions: Array,              // raw questions from DeepSeek
  answers: Array,                // user's answers
  score: Number,                 // 0 to 100
  completedAt: Number,
}
```

#### `daily_sessions` store
Key: `date` (string "YYYY-MM-DD").
```js
{
  date: String,                  // "2025-01-15"
  flashcardsReviewed: Number,
  newWordsLearned: Number,
  storiesRead: Number,           // chapters read
  grammarExercises: Number,
  shadowingMinutes: Number,
  xpEarned: Number,
  minutesStudied: Number,
}
```

### Database functions to implement

```js
// Initialize DB
export async function initDB() { ... }

// Words
export async function importWords(wordsArray) { ... }  // bulk import, deduplicates
export async function addWord(german, translation) { ... }
export async function getAllWords() { ... }
export async function getWordCount() { ... }
export async function deleteWord(id) { ... }

// SRS Cards
export async function getDueCards(limit = 20) { ... }   // cards where nextReview <= Date.now()
export async function getNewCards(limit = 15) { ... }   // cards with state === "new"
export async function updateCardAfterReview(wordId, rating) { ... }  // apply SM-2
export async function getCardStats() { ... }             // { due, new, learning, review }

// Stories
export async function saveStory(storyData) { ... }
export async function getAllStories() { ... }
export async function getStory(id) { ... }
export async function updateStoryProgress(id, currentChapter) { ... }
export async function deleteStory(id) { ... }

// Daily Sessions
export async function getTodaySession() { ... }
export async function updateTodaySession(updates) { ... }
export async function getWeekSessions() { ... }         // last 7 days for heatmap

// Stats
export async function getTotalXP() { ... }
export async function getStudyStreakDays() { ... }
```

---

## SM-2 ALGORITHM: `src/lib/srs.js`

Implement the SM-2 algorithm exactly as described by Wozniak (1987), with four rating buttons instead of the classic 0 to 5 scale:

```
Rating 1 = "Forgot"    → maps to quality 0
Rating 2 = "Hard"      → maps to quality 3
Rating 3 = "Good"      → maps to quality 4
Rating 4 = "Easy"      → maps to quality 5
```

```js
export function calculateNextInterval(card, quality) {
  // quality: 0 | 3 | 4 | 5
  let { easeFactor, interval, repetitions, lapses } = card

  if (quality < 3) {
    // Failed: reset to relearning
    repetitions = 0
    interval = 1
    lapses += 1
    // Ease factor penalty for lapse
    easeFactor = Math.max(1.3, easeFactor - 0.2)
    return { interval, easeFactor, repetitions, lapses, state: 'relearning' }
  }

  // Passed:
  if (repetitions === 0) {
    interval = 1
  } else if (repetitions === 1) {
    interval = 6
  } else {
    interval = Math.round(interval * easeFactor)
  }

  // Ease factor adjustment
  easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  easeFactor = Math.max(1.3, easeFactor)

  repetitions += 1

  const state = repetitions >= 3 ? 'review' : 'learning'
  return { interval, easeFactor, repetitions, lapses, state }
}

export function getNextReviewTimestamp(interval) {
  const now = new Date()
  now.setDate(now.getDate() + interval)
  now.setHours(4, 0, 0, 0)  // Due at 4am to avoid timezone issues
  return now.getTime()
}

// How many cards are due today
export function isDue(card) {
  return card.nextReview <= Date.now()
}

// Predicted retention (SM-2 simplified)
export function estimateRetention(card) {
  if (!card.lastReview) return 0
  const daysSinceReview = (Date.now() - card.lastReview) / (1000 * 60 * 60 * 24)
  return Math.exp(-daysSinceReview / (card.interval * 0.5)) * 100
}
```

### Daily Card Limit Logic
- Default: 15 new cards/day + all due reviews
- User can change in Settings (range: 5 to 30)
- Enforce new card limit strictly; never limit due reviews
- "New" cards are introduced at START of session, then reviews

---

## WORD PARSER: `src/lib/wordParser.js`

Parse the user's Duolingo word list (the format in words.txt: German line, English line, blank line, repeat).

```js
export function parseDuolingoFormat(rawText) {
  // Split by double newlines to get blocks
  // Each block: line 0 = German, line 1 = English
  // Handle edge cases: empty blocks, single-line blocks, extra whitespace
  // Returns Array<{ german: String, translation: String, normalizedKey: String }>
  // Deduplicates within the paste
  // Skips blocks that don't have exactly 2 non-empty lines
  // Normalizes: german.trim(), translation.trim()
  // normalizedKey: german.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function parseManualEntry(germanLine, translationLine) {
  // For manual single-word entry from the UI
}

export function normalizeGerman(word) {
  return word.trim().toLowerCase().replace(/\s+/g, ' ')
}
```

---

## DEEPSEEK CLIENT: `src/lib/deepseek.js`

All AI calls go through this module. API key comes from localStorage key `dr_api_key`.

```js
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
const MODEL = 'deepseek-chat'

function getApiKey() {
  return localStorage.getItem('dr_api_key') || ''
}

async function callDeepSeek({ systemPrompt, userPrompt, temperature = 0.7, maxTokens = 2000 }) {
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
      messages: [
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
```

### Story Generation Function

```js
export async function generateStory({ theme, words, level, chapterCount = 6 }) {
  // words: array of { german, translation }, shuffle before sending, cap at 200 for prompt length
  // level: "A1-A2" | "A2-B1" | "B1-B2"
  
  const wordList = shuffleArray(words).slice(0, 200)
    .map(w => `${w.german} (${w.translation})`).join(', ')
  
  const systemPrompt = `You are a German language story generator for a learner at ${level} level trying to reach B2. You write engaging, immersive German mini-novels that naturally incorporate vocabulary the learner already knows, making them feel successful and confident. Your stories are vivid, emotional, and genuinely interesting. Not textbook boring.`
  
  const userPrompt = `Write a German story with exactly ${chapterCount} chapters (Kapitel 1 through ${chapterCount}) on the theme: "${theme}".

REQUIREMENTS:
- Total length: 800 to 1200 German words
- Each chapter: 130 to 200 words, titled "Kapitel N: [Creative German Title]"
- Language level: ${level}, use mostly simple, clear German with some B1-B2 vocabulary for stretch
- Naturally weave in as many of these vocabulary words as possible: ${wordList}
- Make it COMPELLING: real characters, real conflict, real emotion
- Vary sentence length. Use both simple and complex sentences.
- After EVERY chapter, add a line: [ENGLISH_SUMMARY: one sentence summary of what happened]
- Separate chapters with: ---CHAPTER---

Write ONLY the story. No meta-commentary. Start directly with "Kapitel 1:"`

  return callDeepSeek({ systemPrompt, userPrompt, temperature: 0.85, maxTokens: 4000 })
}
```

### Word Meaning Lookup (for unknown words in story)

```js
export async function explainUnknownWords(unknownWords) {
  // unknownWords: array of German words not in user's vocabulary (max 30)
  // Returns JSON object: { "word": "English meaning (1-5 words)" }
  
  const userPrompt = `For each German word below, provide a very short English meaning (1-5 words max). Return ONLY valid JSON, no markdown, no extra text.

Words: ${unknownWords.join(', ')}

Return format: {"word1": "meaning", "word2": "meaning"}`
  
  const result = await callDeepSeek({ userPrompt, temperature: 0.1, maxTokens: 500 })
  return JSON.parse(result.trim())
}
```

### Full Word Explanation (for the word popup)

```js
export async function explainWord(germanWord, context, userVocabSample) {
  // context: the sentence this word appeared in
  // userVocabSample: 50 random words from user's deck (for example calibration)
  
  const userPrompt = `Explain the German word "${germanWord}" to a B1-level learner.

Context sentence: "${context || 'none'}"

Provide ALL of the following, clearly labeled:
GERMAN: ${germanWord}
GENDER & PLURAL: (if noun, der/die/das, plural form)
MEANING: (English translation, 1-3 words)
FULL MEANING: (2-3 sentence English explanation of nuance, usage, common contexts)
EXAMPLE 1: (German sentence using this word, B1 level)
EXAMPLE 2: (Different German sentence, different context)
MEMORY TIP: (One vivid mnemonic or association to remember this word)
RELATED WORDS: (2-3 related German words or common phrases)

Write clearly and helpfully. No extra formatting symbols.`

  return callDeepSeek({ userPrompt, temperature: 0.3, maxTokens: 600 })
}
```

### Grammar Exercise Generation

```js
export async function generateGrammarExercises({ focus, level, userWords, count = 8 }) {
  // focus: "accusative" | "dative" | "konjunktiv_II" | "passive" | "relative_clauses" | 
  //         "adjective_endings" | "prepositions" | "word_order" | "past_tenses"
  
  const focusDescriptions = {
    accusative: "accusative case (articles, pronouns, adjective endings after accusative)",
    dative: "dative case (articles, pronouns, adjective endings, dative verbs)",
    konjunktiv_II: "Konjunktiv II (würde + infinitive, hätte, wäre, modal + Konjunktiv II)",
    passive: "passive voice (werden-passive in present, past, with modals)",
    relative_clauses: "relative clauses (relative pronouns, word order, with prepositions)",
    adjective_endings: "adjective endings (all three declension tables)",
    prepositions: "German prepositions (two-way with accusative vs dative, fixed prepositions)",
    word_order: "German word order (V2 rule, subordinate clauses, position of nicht)",
    past_tenses: "past tenses (Perfekt vs Präteritum, strong verbs, Plusquamperfekt)"
  }
  
  const wordSample = userWords.slice(0, 30).map(w => w.german).join(', ')
  
  const userPrompt = `Create ${count} German grammar exercises focusing on: ${focusDescriptions[focus]}.

Use these vocabulary words where natural: ${wordSample}

Return ONLY valid JSON (no markdown, no backticks):
{
  "focus": "${focus}",
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
  return JSON.parse(result.trim())
}
```

### Grammar Focus Explanation

```js
export async function explainGrammarFocus(focus) {
  // Returns a concise, clear explanation with examples, for the grammar gym header
  const userPrompt = `Explain German ${focus} to a B1 learner in 150 words maximum. Be clear and direct. Include 2 example sentences. No markdown headers.`
  return callDeepSeek({ userPrompt, temperature: 0.2, maxTokens: 300 })
}
```

### Chat Tutor (bonus feature, AI conversation)

```js
export async function chatWithTutor(messages, userLevel) {
  // messages: array of { role: 'user'|'assistant', content: string }
  // Conversational German tutor
  
  const systemPrompt = `You are a friendly, encouraging German tutor. The student is at ${userLevel} level aiming for B2 in 7 months. 

Rules:
- Mix German and English naturally based on the student's level
- When they make a grammar mistake, gently correct it in brackets: [Correction: ...]
- Keep responses SHORT (2-4 sentences) so conversation flows
- Ask follow-up questions to keep them talking
- If they ask grammar questions, explain simply with 1 example
- Be warm, positive, never condescending`
  
  return callDeepSeek({ systemPrompt, userPrompt: messages[messages.length-1].content, temperature: 0.7, maxTokens: 300 })
}
```

---

## WEB SPEECH API: `src/lib/voice.js`

This is the voice the user already loves: the browser's built-in German de-DE voice. Preserve all the behavior from the old app that worked well.

```js
export class GermanVoice {
  constructor() {
    this.synth = window.speechSynthesis
    this.currentUtterance = null
    this.voices = []
    this.selectedVoiceURI = localStorage.getItem('dr_voice_uri') || null
    this.rate = parseFloat(localStorage.getItem('dr_speech_rate') || '0.85')
    this.onBoundary = null  // callback: (charIndex, charLength) => void
    this.onEnd = null       // callback: () => void
    this.onSentenceEnd = null // callback: (sentenceIndex) => void
    this._loadVoices()
  }
  
  _loadVoices() {
    const load = () => {
      this.voices = this.synth.getVoices().filter(v => v.lang.startsWith('de'))
      // If saved URI exists, use it; else pick first German voice
      if (this.selectedVoiceURI) {
        this.selectedVoice = this.voices.find(v => v.voiceURI === this.selectedVoiceURI)
      }
      if (!this.selectedVoice) {
        this.selectedVoice = this.voices[0] || null
      }
    }
    load()
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = load
    }
  }
  
  getVoices() { return this.voices }
  
  setVoice(voiceURI) {
    this.selectedVoice = this.voices.find(v => v.voiceURI === voiceURI) || this.voices[0]
    this.selectedVoiceURI = voiceURI
    localStorage.setItem('dr_voice_uri', voiceURI)
  }
  
  setRate(rate) {
    this.rate = rate
    localStorage.setItem('dr_speech_rate', rate.toString())
  }
  
  // Speak a full text, chunked to avoid browser TTS cutoff (~220 chars)
  speak(text, { onEnd } = {}) {
    this.stop()
    const chunks = this._chunkBySentence(text, 220)
    let i = 0
    
    const speakNext = () => {
      if (i >= chunks.length) {
        onEnd?.()
        this.onEnd?.()
        return
      }
      const u = new SpeechSynthesisUtterance(chunks[i])
      u.voice = this.selectedVoice
      u.lang = 'de-DE'
      u.rate = this.rate
      u.onend = () => { i++; speakNext() }
      u.onboundary = (e) => this.onBoundary?.(e.charIndex, e.charLength)
      this.currentUtterance = u
      this.synth.speak(u)
      i++
    }
    speakNext()
  }
  
  // Speak a single sentence, then call onEnd
  speakSentence(sentence, { onEnd } = {}) {
    this.stop()
    const u = new SpeechSynthesisUtterance(sentence)
    u.voice = this.selectedVoice
    u.lang = 'de-DE'
    u.rate = this.rate
    u.onend = () => { onEnd?.() }
    this.currentUtterance = u
    this.synth.speak(u)
  }
  
  // Speak a word (for vocabulary tapping)
  speakWord(word) {
    this.synth.cancel()
    const u = new SpeechSynthesisUtterance(word)
    u.voice = this.selectedVoice
    u.lang = 'de-DE'
    u.rate = 0.8
    this.synth.speak(u)
  }
  
  stop() {
    this.synth.cancel()
    this.currentUtterance = null
  }
  
  isPaused() { return this.synth.paused }
  isSpeaking() { return this.synth.speaking }
  
  _chunkBySentence(text, maxLen) {
    // Split on sentence boundaries, then group into chunks <= maxLen
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text]
    const chunks = []
    let current = ''
    for (const s of sentences) {
      if ((current + s).length > maxLen) {
        if (current) chunks.push(current.trim())
        current = s
      } else {
        current += s
      }
    }
    if (current) chunks.push(current.trim())
    return chunks
  }
  
  // Parse text into sentences for shadowing mode
  getSentences(text) {
    return text.match(/[^.!?]+[.!?]+/g)?.map(s => s.trim()) || [text]
  }
}

// Singleton
export const germanVoice = new GermanVoice()
```

---

## LEVEL CALCULATION: `src/lib/levelCalc.js`

```js
// Based on Milton & Alexiou (2009) vocabulary-CEFR research
const LEVEL_THRESHOLDS = [
  { min: 0,    max: 299,  level: 'A1',       label: 'Beginner',      color: '#ef4444' },
  { min: 300,  max: 799,  level: 'A2',       label: 'Elementary',    color: '#f97316' },
  { min: 800,  max: 1999, level: 'B1',       label: 'Intermediate',  color: '#eab308' },
  { min: 2000, max: 3499, level: 'B1+',      label: 'Upper-Intermediate', color: '#84cc16' },
  { min: 3500, max: 4999, level: 'B2',       label: 'Advanced',      color: '#22c55e' },
  { min: 5000, max: 9999, level: 'C1',       label: 'Proficient',    color: '#06b6d4' },
]

export function getLevel(knownWordCount) {
  return LEVEL_THRESHOLDS.find(t => knownWordCount >= t.min && knownWordCount <= t.max)
    || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1]
}

export function getProgressToNextLevel(knownWordCount) {
  const current = getLevel(knownWordCount)
  const range = current.max - current.min
  const progress = knownWordCount - current.min
  return Math.min(100, Math.round((progress / range) * 100))
}

export function getWordsNeededForB2(knownWordCount) {
  return Math.max(0, 3500 - knownWordCount)
}

// Daily new words needed to hit B2 in 7 months from current count
export function getDailyTargetWords(knownWordCount, daysRemaining = 210) {
  const needed = getWordsNeededForB2(knownWordCount)
  return Math.ceil(needed / daysRemaining)
}
```

---

## HOOKS

### `src/hooks/useVoice.js`
```js
import { useState, useCallback, useEffect } from 'react'
import { germanVoice } from '../lib/voice'

export function useVoice() {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [rate, setRateState] = useState(germanVoice.rate)
  const [voices, setVoices] = useState([])
  const [selectedVoiceURI, setSelectedVoiceURIState] = useState(germanVoice.selectedVoiceURI)
  
  useEffect(() => {
    // Load voices after a tick (needed for Chrome)
    const timer = setTimeout(() => {
      setVoices(germanVoice.getVoices())
    }, 500)
    return () => clearTimeout(timer)
  }, [])
  
  const speak = useCallback((text) => {
    setIsSpeaking(true)
    germanVoice.speak(text, { onEnd: () => setIsSpeaking(false) })
  }, [])
  
  const speakWord = useCallback((word) => {
    germanVoice.speakWord(word)
  }, [])
  
  const stop = useCallback(() => {
    germanVoice.stop()
    setIsSpeaking(false)
  }, [])
  
  const changeRate = useCallback((r) => {
    germanVoice.setRate(r)
    setRateState(r)
  }, [])
  
  const changeVoice = useCallback((uri) => {
    germanVoice.setVoice(uri)
    setSelectedVoiceURIState(uri)
  }, [])
  
  return { isSpeaking, speak, speakWord, stop, rate, changeRate, voices, selectedVoiceURI, changeVoice }
}
```

### `src/hooks/useStreak.js`
```js
import { useMemo } from 'react'

// Streak uses localStorage keys:
// dr_streak_count (number)
// dr_streak_last_date ("YYYY-MM-DD")
// dr_streak_grace_used (boolean, for grace day)

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export function useStreak() {
  const count = parseInt(localStorage.getItem('dr_streak_count') || '0')
  const lastDate = localStorage.getItem('dr_streak_last_date') || ''
  
  function incrementStreak() {
    const today = todayStr()
    if (lastDate === today) return // already counted today
    
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]
    
    const dayBeforeYesterday = new Date()
    dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2)
    const dbStr = dayBeforeYesterday.toISOString().split('T')[0]
    
    const graceUsed = localStorage.getItem('dr_streak_grace_used') === 'true'
    
    if (lastDate === yesterdayStr || lastDate === today) {
      // Continuing streak
      localStorage.setItem('dr_streak_count', count + 1)
      localStorage.setItem('dr_streak_grace_used', 'false')
    } else if (lastDate === dbStr && !graceUsed) {
      // Missed yesterday but grace day applies, keep streak
      localStorage.setItem('dr_streak_count', count + 1)
      localStorage.setItem('dr_streak_grace_used', 'true')
    } else {
      // Streak broken (or no previous streak)
      localStorage.setItem('dr_streak_count', '1')
      localStorage.setItem('dr_streak_grace_used', 'false')
    }
    localStorage.setItem('dr_streak_last_date', today)
  }
  
  return {
    streakCount: count,
    lastDate,
    isActiveToday: lastDate === todayStr(),
    incrementStreak,
  }
}
```

### `src/hooks/useSettings.js`
```js
import { useState } from 'react'

export function useSettings() {
  const [apiKey, setApiKeyState] = useState(localStorage.getItem('dr_api_key') || '')
  const [newCardsPerDay, setNewCardsPerDayState] = useState(
    parseInt(localStorage.getItem('dr_new_cards_per_day') || '15')
  )
  const [darkMode, setDarkModeState] = useState(
    localStorage.getItem('dr_dark_mode') !== 'false'
  )
  
  const setApiKey = (key) => {
    localStorage.setItem('dr_api_key', key.trim())
    setApiKeyState(key.trim())
  }
  
  const setNewCardsPerDay = (n) => {
    localStorage.setItem('dr_new_cards_per_day', n)
    setNewCardsPerDayState(n)
  }
  
  const setDarkMode = (val) => {
    localStorage.setItem('dr_dark_mode', val)
    document.documentElement.classList.toggle('dark', val)
    setDarkModeState(val)
  }
  
  return { apiKey, setApiKey, newCardsPerDay, setNewCardsPerDay, darkMode, setDarkMode }
}
```

---

## PAGES: DETAILED SPECIFICATION

---

### PAGE 1: `Dashboard.jsx` (Home Screen)

**Purpose:** The first screen the user sees every day. Shows their streak, level, what's due, and guides them through their daily session.

**Layout:** Dark background, three-column layout on desktop, single-column on mobile.

**Components to render:**

#### Top Banner (Greeting & Streak)
- Large German greeting that changes by time of day:
  - Before noon: "Guten Morgen!" 
  - Noon to 5pm: "Guten Tag!"
  - After 5pm: "Guten Abend!"
- User's current streak as a flame 🔥 icon + number
- If streak is active today: green flame, else grey
- Motivational subtitle: "7 Monate. Jeden Tag. Du schaffst das." (7 months. Every day. You can do it.)

#### Level Meter Card
- Shows current CEFR level (e.g., "B1") in large text
- Progress bar toward next level
- Shows: "X words known → Y needed for [next level]"
- Pull data from: `getWordCount()`, then `getLevel()` and `getProgressToNextLevel()`
- Target reminder: "Goal: B2 by [date 7 months from first launch]"

#### Daily Plan Card (the heart of the dashboard)
Research basis: Baddeley & Longman (1978) show multiple shorter sessions outperform marathon sessions. Daily plan distributes across 4 activity types.

Show a checklist of today's activities:
```
□ 🃏 Flashcard Review   : [N] due today        [START]
□ 📚 Read Story         : Chapter [N] of "[title]" [CONTINUE]  
□ 🏋️ Grammar Gym       : [Focus topic]           [START]
□ 🎙️ Shadowing         : 10 min with today's story [START]
```
- Each row has a checkbox that turns green when completed
- Tap [START] to navigate to that page
- Show XP reward next to each task (e.g., "+50 XP")
- At top: "XP Today: 120 / 300"

#### Stats Strip (4 cards in a row)
1. **Words Known**: total word count from DB
2. **Due Today**: SRS cards due
3. **Days Streak**: current streak
4. **Time Today**: minutes studied today (tracked in daily_sessions)

#### Weekly Heatmap
- 7 boxes, one per day (Mon to Sun, current week)
- Color intensity based on XP earned that day:
  - 0 XP: dark grey
  - 1 to 50 XP: dim green
  - 51 to 150 XP: medium green
  - 150+ XP: bright green
- Tooltip on hover: "[Day]: [XP] XP, [N] words reviewed"

#### Quick Access Row
- Three large clickable cards:
  - "Start Flashcards" → /flashcards
  - "Read a Story" → /story
  - "Grammar Gym" → /grammar

---

### PAGE 2: `Flashcards.jsx` (SRS Review Session)

**Purpose:** Daily vocabulary review using the SM-2 algorithm. This is the core retention engine.

**Research basis:** Wozniak (1987) SM-2 algorithm. 90% retention target. Cloze cards beat translation cards. Separate learning steps.

**Session Flow:**

```
[Pre-session screen]
  "Ready to review?"
  Due cards: 23  |  New cards today: 15/15
  [Start Session] button

[Card screen (the main view)]

[Post-session screen]
  Summary stats
  XP animation
```

#### Pre-Session Screen
- Show: due reviews, new cards available, estimated time (N cards × 8 seconds)
- [Start Session] button
- Option: "Only Reviews" | "Only New" | "Both" toggle
- Small info text: "Reviewing [N] due + [N] new words today"

#### Card Screen (Main Review UI)

Layout:
```
Progress bar at top (cards remaining / total)
[Card face], flippable
[Show Answer] button → flips card
[Rating buttons], appear after flip
```

**Card Front (German → English mode):**
- Large German word centered
- Small speaker icon → tap to hear pronunciation (speakWord)
- If word has gender stored: show "der/die/das" in subtle color
- Current interval shown subtly: "Last reviewed: 3 days ago"

**Card Front (English → German mode, alternates):**
- Large English translation
- "What's the German word?"

**Card Back (after flip, using Framer Motion card flip animation):**
- German word + translation visible
- Example sentence if available (show the stored `example` field)
- Speaker icon to hear the full example sentence

**Rating Buttons (4 buttons, full-width row):**
```
[1 Forgot]     [2 Hard]     [3 Good]     [4 Easy]
  RED           ORANGE        GREEN        BRIGHT GREEN
```
Below each button, show next interval:
- "1 Forgot" → "Again (1 day)"
- "2 Hard" → "2 days"
- "3 Good" → "[calculated interval]"
- "4 Easy" → "[calculated interval × 1.3]"

Call `updateCardAfterReview(wordId, quality)` and move to next card.

**Keyboard shortcuts:**
- Space/Enter → Show Answer
- 1/2/3/4 → Rate card
- ← → to navigate (already-rated cards)

**Progress Bar:** shows N remaining / N total. Color transitions from red → green as session completes.

**XP per card:** 
- New card mastered: +10 XP
- Review correct: +5 XP
- Review failed: +1 XP

#### Post-Session Screen
- Large "Session Complete! 🎉" header
- Stats:
  - Cards reviewed: N
  - Correct: N (%)
  - Time taken: M minutes
  - XP earned: N
  - Longest streak in session
- Motivational message in German: "Weiter so! Du wirst jeden Tag besser." (Keep it up! You get better every day.)
- [Back to Dashboard] and [Review Again] buttons

---

### PAGE 3: `StoryStudio.jsx` (Generate & Read Stories)

**Purpose:** Generate AI stories using the user's vocabulary, read them with TTS, enable shadowing. This is the comprehensible input + listening + shadowing module.

**Research basis:** Krashen (1994) compelling input. Narrow reading (Cho & Krashen 1994). Glossed reading doubles vocabulary learning (Hulstijn et al.). Shadowing (Kadota 2019, Arguelles).

**This page has two states: Library view and Story Reader view.**

#### Library View (default when no story is open)

- Header: "Story Studio" with subtitle "Immerse yourself in German"
- **Generate New Story button**, opens a modal:
  ```
  Story Generator Modal:
  - Theme input (text): "What should the story be about?"
    Suggestions as chips: Adventure, Romance, Mystery, Science, History, Daily Life, Fantasy, Travel
  - Difficulty: Auto (based on word count) | A1-A2 | A2-B1 | B1-B2 (radio buttons)
  - Chapters: 4 | 6 | 8 (default 6)
  - [Generate Story] button
  ```
  - While generating: animated spinner with rotating German words ("Generating your story...")
  - On complete: navigate to story reader

- **Saved Stories list:**
  - Each story as a card:
    - Title + theme tag
    - Progress: "Chapter 3/6" with progress bar
    - Word count + date created
    - [Continue] / [Read Again] / [Delete] buttons
  - Sort: most recent first
  - Empty state: "No stories yet. Generate your first one!"

#### Story Reader View

**Top bar:**
- Back arrow → library
- Story title
- Chapter selector dropdown: "Kapitel 1: Title | 2: Title..." 
- Settings icon → voice rate slider, voice selector

**Chapter Text Area:**

Display the story text with these interactive behaviors:

**Word Coloring System:**
- Words that match the user's vocabulary (normalizedKey match): **highlighted in soft teal/green**
- Words that are in the `wordMeanings` object (AI-explained unknowns): **highlighted in soft blue**
- Unknown words with no explanation: **plain white**
- Currently-spoken word during TTS (word boundary tracking): **bright yellow highlight**

**Word Interaction:**
- **Hover** over any highlighted word: show small tooltip with meaning
- **Click** any word: open WordPopup component (see below)
- Parse words by splitting on spaces and punctuation, keeping punctuation attached to preceding word for display but stripped for lookup

**Word Popup Component (modal that appears on word click):**
```
┌──────────────────────────────────┐
│  🔊  [GERMAN WORD]               │
│  [Gender & Plural if noun]       │
│                                  │
│  Meaning: [English]              │
│                                  │
│  [Loading AI explanation...]     │
│  OR                              │
│  Full meaning: [2-3 sentences]   │
│                                  │
│  Example 1: [German sentence]    │
│  Example 2: [German sentence]    │
│                                  │
│  Memory tip: [mnemonic]          │
│  Related: [words]                │
│                                  │
│  [♡ Save to Review] [✓ Close]    │
└──────────────────────────────────┘
```
- Clicking 🔊 calls `germanVoice.speakWord(word)` immediately
- AI explanation loads asynchronously via `explainWord()`
- "Save to Review" adds word to SRS if not already there
- If word is already in deck: show "✓ In your vocabulary" instead

**English Summary Toggle:**
- Small button "Show Chapter Summary" at bottom of each chapter
- Reveals the [ENGLISH_SUMMARY: ...] line extracted from story
- This prevents over-reliance but is available when needed (Krashen: glossing helps)

**Audio Controls Bar** (sticky at bottom):
```
[⏮ Prev Chapter] [▶ Play] [⏸ Pause] [⏭ Next Chapter]
Speed: [0.6] [0.75] [0.85] [1.0] [1.2]   Voice: [dropdown]
[Shadow Mode] toggle
```

- Play button reads the CURRENT CHAPTER aloud from start
- During playback: currently-spoken sentence highlighted in the text
- Implement sentence tracking: split chapter into sentences, track which sentence is being read using the word boundary API or timing estimates
- Speed buttons: tap to switch rate (highlight active rate)
- Voice dropdown: all German de-DE voices found by the browser

**Shadowing Mode** (toggle on the audio bar):

When shadow mode is ON:
1. Audio controls change to show: "🎙️ Shadow Mode Active"
2. Story text shows one sentence at a time (current sentence big, rest dimmed)
3. Sequence per sentence:
   a. Show sentence in German
   b. [▶ Listen] button, plays the sentence via TTS
   c. After TTS finishes: auto-show [🎙️ Repeat] button with 3-second countdown circle
   d. 3 seconds for user to repeat the sentence aloud
   e. Then auto-advance to next sentence, OR user presses [Next]
4. Progress: "Sentence 3 / 47"
5. [Exit Shadow Mode] button
6. Option: "Auto-advance" toggle (for flow) vs "Manual advance" (for careful study)

After shadowing a chapter: +25 XP and update `shadowingMinutes` in daily session.

**Chapter Navigation:**
- Previous/Next chapter buttons
- Auto-save progress (currentChapter) to DB after each chapter
- "You've read this chapter N times" counter

---

### PAGE 4: `GrammarGym.jsx` (Grammar Exercises)

**Purpose:** Targeted grammar practice based on German B2 requirements. Interleaved practice after initial blocking (Nakata & Suzuki 2019).

**Research basis:** Norris & Ortega (2000): explicit instruction produces large, durable gains. DeKeyser (2025): declarative knowledge must be proceduralized through practice.

**Layout:** Two-panel on desktop. Left: grammar topic list. Right: exercise area.

#### Grammar Topic List (Left Panel)
Each topic is a card with:
- Topic name
- Description (one line)
- Difficulty indicator (A1/A2/B1/B2 tag)
- "Last practiced" date
- Score from last session (e.g., "7/8 correct")

Topics to include (in this order, progression from foundation to B2):
```
Foundation (always do these first):
  1. Present Tense (Präsens)        : A1
  2. Articles & Gender               : A1
  3. Basic Sentence Order            : A1
  4. Nominative Case                 : A1

Building (A2):
  5. Accusative Case                 : A2
  6. Dative Case                     : A2  
  7. Perfekt (Past Tense)            : A2
  8. Modal Verbs                     : A2

Intermediate (B1):
  9. Adjective Endings               : B1
  10. Two-Way Prepositions           : B1
  11. Word Order (Subordinate)       : B1
  12. Präteritum                     : B1

Advanced (B2):
  13. Konjunktiv II                  : B2
  14. Passive Voice                  : B2
  15. Konjunktiv I (Reported Speech) : B2
  16. Relative Clauses               : B2
  17. Genitive Case                  : B2
  18. Infinitive Constructions       : B2
```

**Topic Discovery:** User picks any topic. A "Recommended" badge appears on topics where SRS shows low accuracy words that likely need that grammar.

#### Exercise Session (Right Panel)

When a topic is selected:
1. Show grammar explanation (2-3 sentences from `explainGrammarFocus()`)
2. Load 8 exercises from `generateGrammarExercises()`
3. Display exercises one at a time

**Exercise Types:**

**Fill-in-the-Blank:**
```
Ich gebe _____ Hund Wasser.
         [input field]

Options: der | dem | den | des

[Check Answer]
```
After checking:
- Correct: green highlight + "✓ Richtig!"
- Wrong: red + show correct answer + explanation
- [Next Exercise] button

**Multiple Choice:**
```
Which sentence uses Konjunktiv II correctly?

○ Wenn ich reich bin, kaufe ich ein Auto.
● Wenn ich reich wäre, würde ich ein Auto kaufen.  ← correct
○ Wenn ich reich war, kaufte ich ein Auto.
○ Wenn ich reich sein, kaufen ich ein Auto.

[Check Answer]
```
After checking: show explanation paragraph

**Sentence Reorder (drag-and-drop):**
```
Arrange these words into a correct German sentence:

[gegessen] [hat] [Er] [schon] [das] [Brot]

Drag to reorder → [Er] [hat] [das] [Brot] [schon] [gegessen]

[Check Answer]
```
Implement with drag-and-drop using mouse events (no external drag library needed).

**Session Progress Bar:** 8 segments, turns green as exercises complete.

**End of Session Screen:**
- Score: N/8 correct
- XP earned: score × 5
- Weak points identified: "You struggled with dative adjective endings. Try this topic again."
- [Practice Again] | [Next Topic] | [Back to Gym]

**Grammar Coach Button:**
Fixed bottom-right floating button: "Ask the Coach 💬"
Opens a small chat panel:
- User types a grammar question in English or German
- `chatWithTutor()` responds as a patient tutor
- Shows 4 recent messages
- Closes on outside click

---

### PAGE 5: `VocabVault.jsx` (Vocabulary Manager)

**Purpose:** Import, browse, search, and manage all vocabulary. Gateway for adding new words.

#### Top Section: Import
- Large textarea with label "Paste your Duolingo word list here"
- Example shown below: "hilfreich\nhelpful\n\nSchatz\ntreasure\n..."
- [Import Words] button → runs `parseDuolingoFormat()` → `importWords()` → shows result snackbar:
  "✓ Added 47 words | 12 already existed | 0 ignored"
- File upload option: [📁 Upload words.txt] → reads file, auto-imports
- Manual add: two inputs side-by-side (German | Translation) + [+ Add] button

#### Search Bar
- Searches both German and English translation (substring, case-insensitive)
- Instant filter as user types
- Shows "N words" count after filter

#### Word List
Virtualized list (use windowing for performance with 1000+ words).
Each row:
```
[Avatar: first letter] | [German word]        | [Translation]     | [SRS bar] | [🔊] [🗑]
                       | der/die/das if known  | (shorter if long) |           |
```
- **SRS bar:** small 5-segment bar showing which Leitner "box" the word is in (more segments = better known)
- 🔊: plays pronunciation
- 🗑: delete with confirmation dialog
- Clicking a row opens the WordPopup for that word

#### Filters Row
```
All | New (not yet in SRS) | Learning | Mastered | Recently Added | Due Today
```

#### Stats Bar
```
Total: 1,031  |  Mastered: 234  |  Learning: 445  |  New: 352
```

#### Export Options
- [Copy German Only]: clipboard
- [Copy Pairs]: clipboard  
- [Download .txt]: file download

---

### PAGE 6: `Settings.jsx` (Configuration)

**Purpose:** API key entry, voice configuration, daily targets, app preferences.

#### DeepSeek API Key Section
- Input field (password type, show/hide toggle)
- Instructions: "Get your key at platform.deepseek.com → API Keys → Create Key"
- Test button: sends "say 'ok'" and shows success/fail
- Current status indicator: green "Connected" or red "No key"

#### Voice Settings
- Voice dropdown: all German de-DE browser voices (reload if empty)
- "Test Voice" button: says "Guten Tag! Ich heiße Deutsche Reise."
- Speed slider: 0.6 to 1.2 (default 0.85)
- Preview the selected voice instantly on slider change

#### Study Settings
- New cards per day: number input (5 to 30, default 15)
- Daily XP goal: 100 | 200 | 300 | 500 (select)
- Session reminder: browser notification time picker

#### Progress Settings
- Start date: date picker (for B2 countdown)
- Target date: auto-calculated (start date + 7 months), editable
- "Days remaining" shown

#### Data Management
- [Export All Data]: downloads JSON with all words + SRS cards
- [Import Backup]: restores from JSON
- [Reset Progress]: wipe SRS data only (keep words)
- [Clear Everything]: nuclear option with "Are you sure?" confirmation

---

## LAYOUT: `src/components/Layout.jsx` & `Sidebar.jsx`

### Sidebar (desktop, fixed left, 240px wide)

```
┌────────────────────┐
│  🇩🇪 Deutsche Reise │
│                    │
│  [Level: B1]       │
│  ████████░░ 67%    │
│                    │
│  🏠 Dashboard      │
│  🃏 Flashcards  [3]│  ← red badge: due count
│  📖 Story Studio   │
│  🏋️ Grammar Gym   │
│  📚 Vocab Vault    │
│                    │
│  ─────────────────│
│                    │
│  🔥 12 day streak  │
│  ⚡ 847 XP total   │
│                    │
│  ⚙️ Settings       │
└────────────────────┘
```

- Active page: highlighted with brand-500 background
- Due cards badge: red pill with number
- Streak: shows flame + count
- Collapsible to icon-only on small desktop (< 1200px)

### Mobile Bottom Navigation (< 768px)
```
[🏠 Home] [🃏 Cards] [📖 Story] [🏋️ Grammar] [📚 Vocab]
```
Fixed bottom, 5 icons.

### Top Bar
- Page title (left)
- XP today indicator (center): "⚡ 120 XP today"
- Notification bell (right), shows if cards are due

---

## XP SYSTEM

**XP is the gamification spine. It tracks daily effort without punishing mistakes.**

| Action | XP |
|---|---|
| Complete flashcard session | +30 |
| Each correct review | +5 |
| Each new card mastered first try | +10 |
| Read a full story chapter | +20 |
| Complete shadow mode for a chapter | +25 |
| Complete grammar exercise session | +40 |
| First word of the day (login bonus) | +10 |
| Perfect flashcard session (100%) | +50 bonus |
| 7-day streak milestone | +100 bonus |

**XP Toast Animation:**
- Every time XP is earned: small floating toast from bottom-right: "+20 XP ⚡"
- Framer Motion: fade in from below, hold 1.5s, fade out
- Multiple toasts stack

**Level-up notification:**
- When word count crosses a threshold: full-screen celebration:
  - Confetti animation (CSS-only, no library)
  - "Du bist jetzt [Level]! 🎉"
  - Big XP burst

---

## VISUAL DESIGN SYSTEM

### Colors (dark theme, default)
```
Background:      #020617 (surface-950)
Card background: #0f172a (surface-900)
Card border:     #1e293b (surface-800)
Primary text:    #f8fafc (white)
Secondary text:  #94a3b8 (slate-400)
Brand/Accent:    #0c8ee3 (brand-500)
Success:         #22c55e (green-500)
Warning:         #eab308 (yellow-500)
Error:           #ef4444 (red-500)
Known word:      #0d9488 (teal-600) with 20% opacity background
Unknown word:    #3b82f6 (blue-500) with 15% opacity background
Active word:     #fbbf24 (amber-400) with 30% opacity background
```

### Typography
- Headings: Inter 700
- Body: Inter 400
- German words in stories: Inter 500 (slightly bolder, easier to read)
- Code/vocabulary: JetBrains Mono (for word cards)

### Card Design
All cards use:
```css
background: #0f172a;
border: 1px solid #1e293b;
border-radius: 16px;
box-shadow: 0 4px 24px rgba(0,0,0,0.4);
```

Hover state: `border-color: #0c8ee3` (brand highlight)

### Animations (Framer Motion)
- **Page transitions:** Fade + slide (0.2s)
- **Flashcard flip:** 3D Y-axis rotation (0.4s)
- **Card appear:** Fade in from below (0.3s staggered)
- **Rating button press:** Scale 0.95 (0.1s)
- **XP toast:** Y slide + fade (1.5s total)
- **Streak flame:** Pulse animation (CSS keyframes)

---

## APP.JSX: ROUTING

```jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Flashcards from './pages/Flashcards'
import StoryStudio from './pages/StoryStudio'
import GrammarGym from './pages/GrammarGym'
import VocabVault from './pages/VocabVault'
import Settings from './pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/flashcards" element={<Flashcards />} />
          <Route path="/story" element={<StoryStudio />} />
          <Route path="/story/:id" element={<StoryStudio />} />
          <Route path="/grammar" element={<GrammarGym />} />
          <Route path="/grammar/:focus" element={<GrammarGym />} />
          <Route path="/vocab" element={<VocabVault />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  )
}
```

---

## FIRST-LAUNCH EXPERIENCE (Onboarding)

On first open (detect by checking if `dr_onboarded` localStorage key exists):

Show a welcome screen BEFORE the dashboard:

```
Page 1: Welcome
  "Willkommen! 🇩🇪"
  "You're starting your journey to German B2."
  "Let's set up in 2 minutes."
  [Let's go →]

Page 2: API Key
  "Enter your DeepSeek API key"
  [Input field]
  "Your key is stored only on this device. We never see it."
  [Test connection] [Continue →]

Page 3: Import Words
  "Import your Duolingo vocabulary"
  [Large textarea (paste your word list)]
  [📁 Upload words.txt]
  Shows live count: "1,031 words detected"
  [Import & Continue →]

Page 4: Voice Setup
  "Choose your German voice"
  [Voice dropdown]
  [▶ Test Voice], plays "Guten Tag! Ich freue mich, mit dir Deutsch zu lernen."
  Speed slider
  [Continue →]

Page 5: Ready!
  "Alles bereit! 🚀"
  Current level: [calculated from word count]
  B2 target: [date in 7 months]
  Daily goal: [N] new words + reviews
  [Start Learning →]
```

Set `dr_onboarded = true` and `dr_start_date = today` in localStorage after page 5.

---

## NOTIFICATIONS

Use browser Notification API:
- Request permission during onboarding
- Remind at user-set time if app hasn't been opened today
- Message: "🔥 Dein Streak wartet! [N] Karten sind heute fällig." (Your streak is waiting! N cards are due today.)
- Use `setInterval` on app load to register the daily notification via ServiceWorker if possible, else just on app focus

---

## ERROR STATES & LOADING

### API Key Missing
- When any AI feature is attempted without key: 
- Don't crash. Show modal: "DeepSeek API key needed → [Settings]"

### AI Error
- Show inline error card: "Couldn't connect to DeepSeek. Check your key in Settings."
- [Retry] button

### No Words Yet
- Flashcards empty state: "No words yet! Import your vocabulary in [Vocab Vault →]"
- Grammar gym: still works (uses generic German words)
- Story: still works (generates from frequency list)

### Loading States
- All async operations: show animated spinner + relevant message:
  - Generating story: "Schreibe deine Geschichte..." (Writing your story...)
  - Loading exercises: "Bereite Übungen vor..." (Preparing exercises...)
  - Explaining word: "Erkläre..." (Explaining...)

---

## PERFORMANCE REQUIREMENTS

- Initial page load: under 2 seconds on average connection
- Flashcard transitions: under 100ms (no API call between cards)
- Word popup: show cached translation immediately, AI explanation loads async
- Story text rendering with 1000+ words: use windowing if needed
- IndexedDB: all reads/writes async, never block UI thread

---

## MOBILE RESPONSIVENESS

All pages fully functional on mobile (375px+):
- Flashcards: full-screen card, rating buttons at bottom (thumb-reachable)
- Story reader: text 18px minimum, audio controls sticky bottom
- Shadow mode: one sentence fills screen, large repeat button
- Sidebar: replaced by bottom nav bar
- Word popup: bottom sheet (slides up from bottom on mobile)
- Import: textarea + file upload both work on mobile

---
