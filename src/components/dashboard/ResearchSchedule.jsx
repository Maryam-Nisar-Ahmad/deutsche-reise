import { motion } from 'framer-motion'
import { Clock } from 'lucide-react'

const LINES = [
  'Morning: flashcards, then Frequency Lab (your daily goal).',
  'Grammar block when you can.',
  'Listening / reading / Story Studio.',
  'Speaking or writing most days.',
  'Background German audio when it fits.',
]

export default function ResearchSchedule() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-5 border-brand-500/20"
    >
      <div className="flex items-center gap-2 mb-3">
        <Clock size={18} className="text-brand-400" />
        <h3 className="font-semibold text-white text-sm">Daily rhythm</h3>
      </div>
      <ul className="text-xs text-slate-400 space-y-1.5 list-disc list-inside">
        {LINES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="text-[11px] text-slate-500 mt-3">
        Longer notes: <code className="text-slate-400">public/FIRST_WEEK_GUIDE.txt</code>
      </p>
    </motion.div>
  )
}
