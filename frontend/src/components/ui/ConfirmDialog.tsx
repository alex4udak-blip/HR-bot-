import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Info, AlertCircle, X } from 'lucide-react';
import clsx from 'clsx';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

const variantConfig = {
  danger: {
    icon: AlertCircle,
    iconColor: 'text-red-400',
    bgColor: 'bg-red-500/10',
    buttonColor: 'bg-red-600 hover:bg-red-500',
  },
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    buttonColor: 'bg-yellow-600 hover:bg-yellow-500',
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    buttonColor: 'bg-blue-600 hover:bg-blue-500',
  },
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  const config = variantConfig[variant];
  const Icon = config.icon;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !loading) {
      onCancel();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={loading ? undefined : onCancel}
          onKeyDown={handleKeyDown}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-description"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-md overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-start gap-4 p-5">
              <div className={clsx('p-2 rounded-lg', config.bgColor)}>
                <Icon className={clsx('w-6 h-6', config.iconColor)} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <h3
                  id="confirm-dialog-title"
                  className="text-lg font-semibold text-white"
                >
                  {title}
                </h3>
                <p id="confirm-dialog-description" className="mt-2 text-sm text-white/60">{message}</p>
              </div>
              <button
                onClick={onCancel}
                disabled={loading}
                className="p-1 hover:bg-dark-800/50 rounded-lg transition-colors disabled:opacity-50"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5 text-white/40" />
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 px-5 py-4 glass-light border-t border-white/10">
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="px-4 py-2 text-white/60 hover:text-white hover:bg-dark-800/50 rounded-lg transition-colors disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className={clsx(
                  'px-4 py-2 rounded-lg transition-colors disabled:opacity-50',
                  config.buttonColor
                )}
              >
                {loading ? 'Processing...' : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
