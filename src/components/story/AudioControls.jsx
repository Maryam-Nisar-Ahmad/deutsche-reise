import { Play, Pause, Square, SkipBack, SkipForward, Mic } from 'lucide-react'
import clsx from 'clsx'

const SPEED_OPTIONS = [0.6, 0.75, 0.85, 1.0, 1.2]

export default function AudioControls({
  isPlaying,
  onPlay,
  onPause,
  onStop,
  onPrevChapter,
  onNextChapter,
  rate,
  onRateChange,
  voices,
  selectedVoiceURI,
  onVoiceChange,
  shadowMode,
  onToggleShadow,
  canGoPrev,
  canGoNext,
}) {
  return (
    <div className="sticky bottom-0 left-0 right-0 bg-surface-900/95 backdrop-blur-sm border-t border-surface-800 px-4 py-3">
      <div className="max-w-3xl mx-auto space-y-3">
        {/* Main controls */}
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={onPrevChapter}
            disabled={!canGoPrev}
            className="p-2 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <SkipBack size={20} />
          </button>

          {isPlaying ? (
            <button
              onClick={onPause}
              className="w-12 h-12 rounded-full bg-brand-500 hover:bg-brand-400 flex items-center justify-center text-white transition-colors shadow-lg shadow-brand-500/30"
            >
              <Pause size={22} />
            </button>
          ) : (
            <button
              onClick={onPlay}
              className="w-12 h-12 rounded-full bg-brand-500 hover:bg-brand-400 flex items-center justify-center text-white transition-colors shadow-lg shadow-brand-500/30"
            >
              <Play size={22} className="ml-0.5" />
            </button>
          )}

          <button
            onClick={onNextChapter}
            disabled={!canGoNext}
            className="p-2 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <SkipForward size={20} />
          </button>
        </div>

        {/* Speed + voice + shadow */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Speed */}
          <div className="flex items-center gap-1">
            {SPEED_OPTIONS.map(s => (
              <button
                key={s}
                onClick={() => onRateChange(s)}
                className={clsx(
                  'px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                  Math.abs(rate - s) < 0.01
                    ? 'bg-brand-500 text-white'
                    : 'bg-surface-800 text-slate-400 hover:text-white'
                )}
              >
                {s}×
              </button>
            ))}
          </div>

          {/* Voice selector */}
          {voices.length > 0 && (
            <select
              value={selectedVoiceURI || ''}
              onChange={e => onVoiceChange(e.target.value)}
              className="bg-surface-800 border border-surface-700 text-slate-300 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-brand-500 max-w-[160px]"
            >
              {voices.map(v => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
              ))}
            </select>
          )}

          {/* Shadow mode toggle */}
          <button
            onClick={onToggleShadow}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              shadowMode
                ? 'bg-orange-500 text-white'
                : 'bg-surface-800 text-slate-400 hover:text-white'
            )}
          >
            <Mic size={13} />
            {shadowMode ? 'Shadow Mode ON' : 'Shadow Mode'}
          </button>
        </div>
      </div>
    </div>
  )
}
