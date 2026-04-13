import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  ChevronDown,
  Settings,
  Plus,
  Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import type { Vacancy, VacancyApplication, ApplicationStage, KanbanColumn } from '@/types';
import { APPLICATION_STAGE_LABELS } from '@/types';
import { getKanbanBoard } from '@/services/api';
import StagesConfigModal from './StagesConfigModal';
import { useVacancyStore } from '@/stores/vacancyStore';

// Default visible stages (same as KanbanBoard)
const DEFAULT_VISIBLE_STAGES: ApplicationStage[] = [
  'applied', 'screening', 'phone_screen', 'interview', 'assessment', 'offer', 'hired', 'rejected'
];

/** Derive visible stages and labels from vacancy.custom_stages or defaults */
function getStagesConfig(vacancy: Vacancy): {
  stages: ApplicationStage[];
  labels: Record<string, string>;
} {
  const custom = vacancy.custom_stages?.columns;
  if (!Array.isArray(custom) || custom.length === 0) {
    return {
      stages: DEFAULT_VISIBLE_STAGES,
      labels: { ...APPLICATION_STAGE_LABELS },
    };
  }
  const stages: ApplicationStage[] = [];
  const labels: Record<string, string> = { ...APPLICATION_STAGE_LABELS };
  const seen = new Set<string>();
  for (const col of custom) {
    if (!col.visible) continue;
    const enumKey = (col.maps_to || col.key) as ApplicationStage;
    if (seen.has(enumKey)) continue;
    seen.add(enumKey);
    stages.push(enumKey);
    labels[enumKey] = col.label;
  }
  return { stages, labels };
}

// Stage badge colors — Huntflow-style vivid
const STAGE_BG_COLORS: Record<string, string> = {
  applied: 'bg-emerald-500',
  screening: 'bg-cyan-500',
  phone_screen: 'bg-violet-500',
  interview: 'bg-amber-500',
  assessment: 'bg-orange-500',
  offer: 'bg-yellow-500',
  hired: 'bg-green-500',
  rejected: 'bg-red-500',
  withdrawn: 'bg-gray-500',
};

interface StatusListViewProps {
  vacancy: Vacancy;
}

export default function StatusListView({ vacancy }: StatusListViewProps) {
  const navigate = useNavigate();
  const { updateVacancy, fetchVacancy } = useVacancyStore();

  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showStagesConfig, setShowStagesConfig] = useState(false);

  const { stages, labels } = useMemo(() => getStagesConfig(vacancy), [vacancy]);

  // Fetch kanban data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const board = await getKanbanBoard(vacancy.id);
      setColumns(board.columns);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [vacancy.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Group applications by stage
  const groupedByStage = useMemo(() => {
    const map: Record<string, VacancyApplication[]> = {};
    for (const stage of stages) {
      map[stage] = [];
    }
    for (const col of columns) {
      const stage = col.stage;
      if (map[stage]) {
        map[stage] = col.applications;
      }
    }
    return map;
  }, [columns, stages]);

  // Stage counts
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const col of columns) {
      counts[col.stage] = col.count;
    }
    return counts;
  }, [columns]);

  const toggleCollapse = (stage: string) => {
    setCollapsed(prev => ({ ...prev, [stage]: !prev[stage] }));
  };

  const handleCandidateClick = (app: VacancyApplication) => {
    navigate(`/contacts/${app.entity_id}`);
  };

  const handleSaveStages = async (cols: Array<{ key: string; label: string; visible: boolean; maps_to?: string }>) => {
    await updateVacancy(vacancy.id, { custom_stages: { columns: cols } });
    await fetchVacancy(vacancy.id);
    setShowStagesConfig(false);
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-accent-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Header row */}
      <div className="sticky top-0 z-10 bg-dark-950/95 backdrop-blur-sm border-b border-white/[0.06]">
        <div className="flex items-center px-4 py-2 text-xs font-medium text-dark-400 uppercase tracking-wider">
          <div className="w-8" /> {/* collapse icon */}
          <div className="flex-1 min-w-[200px]">ФИО</div>
          <div className="w-28 text-center">Статус</div>
          <div className="w-28 text-center">Дата</div>
          <div className="w-36">Telegram</div>
          <div className="w-36">Email</div>
          <div className="w-36">Телефон</div>
          <div className="w-28">Источник</div>
          <button
            onClick={() => setShowStagesConfig(true)}
            className="p-1.5 rounded hover:bg-white/10 text-dark-400 hover:text-white transition-colors ml-2"
            title="Настроить стадии"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stage groups */}
      <div className="divide-y divide-white/[0.04]">
        {stages.map((stage) => {
          const apps = groupedByStage[stage] || [];
          const count = stageCounts[stage] || apps.length;
          const isCollapsed = collapsed[stage];
          const bgColor = STAGE_BG_COLORS[stage] || 'bg-gray-600';

          return (
            <div key={stage}>
              {/* Stage header row */}
              <div
                className="flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-white/[0.02] transition-colors group"
                onClick={() => toggleCollapse(stage)}
              >
                <div className="w-5 h-5 flex items-center justify-center text-dark-400 group-hover:text-white transition-colors">
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </div>
                <span className={clsx(
                  'px-2.5 py-1 rounded text-xs font-bold text-white uppercase tracking-wide',
                  bgColor
                )}>
                  {labels[stage] || stage}
                </span>
                <span className="text-xs text-dark-400 font-medium">{count}</span>
                <div className="flex-1" />
                <button
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 text-dark-400 hover:text-white transition-all"
                  onClick={(e) => { e.stopPropagation(); /* TODO: add candidate */ }}
                  title="Добавить кандидата"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Candidates table */}
              {!isCollapsed && apps.length > 0 && (
                <div>
                  {apps.map((app) => (
                    <div
                      key={app.id}
                      className="flex items-center px-4 py-2 hover:bg-white/[0.03] cursor-pointer transition-colors border-l-2 border-transparent hover:border-accent-500/50 group/row"
                      onClick={() => handleCandidateClick(app)}
                    >
                      <div className="w-8" /> {/* indent for collapse icon */}
                      <div className="flex-1 min-w-[200px]">
                        <span className="text-sm text-dark-100 group-hover/row:text-accent-400 transition-colors">
                          {app.entity_name || 'Без имени'}
                        </span>
                      </div>
                      <div className="w-28 text-center">
                        <span className={clsx(
                          'inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase truncate max-w-[110px]',
                          STAGE_BG_COLORS[app.stage] || 'bg-gray-500',
                          'text-white'
                        )}>
                          {(labels[app.stage] || APPLICATION_STAGE_LABELS[app.stage] || app.stage).substring(0, 8)}...
                        </span>
                      </div>
                      <div className="w-28 text-center text-xs text-dark-300">
                        {app.applied_at ? new Date(app.applied_at).toLocaleDateString('ru-RU', { month: '2-digit', day: '2-digit', year: '2-digit' }) : '—'}
                      </div>
                      <div className="w-36 text-xs text-dark-300 truncate">
                        {app.entity_telegram ? `@${app.entity_telegram.replace('@', '')}` : '—'}
                      </div>
                      <div className="w-36 text-xs text-dark-300 truncate">
                        {app.entity_email || '—'}
                      </div>
                      <div className="w-36 text-xs text-dark-300 truncate">
                        {app.entity_phone || '—'}
                      </div>
                      <div className="w-28 text-xs text-dark-400 truncate">
                        {app.source || '—'}
                      </div>
                      <div className="w-8" /> {/* right padding */}
                    </div>
                  ))}
                </div>
              )}

              {/* Empty state for collapsed or empty group */}
              {!isCollapsed && apps.length === 0 && (
                <div className="flex items-center gap-2 px-4 py-3 pl-12">
                  <span className="text-xs text-dark-500 italic">Пусто</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Stages config modal */}
      {showStagesConfig && (
        <StagesConfigModal
          columns={vacancy.custom_stages?.columns ?? null}
          onSave={handleSaveStages}
          onClose={() => setShowStagesConfig(false)}
        />
      )}
    </div>
  );
}
