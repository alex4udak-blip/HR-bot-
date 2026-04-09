import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Briefcase,
  Users,
  ChevronRight,
  Search,
  LayoutGrid,
  List,
  X,
  Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useVacancyStore } from '@/stores/vacancyStore';
import { useAuthStore } from '@/stores/authStore';
import { getUsers } from '@/services/api';
import type { Vacancy, VacancyStatus } from '@/types';
import { VacancyStatusBadge } from '@/components/vacancies';

// Status filter options
const STATUS_FILTERS: { id: VacancyStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'open', label: 'Открытые' },
  { id: 'paused', label: 'На паузе' },
  { id: 'closed', label: 'Закрытые' },
  { id: 'draft', label: 'Черновики' },
];

interface RecruiterGroup {
  userId: number;
  userName: string;
  vacancies: Vacancy[];
}

export default function RecruiterFunnelsPage() {
  const navigate = useNavigate();
  const { vacancies, isLoading, fetchVacancies, createVacancy } = useVacancyStore();
  const { user } = useAuthStore();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<VacancyStatus | 'all'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [usersMap, setUsersMap] = useState<Record<number, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);

  const isHrAdmin = user?.role === 'superadmin' || user?.org_role === 'owner' || user?.org_role === 'admin';

  useEffect(() => {
    fetchVacancies();
  }, [fetchVacancies]);

  useEffect(() => {
    if (isHrAdmin) {
      getUsers().then((users) => {
        const map: Record<number, string> = {};
        users.forEach((u) => { map[u.id] = u.name; });
        setUsersMap(map);
      }).catch(() => {});
    }
  }, [isHrAdmin]);

  const filteredVacancies = useMemo(() => {
    let result = vacancies;
    if (!isHrAdmin && user) {
      result = result.filter((v) => v.created_by === user.id);
    }
    if (statusFilter !== 'all') {
      result = result.filter((v) => v.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (v) => v.title.toLowerCase().includes(q) || v.department_name?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [vacancies, user, isHrAdmin, statusFilter, search]);

  const recruiterGroups = useMemo((): RecruiterGroup[] => {
    if (!isHrAdmin) return [];
    const groups: Record<number, RecruiterGroup> = {};
    filteredVacancies.forEach((v) => {
      const uid = v.created_by ?? 0;
      if (!groups[uid]) {
        groups[uid] = {
          userId: uid,
          userName: v.created_by_name || usersMap[uid] || 'Без автора',
          vacancies: [],
        };
      }
      groups[uid].vacancies.push(v);
    });
    return Object.values(groups).sort((a, b) => a.userName.localeCompare(b.userName));
  }, [filteredVacancies, isHrAdmin, usersMap]);

  const handleOpenFunnel = (vacancyId: number) => {
    navigate(`/vacancies/${vacancyId}`);
  };

  const handleFunnelCreated = (vacancy: Vacancy) => {
    setShowCreateModal(false);
    navigate(`/vacancies/${vacancy.id}`);
  };

  return (
    <div className="h-full flex flex-col gap-4 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-dark-50">
            {isHrAdmin ? 'Воронки рекрутеров' : 'Мои воронки'}
          </h1>
          <p className="text-sm text-dark-400 mt-0.5">
            {isHrAdmin
              ? `${filteredVacancies.length} воронок у ${recruiterGroups.length} рекрутеров`
              : `${filteredVacancies.length} воронок`}
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Новая воронка
        </button>
      </div>

      {/* Filters bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
          <input
            type="text"
            placeholder="Поиск по названию..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 glass-light border border-white/[0.06] rounded-lg text-sm text-dark-100 placeholder-dark-400 focus:outline-none focus:border-accent-500/50"
          />
        </div>
        <div className="flex items-center gap-1 glass-light rounded-lg p-1 border border-white/[0.06]">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={clsx(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                statusFilter === f.id
                  ? 'bg-accent-500/15 text-accent-400'
                  : 'text-dark-400 hover:text-dark-200'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 glass-light rounded-lg p-1 border border-white/[0.06]">
          <button
            onClick={() => setViewMode('grid')}
            className={clsx(
              'p-1.5 rounded-md transition-colors',
              viewMode === 'grid' ? 'bg-accent-500/15 text-accent-400' : 'text-dark-400 hover:text-dark-200'
            )}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={clsx(
              'p-1.5 rounded-md transition-colors',
              viewMode === 'list' ? 'bg-accent-500/15 text-accent-400' : 'text-dark-400 hover:text-dark-200'
            )}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredVacancies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Briefcase className="w-10 h-10 text-dark-500" />
            <div className="text-center">
              <p className="text-dark-100 font-medium">Пока нет воронок</p>
              <p className="text-dark-400 text-sm mt-1">Создайте первую воронку для начала работы</p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Создать воронку
            </button>
          </div>
        ) : isHrAdmin ? (
          <div className="space-y-6">
            {recruiterGroups.map((group) => (
              <div key={group.userId}>
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-sm font-semibold text-dark-100">{group.userName}</h2>
                  <span className="text-xs text-dark-400">{group.vacancies.length} воронок</span>
                </div>
                {viewMode === 'grid' ? (
                  <FunnelGrid vacancies={group.vacancies} onOpen={handleOpenFunnel} />
                ) : (
                  <FunnelList vacancies={group.vacancies} onOpen={handleOpenFunnel} />
                )}
              </div>
            ))}
          </div>
        ) : viewMode === 'grid' ? (
          <FunnelGrid vacancies={filteredVacancies} onOpen={handleOpenFunnel} />
        ) : (
          <FunnelList vacancies={filteredVacancies} onOpen={handleOpenFunnel} />
        )}
      </div>

      {/* Create Funnel Modal */}
      {showCreateModal && (
        <CreateFunnelModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleFunnelCreated}
          createVacancy={createVacancy}
        />
      )}
    </div>
  );
}

/* ===================== Create Funnel Modal ===================== */

function CreateFunnelModal({
  onClose,
  onCreated,
  createVacancy,
}: {
  onClose: () => void;
  onCreated: (vacancy: Vacancy) => void;
  createVacancy: (data: { title: string; status: VacancyStatus }) => Promise<Vacancy>;
}) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3) {
      toast.error('Название минимум 3 символа');
      return;
    }
    setSaving(true);
    try {
      const vacancy = await createVacancy({
        title: title.trim(),
        status: 'open' as VacancyStatus,
      });
      toast.success('Воронка создана');
      onCreated(vacancy);
    } catch {
      toast.error('Ошибка создания воронки');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass rounded-2xl border border-white/10 shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-dark-50">Новая воронка</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-dark-400 hover:text-dark-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <label className="block text-sm font-medium text-dark-200 mb-2">
              Название воронки <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Frontend React Developer"
              className="w-full px-4 py-2.5 glass-light border border-white/[0.08] rounded-lg text-sm text-dark-100 placeholder-dark-400 focus:outline-none focus:border-accent-500/50"
            />
            <p className="mt-1.5 text-xs text-dark-400">
              Стадии воронки можно настроить после создания через ⚙️
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-dark-300 hover:text-dark-100 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving || title.trim().length < 3}
              className="flex items-center gap-2 px-5 py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Создать
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ===================== Subcomponents ===================== */

function FunnelGrid({ vacancies, onOpen }: { vacancies: Vacancy[]; onOpen: (id: number) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {vacancies.map((v) => (
        <FunnelCard key={v.id} vacancy={v} onClick={() => onOpen(v.id)} />
      ))}
    </div>
  );
}

function FunnelList({ vacancies, onOpen }: { vacancies: Vacancy[]; onOpen: (id: number) => void }) {
  return (
    <div className="space-y-1.5">
      {vacancies.map((v) => (
        <FunnelRow key={v.id} vacancy={v} onClick={() => onOpen(v.id)} />
      ))}
    </div>
  );
}

function FunnelCard({ vacancy, onClick }: { vacancy: Vacancy; onClick: () => void }) {
  const count = vacancy.applications_count ?? 0;
  const stageCounts = vacancy.stage_counts ?? {};
  const mainStages = ['applied', 'screening', 'phone_screen', 'interview', 'assessment', 'offer', 'hired'];
  const total = mainStages.reduce((s, k) => s + (stageCounts[k] || 0), 0);

  return (
    <div
      onClick={onClick}
      className="p-3 rounded-lg border border-white/[0.06] glass-light hover:border-white/[0.12] cursor-pointer transition-colors group"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-sm font-medium text-dark-100 group-hover:text-accent-400 transition-colors line-clamp-2">
          {vacancy.title}
        </h3>
        <ChevronRight className="w-4 h-4 text-dark-500 group-hover:text-accent-400 transition-colors shrink-0 mt-0.5" />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <VacancyStatusBadge status={vacancy.status} />
        {vacancy.department_name && (
          <span className="text-xs text-dark-400 truncate">{vacancy.department_name}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-dark-400 mb-2">
        <Users className="w-3.5 h-3.5" />
        <span>{count} кандидатов</span>
      </div>
      {total > 0 && (
        <div className="flex gap-0.5 h-1 rounded-full overflow-hidden bg-white/[0.04]">
          {mainStages.map((stage) => {
            const c = stageCounts[stage] || 0;
            if (c === 0) return null;
            const pct = (c / total) * 100;
            return (
              <div
                key={stage}
                className={clsx(
                  'h-full rounded-full',
                  stage === 'applied' && 'bg-blue-500/70',
                  stage === 'screening' && 'bg-cyan-500/70',
                  stage === 'phone_screen' && 'bg-purple-500/70',
                  stage === 'interview' && 'bg-indigo-500/70',
                  stage === 'assessment' && 'bg-orange-500/70',
                  stage === 'offer' && 'bg-yellow-500/70',
                  stage === 'hired' && 'bg-green-500/70',
                )}
                style={{ width: `${Math.max(pct, 4)}%` }}
                title={`${stage}: ${c}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function FunnelRow({ vacancy, onClick }: { vacancy: Vacancy; onClick: () => void }) {
  const count = vacancy.applications_count ?? 0;
  const stageCounts = vacancy.stage_counts ?? {};

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 px-3 py-2.5 rounded-lg border border-white/[0.06] glass-light hover:border-white/[0.12] cursor-pointer transition-colors group"
    >
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium text-dark-100 group-hover:text-accent-400 transition-colors truncate">
          {vacancy.title}
        </h3>
        {vacancy.department_name && (
          <p className="text-xs text-dark-400 truncate mt-0.5">{vacancy.department_name}</p>
        )}
      </div>
      <VacancyStatusBadge status={vacancy.status} />
      <div className="flex items-center gap-1.5 text-xs text-dark-400 w-28 shrink-0">
        <Users className="w-3.5 h-3.5" />
        <span>{count} кандидатов</span>
      </div>
      <div className="hidden lg:flex items-center gap-1.5 shrink-0">
        {(['applied', 'screening', 'phone_screen', 'offer', 'hired'] as const).map((stage) => {
          const c = stageCounts[stage] || 0;
          if (c === 0) return null;
          return (
            <span
              key={stage}
              className={clsx(
                'px-1.5 py-0.5 text-[10px] font-medium rounded',
                stage === 'applied' && 'bg-blue-500/10 text-blue-400',
                stage === 'screening' && 'bg-cyan-500/10 text-cyan-400',
                stage === 'phone_screen' && 'bg-purple-500/10 text-purple-400',
                stage === 'offer' && 'bg-yellow-500/10 text-yellow-400',
                stage === 'hired' && 'bg-green-500/10 text-green-400',
              )}
            >
              {c}
            </span>
          );
        })}
      </div>
      <ChevronRight className="w-4 h-4 text-dark-500 group-hover:text-accent-400 transition-colors shrink-0" />
    </div>
  );
}
