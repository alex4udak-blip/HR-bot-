import { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Search,
  Copy,
  AlertTriangle,
  Check,
  Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import api, { deduplicatedGet } from '@/services/api/client';

// Stage colors
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

const MATCH_FIELD_LABELS: Record<string, string> = {
  name: 'ФИО',
  email: 'Email',
  telegram: 'Telegram',
  birth_date: 'Дата рождения',
};

const MATCH_FIELD_COLORS: Record<string, string> = {
  name: 'bg-blue-500/15 text-blue-400',
  email: 'bg-purple-500/15 text-purple-400',
  telegram: 'bg-cyan-500/15 text-cyan-400',
  birth_date: 'bg-amber-500/15 text-amber-400',
};

interface CandidateRow {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  telegram?: string;
  birth_date?: string;
  vacancy_title: string;
  vacancy_id: number;
  stage: string;
  stage_label: string;
  source?: string;
  recruiter_name?: string;
  recruiter_id?: number;
  applied_at?: string;
}

interface DuplicateGroup {
  candidates: {
    id: number;
    name: string;
    email?: string;
    phone?: string;
    telegram?: string;
    birth_date?: string;
  }[];
  match_fields: string[];
  count: number;
}

interface FilterOptions {
  recruiters: { id: number; name: string }[];
  vacancies: { id: number; title: string }[];
}

export default function CandidateDatabasePage() {
  // Database tab state
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<FilterOptions>({ recruiters: [], vacancies: [] });
  const [search, setSearch] = useState('');
  const [recruiterId, setRecruiterId] = useState<number | undefined>();
  const [vacancyId, setVacancyId] = useState<number | undefined>();
  const [stageFilter, setStageFilter] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  // Duplicates tab state
  const [tab, setTab] = useState<'database' | 'duplicates'>('database');
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [dupTotal, setDupTotal] = useState(0);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupScanned, setDupScanned] = useState(false);
  const [mergingPair, setMergingPair] = useState<{ source: number; target: number } | null>(null);

  // Load candidates
  const loadCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { skip: page * 50, limit: 50 };
      if (search) params.search = search;
      if (recruiterId) params.recruiter_id = recruiterId;
      if (vacancyId) params.vacancy_id = vacancyId;
      if (stageFilter) params.stage = stageFilter;

      const res = await deduplicatedGet('/candidate-database', { params });
      const data = res.data as any;
      setCandidates(data.items);
      setTotal(data.total);
      if (data.filters) setFilters(data.filters);
    } catch {
      toast.error('Ошибка загрузки базы');
    } finally {
      setLoading(false);
    }
  }, [search, recruiterId, vacancyId, stageFilter, page]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  // Find duplicates
  const scanDuplicates = async () => {
    setDupLoading(true);
    try {
      const res = await api.post('/candidate-database/find-duplicates');
      setDuplicateGroups(res.data.groups);
      setDupTotal(res.data.total_groups);
      setDupScanned(true);
      if (res.data.total_groups === 0) {
        toast.success('Дубли не найдены!');
      } else {
        toast(`Найдено ${res.data.total_groups} групп возможных дублей`, { icon: '⚠️' });
      }
    } catch {
      toast.error('Ошибка поиска дублей');
    } finally {
      setDupLoading(false);
    }
  };

  // Merge candidates
  const mergeCandidates = async (sourceId: number, targetId: number) => {
    setMergingPair({ source: sourceId, target: targetId });
    try {
      await api.post(`/candidate-database/merge?source_id=${sourceId}&target_id=${targetId}`);
      toast.success('Кандидаты объединены');
      // Refresh duplicates
      setDuplicateGroups(prev => prev.filter(g =>
        !g.candidates.some(c => c.id === sourceId)
      ));
      setDupTotal(prev => Math.max(0, prev - 1));
    } catch {
      toast.error('Ошибка объединения');
    } finally {
      setMergingPair(null);
    }
  };

  return (
    <div className="h-full flex flex-col gap-4 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-dark-100 flex items-center gap-2">
            <Database className="w-6 h-6 text-accent-400" />
            База кандидатов
          </h1>
          <p className="text-sm text-dark-400 mt-0.5">
            Архив всех кандидатов из воронок • {total} записей
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 bg-white/[0.02] rounded-lg p-1 border border-white/[0.06]">
          <button
            onClick={() => setTab('database')}
            className={clsx(
              'px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2',
              tab === 'database' ? 'bg-accent-500/15 text-accent-400' : 'text-dark-400 hover:text-dark-200'
            )}
          >
            <Database className="w-4 h-4" />
            Архив ({total})
          </button>
          <button
            onClick={() => { setTab('duplicates'); if (!dupScanned) scanDuplicates(); }}
            className={clsx(
              'px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2',
              tab === 'duplicates' ? 'bg-amber-500/15 text-amber-400' : 'text-dark-400 hover:text-dark-200'
            )}
          >
            <Copy className="w-4 h-4" />
            Найти дубли
            {dupTotal > 0 && (
              <span className="bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                {dupTotal}
              </span>
            )}
          </button>
        </div>

        {tab === 'duplicates' && dupScanned && (
          <button
            onClick={scanDuplicates}
            disabled={dupLoading}
            className="px-3 py-2 text-sm glass-button rounded-lg text-dark-300 flex items-center gap-1.5"
          >
            {dupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Обновить
          </button>
        )}
      </div>

      {/* Database Tab */}
      {tab === 'database' && (
        <>
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
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
            <select
              value={recruiterId || ''}
              onChange={(e) => { setRecruiterId(e.target.value ? parseInt(e.target.value) : undefined); setPage(0); }}
              className="bg-white/[0.02] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-dark-200"
            >
              <option value="">Все рекрутеры</option>
              {filters.recruiters.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <select
              value={vacancyId || ''}
              onChange={(e) => { setVacancyId(e.target.value ? parseInt(e.target.value) : undefined); setPage(0); }}
              className="bg-white/[0.02] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-dark-200 max-w-[200px]"
            >
              <option value="">Все воронки</option>
              {filters.vacancies.map(v => (
                <option key={v.id} value={v.id}>{v.title}</option>
              ))}
            </select>
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

          {/* Table */}
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-dark-900/95 backdrop-blur-sm z-10">
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left py-2.5 px-3 text-dark-400 font-medium">ФИО</th>
                    <th className="text-left py-2.5 px-3 text-dark-400 font-medium">Телефон</th>
                    <th className="text-left py-2.5 px-3 text-dark-400 font-medium">Email</th>
                    <th className="text-left py-2.5 px-3 text-dark-400 font-medium">Telegram</th>
                    <th className="text-left py-2.5 px-3 text-dark-400 font-medium">Д.Р.</th>
                    <th className="text-left py-2.5 px-3 text-dark-400 font-medium">Воронка</th>
                    <th className="text-left py-2.5 px-3 text-dark-400 font-medium">Рекрутер</th>
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
                      <td className="py-2.5 px-3 text-dark-300 text-xs">{c.phone || '—'}</td>
                      <td className="py-2.5 px-3 text-dark-300 text-xs">{c.email || '—'}</td>
                      <td className="py-2.5 px-3 text-dark-300 text-xs">{c.telegram ? `@${c.telegram}` : '—'}</td>
                      <td className="py-2.5 px-3 text-dark-300 text-xs">{c.birth_date || '—'}</td>
                      <td className="py-2.5 px-3 text-dark-300 text-xs max-w-[150px] truncate">{c.vacancy_title}</td>
                      <td className="py-2.5 px-3 text-dark-300 text-xs">{c.recruiter_name || '—'}</td>
                      <td className="py-2.5 px-3">
                        <span className={clsx(
                          'px-2 py-0.5 rounded-full text-[10px] font-medium',
                          STAGE_COLORS[c.stage] || 'bg-dark-400/15 text-dark-300'
                        )}>
                          {c.stage_label}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {candidates.length === 0 && !loading && (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-dark-400">
                        <Database className="w-10 h-10 mx-auto mb-2 opacity-30" />
                        Нет кандидатов
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {total > 50 && (
            <div className="flex items-center justify-between py-2">
              <span className="text-xs text-dark-400">
                {page * 50 + 1}–{Math.min((page + 1) * 50, total)} из {total}
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
                  disabled={(page + 1) * 50 >= total}
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 text-xs rounded-lg glass-button disabled:opacity-30 text-dark-300"
                >
                  Вперёд
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Duplicates Tab */}
      {tab === 'duplicates' && (
        <div className="flex-1 overflow-auto">
          {dupLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-dark-400">
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-amber-400" />
              <p>Сканирование базы на дубли...</p>
              <p className="text-xs mt-1">Это может занять несколько секунд</p>
            </div>
          ) : !dupScanned ? (
            <div className="flex flex-col items-center justify-center py-16 text-dark-400">
              <Copy className="w-12 h-12 mb-3 opacity-30" />
              <p>Нажмите "Найти дубли" для сканирования</p>
            </div>
          ) : duplicateGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-dark-400">
              <Check className="w-12 h-12 mb-3 text-green-400 opacity-60" />
              <p className="text-green-400">Дубли не найдены</p>
              <p className="text-xs mt-1">Все кандидаты уникальны</p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-dark-400">
                <AlertTriangle className="w-4 h-4 inline text-amber-400 mr-1" />
                Найдено <strong className="text-amber-400">{dupTotal}</strong> групп возможных дублей
              </p>
              {duplicateGroups.map((group, gi) => (
                <div key={gi} className="glass-card rounded-xl p-4 space-y-3">
                  {/* Match info */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-dark-400">Совпадения:</span>
                    {group.match_fields.map(f => (
                      <span key={f} className={clsx(
                        'px-2 py-0.5 rounded-full text-[10px] font-medium',
                        MATCH_FIELD_COLORS[f] || 'bg-dark-400/15 text-dark-300'
                      )}>
                        {MATCH_FIELD_LABELS[f] || f}
                      </span>
                    ))}
                    <span className="text-xs text-dark-500 ml-auto">{group.count} кандидатов</span>
                  </div>

                  {/* Candidates in group */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {group.candidates.map((c) => (
                      <div key={c.id} className="glass-light rounded-lg p-3 text-sm">
                        <div className="font-medium text-dark-100 mb-1">{c.name}</div>
                        <div className="space-y-0.5 text-xs text-dark-400">
                          {c.email && <div className={clsx(group.match_fields.includes('email') && 'text-purple-400 font-medium')}>
                            📧 {c.email}
                          </div>}
                          {c.phone && <div>📞 {c.phone}</div>}
                          {c.telegram && <div className={clsx(group.match_fields.includes('telegram') && 'text-cyan-400 font-medium')}>
                            💬 @{c.telegram}
                          </div>}
                          {c.birth_date && <div className={clsx(group.match_fields.includes('birth_date') && 'text-amber-400 font-medium')}>
                            🎂 {c.birth_date}
                          </div>}
                        </div>
                        {/* Merge button */}
                        {group.candidates.length === 2 && c.id !== group.candidates[0].id && (
                          <button
                            onClick={() => mergeCandidates(c.id, group.candidates[0].id)}
                            disabled={mergingPair !== null}
                            className="mt-2 px-3 py-1 text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 rounded-lg transition-colors disabled:opacity-30 flex items-center gap-1"
                          >
                            {mergingPair?.source === c.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            Объединить в {group.candidates[0].name.split(' ')[0]}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
