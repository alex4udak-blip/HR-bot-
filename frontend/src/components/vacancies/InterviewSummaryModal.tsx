import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Star, FileText, Send } from 'lucide-react';
import clsx from 'clsx';
import type { VacancyApplication, ApplicationStage } from '@/types';
import { APPLICATION_STAGE_LABELS } from '@/types';

interface InterviewSummaryModalProps {
  application: VacancyApplication;
  targetStage: ApplicationStage;
  onConfirm: (data: InterviewSummaryData) => Promise<void>;
  onCancel: () => void;
}

export interface InterviewSummaryData {
  interview_summary: string;
  rating?: number;
  recommendation?: 'hire' | 'maybe' | 'reject';
}

const RECOMMENDATION_OPTIONS = [
  { value: 'hire', label: 'Нанять', color: 'text-[var(--hf-status-green)] bg-[var(--hf-status-green-badge)] border-[color:var(--hf-status-green-badge)]' },
  { value: 'maybe', label: 'Возможно', color: 'text-[var(--hf-status-yellow)] bg-[var(--hf-status-yellow-badge)] border-[color:var(--hf-status-yellow-badge)]' },
  { value: 'reject', label: 'Отказ', color: 'text-[var(--hf-status-red)] bg-[var(--hf-status-red-badge)] border-[color:var(--hf-status-red-badge)]' },
] as const;

export default function InterviewSummaryModal({
  application,
  targetStage,
  onConfirm,
  onCancel,
}: InterviewSummaryModalProps) {
  const [summary, setSummary] = useState('');
  const [rating, setRating] = useState(0);
  const [recommendation, setRecommendation] = useState<'hire' | 'maybe' | 'reject' | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!summary.trim()) {
      setError('Заполните итог собеседования');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onConfirm({
        interview_summary: summary.trim(),
        rating: rating > 0 ? rating : undefined,
        recommendation: recommendation || undefined,
      });
    } catch {
      setError('Ошибка при сохранении. Попробуйте ещё раз.');
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-[var(--hf-black-alpha-60)] backdrop-blur-sm z-[60] flex items-center justify-center p-4"
        onClick={onCancel}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg rounded-xl border border-[color:var(--hf-white-alpha-10)] bg-[var(--hf-bg-dark)] shadow-[var(--hf-shadow-2xl)] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-[color:var(--hf-white-alpha-10)]">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[var(--hf-status-purple-badge)] rounded-lg">
                <FileText className="w-5 h-5 text-[var(--hf-status-purple)]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--hf-white)]">Итог собеседования</h2>
                <p className="text-sm text-[color:var(--hf-white-alpha-50)]">
                  {application.entity_name} → {APPLICATION_STAGE_LABELS[targetStage]}
                </p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="p-2 hover:bg-[var(--hf-white-alpha-10)] rounded-lg transition-colors text-[color:var(--hf-white-alpha-60)] hover:text-[var(--hf-white)]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 space-y-4">
            {/* Interview Summary (required) */}
            <div>
              <label className="block text-sm text-[color:var(--hf-white-alpha-70)] mb-1.5">
                Итог собеседования <span className="text-[var(--hf-status-red)]">*</span>
              </label>
              <textarea
                value={summary}
                onChange={(e) => {
                  setSummary(e.target.value);
                  if (error) setError('');
                }}
                rows={4}
                className={clsx(
                  'w-full px-3 py-2.5 bg-[var(--hf-white-alpha-04)] border rounded-lg text-[var(--hf-white)] placeholder:text-[color:var(--hf-white-alpha-30)]',
                  'focus:outline-none focus:ring-2 focus:ring-[var(--hf-status-purple-badge)] focus:border-[color:var(--hf-status-purple-badge)] resize-none transition-all',
                  error && !summary.trim() ? 'border-[color:var(--hf-status-red-badge)]' : 'border-[color:var(--hf-white-alpha-06)]'
                )}
                placeholder="Опишите ключевые моменты собеседования, впечатления, сильные и слабые стороны кандидата..."
                autoFocus
              />
              {error && (
                <p className="text-xs text-[var(--hf-status-red)] mt-1">{error}</p>
              )}
            </div>

            {/* Rating (optional) */}
            <div>
              <label className="block text-sm text-[color:var(--hf-white-alpha-70)] mb-1.5">
                Оценка кандидата
              </label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    onClick={() => setRating(value === rating ? 0 : value)}
                    className={clsx(
                      'p-1.5 rounded-lg transition-all',
                      value <= rating
                        ? 'text-[var(--hf-status-yellow)]'
                        : 'text-[color:var(--hf-white-alpha-20)] hover:text-[color:var(--hf-white-alpha-40)]'
                    )}
                  >
                    <Star className={clsx('w-6 h-6', value <= rating && 'fill-current')} />
                  </button>
                ))}
                {rating > 0 && (
                  <span className="ml-2 text-sm text-[color:var(--hf-white-alpha-40)]">{rating} / 5</span>
                )}
              </div>
            </div>

            {/* Recommendation (optional) */}
            <div>
              <label className="block text-sm text-[color:var(--hf-white-alpha-70)] mb-1.5">
                Рекомендация
              </label>
              <div className="flex items-center gap-2">
                {RECOMMENDATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setRecommendation(recommendation === opt.value ? '' : opt.value)}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg border text-sm font-medium transition-all',
                      recommendation === opt.value
                        ? opt.color
                        : 'border-[color:var(--hf-white-alpha-06)] text-[color:var(--hf-white-alpha-40)] hover:text-[color:var(--hf-white-alpha-60)] hover:border-[color:var(--hf-white-alpha-10)]'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-4 border-t border-[color:var(--hf-white-alpha-10)]">
            <button
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 text-[color:var(--hf-white-alpha-60)] hover:text-[var(--hf-white)] transition-colors rounded-lg"
            >
              Отмена
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !summary.trim()}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all',
                summary.trim()
                  ? 'bg-[var(--hf-status-purple)] hover:bg-[var(--hf-status-purple)] text-[var(--hf-white)]'
                  : 'bg-[var(--hf-white-alpha-04)] text-[color:var(--hf-white-alpha-30)] cursor-not-allowed'
              )}
            >
              <Send className="w-4 h-4" />
              {loading ? 'Сохранение...' : 'Сохранить и перевести'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
