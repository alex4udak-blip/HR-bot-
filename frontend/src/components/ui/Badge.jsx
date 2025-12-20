import { cn } from '../../lib/utils'

const variants = {
  default: 'bg-dark-700 text-dark-300 border border-dark-600',
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
}

export function Badge({ children, variant = 'default', className }) {
  return (
    <span className={cn('badge', variants[variant], className)}>
      {children}
    </span>
  )
}
