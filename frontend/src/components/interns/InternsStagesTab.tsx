import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch,
  ChevronDown,
  Users,
  BookOpen,
  CheckCircle2,
  Filter,
  X,
  AtSign,
  Calendar,
} from 'lucide-react';
import clsx from 'clsx';
import {
  MOCK_INTERNS,
  MOCK_TRAIL_DETAILS,
  MOCK_INFO,
  STATUS_LABELS,
  STATUS_COLORS,
} from '@/data/mockInterns';
import type { InternStatus, TrailDetail, TrailModule } from '@/data/mockInterns';
import { formatDate } from '@/utils';

type SortField = 'name' | 'startDate' | 'endDate' | 'students' | 'completion';
type SortDir = 'asc' | 'desc';

function getAvatarInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase();
}

function getSubmittedWorksCount(internId: number): number {
  const info = MOCK_INFO[internId];
  if (!info) return 0;
  return info.works.filter(w => w.status === 'submitted' || w.status === 'reviewed' || w.status === 'returned').length;
}

function getTrailStudentIds(trail: TrailDetail): number[] {
  const ids = new Set<number>();
  trail.modules.forEach(m => m.students.forEach(s => ids.add(s.internId)));
  return Array.from(ids);
}

function getTrailCompletion(trail: TrailDetail): number {
  let totalProgress = 0;
  let totalEntries = 0;
  trail.modules.forEach(m => {
    m.students.forEach(s => {
      totalProgress += s.progress;
      totalEntries++;
    });
  });
  return totalEntries > 0 ? Math.round(totalProgress / totalEntries) : 0;
}

function getModuleCompletion(mod: TrailModule): number {
  if (mod.students.length === 0) return 0;
  const total = mod.students.reduce((sum, s) => sum + s.progress, 0);
  return Math.round(total / mod.students.length);
}

export default function InternsStagesTab() {
  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [telegramSearch, setTelegramSearch] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<InternStatus[]>([]);
  const [minWorks, setMinWorks] = useState('');
  const [maxWorks, setMaxWorks] = useState('');
  const [trailStartFrom, setTrailStartFrom] = useState('');
  const [trailStartTo, setTrailStartTo] = useState('');
  const [trailEndFrom, setTrailEndFrom] = useState('');
  const [trailEndTo, setTrailEndTo] = useState('');
  const [regFrom, setRegFrom] = useState('');
  const [regTo, setRegTo] = useState('');

  // Sort state
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Expanded trails
  const [expandedTrails, setExpandedTrails] = useState<Set<number>>(new Set());
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (telegramSearch) count++;
    if (selectedStatuses.length > 0) count++;
    if (minWorks || maxWorks) count++;
    if (trailStartFrom || trailStartTo) count++;
    if (trailEndFrom || trailEndTo) count++;
    if (regFrom || regTo) count++;
    return count;
  }, [telegramSearch, selectedStatuses, minWorks, maxWorks, trailStartFrom, trailStartTo, trailEndFrom, trailEndTo, regFrom, regTo]);

  // Filter intern IDs
  const filteredInternIds = useMemo(() => {
    let interns = MOCK_INTERNS;

    if (telegramSearch) {
      const q = telegramSearch.toLowerCase();
      interns = interns.filter(i => i.telegramUsername?.toLowerCase().includes(q));
    }

    if (selectedStatuses.length > 0) {
      interns = interns.filter(i => selectedStatuses.includes(i.status));
    }

    if (minWorks) {
      const min = parseInt(minWorks, 10);
      if (!isNaN(min)) {
        interns = interns.filter(i => getSubmittedWorksCount(i.id) >= min);
      }
    }

    if (maxWorks) {
      const max = parseInt(maxWorks, 10);
      if (!isNaN(max)) {
        interns = interns.filter(i => getSubmittedWorksCount(i.id) <= max);
      }
    }

    if (regFrom) {
      interns = interns.filter(i => i.registrationDate >= regFrom);
    }
    if (regTo) {
      interns = interns.filter(i => i.registrationDate <= regTo);
    }

    return new Set(interns.map(i => i.id));
  }, [telegramSearch, selectedStatuses, minWorks, maxWorks, regFrom, regTo]);

  // Filter and sort trails
  const filteredTrails = useMemo(() => {
    let trails = MOCK_TRAIL_DETAILS;

    // Filter by trail dates
    if (trailStartFrom) {
      trails = trails.filter(t => t.startDate >= trailStartFrom);
    }
    if (trailStartTo) {
      trails = trails.filter(t => t.startDate <= trailStartTo);
    }
    if (trailEndFrom) {
      trails = trails.filter(t => t.endDate >= trailEndFrom);
    }
    if (trailEndTo) {
      trails = trails.filter(t => t.endDate <= trailEndTo);
    }

    // Filter trails that have at least one matching student
    trails = trails.filter(trail => {
      const studentIds = getTrailStudentIds(trail);
      return studentIds.some(id => filteredInternIds.has(id));
    });

    // Sort
    trails = [...trails].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'startDate':
          cmp = a.startDate.localeCompare(b.startDate);
          break;
        case 'endDate':
          cmp = a.endDate.localeCompare(b.endDate);
          break;
        case 'students': {
          const aStudents = getTrailStudentIds(a).filter(id => filteredInternIds.has(id)).length;
          const bStudents = getTrailStudentIds(b).filter(id => filteredInternIds.has(id)).length;
          cmp = aStudents - bStudents;
          break;
        }
        case 'completion':
          cmp = getTrailCompletion(a) - getTrailCompletion(b);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return trails;
  }, [filteredInternIds, trailStartFrom, trailStartTo, trailEndFrom, trailEndTo, sortField, sortDir]);

  const toggleTrail = (trailId: number) => {
    setExpandedTrails(prev => {
      const next = new Set(prev);
      if (next.has(trailId)) next.delete(trailId);
      else next.add(trailId);
      return next;
    });
  };

  const toggleModule = (key: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const clearFilters = () => {
    setTelegramSearch('');
    setSelectedStatuses([]);
    setMinWorks('');
    setMaxWorks('');
    setTrailStartFrom('');
    setTrailStartTo('');
    setTrailEndFrom('');
    setTrailEndTo('');
    setRegFrom('');
    setRegTo('');
  };

  const toggleStatus = (status: InternStatus) => {
    setSelectedStatuses(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    );
  };

  // Aggregate stats
  const totalStudents = useMemo(() => {
    const ids = new Set<number>();
    filteredTrails.forEach(t => getTrailStudentIds(t).forEach(id => {
      if (filteredInternIds.has(id)) ids.add(id);
    }));
    return ids.size;
  }, [filteredTrails, filteredInternIds]);

  const totalModules = useMemo(() => {
    return filteredTrails.reduce((sum, t) => sum + t.modules.length, 0);
  }, [filteredTrails]);

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-all active:scale-95',
              activeFiltersCount > 0
                ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                : 'bg-white/5 border-white/10 hover:bg-white/10'
            )}
          >
            <Filter className="w-4 h-4" />
            <span>Фильтры</span>
            {activeFiltersCount > 0 && (
              <span className="px-1.5 py-0.5 bg-emerald-600 text-white text-[10px] rounded-full">
                {activeFiltersCount}
              </span>
            )}
          </button>
          {activeFiltersCount > 0 && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-white/50 hover:text-white/80 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Сбросить
            </button>
          )}

          {/* Sort buttons */}
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-white/40 mr-1">Сортировка:</span>
            {([
              { field: 'name' as SortField, label: 'Название' },
              { field: 'startDate' as SortField, label: 'Начало' },
              { field: 'students' as SortField, label: 'Студенты' },
              { field: 'completion' as SortField, label: 'Прогресс' },
            ]).map(item => (
              <button
                key={item.field}
                onClick={() => handleSort(item.field)}
                className={clsx(
                  'px-2 py-1 text-xs rounded-lg border transition-colors flex items-center gap-1',
                  sortField === item.field
                    ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                    : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
                )}
              >
                {item.label}
                {sortField === item.field && (
                  <ChevronDown className={clsx('w-3 h-3 transition-transform', sortDir === 'asc' ? 'rotate-180' : '')} />
                )}
              </button>
            ))}
          </div>
        </div>

        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-4 overflow-hidden"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Telegram search */}
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">Telegram-никнейм</label>
                <div className="relative">
                  <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input
                    type="text"
                    placeholder="@username"
                    value={telegramSearch}
                    onChange={e => setTelegramSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                </div>
              </div>

              {/* Status filter */}
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">Статус кандидата</label>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(STATUS_LABELS) as InternStatus[]).map(status => (
                    <button
                      key={status}
                      onClick={() => toggleStatus(status)}
                      className={clsx(
                        'px-2.5 py-1.5 text-xs rounded-lg border transition-colors',
                        selectedStatuses.includes(status)
                          ? STATUS_COLORS[status] + ' border-current'
                          : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                      )}
                    >
                      {STATUS_LABELS[status]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Submitted works range */}
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">Сданные работы (кол-во)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="от"
                    min="0"
                    value={minWorks}
                    onChange={e => setMinWorks(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                  <span className="text-white/30 text-xs">—</span>
                  <input
                    type="number"
                    placeholder="до"
                    min="0"
                    value={maxWorks}
                    onChange={e => setMaxWorks(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                </div>
              </div>

              {/* Trail start date range */}
              <div>
                <label className="text-xs text-white/50 mb-1.5 block flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Дата начала трейла
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={trailStartFrom}
                    onChange={e => setTrailStartFrom(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                  <span className="text-white/30 text-xs">—</span>
                  <input
                    type="date"
                    value={trailStartTo}
                    onChange={e => setTrailStartTo(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                </div>
              </div>

              {/* Trail end date range */}
              <div>
                <label className="text-xs text-white/50 mb-1.5 block flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Дата окончания трейла
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={trailEndFrom}
                    onChange={e => setTrailEndFrom(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                  <span className="text-white/30 text-xs">—</span>
                  <input
                    type="date"
                    value={trailEndTo}
                    onChange={e => setTrailEndTo(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                </div>
              </div>

              {/* Registration date range */}
              <div>
                <label className="text-xs text-white/50 mb-1.5 block flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Дата регистрации
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={regFrom}
                    onChange={e => setRegFrom(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                  <span className="text-white/30 text-xs">—</span>
                  <input
                    type="date"
                    value={regTo}
                    onChange={e => setRegTo(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-emerald-500/50 text-sm"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-white/5 border border-white/10 rounded-xl p-3">
          <div className="flex items-center gap-2 text-white/50 mb-1">
            <GitBranch className="w-4 h-4 text-emerald-400" />
            <span className="text-xs">Трейлов</span>
          </div>
          <p className="text-xl font-bold">{filteredTrails.length}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white/5 border border-white/10 rounded-xl p-3">
          <div className="flex items-center gap-2 text-white/50 mb-1">
            <Users className="w-4 h-4 text-blue-400" />
            <span className="text-xs">Студентов</span>
          </div>
          <p className="text-xl font-bold">{totalStudents}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white/5 border border-white/10 rounded-xl p-3">
          <div className="flex items-center gap-2 text-white/50 mb-1">
            <BookOpen className="w-4 h-4 text-amber-400" />
            <span className="text-xs">Модулей</span>
          </div>
          <p className="text-xl font-bold">{totalModules}</p>
        </motion.div>
      </div>

      {/* Trail Cards */}
      {filteredTrails.length === 0 ? (
        <div className="py-16 text-center text-white/40">
          <GitBranch className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium mb-2">Нет трейлов</h3>
          <p className="text-sm">Попробуйте изменить параметры фильтров</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTrails.map((trail, trailIndex) => {
            const isExpanded = expandedTrails.has(trail.id);
            const studentIds = getTrailStudentIds(trail).filter(id => filteredInternIds.has(id));
            const completion = getTrailCompletion(trail);
            const completedModules = trail.modules.filter(m =>
              m.students.every(s => s.progress === 100) && m.students.length > 0
            ).length;

            return (
              <motion.div
                key={trail.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: trailIndex * 0.05 }}
                className="bg-white/5 border border-white/10 rounded-xl overflow-hidden"
              >
                {/* Trail Header */}
                <button
                  onClick={() => toggleTrail(trail.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <GitBranch className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <h4 className="font-medium text-sm truncate">{trail.name}</h4>
                      <div className="flex items-center gap-3 mt-1 text-xs text-white/40">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(trail.startDate, 'short')} — {formatDate(trail.endDate, 'short')}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {studentIds.length} студ.
                        </span>
                        <span className="flex items-center gap-1">
                          <BookOpen className="w-3 h-3" />
                          {trail.modules.length} мод.
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0">
                    {/* Completion */}
                    <div className="hidden sm:flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={clsx('h-full rounded-full', {
                            'bg-emerald-400': completion >= 80,
                            'bg-amber-400': completion >= 50 && completion < 80,
                            'bg-blue-400': completion < 50,
                          })}
                          style={{ width: `${completion}%` }}
                        />
                      </div>
                      <span className="text-xs text-white/50 w-8 text-right">{completion}%</span>
                    </div>
                    <div className="hidden sm:block">
                      <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-500/20 text-emerald-400">
                        {completedModules}/{trail.modules.length}
                      </span>
                    </div>
                    <ChevronDown className={clsx('w-4 h-4 text-white/40 transition-transform', isExpanded ? 'rotate-180' : '')} />
                  </div>
                </button>

                {/* Trail Content */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 border-t border-white/5 space-y-2 pt-3">
                        {trail.modules.map(mod => {
                          const moduleKey = `${trail.id}-${mod.id}`;
                          const isModExpanded = expandedModules.has(moduleKey);
                          const modCompletion = getModuleCompletion(mod);
                          const modStudents = mod.students.filter(s => filteredInternIds.has(s.internId));
                          const allCompleted = modStudents.length > 0 && modStudents.every(s => s.progress === 100);

                          if (modStudents.length === 0) return null;

                          return (
                            <div key={mod.id} className="bg-white/5 rounded-lg overflow-hidden">
                              <button
                                onClick={() => toggleModule(moduleKey)}
                                className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors text-left"
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  {allCompleted ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                  ) : (
                                    <BookOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
                                  )}
                                  <span className="text-sm truncate">{mod.name}</span>
                                  <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-white/10 text-white/50 flex-shrink-0">
                                    {modStudents.length} студ.
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 flex-shrink-0">
                                  <div className="flex items-center gap-2">
                                    <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                      <div
                                        className={clsx('h-full rounded-full', {
                                          'bg-emerald-400': modCompletion === 100,
                                          'bg-amber-400': modCompletion >= 50 && modCompletion < 100,
                                          'bg-blue-400': modCompletion < 50,
                                        })}
                                        style={{ width: `${modCompletion}%` }}
                                      />
                                    </div>
                                    <span className="text-xs text-white/40 w-8 text-right">{modCompletion}%</span>
                                  </div>
                                  <ChevronDown className={clsx('w-3.5 h-3.5 text-white/30 transition-transform', isModExpanded ? 'rotate-180' : '')} />
                                </div>
                              </button>

                              <AnimatePresence>
                                {isModExpanded && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="px-3 pb-3 space-y-1.5">
                                      {modStudents.map(student => {
                                        const intern = MOCK_INTERNS.find(i => i.id === student.internId);
                                        if (!intern) return null;

                                        return (
                                          <div
                                            key={student.internId}
                                            className="flex items-center gap-3 p-2 bg-white/5 rounded-lg"
                                          >
                                            <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-xs font-medium flex-shrink-0">
                                              {getAvatarInitials(intern.name)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-2">
                                                <span className="text-xs font-medium truncate">{intern.name}</span>
                                                <span className={clsx('px-1.5 py-0.5 text-[10px] rounded-full flex-shrink-0', STATUS_COLORS[intern.status])}>
                                                  {STATUS_LABELS[intern.status]}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-2 mt-1">
                                                <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                                                  <div
                                                    className={clsx('h-full rounded-full', {
                                                      'bg-emerald-400': student.progress === 100,
                                                      'bg-amber-400': student.progress >= 50 && student.progress < 100,
                                                      'bg-blue-400': student.progress < 50,
                                                    })}
                                                    style={{ width: `${student.progress}%` }}
                                                  />
                                                </div>
                                                <span className="text-[10px] text-white/40 w-8 text-right flex-shrink-0">{student.progress}%</span>
                                              </div>
                                            </div>
                                            {student.score !== undefined && (
                                              <span className={clsx('text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0', {
                                                'bg-emerald-500/20 text-emerald-400': student.score >= 90,
                                                'bg-blue-500/20 text-blue-400': student.score >= 75 && student.score < 90,
                                                'bg-amber-500/20 text-amber-400': student.score >= 60 && student.score < 75,
                                                'bg-red-500/20 text-red-400': student.score < 60,
                                              })}>
                                                {student.score}
                                              </span>
                                            )}
                                            {student.completedDate && (
                                              <span className="text-[10px] text-white/30 flex-shrink-0">
                                                {formatDate(student.completedDate, 'short')}
                                              </span>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
