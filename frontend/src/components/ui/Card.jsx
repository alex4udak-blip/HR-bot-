import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

export function Card({ children, className, hover = false, ...props }) {
  const Component = hover ? motion.div : 'div'
  const hoverProps = hover
    ? {
        whileHover: { scale: 1.02, y: -2 },
        transition: { type: 'spring', stiffness: 300 },
      }
    : {}

  return (
    <Component
      className={cn('glass-card', className)}
      {...hoverProps}
      {...props}
    >
      {children}
    </Component>
  )
}

export function CardHeader({ children, className }) {
  return (
    <div className={cn('flex items-center justify-between mb-4', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className }) {
  return (
    <h3 className={cn('text-lg font-semibold text-dark-100', className)}>
      {children}
    </h3>
  )
}

export function CardContent({ children, className }) {
  return <div className={cn(className)}>{children}</div>
}
