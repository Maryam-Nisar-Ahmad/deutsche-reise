import { Volume2, Clock } from 'lucide-react'
import { germanVoice } from '../../lib/voice'
import clsx from 'clsx'

const CARD_SCENE_HEIGHT = 400

export default function FlashCard({ card, mode = 'de_to_en', isFlipped, onFlip }) {
  const { word } = card
  const flashExamples = Array.isArray(card.flashExamples)
    ? card.flashExamples.filter((ex) => ex && String(ex.de || '').trim())
    : []
  const hasFlashExamples = flashExamples.length > 0

  // Format last reviewed
  const lastReviewedText = card.lastReview
    ? (() => {
        const days = Math.round((Date.now() - card.lastReview) / 86400000)
        if (days === 0) return 'Reviewed today'
        if (days === 1) return 'Reviewed yesterday'
        return `Reviewed ${days} days ago`
      })()
    : 'New card'

  const genderColor = {
    der: 'text-blue-400',
    die: 'text-pink-400',
    das: 'text-green-400',
  }

  return (
    <div className="flashcard-scene w-full" style={{ height: CARD_SCENE_HEIGHT }}>
      <div className={`flashcard-inner ${isFlipped ? 'flipped' : ''}`}>
        {/* Front */}
        <div
          className="flashcard-face card flex flex-col items-center justify-center p-6 sm:p-8 text-center"
          style={{ height: CARD_SCENE_HEIGHT }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-slate-500 uppercase tracking-wider">
              {mode === 'de_to_en' ? 'German' : 'English'}
            </span>
          </div>

          <div className="flex items-center gap-3 mb-4 flex-wrap justify-center">
                {mode === 'de_to_en' && word.gender && (
                  <span className={clsx('text-xl font-medium', genderColor[word.gender] || 'text-slate-400')}>
                    {word.gender}
                  </span>
                )}
                <h2 className="text-4xl font-bold text-white font-mono">
                  {mode === 'de_to_en' ? word.german : word.translation}
                </h2>
                {mode === 'de_to_en' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); germanVoice.speakWord(word.german) }}
                    className="text-slate-500 hover:text-brand-400 transition-colors"
                    type="button"
                    aria-label="Play German"
                  >
                    <Volume2 size={22} />
                  </button>
                )}
                {mode === 'en_to_de' && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); germanVoice.speakWord(word.german) }}
                    className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 border border-brand-500/40 rounded-lg px-2 py-1"
                    aria-label="Hear German answer"
                  >
                    <Volume2 size={14} />
                    Hear German
                  </button>
                )}
              </div>

          {mode === 'en_to_de' && (
            <p className="text-slate-500 text-sm">What is the German for this English cue?</p>
          )}

          <div className="mt-auto flex items-center gap-1 text-xs text-slate-600">
            <Clock size={11} />
            <span>{lastReviewedText}</span>
          </div>

          <button
            onClick={onFlip}
            className="mt-4 px-6 py-2 bg-surface-800 hover:bg-surface-700 text-slate-300 text-sm font-medium rounded-xl transition-all border border-surface-700 hover:border-surface-600"
          >
            Show Answer
          </button>
        </div>

        {/* Back */}
        <div
          className="flashcard-face flashcard-back card flex flex-col items-center justify-start p-4 sm:p-5 text-center bg-surface-900 overflow-y-auto"
          style={{ height: CARD_SCENE_HEIGHT }}
        >
          <div className="w-full max-w-lg shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">German</div>
            <div className="flex items-center justify-center gap-2 mb-2 flex-wrap">
              {word.gender && (
                <span className={clsx('text-xl font-medium', genderColor[word.gender] || 'text-slate-400')}>
                  {word.gender}
                </span>
              )}
              <h2 className="text-2xl sm:text-3xl font-bold text-white font-mono">{word.german}</h2>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); germanVoice.speakWord(word.german) }}
                className="text-slate-500 hover:text-brand-400 transition-colors"
                aria-label="Play German"
              >
                <Volume2 size={20} />
              </button>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">English</div>
            <div className="text-lg sm:text-xl text-brand-300 font-medium px-1">{word.translation}</div>

            {hasFlashExamples && (
              <div className="mt-3 pt-3 border-t border-surface-700 w-full">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
                  Examples (from your saved lesson)
                </div>
                <ul className="space-y-2 text-left">
                  {flashExamples.map((ex, i) => (
                    <li
                      key={i}
                      className="rounded-lg bg-surface-800/90 border border-surface-700 px-3 py-2"
                    >
                      <p className="text-sm text-slate-100 leading-snug">{ex.de}</p>
                      {String(ex.en || '').trim() ? (
                        <p className="text-xs text-slate-400 mt-1 leading-snug">{ex.en}</p>
                      ) : null}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          germanVoice.speakWord(ex.de)
                        }}
                        className="mt-1.5 text-[11px] text-brand-400 hover:underline"
                      >
                        Play German
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {Array.isArray(word.variants) && word.variants.length > 0 && (
              <div className="mt-3 text-left w-full rounded-xl bg-surface-800/80 border border-surface-700 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Forms</div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {[word.german, ...word.variants].filter(Boolean).join(', ')}
                </p>
              </div>
            )}
            {word.plural && (
              <div className="text-sm text-slate-500 mt-2">Plural: {word.plural}</div>
            )}
          </div>

          {!hasFlashExamples && word.example && (
            <div className="mt-3 pt-3 border-t border-surface-700 text-center max-w-sm w-full shrink-0">
              <p className="text-sm text-slate-300 italic">{word.example}</p>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); germanVoice.speakWord(word.example) }}
                className="mt-1 text-xs text-slate-500 hover:text-brand-400 flex items-center gap-1 mx-auto transition-colors"
              >
                <Volume2 size={11} />
                Hear example
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
