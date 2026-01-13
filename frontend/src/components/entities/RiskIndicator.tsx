import { useState, useEffect } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Loader2
} from 'lucide-react';
import clsx from 'clsx';
import * as api from '@/services/api';
import type { RiskScoreResponse } from '@/services/api';

interface RiskIndicatorProps {
  entityId: number;
  className?: string;
  showScore?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

// Risk level config
const RISK_CONFIG = {
  high: {
    icon: ShieldAlert,
    bgColor: 'bg-red-500/20',
    textColor: 'text-red-400',
    borderColor: 'border-red-500/30',
    label: 'Высокий'
  },
  medium: {
    icon: Shield,
    bgColor: 'bg-orange-500/20',
    textColor: 'text-orange-400',
    borderColor: 'border-orange-500/30',
    label: 'Средний'
  },
  low: {
    icon: ShieldCheck,
    bgColor: 'bg-green-500/20',
    textColor: 'text-green-400',
    borderColor: 'border-green-500/30',
    label: 'Низкий'
  }
};

// Size config
const SIZE_CONFIG = {
  sm: {
    iconSize: 14,
    padding: 'p-1',
    textSize: 'text-xs',
    gap: 'gap-1'
  },
  md: {
    iconSize: 16,
    padding: 'p-1.5',
    textSize: 'text-sm',
    gap: 'gap-1.5'
  },
  lg: {
    iconSize: 20,
    padding: 'p-2',
    textSize: 'text-base',
    gap: 'gap-2'
  }
};

export default function RiskIndicator({
  entityId,
  className,
  showScore = false,
  size = 'sm'
}: RiskIndicatorProps) {
  const [data, setData] = useState<RiskScoreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadRiskScore = async () => {
      try {
        const result = await api.getEntityRiskScore(entityId);
        if (mounted) {
          setData(result);
          setError(false);
        }
      } catch {
        if (mounted) {
          setError(true);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadRiskScore();

    return () => {
      mounted = false;
    };
  }, [entityId]);

  const sizeConfig = SIZE_CONFIG[size];

  if (loading) {
    return (
      <div className={clsx('inline-flex items-center', className)}>
        <Loader2
          size={sizeConfig.iconSize}
          className="text-white/40 animate-spin"
        />
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  const riskConfig = RISK_CONFIG[data.risk_level];
  const Icon = riskConfig.icon;

  // Tooltip content
  const tooltipContent = `${riskConfig.label} риск (${data.risk_score}/100)`;

  return (
    <div
      className={clsx(
        'inline-flex items-center rounded-lg border cursor-default',
        riskConfig.bgColor,
        riskConfig.borderColor,
        sizeConfig.padding,
        sizeConfig.gap,
        className
      )}
      title={tooltipContent}
    >
      <Icon size={sizeConfig.iconSize} className={riskConfig.textColor} />
      {showScore && (
        <span className={clsx(riskConfig.textColor, sizeConfig.textSize, 'font-medium')}>
          {data.risk_score}
        </span>
      )}
    </div>
  );
}

// Static variant that accepts preloaded data (for lists where we want to avoid N+1 requests)
interface StaticRiskIndicatorProps {
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  className?: string;
  showScore?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function StaticRiskIndicator({
  riskScore,
  riskLevel,
  className,
  showScore = false,
  size = 'sm'
}: StaticRiskIndicatorProps) {
  const sizeConfig = SIZE_CONFIG[size];
  const riskConfig = RISK_CONFIG[riskLevel];
  const Icon = riskConfig.icon;
  const tooltipContent = `${riskConfig.label} риск (${riskScore}/100)`;

  return (
    <div
      className={clsx(
        'inline-flex items-center rounded-lg border cursor-default',
        riskConfig.bgColor,
        riskConfig.borderColor,
        sizeConfig.padding,
        sizeConfig.gap,
        className
      )}
      title={tooltipContent}
    >
      <Icon size={sizeConfig.iconSize} className={riskConfig.textColor} />
      {showScore && (
        <span className={clsx(riskConfig.textColor, sizeConfig.textSize, 'font-medium')}>
          {riskScore}
        </span>
      )}
    </div>
  );
}

// Badge variant for showing in headers
interface RiskBadgeProps {
  riskScore: number;
  className?: string;
}

export function RiskBadge({ riskScore, className }: RiskBadgeProps) {
  const riskLevel = riskScore >= 60 ? 'high' : riskScore >= 30 ? 'medium' : 'low';
  const riskConfig = RISK_CONFIG[riskLevel];
  const Icon = riskConfig.icon;

  return (
    <div
      className={clsx(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border',
        riskConfig.bgColor,
        riskConfig.borderColor,
        className
      )}
    >
      <Icon size={16} className={riskConfig.textColor} />
      <span className={clsx(riskConfig.textColor, 'text-sm font-medium')}>
        Риск: {riskScore}/100
      </span>
    </div>
  );
}
