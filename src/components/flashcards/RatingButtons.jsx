import { motion } from 'framer-motion'
import { getIntervalPreview } from '../../lib/srs'

const RATINGS = [
  { value: 1, label: 'Forgot', color: 'bg-red-600 hover:bg-red-500 border-red-700', textColor: 'text-white', key: '1' },
  { value: 2, label: 'Hard',   color: 'bg-orange-600 hover:bg-orange-500 border-orange-700', textColor: 'text-white', key: '2' },
  { value: 3, label: 'Good',   color: 'bg-green-600 hover:bg-green-500 border-green-700', textColor: 'text-white', key: '3' },
  { value: 4, label: 'Easy',   color: 'bg-emerald-500 hover:bg-emerald-400 border-emerald-600', textColor: 'text-white', key: '4' },
]

export default function RatingButtons({ card, onRate }) {
  return (
    <div className="grid grid-cols-4 gap-2 w-full">
      {RATINGS.map((r, i) => {
        const preview = getIntervalPreview(card, r.value)
        return (
          <motion.button
            key={r.value}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onRate(r.value)}
            className={`
              flex flex-col items-center justify-center py-3 px-2 rounded-xl
              border font-semibold text-sm transition-all duration-100
              ${r.color} ${r.textColor}
            `}
          >
            <span className="font-bold">{r.value} {r.label}</span>
            <span className="text-xs opacity-75 mt-0.5 font-normal">{preview}</span>
          </motion.button>
        )
      })}
    </div>
  )
}
