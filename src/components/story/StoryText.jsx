import { useMemo } from 'react'
import clsx from 'clsx'
import { normalizeGerman } from '../../lib/wordParser'

/** Strip leading/trailing punctuation before vocabulary match (exact normalizedKey only). */
const EDGE_PUNCT_RE = /^[.,!?"„"\u201C\u201D;:\u2014\u2013()]+|[.,!?"„"\u201C\u201D;:\u2014\u2013()]+$/g

function stripEdgesForMatch(token) {
  let s = token
  let prev = ''
  while (s !== prev) {
    prev = s
    s = s.replace(EDGE_PUNCT_RE, '')
  }
  return s
}

/** Token for display: split on spaces, keep whitespace chunks. */
function tokenizeBySpaces(text) {
  return text.split(/(\s+)/).filter(part => part.length > 0)
}

function lookupKey(strippedToken) {
  if (!strippedToken) return ''
  return normalizeGerman(strippedToken)
}

export default function StoryText({
  text,
  knownWords = new Set(),
  knownTranslations = new Map(),
  unknownMeanings = {},
  activeWordIndex = -1,
  onWordClick,
}) {
  const tokens = useMemo(() => tokenizeBySpaces(text), [text])

  let wordCounter = 0
  const tokenData = tokens.map(token => {
    if (/^\s+$/.test(token)) {
      return { token, type: 'other', wordIndex: -1 }
    }

    const stripped = stripEdgesForMatch(token)
    const key = lookupKey(stripped)
    const isKnown = key.length > 0 && knownWords.has(key)
    const hasUnknownMeaning = key.length > 0 && !!unknownMeanings[key]
    const thisIndex = wordCounter++

    return {
      token,
      stripped,
      key,
      type: 'word',
      wordIndex: thisIndex,
      isKnown,
      hasUnknownMeaning,
    }
  })

  return (
    <p className="text-[17px] leading-relaxed text-slate-200 font-medium whitespace-pre-wrap">
      {tokenData.map((td, i) => {
        if (td.type !== 'word') {
          return <span key={i}>{td.token}</span>
        }

        const isActive = td.wordIndex === activeWordIndex
        const known = td.isKnown
        const unknown = td.hasUnknownMeaning
        const tooltip = known
          ? (knownTranslations.get(td.key) || 'In your vocabulary')
          : unknown
            ? unknownMeanings[td.key]
            : undefined

        return (
          <span
            key={i}
            onClick={() => onWordClick?.(td.key, td.stripped || td.token)}
            title={tooltip}
            className={clsx(
              'transition-colors duration-100 rounded-sm cursor-pointer',
              isActive && 'word-active',
              !isActive && known && 'word-known',
              !isActive && !known && unknown && 'word-unknown',
              !isActive && !known && !unknown && 'word-plain hover:bg-white/10',
            )}
          >
            {td.token}
          </span>
        )
      })}
    </p>
  )
}
