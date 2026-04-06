import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Loader2,
  Users,
  UserPlus,
  Eye,
  Wrench,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Copy,
  Tag,
  Download,
  RefreshCw,
  Briefcase,
  Calendar,
  Filter,
  X,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import {
  searchCandidates,
  bulkCandidateAction,
  getCandidateRecruiters,
  getCandidateTags,
} from '@/services/api/candidates';
import type {
  CandidateSearchParams,
  CandidateStats,
  CandidateSearchResult,
  RecruiterOption,
  BulkActionPayload,
} from '@/services/api/candidates';
import { formatDate } from '@/utils';
import { STATUS_LABELS, STATUS_COLORS } from '@/types';
import type { EntityStatus } from '@/types';

// ---------- constants ----------

const STAT_PILLS: { key: keyof CandidateStats; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'total', label: 'Всего', icon: <Users className="w-4 h-4" />, color: 'text-white/70' },
  { key: 'new', label: 'Новые', icon: <UserPlus className="w-4 h-4" />, color: 'text-blue-400' },
  { key: 'screening', label: 'Скрининг', icon: <Eye className="w-4 h-4" />, color: 'text-cyan-400' },
  { key: 'practice', label: 'Практика', icon: <Wrench className="w-4 h-4" />, color: 'text-amber-400' },
  { key: 'hired', label: 'Приняты', icon: <CheckCircle2 className="w-4 h-4" />, color: 'text-green-400' },
  { key: 'rejected', label: 'Отклонены', icon: <XCircle className="w-4 h-4" />, color: 'text-red-400' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'new', label: 'Новый' },
  { value: 'screening', label: 'Скрининг' },
  { value: 'practice', label: 'Практика' },
  { value: 'tech_practice', label: 'Тех-практика' },
  { value: 'is_interview', label: 'ИС' },
  { value: 'offer', label: 'Оффер' },
  { value: 'hired', label: 'Принят' },
  { value: 'rejected', label: 'Отклонён' },
  { value: 'withdrawn', label: 'Отозван' },
];

const SOURCE_OPTIONS = [
  { value: '', label: 'Все источники' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'web', label: 'Web' },
  { value: 'hh', label: 'HeadHunter' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'referral', label: 'Реферал' },
  { value: 'other', label: 'Другое' },
];

const PER_PAGE_OPTIONS = [20, 50, 100];

const SORTABLE_COLUMNS: { key: string; label: string }[] = [
  { key: 'name', label: 'Имя' },
  { key: 'status', label: 'Статус' },
  { key: 'source', label: 'Источник' },
  { key: 'created_at', label: 'Создан' },
];

// ---------- helpers ----------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

const emptyStats: CandidateStats = { total: 0, new: 0, screening: 0, practice: 0, hired: 0, rejected: 0 };

// ---------- component ----------

export default function AllCandidatesPage() {
  // --- data ---
  const [result, setResult] = useState<CandidateSearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [recruiters, setRecruiters] = useState<RecruiterOption[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);

  // --- filters ---
  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebounce(searchText, 350);
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [recruiterId, setRecruiterId] = useState<number | undefined>(undefined);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [tagsFilter, setTagsFilter] = useState('');

  // --- pagination / sort ---
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // --- selection ---
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkStatusValue, setBulkStatusValue] = useState('');
  const [bulkTagValue, setBulkTagValue] = useState('');

  // --- refs ---
  const abortRef = useRef<AbortController | null>(null);

  // Load recruiters + tags once
  useEffect(() => {
    getCandidateRecruiters().then(setRecruiters).catch(() => {});
    getCandidateTags().then(setAllTags).catch(() => {});
  }, []);

  // Build params object
  const buildParams = useCallback((): CandidateSearchParams => ({
    q: debouncedSearch || undefined,
    status: status || undefined,
    source: source || undefined,
    recruiter_id: recruiterId,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    tags: tagsFilter || undefined,
    page,
    per_page: perPage,
    sort_by: sortBy,
    sort_order: sortOrder,
  }), [debouncedSearch, status, source, recruiterId, dateFrom, dateTo, tagsFilter, page, perPage, sortBy, sortOrder]);

  // Fetch data
  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const data = await searchCandidates(buildParams());
      if (!controller.signal.aborted) {
        setResult(data);
      }
    } catch (err: any) {
      if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
        console.error('Candidate search failed', err);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [debouncedSearch, status, source, recruiterId, dateFrom, dateTo, tagsFilter, perPage]);

  // Clear selection on data change
  useEffect(() => { setSelected(new Set()); }, [result]);

  const stats = result?.stats ?? emptyStats;
  const items = result?.items ?? [];
  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // --- selection helpers ---
  const allOnPageSelected = items.length > 0 && items.every(i => selected.has(i.id));

  const toggleAll = () => {
    if (allOnPageSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map(i => i.id)));
    }
  };

  const toggleOne = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // --- sort ---
  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder(o => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortOrder('asc');
    }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <ArrowUpDown className="w-3.5 h-3.5 text-white/20" />;
    return sortOrder === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5 text-blue-400" />
      : <ArrowDown className="w-3.5 h-3.5 text-blue-400" />;
  };

  // --- bulk actions ---
  const doBulk = async (action: string, extra?: Partial<BulkActionPayload>) => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      const payload: BulkActionPayload = {
        entity_ids: Array.from(selected),
        action,
        ...extra,
      };
      const res = await bulkCandidateAction(payload);
      if (res instanceof Blob) {
        const url = URL.createObjectURL(res);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'candidates_export.csv';
        a.click();
        URL.revokeObjectURL(url);
      }
      fetchData();
    } catch (err) {
      console.error('Bulk action failed', err);
    } finally {
      setBulkLoading(false);
    }
  };

  // --- reset filters ---
  const resetFilters = () => {
    setSearchText('');
    setStatus('');
    setSource('');
    setRecruiterId(undefined);
    setDateFrom('');
    setDateTo('');
    setTagsFilter('');
  };

  const hasActiveFilters = !!(debouncedSearch || status || source || recruiterId || dateFrom || dateTo || tagsFilter);

  // --- render ---
  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Кандидаты</h1>
          <p className="text-sm text-white/40 mt-0.5">CRM-поиск и управление кандидатами</p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-3 py-2 bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 rounded-xl text-sm text-white/60 hover:text-white transition-all"
        >
          <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          Обновить
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {STAT_PILLS.map(pill => (
          <motion.div
            key={pill.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/[0.04] border border-white/[0.06] rounded-xl px-4 py-3 flex items-center gap-3"
          >
            <div className={clsx('flex-shrink-0', pill.color)}>{pill.icon}</div>
            <div>
              <p className="text-xs text-white/40">{pill.label}</p>
              <p className={clsx('text-lg font-bold', pill.color)}>
                {loading ? '-' : stats[pill.key]}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-white/30" />
        <input
          type="text"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="Поиск по имени, email, телефону, позиции..."
          className="w-full pl-11 pr-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all"
        />
        {searchText && (
          <button onClick={() => setSearchText('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Status */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-white/30 uppercase tracking-wider">Статус</label>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 appearance-none cursor-pointer min-w-[140px]"
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value} className="bg-[#1a1a2e] text-white">{o.label}</option>
            ))}
          </select>
        </div>

        {/* Source */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-white/30 uppercase tracking-wider">Источник</label>
          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 appearance-none cursor-pointer min-w-[140px]"
          >
            {SOURCE_OPTIONS.map(o => (
              <option key={o.value} value={o.value} className="bg-[#1a1a2e] text-white">{o.label}</option>
            ))}
          </select>
        </div>

        {/* Recruiter */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-white/30 uppercase tracking-wider">Рекрутер</label>
          <select
            value={recruiterId ?? ''}
            onChange={e => setRecruiterId(e.target.value ? Number(e.target.value) : undefined)}
            className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 appearance-none cursor-pointer min-w-[150px]"
          >
            <option value="" className="bg-[#1a1a2e] text-white">Все рекрутеры</option>
            {recruiters.map(r => (
              <option key={r.id} value={r.id} className="bg-[#1a1a2e] text-white">{r.name}</option>
            ))}
          </select>
        </div>

        {/* Date from */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-white/30 uppercase tracking-wider">Дата от</label>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 min-w-[140px]"
            />
          </div>
        </div>

        {/* Date to */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-white/30 uppercase tracking-wider">Дата до</label>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 min-w-[140px]"
            />
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-white/30 uppercase tracking-wider">Теги</label>
          <input
            type="text"
            value={tagsFilter}
            onChange={e => setTagsFilter(e.target.value)}
            placeholder="frontend, senior..."
            list="tag-suggestions"
            className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20 min-w-[140px]"
          />
          <datalist id="tag-suggestions">
            {allTags.map(t => <option key={t} value={t} />)}
          </datalist>
        </div>

        {/* Reset button */}
        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-sm text-red-400 transition-all self-end"
          >
            <Filter className="w-3.5 h-3.5" />
            Сбросить
          </button>
        )}
      </div>

      {/* Bulk actions toolbar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3">
              <span className="text-sm text-blue-300 font-medium">
                Выбрано: {selected.size}
              </span>
              <div className="h-5 w-px bg-white/10" />

              {/* Change status */}
              <div className="flex items-center gap-1.5">
                <select
                  value={bulkStatusValue}
                  onChange={e => setBulkStatusValue(e.target.value)}
                  className="bg-white/[0.06] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white appearance-none cursor-pointer"
                >
                  <option value="" className="bg-[#1a1a2e]">Сменить статус...</option>
                  {STATUS_OPTIONS.filter(o => o.value).map(o => (
                    <option key={o.value} value={o.value} className="bg-[#1a1a2e]">{o.label}</option>
                  ))}
                </select>
                {bulkStatusValue && (
                  <button
                    onClick={() => { doBulk('change_status', { status: bulkStatusValue }); setBulkStatusValue(''); }}
                    disabled={bulkLoading}
                    className="px-2 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 rounded-lg text-xs text-blue-300 transition-all"
                  >
                    OK
                  </button>
                )}
              </div>

              {/* Add tag */}
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={bulkTagValue}
                  onChange={e => setBulkTagValue(e.target.value)}
                  placeholder="Добавить тег..."
                  className="bg-white/[0.06] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-white/30 w-[120px] focus:outline-none"
                />
                {bulkTagValue && (
                  <button
                    onClick={() => { doBulk('add_tag', { tag: bulkTagValue }); setBulkTagValue(''); }}
                    disabled={bulkLoading}
                    className="px-2 py-1.5 bg-green-500/20 hover:bg-green-500/30 rounded-lg text-xs text-green-300 transition-all"
                  >
                    <Tag className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Export CSV */}
              <button
                onClick={() => doBulk('export_csv')}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 rounded-lg text-xs text-white/60 transition-all"
              >
                <Download className="w-3 h-3" />
                CSV
              </button>

              {/* Attach to vacancy */}
              <button
                onClick={() => doBulk('add_to_vacancy')}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 rounded-lg text-xs text-white/60 transition-all"
              >
                <Briefcase className="w-3 h-3" />
                К вакансии
              </button>

              {/* Delete */}
              <button
                onClick={() => {
                  if (window.confirm(`Удалить ${selected.size} кандидат(ов)? Это действие необратимо.`)) {
                    doBulk('delete');
                    setSelected(new Set());
                  }
                }}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-xs text-red-400 transition-all"
              >
                <Trash2 className="w-3 h-3" />
                Удалить
              </button>

              {bulkLoading && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {/* Checkbox */}
                <th className="px-4 py-3 text-left w-10">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                    className="rounded border-white/20 bg-white/[0.06] text-blue-500 focus:ring-blue-500/30 cursor-pointer"
                  />
                </th>
                {/* Columns */}
                {SORTABLE_COLUMNS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="px-4 py-3 text-left text-[11px] text-white/40 font-semibold uppercase tracking-wider cursor-pointer hover:text-white/60 select-none"
                  >
                    <span className="flex items-center gap-1.5">
                      {col.label}
                      <SortIcon col={col.key} />
                    </span>
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-[11px] text-white/40 font-semibold uppercase tracking-wider">Рекрутер</th>
                <th className="px-4 py-3 text-left text-[11px] text-white/40 font-semibold uppercase tracking-wider">Теги</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex items-center justify-center gap-3">
                      <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
                      <span className="text-sm text-white/30">Загрузка...</span>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <Users className="w-8 h-8 text-white/10 mx-auto mb-2" />
                    <p className="text-sm text-white/30">Кандидаты не найдены</p>
                    {hasActiveFilters && (
                      <button onClick={resetFilters} className="mt-2 text-xs text-blue-400 hover:underline">
                        Сбросить фильтры
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                items.map((item, idx) => (
                  <motion.tr
                    key={item.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.02 }}
                    className={clsx(
                      'border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors',
                      selected.has(item.id) && 'bg-blue-500/[0.06]'
                    )}
                  >
                    {/* Checkbox */}
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleOne(item.id)}
                        className="rounded border-white/20 bg-white/[0.06] text-blue-500 focus:ring-blue-500/30 cursor-pointer"
                      />
                    </td>

                    {/* Name + position + contact + duplicate */}
                    <td className="px-4 py-3 min-w-[220px]">
                      <div className="flex items-center gap-2">
                        {item.is_duplicate && (
                          <span title="Возможный дубликат" className="flex-shrink-0">
                            <Copy className="w-3.5 h-3.5 text-orange-400" />
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate">{item.name}</p>
                          {item.position && (
                            <p className="text-xs text-white/40 truncate">{item.position}</p>
                          )}
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-white/25">
                            {item.email && <span className="truncate max-w-[140px]">{item.email}</span>}
                            {item.phone && <span>{item.phone}</span>}
                            {item.telegram_username && <span>@{item.telegram_username}</span>}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3">
                      <span className={clsx(
                        'inline-block px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap',
                        STATUS_COLORS[item.status as EntityStatus] || 'bg-gray-500/20 text-gray-300 border-gray-500/30'
                      )}>
                        {STATUS_LABELS[item.status as EntityStatus] || item.status}
                      </span>
                    </td>

                    {/* Source */}
                    <td className="px-4 py-3 text-white/50 whitespace-nowrap">
                      {item.source || '-'}
                    </td>

                    {/* Created */}
                    <td className="px-4 py-3 text-white/40 text-xs whitespace-nowrap">
                      {formatDate(item.created_at)}
                    </td>

                    {/* Vacancy count */}
                    <td className="px-4 py-3 text-center">
                      {item.vacancy_count > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 text-blue-300 text-xs rounded-full">
                          <Briefcase className="w-3 h-3" />
                          {item.vacancy_count}
                        </span>
                      ) : (
                        <span className="text-white/20 text-xs">0</span>
                      )}
                    </td>

                    {/* Recruiter */}
                    <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">
                      {item.recruiter_name || '-'}
                    </td>

                    {/* Tags */}
                    <td className="px-4 py-3">
                      {item.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {item.tags.slice(0, 3).map(tag => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 bg-white/5 text-white/40 text-[10px] rounded-full border border-white/[0.06] truncate max-w-[80px]"
                              title={tag}
                            >
                              {tag}
                            </span>
                          ))}
                          {item.tags.length > 3 && (
                            <span className="text-[10px] text-white/25">+{item.tags.length - 3}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-white/15 text-xs">-</span>
                      )}
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-t border-white/[0.06]">
            <div className="flex items-center gap-2 text-xs text-white/40">
              <span>Показано {((page - 1) * perPage) + 1}--{Math.min(page * perPage, total)} из {total}</span>
              <select
                value={perPage}
                onChange={e => setPerPage(Number(e.target.value))}
                className="bg-white/[0.06] border border-white/10 rounded-lg px-2 py-1 text-xs text-white appearance-none cursor-pointer"
              >
                {PER_PAGE_OPTIONS.map(n => (
                  <option key={n} value={n} className="bg-[#1a1a2e]">{n} / стр.</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page <= 1}
                className="p-1.5 rounded-lg hover:bg-white/[0.06] disabled:opacity-20 disabled:cursor-not-allowed text-white/50 transition-all"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-lg hover:bg-white/[0.06] disabled:opacity-20 disabled:cursor-not-allowed text-white/50 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Page numbers */}
              {(() => {
                const pages: number[] = [];
                const range = 2;
                for (let i = Math.max(1, page - range); i <= Math.min(totalPages, page + range); i++) {
                  pages.push(i);
                }
                return pages.map(p => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={clsx(
                      'min-w-[32px] h-8 rounded-lg text-xs font-medium transition-all',
                      p === page
                        ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                        : 'text-white/40 hover:bg-white/[0.06] hover:text-white/60'
                    )}
                  >
                    {p}
                  </button>
                ));
              })()}

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded-lg hover:bg-white/[0.06] disabled:opacity-20 disabled:cursor-not-allowed text-white/50 transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                className="p-1.5 rounded-lg hover:bg-white/[0.06] disabled:opacity-20 disabled:cursor-not-allowed text-white/50 transition-all"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
