import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Quote
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import * as api from '@/services/api';
import type { RedFlagsAnalysis, RedFlag } from '@/services/api';

interface RedFlagsPanelProps {
  entityId: number;
  vacancyId?: number;
  className?: string;
}

// Severity config with colors and icons
const SEVERITY_CONFIG = {
  high: {
    icon: AlertTriangle,
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/30',
    textColor: 'text-red-400',
    label: 'Критический'
  },
  medium: {
    icon: AlertCircle,
    bgColor: 'bg-orange-500/20',
    borderColor: 'border-orange-500/30',
    textColor: 'text-orange-400',
    label: 'Средний'
  },
  low: {
    icon: Info,
    bgColor: 'bg-yellow-500/20',
    borderColor: 'border-yellow-500/30',
    textColor: 'text-yellow-400',
    label: 'Низкий'
  }
};

// Risk score indicator
function RiskScoreIndicator({ score }: { score: number }) {
  const getColor = () => {
    if (score >= 60) return 'from-red-500 to-red-600';
    if (score >= 30) return 'from-orange-500 to-orange-600';
    return 'from-green-500 to-green-600';
  };

  const getIcon = () => {
    if (score >= 60) return ShieldAlert;
    if (score >= 30) return Shield;
    return ShieldCheck;
  };

  const Icon = getIcon();

  return (
    <div className="flex items-center gap-3 p-4 glass-light rounded-xl">
      <div className={clsx('p-3 rounded-xl bg-gradient-to-br', getColor())}>
        <Icon size={24} className="text-white" />
      </div>
      <div>
        <div className="text-2xl font-bold text-white">{score}</div>
        <div className="text-sm text-white/60">Риск-скор</div>
      </div>
      <div className="ml-auto text-right">
        <div className={clsx(
          'text-sm font-medium',
          score >= 60 ? 'text-red-400' : score >= 30 ? 'text-orange-400' : 'text-green-400'
        )}>
          {score >= 60 ? 'Высокий риск' : score >= 30 ? 'Средний риск' : 'Низкий риск'}
        </div>
        <div className="text-xs text-white/40 mt-1">
          {score >= 60
            ? 'Требуется детальная проверка'
            : score >= 30
              ? 'Обратите внимание на замечания'
              : 'Кандидат выглядит хорошо'}
        </div>
      </div>
    </div>
  );
}

// Single red flag card
function RedFlagCard({ flag, isExpanded, onToggle }: {
  flag: RedFlag;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const config = SEVERITY_CONFIG[flag.severity];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        'rounded-xl border overflow-hidden transition-colors',
        config.bgColor,
        config.borderColor
      )}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-start gap-3 text-left hover:bg-dark-800/50 transition-colors"
      >
        <Icon size={20} className={clsx('flex-shrink-0 mt-0.5', config.textColor)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={clsx('font-medium', config.textColor)}>
              {flag.type_label}
            </span>
            <span className={clsx(
              'text-xs px-2 py-0.5 rounded-full',
              config.bgColor,
              config.textColor
            )}>
              {config.label}
            </span>
          </div>
          <p className="text-sm text-white/80 mt-1 line-clamp-2">
            {flag.description}
          </p>
        </div>
        <div className="flex-shrink-0 text-white/40">
          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 space-y-3 border-t border-white/10">
              {/* Evidence */}
              {flag.evidence && (
                <div className="mt-3 p-3 bg-black/20 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Quote size={14} className="text-white/40 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-white/60 italic">{flag.evidence}</p>
                  </div>
                </div>
              )}

              {/* Suggestion */}
              <div className="mt-3">
                <h4 className="text-xs font-medium text-white/40 uppercase tracking-wide mb-1">
                  Рекомендация
                </h4>
                <p className="text-sm text-white/80">{flag.suggestion}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function RedFlagsPanel({ entityId, vacancyId, className }: RedFlagsPanelProps) {
  const [analysis, setAnalysis] = useState<RedFlagsAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFlags, setExpandedFlags] = useState<Set<number>>(new Set());

  const loadAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getEntityRedFlags(entityId, vacancyId);
      setAnalysis(data);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Не удалось загрузить анализ';
      setError(errorMessage);
      toast.error('Ошибка загрузки анализа red flags');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalysis();
  }, [entityId, vacancyId]);

  const toggleFlag = (index: number) => {
    setExpandedFlags(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (analysis) {
      setExpandedFlags(new Set(analysis.flags.map((_, i) => i)));
    }
  };

  const collapseAll = () => {
    setExpandedFlags(new Set());
  };

  if (loading) {
    return (
      <div className={clsx('p-6 flex flex-col items-center justify-center gap-4', className)}>
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
        <div className="text-center">
          <p className="text-white/80">Анализ кандидата...</p>
          <p className="text-sm text-white/40 mt-1">Это может занять несколько секунд</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={clsx('p-6 text-center', className)}>
        <AlertCircle className="mx-auto mb-3 text-red-400" size={40} />
        <p className="text-white/80 mb-4">{error}</p>
        <button
          onClick={loadAnalysis}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors mx-auto"
        >
          <RefreshCw size={16} />
          Повторить
        </button>
      </div>
    );
  }

  if (!analysis) {
    return null;
  }

  // Group flags by severity
  const highFlags = analysis.flags.filter(f => f.severity === 'high');
  const mediumFlags = analysis.flags.filter(f => f.severity === 'medium');
  const lowFlags = analysis.flags.filter(f => f.severity === 'low');

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Risk Score */}
      <RiskScoreIndicator score={analysis.risk_score} />

      {/* Summary */}
      <div className="p-4 glass-light rounded-xl">
        <p className="text-white/80">{analysis.summary}</p>
      </div>

      {/* Flags count summary */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {analysis.high_severity_count > 0 && (
            <div className="flex items-center gap-1.5">
              <AlertTriangle size={16} className="text-red-400" />
              <span className="text-sm text-red-400">{analysis.high_severity_count}</span>
            </div>
          )}
          {analysis.medium_severity_count > 0 && (
            <div className="flex items-center gap-1.5">
              <AlertCircle size={16} className="text-orange-400" />
              <span className="text-sm text-orange-400">{analysis.medium_severity_count}</span>
            </div>
          )}
          {analysis.low_severity_count > 0 && (
            <div className="flex items-center gap-1.5">
              <Info size={16} className="text-yellow-400" />
              <span className="text-sm text-yellow-400">{analysis.low_severity_count}</span>
            </div>
          )}
          {analysis.flags_count === 0 && (
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={16} className="text-green-400" />
              <span className="text-sm text-green-400">Нет замечаний</span>
            </div>
          )}
        </div>

        {analysis.flags_count > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={expandAll}
              className="text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              Развернуть все
            </button>
            <span className="text-white/20">|</span>
            <button
              onClick={collapseAll}
              className="text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              Свернуть все
            </button>
          </div>
        )}
      </div>

      {/* Flags list */}
      {analysis.flags_count > 0 && (
        <div className="space-y-3">
          {/* High severity */}
          {highFlags.length > 0 && (
            <div className="space-y-2">
              {highFlags.map((flag, i) => (
                <RedFlagCard
                  key={`high-${i}`}
                  flag={flag}
                  isExpanded={expandedFlags.has(i)}
                  onToggle={() => toggleFlag(i)}
                />
              ))}
            </div>
          )}

          {/* Medium severity */}
          {mediumFlags.length > 0 && (
            <div className="space-y-2">
              {mediumFlags.map((flag, i) => {
                const globalIndex = highFlags.length + i;
                return (
                  <RedFlagCard
                    key={`medium-${i}`}
                    flag={flag}
                    isExpanded={expandedFlags.has(globalIndex)}
                    onToggle={() => toggleFlag(globalIndex)}
                  />
                );
              })}
            </div>
          )}

          {/* Low severity */}
          {lowFlags.length > 0 && (
            <div className="space-y-2">
              {lowFlags.map((flag, i) => {
                const globalIndex = highFlags.length + mediumFlags.length + i;
                return (
                  <RedFlagCard
                    key={`low-${i}`}
                    flag={flag}
                    isExpanded={expandedFlags.has(globalIndex)}
                    onToggle={() => toggleFlag(globalIndex)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Refresh button */}
      <div className="flex justify-center pt-2">
        <button
          onClick={loadAnalysis}
          className="flex items-center gap-2 text-sm text-white/40 hover:text-white/60 transition-colors"
        >
          <RefreshCw size={14} />
          Обновить анализ
        </button>
      </div>
    </div>
  );
}
