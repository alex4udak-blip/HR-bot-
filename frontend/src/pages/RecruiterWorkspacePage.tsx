import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Briefcase,
  Users,
  UserCheck,
  Search,
  ChevronRight,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore } from '@/stores/authStore';
import {
  getWorkspaces,
  getWorkspace,
  getWorkspaceCandidates,
} from '@/services/api/workspaces';
import type {
  WorkspaceSummary,
  WorkspaceDetail,
  WorkspaceCandidate,
} from '@/services/api/workspaces';

// Stage color map
const STAGE_COLORS: Record<string, string> = {
  applied: 'bg-blue-500/15 text-blue-400',
  screening: 'bg-cyan-500/15 text-cyan-400',
  phone_screen: 'bg-purple-500/15 text-purple-400',
  interview: 'bg-indigo-500/15 text-indigo-400',
  assessment: 'bg-amber-500/15 text-amber-400',
  offer: 'bg-emerald-500/15 text-emerald-400',
  hired: 'bg-green-500/15 text-green-400',
  rejected: 'bg-red-500/15 text-red-400',
};

const VACANCY_STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-500/15 text-green-400',
  paused: 'bg-amber-500/15 text-amber-400',
  closed: 'bg-red-500/15 text-red-400',
  draft: 'bg-dark-400/15 text-dark-300',
};

const VACANCY_STATUS_LABELS: Record<string, string> = {
  open: 'Открыта',
  paused: 'На паузе',
  closed: 'Закрыта',
  draft: 'Черновик',
};

export default function RecruiterWorkspacePage() {
  const navigate = useNavigate();
  const { recruiterId } = useParams<{ recruiterId?: string }>();
  const { user } = useAuthStore();

  const isAdmin = user?.role === 'superadmin' || user?.org_role === 'owner' || user?.org_role === 'admin';

  // State
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [candidates, setCandidates] = useState<WorkspaceCandidate[]>([]);
  const [candidatesTotal, setCandidatesTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'vacancies' | 'candidates'>('vacancies');
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('');
  const [vacancyFilter, setVacancyFilter] = useState<number | undefined>();
  const [page, setPage] = useState(0);

  // Determine which recruiter to show
  const effectiveRecruiterId = recruiterId ? parseInt(recruiterId) : (isAdmin ? null : user?.id);

  // Load workspaces list (for admin) or direct workspace (for recruiter)
  useEffect(() => {
    setLoading(true);
    if (effectiveRecruiterId) {
      // Load specific workspace
      getWorkspace(effectiveRecruiterId)
        .then(setWorkspace)
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      // Load all workspaces (admin view)
      getWorkspaces()
        .then(setWorkspaces)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [effectiveRecruiterId]);

  // Load candidates when on candidates tab
  useEffect(() => {
    if (!effectiveRecruiterId || tab !== 'candidates') return;
    getWorkspaceCandidates(effectiveRecruiterId, {
      search: search || undefined,
      stage: stageFilter || undefined,
      vacancy_id: vacancyFilter,
      skip: page * 50,
      limit: 50,
    })
      .then((res) => {
        setCandidates(res.items);
        setCandidatesTotal(res.total);
      })
      .catch(() => {});
  }, [effectiveRecruiterId, tab, search, stageFilter, vacancyFilter, page]);

  // --- Admin: Workspaces List View ---
  if (!effectiveRecruiterId) {
    return (
      <div className="h-full flex flex-col gap-4 p-4 lg:p-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-dark-100">Пространства рекрутеров</h1>
          <p className="text-sm text-dark-400 mt-0.5">
            {workspaces.length} рекрутеров
          </p>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : workspaces.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-dark-400">
            <Users className="w-12 h-12 mb-3 opacity-40" />
            <p>Нет рекрутеров в организации</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {workspaces.map((ws) => (
              <button
                key={ws.recruiter_id}
                onClick={() => navigate(`/workspaces/${ws.recruiter_id}`)}
                className="glass-card rounded-xl p-5 text-left hover:border-accent-500/30 transition-all group"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-accent-500/15 flex items-center justify-center text-accent-400 font-medium">
                      {ws.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium text-dark-100">{ws.name}</div>
                      <div className="text-xs text-dark-400">{ws.email}</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-dark-500 group-hover:text-accent-400 transition-colors" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <div className="text-lg font-bold text-dark-100">{ws.vacancy_count}</div>
                    <div className="text-[10px] text-dark-400">Воронок</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-dark-100">{ws.candidate_count}</div>
                    <div className="text-[10px] text-dark-400">Кандидатов</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-accent-400">{ws.active_count}</div>
                    <div className="text-[10px] text-dark-400">Активных</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- Workspace Detail View ---
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-dark-400">
        <Users className="w-12 h-12 mb-3 opacity-40" />
        <p>Пространство не найдено</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        {isAdmin && (
          <button
            onClick={() => navigate('/workspaces')}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-dark-300" />
          </button>
        )}
        <div className="flex-1">
          <h1 className="text-xl lg:text-2xl font-bold text-dark-100">
            {isAdmin ? `Пространство: ${workspace.name}` : 'Моё пространство'}
          </h1>
          <p className="text-sm text-dark-400 mt-0.5">{workspace.email}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="glass-card rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/15 flex items-center justify-center">
            <Briefcase className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <div className="text-xl font-bold text-dark-100">{workspace.vacancies.length}</div>
            <div className="text-xs text-dark-400">Воронок</div>
          </div>
        </div>
        <div className="glass-card rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-500/15 flex items-center justify-center">
            <Users className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <div className="text-xl font-bold text-dark-100">{workspace.total_candidates}</div>
            <div className="text-xs text-dark-400">Всего кандидатов</div>
          </div>
        </div>
        <div className="glass-card rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/15 flex items-center justify-center">
            <UserCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="text-xl font-bold text-emerald-400">{workspace.active_candidates}</div>
            <div className="text-xs text-dark-400">Активных</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-white/[0.02] rounded-lg p-1 border border-white/[0.06] w-fit">
        <button
          onClick={() => setTab('vacancies')}
          className={clsx(
            'px-4 py-2 text-sm font-medium rounded-md transition-colors',
            tab === 'vacancies' ? 'bg-accent-500/15 text-accent-400' : 'text-dark-400 hover:text-dark-200'
          )}
        >
          Воронки ({workspace.vacancies.length})
        </button>
        <button
          onClick={() => setTab('candidates')}
          className={clsx(
            'px-4 py-2 text-sm font-medium rounded-md transition-colors',
            tab === 'candidates' ? 'bg-accent-500/15 text-accent-400' : 'text-dark-400 hover:text-dark-200'
          )}
        >
          Кандидаты ({workspace.total_candidates})
        </button>
      </div>

      {/* Tab Content */}
      {tab === 'vacancies' ? (
        <div className="flex-1 overflow-y-auto space-y-2">
          {workspace.vacancies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-dark-400">
              <Briefcase className="w-10 h-10 mb-3 opacity-40" />
              <p>Нет воронок</p>
            </div>
          ) : (
            workspace.vacancies.map((v) => (
              <button
                key={v.id}
                onClick={() => navigate(`/vacancies/${v.id}`)}
                className="w-full glass-card rounded-xl p-4 flex items-center justify-between hover:border-accent-500/30 transition-all group text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Briefcase className="w-5 h-5 text-dark-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-dark-100 truncate">{v.title}</div>
                    {v.department_name && (
                      <div className="text-xs text-dark-400 mt-0.5">{v.department_name}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={clsx(
                    'px-2.5 py-1 rounded-full text-xs font-medium',
                    VACANCY_STATUS_COLORS[v.status] || 'bg-dark-400/15 text-dark-300'
                  )}>
                    {VACANCY_STATUS_LABELS[v.status] || v.status}
                  </span>
                  <div className="text-sm text-dark-300">
                    <Users className="w-4 h-4 inline mr-1" />
                    {v.candidate_count}
                  </div>
                  <ChevronRight className="w-4 h-4 text-dark-500 group-hover:text-accent-400 transition-colors" />
                </div>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-3 overflow-hidden">
          {/* Candidates search + filters */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
              <input
                type="text"
                placeholder="Поиск по ФИО, email, телефону..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="w-full pl-10 pr-4 py-2 bg-white/[0.02] border border-white/[0.06] rounded-lg text-sm text-dark-100 placeholder-dark-400 focus:outline-none focus:border-accent-500/50"
              />
            </div>
            {workspace.vacancies.length > 0 && (
              <select
                value={vacancyFilter || ''}
                onChange={(e) => { setVacancyFilter(e.target.value ? parseInt(e.target.value) : undefined); setPage(0); }}
                className="bg-white/[0.02] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-dark-200 max-w-[200px]"
              >
                <option value="">Все воронки</option>
                {workspace.vacancies.map((v) => (
                  <option key={v.id} value={v.id}>{v.title}</option>
                ))}
              </select>
            )}
            <select
              value={stageFilter}
              onChange={(e) => { setStageFilter(e.target.value); setPage(0); }}
              className="bg-white/[0.02] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-dark-200"
            >
              <option value="">Все этапы</option>
              <option value="applied">Новый</option>
              <option value="screening">Отбор</option>
              <option value="phone_screen">Собеседование назначено</option>
              <option value="interview">Собеседование пройдено</option>
              <option value="assessment">Практика</option>
              <option value="offer">Оффер</option>
              <option value="hired">Вышел на работу</option>
              <option value="rejected">Отказ</option>
            </select>
          </div>

          {/* Candidates table */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-dark-900/90 backdrop-blur-sm">
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left py-2.5 px-3 text-dark-400 font-medium">ФИО</th>
                  <th className="text-left py-2.5 px-3 text-dark-400 font-medium">Телефон</th>
                  <th className="text-left py-2.5 px-3 text-dark-400 font-medium">Email</th>
                  <th className="text-left py-2.5 px-3 text-dark-400 font-medium">Telegram</th>
                  <th className="text-left py-2.5 px-3 text-dark-400 font-medium">Воронка</th>
                  <th className="text-left py-2.5 px-3 text-dark-400 font-medium">Этап</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c, i) => (
                  <tr
                    key={`${c.id}-${c.vacancy_id}-${i}`}
                    className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-2.5 px-3 text-dark-100 font-medium">{c.name}</td>
                    <td className="py-2.5 px-3 text-dark-300">{c.phone || '—'}</td>
                    <td className="py-2.5 px-3 text-dark-300">{c.email || '—'}</td>
                    <td className="py-2.5 px-3 text-dark-300">{c.telegram ? `@${c.telegram}` : '—'}</td>
                    <td className="py-2.5 px-3 text-dark-300 max-w-[180px] truncate">{c.vacancy_title}</td>
                    <td className="py-2.5 px-3">
                      <span className={clsx(
                        'px-2 py-0.5 rounded-full text-xs font-medium',
                        STAGE_COLORS[c.stage] || 'bg-dark-400/15 text-dark-300'
                      )}>
                        {c.stage_label}
                      </span>
                    </td>
                  </tr>
                ))}
                {candidates.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-dark-400">
                      Нет кандидатов
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {candidatesTotal > 50 && (
            <div className="flex items-center justify-between py-2">
              <span className="text-xs text-dark-400">
                {page * 50 + 1}–{Math.min((page + 1) * 50, candidatesTotal)} из {candidatesTotal}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 text-xs rounded-lg glass-button disabled:opacity-30 text-dark-300"
                >
                  Назад
                </button>
                <button
                  disabled={(page + 1) * 50 >= candidatesTotal}
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 text-xs rounded-lg glass-button disabled:opacity-30 text-dark-300"
                >
                  Вперёд
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
