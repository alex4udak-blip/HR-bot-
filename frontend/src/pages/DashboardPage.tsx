import { useState, useEffect, useCallback } from 'react';
import {
  Clock, Users, Filter, ChevronDown, FileSpreadsheet,
  FileDown, XCircle, ArrowRight, UserCheck,
  BarChart3, CalendarRange,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import * as XLSX from 'xlsx';
import api from '@/services/api/client';
import { useAuthStore } from '@/stores/authStore';

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

interface DepartmentSummary {
  id: number;
  name: string;
  vacancies: number;
  open_vacancies: number;
  applications: number;
  hires: number;
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
  primary: 'var(--hf-report-candidate)',
  green: 'var(--hf-report-source-green)',
  red: 'var(--hf-report-source-red)',
  gray_light: 'var(--hf-report-rejection-light)',
  gray_medium: 'var(--hf-report-rejection-medium)',
  gray_dark: 'var(--hf-report-rejection-dark)',
  blue: 'var(--hf-report-source-blue)',
  purple: 'var(--hf-report-source-purple)',
  orange: 'var(--hf-report-source-orange)',
};

// ===== MAIN COMPONENT =====

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const isAdminAnalytics =
    user?.role === 'superadmin' ||
    user?.org_role === 'owner' ||
    user?.org_role === 'admin';
  // Не-админ (HR рекрутёр) видит только категорию "Вакансии" — все цифры
  // backend отскейпит на его recruiter_id. Категория "Рекрутеры" скрыта,
  // т.к. там воронка по всем рекрутерам — для не-админа смысла нет.
  const visibleCategories = isAdminAnalytics
    ? REPORT_CATEGORIES
    : REPORT_CATEGORIES.filter(c => c.id !== 'recruiter');

  const [activeCategory, setActiveCategory] = useState('vacancy');
  const [activeReport, setActiveReport] = useState('ttf');
  const [period, setPeriod] = useState('current');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [vacancyStatus, setVacancyStatus] = useState('open');
  const [selectedDepartment, setSelectedDepartment] = useState<number | null>(null);
  const [showCategoryDD, setShowCategoryDD] = useState(false);
  const [showReportDD, setShowReportDD] = useState(false);
  const [showPeriodDD, setShowPeriodDD] = useState(false);
  const [showDepartmentDD, setShowDepartmentDD] = useState(false);
  const [showStatusDD, setShowStatusDD] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Report data
  const [ttfData, setTtfData] = useState<TimeToFillReport | null>(null);
  const [funnelData, setFunnelData] = useState<FunnelReport | null>(null);
  const [funnelByRecruiter, setFunnelByRecruiter] = useState<FunnelByRecruiterReport | null>(null);
  const [rejectionsData, setRejectionsData] = useState<RejectionsReport | null>(null);
  const [sourcesData, setSourcesData] = useState<SourceReport | null>(null);
  const [movementData, setMovementData] = useState<MovementReport | null>(null);
  const [departments, setDepartments] = useState<DepartmentSummary[]>([]);

  useEffect(() => {
    api.get<DepartmentSummary[]>('/analytics/dashboard/departments-summary')
      .then(res => setDepartments(Array.isArray(res.data) ? res.data : []))
      .catch(() => setDepartments([]));
  }, []);

  const loadReport = useCallback(async () => {
    if (period === 'custom' && customFrom && customTo && customFrom > customTo) {
      toast.error('Дата начала не может быть позже даты окончания');
      return;
    }
    setIsLoading(true);
    setReportError(null);
    try {
      const params: Record<string, string> = { period, vacancy_status: vacancyStatus };
      if (selectedDepartment) params.department_id = String(selectedDepartment);
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
      setReportError('Не удалось загрузить данные отчёта');
      toast.error('Ошибка загрузки отчёта');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [activeReport, period, vacancyStatus, selectedDepartment, customFrom, customTo]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  // Find current category & report info — должно быть до handleExportExcel
  const currentCat = REPORT_CATEGORIES.find(c => c.id === activeCategory);
  const currentReport = currentCat?.reports.find(r => r.id === activeReport);
  const currentStatus = VACANCY_STATUS_OPTIONS.find(s => s.id === vacancyStatus);
  const currentDepartment = departments.find(d => d.id === selectedDepartment);

  // Экспорт текущего отчёта в Excel
  const handleExportExcel = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const fmt = (n: number | null | undefined): string | number => (n == null ? '' : n);
    let sheetsAdded = 0;
    type Row = (string | number)[];
    const aoa = (rows: Row[]) => XLSX.utils.aoa_to_sheet(rows);

    if (activeReport === 'ttf' && ttfData) {
      const summary: Row[] = [
        ['Показатель', 'Значение'],
        ['Средний срок закрытия (дн)', fmt(ttfData.summary.avg_days_to_close)],
        ['Средняя просрочка (дн)', fmt(ttfData.summary.avg_delay_days)],
        ['Закрыто позиций', ttfData.summary.closed_positions],
        ['Всего позиций', ttfData.summary.total_positions],
      ];
      XLSX.utils.book_append_sheet(wb, aoa(summary), 'Сводка');
      const stages: Row[] = [['Этап', 'Среднее время (дн)'], ...ttfData.stage_timings.map(s => [s.label, s.avg_days] as Row)];
      XLSX.utils.book_append_sheet(wb, aoa(stages), 'Время на этапах');
      const closings: Row[] = [
        ['Кандидат', 'Вакансия', 'Рекрутер', 'Дата старта', 'Дата закрытия', 'Дней до закрытия'],
        ...ttfData.last_closings.map(c => [
          c.candidate_name, c.vacancy_title, c.recruiter_name ?? '', c.start_date ?? '', c.closed_date ?? '', fmt(c.days_to_close),
        ] as Row),
      ];
      XLSX.utils.book_append_sheet(wb, aoa(closings), 'Последние закрытия');
      sheetsAdded = 3;
    } else if (activeReport === 'funnel' && funnelData) {
      const stages: Row[] = [
        ['Этап', 'Кандидатов', 'Отказов'],
        ...funnelData.stages.map(s => [s.label, s.candidate_count, s.rejection_count] as Row),
      ];
      XLSX.utils.book_append_sheet(wb, aoa(stages), 'Воронка');
      const sources: Row[] = [['Источник', 'Кол-во'], ...funnelData.sources.map(s => [s.source, s.count] as Row)];
      XLSX.utils.book_append_sheet(wb, aoa(sources), 'Источники');
      const reasons: Row[] = [['Причина отказа', 'Кол-во'], ...funnelData.rejection_reasons.map(r => [r.reason, r.count] as Row)];
      XLSX.utils.book_append_sheet(wb, aoa(reasons), 'Причины отказов');
      sheetsAdded = 3;
    } else if (activeReport === 'funnel-recruiter' && funnelByRecruiter) {
      const summary: Row[] = [
        ['Этап', 'Кандидатов', 'Отказов'],
        ...funnelByRecruiter.summary.stages.map(s => [s.label, s.candidate_count, s.rejection_count] as Row),
      ];
      XLSX.utils.book_append_sheet(wb, aoa(summary), 'Сводка');
      funnelByRecruiter.by_recruiter.forEach(rec => {
        const rows: Row[] = [
          [`Рекрутер: ${rec.recruiter_name}`],
          ['Этап', 'Кандидатов', 'Отказов'],
          ...rec.stages.map(s => [s.label, s.candidate_count, s.rejection_count] as Row),
        ];
        const sheetName = rec.recruiter_name.slice(0, 28).replace(/[\\/?*[\]:]/g, '_');
        XLSX.utils.book_append_sheet(wb, aoa(rows), sheetName || `Рекрутер ${rec.recruiter_id}`);
      });
      sheetsAdded = 1 + funnelByRecruiter.by_recruiter.length;
    } else if (activeReport === 'rejections' && rejectionsData) {
      const top: Row[] = [['Причина', 'Кол-во'], ...rejectionsData.top_reasons.map(r => [r.reason, r.count] as Row)];
      XLSX.utils.book_append_sheet(wb, aoa(top), 'Топ причин');
      const byStage: Row[] = [['Этап', 'Всего отказов']];
      rejectionsData.by_stage.forEach(s => byStage.push([s.label, s.count]));
      XLSX.utils.book_append_sheet(wb, aoa(byStage), 'По этапам');
      sheetsAdded = 2;
    } else if (activeReport === 'sources' && sourcesData) {
      const total: Row[] = [['Источник', 'Кол-во'], ...sourcesData.sources.map(s => [s.source, s.count] as Row)];
      XLSX.utils.book_append_sheet(wb, aoa(total), 'Все источники');
      sheetsAdded = 1;
    } else if (activeReport === 'movement' && movementData) {
      const moves: Row[] = [
        ['Из этапа', 'В этап', 'Кол-во'],
        ...movementData.movements.map(m => [m.from_label, m.to_label, m.count] as Row),
      ];
      XLSX.utils.book_append_sheet(wb, aoa(moves), 'Движение');
      sheetsAdded = 1;
    }

    if (sheetsAdded === 0) {
      toast.error('Нет данных для экспорта');
      return;
    }

    const reportLabel = currentReport?.label?.replace(/[\\/?*[\]:]/g, '_') ?? 'report';
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `${reportLabel}_${today}.xlsx`);
    toast.success('Excel экспортирован');
  }, [activeReport, ttfData, funnelData, funnelByRecruiter, rejectionsData, sourcesData, movementData, currentReport]);

  return (
    <div className="hf-analytics-page">
      <div className="hf-analytics-header">
        <div className="hf-analytics-title-row">
          <div className="hf-analytics-title">
            <h1>Центр аналитики</h1>
          </div>
          <button
            type="button"
            onClick={handleExportExcel}
            className="hf-analytics-excel"
            title="Скачать Excel"
          >
            <FileSpreadsheet className="hf-analytics-excel-icon" />
            Скачать Excel
          </button>
        </div>

        <div className="hf-analytics-filter-row">
          <div className="hf-analytics-filter-group">
            <div className="hf-analytics-filter-dd">
              <FilterSelect
                label=""
                value={currentCat?.label ?? 'Вакансии'}
                open={showCategoryDD}
                onClick={() => {
                  setShowCategoryDD(!showCategoryDD);
                  setShowReportDD(false);
                  setShowPeriodDD(false);
                  setShowDepartmentDD(false);
                  setShowStatusDD(false);
                }}
              />
              {showCategoryDD && (
                <>
                  <button
                    type="button"
                    aria-label="Закрыть меню категории отчётов"
                    className="hf-analytics-menu-backdrop"
                    onClick={() => setShowCategoryDD(false)}
                  />
                  <div className="hf-analytics-menu hf-analytics-menu-open">
                    {visibleCategories.map(cat => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          setActiveCategory(cat.id);
                          setActiveReport(cat.reports[0].id);
                          setShowCategoryDD(false);
                        }}
                        className={clsx('hf-analytics-menu-item', activeCategory === cat.id && 'hf-analytics-menu-item-active')}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="hf-analytics-filter-dd">
              <FilterSelect
                label=""
                value={currentReport?.label ?? 'Отчёт'}
                open={showReportDD}
                onClick={() => {
                  setShowReportDD(!showReportDD);
                  setShowCategoryDD(false);
                  setShowPeriodDD(false);
                  setShowDepartmentDD(false);
                  setShowStatusDD(false);
                }}
              />
              {showReportDD && (
                <>
                  <button
                    type="button"
                    aria-label="Закрыть меню отчётов"
                    className="hf-analytics-menu-backdrop"
                    onClick={() => setShowReportDD(false)}
                  />
                  <div className="hf-analytics-report-menu hf-analytics-menu-open">
                    {currentCat ? (
                      <div className="hf-analytics-report-group">
                        {currentCat.reports.map(rep => {
                          const Icon = rep.icon;
                          const isActive = activeReport === rep.id;
                          return (
                            <button
                              key={rep.id}
                              type="button"
                              onClick={() => {
                                setActiveReport(rep.id);
                                setShowReportDD(false);
                              }}
                              className={clsx(
                                'hf-analytics-report-item',
                                isActive && 'hf-analytics-report-item-active',
                              )}
                            >
                              <Icon className="hf-analytics-report-item-icon" />
                              <span>{rep.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="hf-analytics-filter-group">
            <div className="hf-analytics-filter-dd">
              <FilterSelect
                label="За период:"
                value={PERIOD_TABS.find(p => p.id === period)?.label ?? 'Свой диапазон'}
                open={showPeriodDD}
                onClick={() => {
                  setShowPeriodDD(!showPeriodDD);
                  setShowCategoryDD(false);
                  setShowReportDD(false);
                  setShowDepartmentDD(false);
                  setShowStatusDD(false);
                }}
              />
              {showPeriodDD && (
                <>
                  <button
                    type="button"
                    aria-label="Закрыть меню периода"
                    className="hf-analytics-menu-backdrop"
                    onClick={() => setShowPeriodDD(false)}
                  />
                  <div className="hf-analytics-menu hf-analytics-menu-open">
                    {PERIOD_TABS.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { setPeriod(p.id); setShowPeriodDD(false); }}
                        className={clsx('hf-analytics-menu-item', period === p.id && 'hf-analytics-menu-item-active')}
                      >
                        {p.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { setPeriod('custom'); setShowPeriodDD(false); }}
                      className={clsx('hf-analytics-menu-item', period === 'custom' && 'hf-analytics-menu-item-active')}
                    >
                      <CalendarRange className="hf-analytics-menu-icon" />
                      Свой диапазон
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="hf-analytics-filter-dd">
              <FilterSelect
                label="Подразделение:"
                value={currentDepartment?.name ?? 'Все'}
                open={showDepartmentDD}
                onClick={() => {
                  setShowDepartmentDD(!showDepartmentDD);
                  setShowCategoryDD(false);
                  setShowReportDD(false);
                  setShowPeriodDD(false);
                  setShowStatusDD(false);
                }}
              />
              {showDepartmentDD && (
                <>
                  <button
                    type="button"
                    aria-label="Закрыть меню подразделений"
                    className="hf-analytics-menu-backdrop"
                    onClick={() => setShowDepartmentDD(false)}
                  />
                  <div className="hf-analytics-menu hf-analytics-menu-open">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDepartment(null);
                        setShowDepartmentDD(false);
                      }}
                      className={clsx('hf-analytics-menu-item', selectedDepartment === null && 'hf-analytics-menu-item-active')}
                    >
                      Все
                    </button>
                    {departments.map(dept => (
                      <button
                        key={dept.id}
                        type="button"
                        onClick={() => {
                          setSelectedDepartment(dept.id);
                          setShowDepartmentDD(false);
                        }}
                        className={clsx('hf-analytics-menu-item', selectedDepartment === dept.id && 'hf-analytics-menu-item-active')}
                      >
                        {dept.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="hf-analytics-filter-dd">
              <button
                type="button"
                onClick={() => {
                  setShowStatusDD(!showStatusDD);
                  setShowCategoryDD(false);
                  setShowReportDD(false);
                  setShowPeriodDD(false);
                  setShowDepartmentDD(false);
                }}
                className="hf-analytics-filter"
              >
                <span>Вакансии:</span>
                <strong>{currentStatus?.label}</strong>
                <ChevronDown className="hf-analytics-filter-chevron" />
              </button>
              {showStatusDD && (
                <>
                  <button
                    type="button"
                    aria-label="Закрыть меню статуса вакансий"
                    className="hf-analytics-menu-backdrop"
                    onClick={() => setShowStatusDD(false)}
                  />
                  <div className="hf-analytics-menu hf-analytics-menu-open">
                    {VACANCY_STATUS_OPTIONS.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { setVacancyStatus(s.id); setShowStatusDD(false); }}
                        className={clsx('hf-analytics-menu-item', vacancyStatus === s.id && 'hf-analytics-menu-item-active')}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {period === 'custom' && (
            <div className="hf-analytics-date-range">
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="hf-analytics-date"
              />
              <span>—</span>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="hf-analytics-date"
              />
            </div>
          )}
        </div>
      </div>

      <main className="hf-analytics-main">
        <section className="hf-analytics-report-sheet">
          <div className="hf-analytics-report-heading">
            <h2>{currentCat?.label ?? 'Вакансии'} → {currentReport?.label ?? 'Отчёт'}</h2>
            <button
              type="button"
              onClick={() => window.print()}
              className="hf-analytics-print"
              title="Печать"
              aria-label="Печать отчёта"
            >
              <FileDown className="hf-analytics-print-icon" />
            </button>
          </div>

          {isLoading ? (
            <div className="hf-analytics-loading">
              <div className="hf-analytics-spinner" />
            </div>
          ) : reportError ? (
            <div className="hf-analytics-empty-state">
              <XCircle className="hf-analytics-empty-icon" />
              <div>
                <h3>{reportError}</h3>
                <p>Попробуйте другой фильтр или обновите отчёт позже.</p>
              </div>
            </div>
          ) : (
            <>
              {activeReport === 'ttf' && ttfData && <TTFContent data={ttfData} />}
              {activeReport === 'funnel' && funnelData && <FunnelContent data={funnelData} />}
              {activeReport === 'funnel-recruiter' && funnelByRecruiter && <FunnelByRecruiterContent data={funnelByRecruiter} />}
              {activeReport === 'rejections' && rejectionsData && <RejectionsContent data={rejectionsData} />}
              {activeReport === 'sources' && sourcesData && <SourcesContent data={sourcesData} />}
              {activeReport === 'movement' && movementData && <MovementContent data={movementData} />}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

// ===== SHARED COMPONENTS =====

function FilterSelect({
  label,
  value,
  open,
  onClick,
}: {
  label: string;
  value: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx('hf-analytics-filter', open && 'hf-analytics-filter-open')}
    >
      {label && <span>{label}</span>}
      <strong>{value}</strong>
      <ChevronDown className="hf-analytics-filter-chevron" />
    </button>
  );
}

function KPICard({ value, label, sub }: { value: string | number; label: string; sub?: string }) {
  return (
    <div className="hf-analytics-kpi">
      <div className="hf-analytics-kpi-value">{value}</div>
      <div className="hf-analytics-kpi-label">{label}</div>
      {sub && <div className="hf-analytics-kpi-sub">{sub}</div>}
    </div>
  );
}

function HBar({ width, color, value, label }: { width: number; color: string; value: number | string; label: string }) {
  return (
    <div className="hf-analytics-bar-row">
      <div className="hf-analytics-bar-label">{label}</div>
      <div className="hf-analytics-bar-track">
        <div
          className="hf-analytics-bar"
          style={{
            width: `${Math.max(width, 2)}%`,
            backgroundColor: color,
          }}
        />
        <span className="hf-analytics-bar-value">{value}</span>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="hf-analytics-section-title">{children}</h3>;
}

function SectionDesc({ children }: { children: React.ReactNode }) {
  return <p className="hf-analytics-section-desc">{children}</p>;
}

function Divider() {
  return <div className="hf-analytics-divider" />;
}

function LegendItem({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="hf-analytics-legend-item">
      <div className="hf-analytics-legend-name">
        <div className="hf-analytics-legend-dot" style={{ backgroundColor: color }} />
        <span>{label}</span>
      </div>
      <span className="hf-analytics-legend-count">{count}</span>
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
      <div className="hf-analytics-kpi-row">
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

      <div>
        {stage_timings.map(st => (
          <HBar
            key={st.stage}
            width={(st.avg_days / maxDays) * 100}
            color={BAR_COLORS.primary}
            value={st.avg_days > 0 ? `${st.avg_days} дн` : '0 дн'}
            label={st.label}
          />
        ))}
      </div>

      {/* Last closings */}
      {last_closings.length > 0 && (
        <>
          <Divider />
          <SectionTitle>Последние закрытия</SectionTitle>
          <div className="hf-analytics-closing-list">
            {last_closings.map((lc, i) => (
              <div key={i} className="hf-analytics-closing">
                <UserCheck className="hf-analytics-closing-icon" />
                <div className="hf-analytics-closing-main">
                  <div className="hf-analytics-closing-name">{lc.candidate_name}</div>
                  <div className="hf-analytics-closing-vacancy">{lc.vacancy_title}</div>
                  {lc.recruiter_name && (
                    <div className="hf-analytics-closing-recruiter">{lc.recruiter_name}</div>
                  )}
                </div>
                <div className="hf-analytics-closing-side">
                  <div className="hf-analytics-closing-days">
                    {lc.days_to_close != null ? `${lc.days_to_close} дн` : '—'}
                  </div>
                  {lc.closed_date && (
                    <div className="hf-analytics-closing-date">{lc.closed_date}</div>
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
  const legendColors = [
    BAR_COLORS.green,
    BAR_COLORS.red,
    BAR_COLORS.primary,
    BAR_COLORS.blue,
    BAR_COLORS.purple,
    BAR_COLORS.orange,
  ];

  return (
    <div className="hf-analytics-split">
      {/* Chart area */}
      <div className="hf-analytics-chart-main">
        {/* Headers */}
        <div className="hf-analytics-chart-head">
          <div className="hf-analytics-chart-label-spacer" />
          <div className="hf-analytics-chart-head-cell">
            Кандидаты
          </div>
          <div className="hf-analytics-chart-head-side">
            Отказы
          </div>
        </div>

        {/* Bars */}
        <div>
          {data.stages.map(st => (
            <div key={st.stage} className="hf-analytics-funnel-row">
              <div className="hf-analytics-funnel-label">
                {st.label}
              </div>
              {/* Candidate bar */}
              <div className="hf-analytics-funnel-track">
                <div
                  className="hf-analytics-funnel-bar"
                  style={{
                    width: `${Math.max((st.candidate_count / maxCount) * 100, 1)}%`,
                    backgroundColor: BAR_COLORS.green,
                  }}
                />
                {st.candidate_count > 0 && (
                  <span className="hf-analytics-funnel-value">{st.candidate_count}</span>
                )}
              </div>
              {/* Rejection bar */}
              <div className="hf-analytics-funnel-rejections">
                {st.rejection_count > 0 && (
                  <>
                    <div
                      className="hf-analytics-funnel-bar"
                      style={{
                        width: `${(st.rejection_count / maxRej) * 100}%`,
                        backgroundColor: BAR_COLORS.gray_light,
                      }}
                    />
                    <span className="hf-analytics-funnel-value">{st.rejection_count}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right legend */}
      <div className="hf-analytics-legend">
        <div className="hf-analytics-legend-head">
          <span className="hf-analytics-legend-title">Все</span>
          <span className="hf-analytics-legend-total">{data.total_candidates}</span>
        </div>
        {data.sources.map((s, i) => (
          <LegendItem
            key={i}
            color={legendColors[i % legendColors.length]}
            label={s.source === 'unknown' ? 'Не указан' : s.source}
            count={s.count}
          />
        ))}

        {data.rejection_reasons.length > 0 && (
          <div className="hf-analytics-legend-section">
            <div className="hf-analytics-legend-head">
              <span className="hf-analytics-legend-title">Отказы</span>
              <span className="hf-analytics-legend-total">{data.total_rejections}</span>
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
          <div className="hf-analytics-recruiter-list">
            {data.by_recruiter.map(rec => {
              const maxCount = Math.max(...rec.stages.map(s => s.candidate_count), 1);
              return (
                <div key={rec.recruiter_id} className="hf-analytics-recruiter-card">
                  <div className="hf-analytics-recruiter-head">
                    <div className="hf-analytics-recruiter-person">
                      <div className="hf-analytics-recruiter-avatar">
                        {rec.recruiter_name.charAt(0)}
                      </div>
                      <span className="hf-analytics-recruiter-name">{rec.recruiter_name}</span>
                    </div>
                    <div className="hf-analytics-recruiter-meta">
                      {rec.total_candidates} кандидатов · {rec.total_rejections} отказов
                    </div>
                  </div>
                  <div>
                    {rec.stages.map(st => (
                      <div key={st.stage} className="hf-analytics-recruiter-row">
                        <div className="hf-analytics-recruiter-stage">{st.label}</div>
                        <div className="hf-analytics-funnel-track">
                          <div
                            className="h-5 rounded-sm"
                            style={{
                              width: `${Math.max((st.candidate_count / maxCount) * 100, 1)}%`,
                              backgroundColor: BAR_COLORS.green,
                            }}
                          />
                          {st.candidate_count > 0 && (
                            <span className="hf-analytics-funnel-value">{st.candidate_count}</span>
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
    <div className="hf-analytics-split">
      <div className="hf-analytics-chart-main">
        <SectionTitle>Отказы по этапам</SectionTitle>
        <SectionDesc>На каком этапе кандидаты получают отказ</SectionDesc>

        <div>
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
      <div className="hf-analytics-legend">
        <div className="hf-analytics-legend-head">
          <span className="hf-analytics-legend-title">Всего отказов</span>
          <span className="hf-analytics-legend-total">{data.total_rejections}</span>
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
  const colors = [
    BAR_COLORS.green,
    BAR_COLORS.red,
    BAR_COLORS.primary,
    BAR_COLORS.blue,
    BAR_COLORS.purple,
    BAR_COLORS.orange,
  ];

  return (
    <>
      <div className="hf-analytics-kpi-row hf-analytics-kpi-row-compact">
        <KPICard value={data.total_candidates} label="Всего кандидатов" />
        <KPICard value={data.sources.length} label="Источников" />
      </div>

      <SectionTitle>Распределение по источникам</SectionTitle>
      <div className="hf-analytics-bars">
        {data.sources.map((s, i) => (
          <HBar
            key={i}
            width={(s.count / maxCount) * 100}
            color={colors[i % colors.length]}
            value={s.count}
            label={s.source === 'unknown' ? 'Не указан' : s.source}
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
      <div className="hf-analytics-bars">
        {data.movements.map((m, i) => {
          const color = m.to_stage === 'rejected' ? BAR_COLORS.red
            : m.to_stage === 'hired' ? BAR_COLORS.green
            : BAR_COLORS.primary;
          return (
            <div key={i} className="hf-analytics-bar-row">
              <div className="hf-analytics-movement-label">
                <span className="truncate">{m.from_label}</span>
                <ArrowRight className="hf-analytics-movement-icon" />
                <span className="truncate">{m.to_label}</span>
              </div>
              <div className="hf-analytics-bar-track">
                <div
                  className="h-7 rounded-sm"
                  style={{
                    width: `${Math.max((m.count / maxCount) * 100, 2)}%`,
                    backgroundColor: color,
                  }}
                />
                <span className="hf-analytics-bar-value">{m.count}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
