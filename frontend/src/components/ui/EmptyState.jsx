import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex flex-col items-center justify-center py-16 px-4 text-center',
        className
      )}
    >
      {Icon && (
        <div className="w-16 h-16 rounded-2xl bg-dark-800 flex items-center justify-center mb-4">
          <Icon className="w-8 h-8 text-dark-500" />
        </div>
      )}
      <h3 className="text-lg font-medium text-dark-200 mb-2">{title}</h3>
      {description && (
        <p className="text-dark-400 max-w-sm mb-6">{description}</p>
      )}
      {action}
    </motion.div>
  )
}
