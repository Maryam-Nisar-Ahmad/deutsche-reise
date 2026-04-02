import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Volume2, Clock } from 'lucide-react'
import { germanVoice } from '../../lib/voice'
import clsx from 'clsx'

export default function FlashCard({ card, mode = 'de_to_en', isFlipped, onFlip }) {
  const { word } = card

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
    <div className="flashcard-scene w-full" style={{ height: 320 }}>
      <div className={`flashcard-inner ${isFlipped ? 'flipped' : ''}`}>
        {/* Front */}
        <div className="flashcard-face card flex flex-col items-center justify-center p-8 text-center" style={{ height: 320 }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-slate-500 uppercase tracking-wider">
              {mode === 'de_to_en' ? 'German' : 'English'}
            </span>
          </div>

          <div className="flex items-center gap-3 mb-4">
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
              >
                <Volume2 size={22} />
              </button>
            )}
          </div>

          {mode === 'en_to_de' && (
            <p className="text-slate-500 text-sm">What's the German word?</p>
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
        <div className="flashcard-face flashcard-back card flex flex-col items-center justify-center p-8 text-center bg-surface-900" style={{ height: 320 }}>
          <div className="mb-3">
            <div className="flex items-center justify-center gap-2 mb-1">
              {word.gender && (
                <span className={clsx('text-xl font-medium', genderColor[word.gender] || 'text-slate-400')}>
                  {word.gender}
                </span>
              )}
              <h2 className="text-3xl font-bold text-white font-mono">{word.german}</h2>
              <button
                onClick={(e) => { e.stopPropagation(); germanVoice.speakWord(word.german) }}
                className="text-slate-500 hover:text-brand-400 transition-colors"
              >
                <Volume2 size={20} />
              </button>
            </div>
            <div className="text-xl text-brand-300 font-medium">{word.translation}</div>
            {word.plural && (
              <div className="text-sm text-slate-500 mt-0.5">Plural: {word.plural}</div>
            )}
          </div>

          {word.example && (
            <div className="mt-3 pt-3 border-t border-surface-700 text-center max-w-sm">
              <p className="text-sm text-slate-300 italic">{word.example}</p>
              <button
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
