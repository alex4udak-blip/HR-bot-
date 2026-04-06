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
  { value: 'hire', label: 'Нанять', color: 'text-green-400 bg-green-500/20 border-green-500/30' },
  { value: 'maybe', label: 'Возможно', color: 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30' },
  { value: 'reject', label: 'Отказ', color: 'text-red-400 bg-red-500/20 border-red-500/30' },
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
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
        onClick={onCancel}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg rounded-xl border border-white/10 bg-[#1a1a2e] shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <FileText className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Итог собеседования</h2>
                <p className="text-sm text-white/50">
                  {application.entity_name} → {APPLICATION_STAGE_LABELS[targetStage]}
                </p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 space-y-4">
            {/* Interview Summary (required) */}
            <div>
              <label className="block text-sm text-white/70 mb-1.5">
                Итог собеседования <span className="text-red-400">*</span>
              </label>
              <textarea
                value={summary}
                onChange={(e) => {
                  setSummary(e.target.value);
                  if (error) setError('');
                }}
                rows={4}
                className={clsx(
                  'w-full px-3 py-2.5 bg-white/[0.04] border rounded-lg text-white placeholder-white/30',
                  'focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 resize-none transition-all',
                  error && !summary.trim() ? 'border-red-500/50' : 'border-white/[0.06]'
                )}
                placeholder="Опишите ключевые моменты собеседования, впечатления, сильные и слабые стороны кандидата..."
                autoFocus
              />
              {error && (
                <p className="text-xs text-red-400 mt-1">{error}</p>
              )}
            </div>

            {/* Rating (optional) */}
            <div>
              <label className="block text-sm text-white/70 mb-1.5">
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
                        ? 'text-yellow-400'
                        : 'text-white/20 hover:text-white/40'
                    )}
                  >
                    <Star className={clsx('w-6 h-6', value <= rating && 'fill-current')} />
                  </button>
                ))}
                {rating > 0 && (
                  <span className="ml-2 text-sm text-white/40">{rating} / 5</span>
                )}
              </div>
            </div>

            {/* Recommendation (optional) */}
            <div>
              <label className="block text-sm text-white/70 mb-1.5">
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
                        : 'border-white/[0.06] text-white/40 hover:text-white/60 hover:border-white/10'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-4 border-t border-white/10">
            <button
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 text-white/60 hover:text-white transition-colors rounded-lg"
            >
              Отмена
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !summary.trim()}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all',
                summary.trim()
                  ? 'bg-purple-600 hover:bg-purple-500 text-white'
                  : 'bg-white/[0.04] text-white/30 cursor-not-allowed'
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
