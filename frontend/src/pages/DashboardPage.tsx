import { useState, useEffect, useCallback } from 'react';
import {
  Clock, Users, Filter, ChevronDown, Printer,
  FileDown, XCircle, ArrowRight, UserCheck,
  BarChart3, CalendarRange,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import api from '@/services/api/client';

// ===== TYPES =====

interface TimeToFillSummary {
  avg_days_to_close: number | null;
  avg_delay_days: number | null;
  closed_positions: number;
  total_positions: number;
}

interface StageTimingItem {
  stage: string;
  label: string;
  avg_days: number;
}

interface LastClosing {
  candidate_name: string;
  vacancy_title: string;
  recruiter_name: string | null;
  closed_date: string | null;
  days_to_close: number | null;
  start_date: string | null;
}

interface TimeToFillReport {
  summary: TimeToFillSummary;
  stage_timings: StageTimingItem[];
  last_closings: LastClosing[];
}

interface FunnelStageData {
  stage: string;
  label: string;
  candidate_count: number;
  rejection_count: number;
}

interface SourceBreakdown {
  source: string;
  count: number;
}

interface RejectionReasonItem {
  reason: string;
  count: number;
}

interface FunnelReport {
  stages: FunnelStageData[];
  total_candidates: number;
  total_rejections: number;
  sources: SourceBreakdown[];
  rejection_reasons: RejectionReasonItem[];
}

interface RecruiterFunnelItem {
  recruiter_id: number;
  recruiter_name: string;
  stages: FunnelStageData[];
  total_candidates: number;
  total_rejections: number;
}

interface FunnelByRecruiterReport {
  summary: FunnelReport;
  by_recruiter: RecruiterFunnelItem[];
}

interface RejectionsByStage {
  stage: string;
  label: string;
  count: number;
  reasons: RejectionReasonItem[];
}

interface RejectionsReport {
  total_rejections: number;
  by_stage: RejectionsByStage[];
  top_reasons: RejectionReasonItem[];
}

interface SourceReport {
  total_candidates: number;
  sources: SourceBreakdown[];
  by_stage: Record<string, SourceBreakdown[]>;
}

interface StageMovementItem {
  from_stage: string;
  from_label: string;
  to_stage: string;
  to_label: string;
  count: number;
}

interface MovementReport {
  total_movements: number;
  movements: StageMovementItem[];
}

// ===== CONSTANTS =====

const REPORT_CATEGORIES = [
  {
    id: 'vacancy',
    label: 'Вакансии',
    icon: BarChart3,
    reports: [
      { id: 'ttf', label: 'Время закрытия позиций', icon: Clock },
      { id: 'funnel', label: 'Воронка подбора', icon: Filter },
      { id: 'sources', label: 'Источники резюме', icon: FileDown },
      { id: 'rejections', label: 'Причины отказов', icon: XCircle },
      { id: 'movement', label: 'Движение по этапам', icon: ArrowRight },
    ],
  },
  {
    id: 'recruiter',
    label: 'Рекрутеры',
    icon: Users,
    reports: [
      { id: 'funnel-recruiter', label: 'Воронка по рекрутерам', icon: Users },
    ],
  },
] as const;

const PERIOD_TABS = [
  { id: 'current', label: 'Текущая' },
  { id: 'month', label: 'Месяц' },
  { id: 'quarter', label: 'Квартал' },
  { id: 'half_year', label: 'Полгода' },
  { id: 'year', label: 'Год' },
] as const;

const VACANCY_STATUS_OPTIONS = [
  { id: 'open', label: 'В работе' },
  { id: 'all', label: 'Все вакансии' },
  { id: 'closed', label: 'Закрытые' },
] as const;

const BAR_COLORS = {
  primary: '#d4a843',
  green: '#8cb369',
  red: '#e05263',
  gray_light: '#6b7280',
  gray_medium: '#4b5563',
  gray_dark: '#374151',
  blue: '#60a5fa',
  purple: '#a78bfa',
  orange: '#fb923c',
};

// ===== MAIN COMPONENT =====

export default function DashboardPage() {
  const [activeCategory, setActiveCategory] = useState('vacancy');
  const [activeReport, setActiveReport] = useState('ttf');
  const [period, setPeriod] = useState('current');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [vacancyStatus, setVacancyStatus] = useState('open');
  const [showStatusDD, setShowStatusDD] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Report data
  const [ttfData, setTtfData] = useState<TimeToFillReport | null>(null);
  const [funnelData, setFunnelData] = useState<FunnelReport | null>(null);
  const [funnelByRecruiter, setFunnelByRecruiter] = useState<FunnelByRecruiterReport | null>(null);
  const [rejectionsData, setRejectionsData] = useState<RejectionsReport | null>(null);
  const [sourcesData, setSourcesData] = useState<SourceReport | null>(null);
  const [movementData, setMovementData] = useState<MovementReport | null>(null);

  const loadReport = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: Record<string, string> = { period, vacancy_status: vacancyStatus };
      if (period === 'custom') {
        if (customFrom) params.date_from = customFrom;
        if (customTo) params.date_to = customTo;
      }
      switch (activeReport) {
        case 'ttf': {
          const res = await api.get<TimeToFillReport>('/analytics/reports/time-to-fill', { params });
          setTtfData(res.data);
          break;
        }
        case 'funnel': {
          const res = await api.get<FunnelReport>('/analytics/reports/funnel', { params });
          setFunnelData(res.data);
          break;
        }
        case 'funnel-recruiter': {
          const res = await api.get<FunnelByRecruiterReport>('/analytics/reports/funnel-by-recruiter', { params });
          setFunnelByRecruiter(res.data);
          break;
        }
        case 'rejections': {
          const res = await api.get<RejectionsReport>('/analytics/reports/rejections', { params });
          setRejectionsData(res.data);
          break;
        }
        case 'sources': {
          const res = await api.get<SourceReport>('/analytics/reports/sources', { params });
          setSourcesData(res.data);
          break;
        }
        case 'movement': {
          const res = await api.get<MovementReport>('/analytics/reports/movement', { params });
          setMovementData(res.data);
          break;
        }
      }
    } catch (err) {
      toast.error('Ошибка загрузки отчёта');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [activeReport, period, vacancyStatus, customFrom, customTo]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  // Find current category & report info
  const currentCat = REPORT_CATEGORIES.find(c => c.id === activeCategory);
  const currentReport = currentCat?.reports.find(r => r.id === activeReport);
  const currentStatus = VACANCY_STATUS_OPTIONS.find(s => s.id === vacancyStatus);

  return (
    <div className="h-full flex overflow-hidden">
      {/* ===== LEFT SIDEBAR — Report Navigation ===== */}
      <div className="w-[260px] flex-shrink-0 border-r border-white/[0.06] bg-white/[0.02] overflow-y-auto">
        <div className="p-5 pb-3">
          <h2 className="text-sm font-semibold text-white/50 uppercase tracking-wider">Аналитика</h2>
        </div>

        {REPORT_CATEGORIES.map(cat => (
          <div key={cat.id} className="mb-2">
            {/* Category header */}
            <div className="px-5 py-2">
              <span className="text-xs font-semibold text-white/30 uppercase tracking-wider">
                {cat.label}
              </span>
            </div>

            {/* Report items */}
            {cat.reports.map(rep => {
              const isActive = activeReport === rep.id;
              const Icon = rep.icon;
              return (
                <button
                  key={rep.id}
                  onClick={() => {
                    setActiveCategory(cat.id);
                    setActiveReport(rep.id);
                  }}
                  className={clsx(
                    'w-full flex items-center gap-3 px-5 py-2.5 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-white/[0.08] text-white border-r-2 border-accent-500'
                      : 'text-white/50 hover:text-white/70 hover:bg-white/[0.04]',
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{rep.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* ===== MAIN CONTENT ===== */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top filter bar */}
        <div className="flex-shrink-0 border-b border-white/[0.06] bg-white/[0.02]">
          {/* Report title + print */}
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <div className="flex items-center gap-3">
              {currentReport && <currentReport.icon className="w-5 h-5 text-white/40" />}
              <h1 className="text-lg font-semibold text-white/90">
                {currentReport?.label ?? 'Отчёт'}
              </h1>
            </div>
            <button
              onClick={() => window.print()}
              className="p-2 rounded-lg hover:bg-white/[0.06] text-white/30 hover:text-white/60 transition-colors"
              title="Печать"
            >
              <Printer className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* Period tabs + vacancy status */}
          <div className="flex items-center justify-between px-6 pb-3">
            {/* Period tabs */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-white/[0.04] rounded-lg p-1">
                {PERIOD_TABS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setPeriod(p.id)}
                    className={clsx(
                      'px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors',
                      period === p.id
                        ? 'bg-white/[0.12] text-white shadow-sm'
                        : 'text-white/40 hover:text-white/60',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  onClick={() => setPeriod('custom')}
                  className={clsx(
                    'flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors',
                    period === 'custom'
                      ? 'bg-white/[0.12] text-white shadow-sm'
                      : 'text-white/40 hover:text-white/60',
                  )}
                >
                  <CalendarRange className="w-3.5 h-3.5" />
                  Свой диапазон
                </button>
              </div>

              {period === 'custom' && (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/80 outline-none focus:border-accent-500/50"
                  />
                  <span className="text-white/30 text-sm">—</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/80 outline-none focus:border-accent-500/50"
                  />
                </div>
              )}
            </div>

            {/* Vacancy status dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowStatusDD(!showStatusDD)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-white/50 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
              >
                Вакансии: {currentStatus?.label}
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {showStatusDD && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowStatusDD(false)} />
                  <div className="absolute right-0 z-20 mt-1 bg-dark-700 border border-white/[0.08] rounded-lg shadow-xl py-1 min-w-[160px]">
                    {VACANCY_STATUS_OPTIONS.map(s => (
                      <button
                        key={s.id}
                        onClick={() => { setVacancyStatus(s.id); setShowStatusDD(false); }}
                        className={clsx(
                          'w-full text-left px-4 py-2 text-sm hover:bg-white/[0.06] transition-colors',
                          vacancyStatus === s.id ? 'text-white font-medium' : 'text-white/50',
                        )}
                      >
                        {vacancyStatus === s.id && <span className="mr-2 text-accent-500">✓</span>}
                        {s.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Report content area */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="max-w-5xl">
              {activeReport === 'ttf' && ttfData && <TTFContent data={ttfData} />}
              {activeReport === 'funnel' && funnelData && <FunnelContent data={funnelData} />}
              {activeReport === 'funnel-recruiter' && funnelByRecruiter && <FunnelByRecruiterContent data={funnelByRecruiter} />}
              {activeReport === 'rejections' && rejectionsData && <RejectionsContent data={rejectionsData} />}
              {activeReport === 'sources' && sourcesData && <SourcesContent data={sourcesData} />}
              {activeReport === 'movement' && movementData && <MovementContent data={movementData} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== SHARED COMPONENTS =====

function KPICard({ value, label, sub }: { value: string | number; label: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5">
      <div className="text-3xl font-bold text-white/90">{value}</div>
      <div className="text-sm text-white/40 mt-1">{label}</div>
      {sub && <div className="text-xs text-white/25 mt-0.5">{sub}</div>}
    </div>
  );
}

function HBar({ width, color, value, label }: { width: number; color: string; value: number | string; label: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="w-48 text-sm text-white/50 text-right truncate flex-shrink-0">{label}</div>
      <div className="flex-1 flex items-center gap-3">
        <div
          className="h-7 rounded-sm transition-all duration-300"
          style={{
            width: `${Math.max(width, 2)}%`,
            backgroundColor: color,
          }}
        />
        <span className="text-sm font-medium text-white/70 flex-shrink-0">{value}</span>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-white/80 mb-1">{children}</h3>;
}

function SectionDesc({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-white/30 mb-5">{children}</p>;
}

function Divider() {
  return <div className="border-t border-white/[0.06] my-8" />;
}

function LegendItem({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex items-center justify-between text-sm py-0.5">
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <span className="text-white/50 truncate max-w-[150px]">{label}</span>
      </div>
      <span className="text-white/70 font-medium ml-3">{count}</span>
    </div>
  );
}

// ===== TTF REPORT =====

function TTFContent({ data }: { data: TimeToFillReport }) {
  const { summary, stage_timings, last_closings } = data;
  const maxDays = Math.max(...stage_timings.map(s => s.avg_days), 1);

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-5 mb-8">
        <KPICard
          value={summary.avg_days_to_close != null ? `${summary.avg_days_to_close}` : '—'}
          label="Ср. срок закрытия, дн"
        />
        <KPICard
          value={summary.avg_delay_days != null ? `${summary.avg_delay_days}` : '—'}
          label="Ср. просрочка, дн"
        />
        <KPICard
          value={`${summary.closed_positions}/${summary.total_positions}`}
          label="Закрытых позиций"
        />
      </div>

      <Divider />

      {/* Stage timings bars */}
      <SectionTitle>Среднее время на этапе</SectionTitle>
      <SectionDesc>Среднее время нахождения кандидатов на каждом этапе воронки</SectionDesc>

      <div className="space-y-2.5">
        {stage_timings.map(st => (
          <HBar
            key={st.stage}
            width={(st.avg_days / maxDays) * 100}
            color={BAR_COLORS.primary}
            value={st.avg_days > 0 ? `${st.avg_days} дн` : '—'}
            label={st.label}
          />
        ))}
      </div>

      {/* Last closings */}
      {last_closings.length > 0 && (
        <>
          <Divider />
          <SectionTitle>Последние закрытия</SectionTitle>
          <div className="space-y-2 mt-4">
            {last_closings.map((lc, i) => (
              <div
                key={i}
                className="flex items-center gap-4 p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02]"
              >
                <UserCheck className="w-5 h-5 text-green-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white/80">{lc.candidate_name}</div>
                  <div className="text-xs text-white/35">{lc.vacancy_title}</div>
                  {lc.recruiter_name && (
                    <div className="text-xs text-white/25 mt-0.5">{lc.recruiter_name}</div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm text-white/60 font-medium">
                    {lc.days_to_close != null ? `${lc.days_to_close} дн` : '—'}
                  </div>
                  {lc.closed_date && (
                    <div className="text-xs text-white/25">{lc.closed_date}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ===== FUNNEL =====

function FunnelContent({ data }: { data: FunnelReport }) {
  const maxCount = Math.max(...data.stages.map(s => s.candidate_count), 1);
  const maxRej = Math.max(...data.stages.map(s => s.rejection_count), 1);
  const legendColors = ['#8cb369', '#e05263', '#d4a843', '#60a5fa', '#a78bfa', '#fb923c'];

  return (
    <div className="flex gap-8">
      {/* Chart area */}
      <div className="flex-1 min-w-0">
        {/* Headers */}
        <div className="flex gap-4 mb-4">
          <div className="w-48 flex-shrink-0" />
          <div className="flex-1 text-xs text-white/30 font-medium uppercase tracking-wider">
            Кандидаты
          </div>
          <div className="w-40 text-xs text-white/30 font-medium uppercase tracking-wider flex-shrink-0">
            Отказы
          </div>
        </div>

        {/* Bars */}
        <div className="space-y-2">
          {data.stages.map(st => (
            <div key={st.stage} className="flex items-center gap-4">
              <div className="w-48 text-sm text-white/50 text-right flex-shrink-0 truncate">
                {st.label}
              </div>
              {/* Candidate bar */}
              <div className="flex-1 flex items-center gap-2">
                <div
                  className="h-7 rounded-sm"
                  style={{
                    width: `${Math.max((st.candidate_count / maxCount) * 100, 1)}%`,
                    backgroundColor: BAR_COLORS.green,
                  }}
                />
                {st.candidate_count > 0 && (
                  <span className="text-xs text-white/50">{st.candidate_count}</span>
                )}
              </div>
              {/* Rejection bar */}
              <div className="w-40 flex items-center gap-2 flex-shrink-0">
                {st.rejection_count > 0 && (
                  <>
                    <div
                      className="h-7 rounded-sm"
                      style={{
                        width: `${(st.rejection_count / maxRej) * 100}%`,
                        backgroundColor: BAR_COLORS.gray_light,
                      }}
                    />
                    <span className="text-xs text-white/40">{st.rejection_count}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right legend */}
      <div className="w-52 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-white/70">Все</span>
          <span className="text-sm font-bold text-white/80">{data.total_candidates}</span>
        </div>
        {data.sources.map((s, i) => (
          <LegendItem
            key={i}
            color={legendColors[i % legendColors.length]}
            label={s.source}
            count={s.count}
          />
        ))}

        {data.rejection_reasons.length > 0 && (
          <div className="mt-6 pt-4 border-t border-white/[0.06]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-white/70">Отказы</span>
              <span className="text-sm font-bold text-white/80">{data.total_rejections}</span>
            </div>
            {data.rejection_reasons.map((r, i) => (
              <LegendItem
                key={i}
                color={i === 0 ? BAR_COLORS.gray_light : i === 1 ? BAR_COLORS.gray_medium : BAR_COLORS.gray_dark}
                label={r.reason}
                count={r.count}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== FUNNEL BY RECRUITER =====

function FunnelByRecruiterContent({ data }: { data: FunnelByRecruiterReport }) {
  return (
    <>
      <FunnelContent data={data.summary} />

      {data.by_recruiter.length > 0 && (
        <>
          <Divider />
          <SectionTitle>По рекрутерам</SectionTitle>
          <div className="space-y-5 mt-4">
            {data.by_recruiter.map(rec => {
              const maxCount = Math.max(...rec.stages.map(s => s.candidate_count), 1);
              return (
                <div key={rec.recruiter_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-accent-500/20 flex items-center justify-center text-xs font-bold text-accent-400">
                        {rec.recruiter_name.charAt(0)}
                      </div>
                      <span className="font-medium text-white/80">{rec.recruiter_name}</span>
                    </div>
                    <div className="text-xs text-white/35">
                      {rec.total_candidates} кандидатов · {rec.total_rejections} отказов
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {rec.stages.map(st => (
                      <div key={st.stage} className="flex items-center gap-3">
                        <div className="w-40 text-xs text-white/40 text-right truncate">{st.label}</div>
                        <div className="flex-1 flex items-center gap-2">
                          <div
                            className="h-5 rounded-sm"
                            style={{
                              width: `${Math.max((st.candidate_count / maxCount) * 100, 1)}%`,
                              backgroundColor: BAR_COLORS.green,
                            }}
                          />
                          {st.candidate_count > 0 && (
                            <span className="text-xs text-white/40">{st.candidate_count}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

// ===== REJECTIONS =====

function RejectionsContent({ data }: { data: RejectionsReport }) {
  const maxCount = Math.max(...data.by_stage.map(s => s.count), 1);

  return (
    <div className="flex gap-8">
      <div className="flex-1 min-w-0">
        <SectionTitle>Отказы по этапам</SectionTitle>
        <SectionDesc>На каком этапе кандидаты получают отказ</SectionDesc>

        <div className="space-y-2.5">
          {data.by_stage.map(st => (
            <HBar
              key={st.stage}
              width={(st.count / maxCount) * 100}
              color={BAR_COLORS.red}
              value={st.count}
              label={st.label}
            />
          ))}
        </div>
      </div>

      {/* Right legend */}
      <div className="w-52 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-white/70">Всего отказов</span>
          <span className="text-sm font-bold text-white/80">{data.total_rejections}</span>
        </div>
        {data.top_reasons.map((r, i) => (
          <LegendItem
            key={i}
            color={i === 0 ? BAR_COLORS.gray_light : i === 1 ? BAR_COLORS.gray_medium : BAR_COLORS.gray_dark}
            label={r.reason}
            count={r.count}
          />
        ))}
      </div>
    </div>
  );
}

// ===== SOURCES =====

function SourcesContent({ data }: { data: SourceReport }) {
  const maxCount = Math.max(...data.sources.map(s => s.count), 1);
  const colors = ['#8cb369', '#e05263', '#d4a843', '#60a5fa', '#a78bfa', '#fb923c'];

  return (
    <>
      <div className="flex items-center gap-4 mb-6">
        <KPICard value={data.total_candidates} label="Всего кандидатов" />
        <KPICard value={data.sources.length} label="Источников" />
      </div>

      <SectionTitle>Распределение по источникам</SectionTitle>
      <div className="space-y-2.5 mt-4">
        {data.sources.map((s, i) => (
          <HBar
            key={i}
            width={(s.count / maxCount) * 100}
            color={colors[i % colors.length]}
            value={s.count}
            label={s.source}
          />
        ))}
      </div>
    </>
  );
}

// ===== MOVEMENT =====

function MovementContent({ data }: { data: MovementReport }) {
  const maxCount = Math.max(...data.movements.map(m => m.count), 1);

  return (
    <>
      <div className="mb-6">
        <KPICard value={data.total_movements} label="Всего перемещений" />
      </div>

      <SectionTitle>Перемещения между этапами</SectionTitle>
      <div className="space-y-2.5 mt-4">
        {data.movements.map((m, i) => {
          const color = m.to_stage === 'rejected' ? BAR_COLORS.red
            : m.to_stage === 'hired' ? BAR_COLORS.green
            : BAR_COLORS.primary;
          return (
            <div key={i} className="flex items-center gap-4">
              <div className="w-56 text-sm text-white/50 text-right flex items-center justify-end gap-2 flex-shrink-0 truncate">
                <span className="truncate">{m.from_label}</span>
                <ArrowRight className="w-3 h-3 text-white/25 flex-shrink-0" />
                <span className="truncate">{m.to_label}</span>
              </div>
              <div className="flex-1 flex items-center gap-3">
                <div
                  className="h-7 rounded-sm"
                  style={{
                    width: `${Math.max((m.count / maxCount) * 100, 2)}%`,
                    backgroundColor: color,
                  }}
                />
                <span className="text-sm font-medium text-white/70">{m.count}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
