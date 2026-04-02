import { motion } from 'framer-motion'

const GERMAN_WORDS = [
  'Schreibe...', 'Denke...', 'Bereite vor...', 'Generiere...',
  'Erschaffe...', 'Analysiere...', 'Erkläre...'
]

export default function LoadingSpinner({ message, size = 'md', showWords = false }) {
  const sizes = {
    sm: 'h-4 w-4 border-2',
    md: 'h-8 w-8 border-3',
    lg: 'h-12 w-12 border-4',
    xl: 'h-16 w-16 border-4',
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className="relative">
        <div
          className={`${sizes[size]} rounded-full border-surface-700 border-t-brand-500 animate-spin`}
          style={{ borderWidth: size === 'sm' ? 2 : size === 'xl' ? 4 : 3 }}
        />
        {size === 'xl' && (
          <div className="absolute inset-1 rounded-full border-2 border-surface-700 border-b-brand-300 animate-spin"
               style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
        )}
      </div>

      {message && (
        <motion.p
          className="text-slate-400 text-sm font-medium"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {message}
        </motion.p>
      )}

      {showWords && (
        <motion.div
          className="flex flex-wrap gap-2 max-w-xs justify-center mt-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          {GERMAN_WORDS.map((w, i) => (
            <motion.span
              key={w}
              className="text-xs text-brand-400 font-mono"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0] }}
              transition={{
                delay: i * 0.3,
                duration: 1.5,
                repeat: Infinity,
                repeatDelay: GERMAN_WORDS.length * 0.3,
              }}
            >
              {w}
            </motion.span>
          ))}
        </motion.div>
      )}
    </div>
  )
}

export function PageLoader({ message = 'Loading...' }) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <LoadingSpinner size="lg" message={message} />
    </div>
  )
}
