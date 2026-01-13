/**
 * CompatibilityBadge Component
 *
 * Displays AI-calculated compatibility score between a candidate and vacancy.
 * Shows color-coded badge with tooltip containing detailed breakdown.
 */
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Target,
  Briefcase,
  DollarSign,
  Heart,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  Loader2,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import type { CompatibilityScore } from '@/types';

interface CompatibilityBadgeProps {
  /** Pre-loaded compatibility score */
  score?: CompatibilityScore | null;
  /** Loading state */
  isLoading?: boolean;
  /** Error message */
  error?: string | null;
  /** Callback to calculate/recalculate score */
  onCalculate?: () => void;
  /** Show detailed breakdown on hover */
  showDetails?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show only the badge without dropdown */
  compact?: boolean;
}

// Score color utilities
const getScoreColor = (score: number): string => {
  if (score >= 70) return 'text-green-400';
  if (score >= 40) return 'text-yellow-400';
  return 'text-red-400';
};

const getScoreBgColor = (score: number): string => {
  if (score >= 70) return 'bg-green-500/20 border-green-500/30';
  if (score >= 40) return 'bg-yellow-500/20 border-yellow-500/30';
  return 'bg-red-500/20 border-red-500/30';
};

const getRecommendationLabel = (recommendation: string): { label: string; color: string } => {
  switch (recommendation) {
    case 'hire':
      return { label: 'Рекомендуем', color: 'text-green-400' };
    case 'maybe':
      return { label: 'На рассмотрение', color: 'text-yellow-400' };
    case 'reject':
      return { label: 'Не рекомендуем', color: 'text-red-400' };
    default:
      return { label: 'Не определено', color: 'text-white/60' };
  }
};

// Score bar component
function ScoreBar({ label, score, icon: Icon }: { label: string; score: number; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-white/40 flex-shrink-0" />
      <span className="text-xs text-white/60 w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className={`h-full rounded-full ${
            score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-yellow-500' : 'bg-red-500'
          }`}
        />
      </div>
      <span className={`text-xs font-medium w-8 text-right ${getScoreColor(score)}`}>
        {score}
      </span>
    </div>
  );
}

export default function CompatibilityBadge({
  score,
  isLoading = false,
  error = null,
  onCalculate,
  showDetails = true,
  size = 'md',
  compact = false
}: CompatibilityBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Size variants
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-3 py-1.5'
  };

  // Loading state
  if (isLoading) {
    return (
      <div className={`inline-flex items-center gap-1.5 ${sizeClasses[size]} rounded-md bg-white/5 border border-white/10`}>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="w-3.5 h-3.5 text-blue-400" />
        </motion.div>
        <span className="text-white/60">AI...</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <button
        onClick={onCalculate}
        className={`inline-flex items-center gap-1.5 ${sizeClasses[size]} rounded-md bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors`}
        title={error}
      >
        <AlertCircle className="w-3.5 h-3.5" />
        <span>Ошибка</span>
      </button>
    );
  }

  // No score - show calculate button
  if (!score) {
    return (
      <button
        onClick={onCalculate}
        disabled={!onCalculate}
        className={`inline-flex items-center gap-1.5 ${sizeClasses[size]} rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span>AI скор</span>
      </button>
    );
  }

  // Compact badge without dropdown
  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-1 ${sizeClasses[size]} rounded-md border ${getScoreBgColor(score.overall_score)}`}
        title={`${score.overall_score}% совместимость`}
      >
        <Sparkles className="w-3 h-3" />
        <span className={`font-bold ${getScoreColor(score.overall_score)}`}>
          {score.overall_score}
        </span>
      </div>
    );
  }

  const recommendation = getRecommendationLabel(score.recommendation);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Badge Button */}
      <button
        onClick={() => showDetails && setIsOpen(!isOpen)}
        className={`inline-flex items-center gap-1.5 ${sizeClasses[size]} rounded-md border ${getScoreBgColor(score.overall_score)} transition-all ${
          showDetails ? 'hover:brightness-110 cursor-pointer' : 'cursor-default'
        }`}
      >
        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
        <span className={`font-bold ${getScoreColor(score.overall_score)}`}>
          {score.overall_score}%
        </span>
        {showDetails && (
          <ChevronDown
            className={`w-3.5 h-3.5 text-white/40 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && showDetails && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 mt-2 left-0 w-72 p-4 bg-[#1a1a2e] border border-white/10 rounded-xl shadow-xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg ${getScoreBgColor(score.overall_score)}`}>
                  <Sparkles className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">AI Совместимость</p>
                  <p className={`text-xs ${recommendation.color}`}>{recommendation.label}</p>
                </div>
              </div>
              <div className={`text-2xl font-bold ${getScoreColor(score.overall_score)}`}>
                {score.overall_score}%
              </div>
            </div>

            {/* Score Breakdown */}
            <div className="space-y-2 mb-4">
              <ScoreBar label="Навыки" score={score.skills_match} icon={Target} />
              <ScoreBar label="Опыт" score={score.experience_match} icon={Briefcase} />
              <ScoreBar label="Зарплата" score={score.salary_match} icon={DollarSign} />
              <ScoreBar label="Культура" score={score.culture_fit} icon={Heart} />
            </div>

            {/* Summary */}
            {score.summary && (
              <p className="text-xs text-white/60 mb-3 leading-relaxed">
                {score.summary}
              </p>
            )}

            {/* Strengths */}
            {score.strengths && score.strengths.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <ThumbsUp className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-xs font-medium text-green-400">Сильные стороны</span>
                </div>
                <ul className="space-y-1">
                  {score.strengths.slice(0, 3).map((strength, idx) => (
                    <li key={idx} className="text-xs text-white/70 pl-5 relative">
                      <span className="absolute left-1.5 top-1.5 w-1 h-1 rounded-full bg-green-400" />
                      {strength}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Weaknesses */}
            {score.weaknesses && score.weaknesses.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <ThumbsDown className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-xs font-medium text-red-400">Риски</span>
                </div>
                <ul className="space-y-1">
                  {score.weaknesses.slice(0, 3).map((weakness, idx) => (
                    <li key={idx} className="text-xs text-white/70 pl-5 relative">
                      <span className="absolute left-1.5 top-1.5 w-1 h-1 rounded-full bg-red-400" />
                      {weakness}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recalculate Button */}
            {onCalculate && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCalculate();
                  setIsOpen(false);
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 mt-2 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Пересчитать
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Export utilities for use in other components
export { getScoreColor, getScoreBgColor, getRecommendationLabel };
