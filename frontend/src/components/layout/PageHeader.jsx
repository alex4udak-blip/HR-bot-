import { motion } from 'framer-motion'

export function PageHeader({ title, description, actions }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8"
    >
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-dark-100">
          {title}
        </h1>
        {description && (
          <p className="text-dark-400 mt-1">{description}</p>
        )}
      </div>
      {actions && <div className="flex gap-3">{actions}</div>}
    </motion.div>
  )
}
