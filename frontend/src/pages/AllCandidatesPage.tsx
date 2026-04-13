import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Loader2,
  X,
  RefreshCw,
  Settings2,
  Save,
  GripVertical,
  Users,
  Plus,
  MessageSquare,
  Paperclip,
  Mail,
  Calendar,
  ThumbsUp,
  XCircle,
  FileText,
  Eye,
  Printer,
  Download,
  Tag,
  Copy,
  Check,
  CheckSquare,
  Square,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import {
  getCandidatesKanban,
  changeCandidateStatus,
  getCandidateRecruiters,
} from '@/services/api/candidates';
import type {
  KanbanBoardResponse,
  KanbanCard,
  KanbanColumn,
  RecruiterOption,
} from '@/services/api/candidates';
import { useAuthStore } from '@/stores/authStore';

// ---------- constants ----------

const STATUS_COLORS: Record<string, { dot: string; text: string; bg: string; badge: string }> = {
  new:            { dot: 'bg-blue-400',    text: 'text-blue-400',    bg: 'bg-blue-500/10',    badge: 'bg-blue-500/15 text-blue-400' },
  screening:      { dot: 'bg-cyan-400',    text: 'text-cyan-400',    bg: 'bg-cyan-500/10',    badge: 'bg-cyan-500/15 text-cyan-400' },
  practice:       { dot: 'bg-purple-400',  text: 'text-purple-400',  bg: 'bg-purple-500/10',  badge: 'bg-purple-500/15 text-purple-400' },
  tech_practice:  { dot: 'bg-indigo-400',  text: 'text-indigo-400',  bg: 'bg-indigo-500/10',  badge: 'bg-indigo-500/15 text-indigo-400' },
  is_interview:   { dot: 'bg-orange-400',  text: 'text-orange-400',  bg: 'bg-orange-500/10',  badge: 'bg-orange-500/15 text-orange-400' },
  offer:          { dot: 'bg-yellow-400',  text: 'text-yellow-400',  bg: 'bg-yellow-500/10',  badge: 'bg-yellow-500/15 text-yellow-400' },
  hired:          { dot: 'bg-green-400',   text: 'text-green-400',   bg: 'bg-green-500/10',   badge: 'bg-green-500/15 text-green-400' },
  rejected:       { dot: 'bg-red-400',     text: 'text-red-400',     bg: 'bg-red-500/10',     badge: 'bg-red-500/15 text-red-400' },
};

const FALLBACK_COLOR = { dot: 'bg-gray-400', text: 'text-gray-400', bg: 'bg-gray-500/10', badge: 'bg-gray-500/15 text-gray-400' };

// ---------- helpers ----------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function getInitials(name: string): string {
  const p = name.trim().split(/\s+/);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  return (p[0]?.[0] || '?').toUpperCase();
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru');
}

function formatDateFull(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ru', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ================================================================
// MAIN PAGE
// ================================================================

export default function AllCandidatesPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [board, setBoard] = useState<KanbanBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [recruiters, setRecruiters] = useState<RecruiterOption[]>([]);

  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebounce(searchText, 400);
  const [activeTab, setActiveTab] = useState('all');
  const [recruiterId, setRecruiterId] = useState<number | undefined>();

  const [selectedCard, setSelectedCard] = useState<KanbanCard | null>(null);
  const [selectedStatus, setSelectedStatus] = useState('');
  const [detailTab, setDetailTab] = useState<'info' | 'resume'>('info');
  const [showStageSettings, setShowStageSettings] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const isAdmin = user?.role === 'superadmin' || user?.org_role === 'owner' || user?.org_role === 'admin';
  const anySelected = selectedIds.size > 0;

  useEffect(() => { getCandidateRecruiters().then(setRecruiters).catch(() => {}); }, []);

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCandidatesKanban({ q: debouncedSearch || undefined, recruiter_id: recruiterId });
      setBoard(data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [debouncedSearch, recruiterId]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  const filteredCards = (() => {
    if (!board) return [];
    const items: { card: KanbanCard; status: string; label: string }[] = [];
    for (const col of board.columns) {
      if (activeTab === 'all' || col.status === activeTab) {
        for (const c of col.cards) items.push({ card: c, status: col.status, label: col.label });
      }
    }
    return items;
  })();

  // Auto-select first
  useEffect(() => {
    if (filteredCards.length > 0 && !selectedCard) {
      setSelectedCard(filteredCards[0].card);
      setSelectedStatus(filteredCards[0].status);
    }
  }, [filteredCards.length]);

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedCard || newStatus === selectedStatus) return;
    const old = selectedStatus;
    const name = selectedCard.name;
    setBoard(prev => {
      if (!prev) return prev;
      return { ...prev, columns: prev.columns.map(col => {
        if (col.status === old) return { ...col, cards: col.cards.filter(c => c.id !== selectedCard.id), count: col.count - 1 };
        if (col.status === newStatus) return { ...col, cards: [selectedCard, ...col.cards], count: col.count + 1 };
        return col;
      })};
    });
    setSelectedStatus(newStatus);
    try {
      await changeCandidateStatus(selectedCard.id, newStatus);
      toast.success(`${name} → ${board?.columns.find(c => c.status === newStatus)?.label}`);
    } catch { toast.error('Ошибка'); fetchBoard(); }
  };

  const toggleSelection = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalCount = board?.total || 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ===== TOP: Stage tabs (like Huntflow / RecruiterFunnelsPage) ===== */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-white/[0.06] overflow-x-auto no-scrollbar flex-shrink-0">
        {/* "Все" tab */}
        <button
          onClick={() => { setActiveTab('all'); setSelectedCard(null); }}
          className={clsx(
            'px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
            activeTab === 'all'
              ? 'bg-accent-500 text-white'
              : 'text-dark-400 hover:bg-white/[0.06]',
          )}
        >
          Все <span className="ml-1 text-xs opacity-70">{totalCount}</span>
        </button>

        {board?.columns.map(col => {
          return (
            <button
              key={col.status}
              onClick={() => { setActiveTab(col.status); setSelectedCard(null); }}
              className={clsx(
                'px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
                activeTab === col.status
                  ? 'bg-accent-500 text-white'
                  : 'text-dark-400 hover:bg-white/[0.06]',
              )}
            >
              {col.label} <span className="ml-1 text-xs opacity-70">{col.count}</span>
            </button>
          );
        })}

        {/* Right-side controls */}
        <div className="ml-auto flex items-center gap-2 flex-shrink-0 pl-4">
          <select
            value={recruiterId || ''}
            onChange={(e) => setRecruiterId(e.target.value ? Number(e.target.value) : undefined)}
            className="px-2 py-1 bg-white/[0.04] border border-white/[0.08] rounded-md text-xs text-white/60"
          >
            <option value="">Все рекрутеры</option>
            {recruiters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button onClick={fetchBoard} disabled={loading} className="p-1.5 text-white/30 hover:text-white/60">
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          </button>
          {isAdmin && (
            <button onClick={() => setShowStageSettings(true)} className="p-1.5 text-white/30 hover:text-amber-400" title="Настроить этапы">
              <Settings2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ===== MASTER-DETAIL SPLIT ===== */}
      {loading && !board ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT: Candidate list */}
          <div className="w-[350px] flex-shrink-0 border-r border-white/[0.06] overflow-hidden flex flex-col relative">
            {/* Search */}
            <div className="p-3 border-b border-white/[0.04]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Поиск кандидатов..."
                  className="w-full pl-9 pr-8 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-accent-500/40"
                />
                {searchText && (
                  <button onClick={() => setSearchText('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className={clsx('flex-1 overflow-y-auto', anySelected && 'pb-14')}>
              {filteredCards.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-dark-500 text-sm">
                  Нет кандидатов
                </div>
              ) : (
                filteredCards.map(({ card, status }) => {
                  const isSelected = selectedCard?.id === card.id;
                  const isChecked = selectedIds.has(card.id);
                  const initials = getInitials(card.name);
                  return (
                    <div
                      key={card.id}
                      onClick={() => { setSelectedCard(card); setSelectedStatus(status); setDetailTab('info'); }}
                      className={clsx(
                        'flex items-start gap-2 px-3 py-3 cursor-pointer border-b border-white/[0.04] transition-colors group/card',
                        isChecked
                          ? 'bg-accent-500/10 border-l-2 border-l-accent-500'
                          : isSelected
                            ? 'bg-accent-500/10 border-l-2 border-l-accent-500'
                            : 'hover:bg-white/[0.03] border-l-2 border-l-transparent',
                      )}
                    >
                      {/* Checkbox */}
                      <div
                        onClick={(e) => { e.stopPropagation(); toggleSelection(card.id); }}
                        className={clsx(
                          'flex items-center justify-center w-4 h-4 mt-2.5 flex-shrink-0 cursor-pointer transition-opacity',
                          anySelected ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100',
                        )}
                      >
                        {isChecked ? (
                          <CheckSquare className="w-4 h-4 text-accent-400" />
                        ) : (
                          <Square className="w-4 h-4 text-dark-500 hover:text-dark-300" />
                        )}
                      </div>

                      {/* Small avatar */}
                      <div className="w-9 h-9 rounded-full bg-accent-500/20 flex items-center justify-center text-accent-400 text-sm font-medium flex-shrink-0">
                        {initials}
                      </div>

                      {/* Name + position + source/date */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-dark-100 truncate">
                          {card.name}
                        </div>
                        {card.position && (
                          <div className="text-xs text-dark-500 truncate mt-0.5">
                            {card.position}
                          </div>
                        )}
                        <div className="text-xs text-dark-600 mt-0.5">
                          {card.source || ''}
                          {card.created_at && (
                            <span className="ml-1">{formatDateShort(card.created_at)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bulk actions bar */}
            {anySelected && (
              <div className="absolute bottom-0 left-0 right-0 p-3 bg-dark-800 border-t border-white/[0.08] flex items-center justify-between">
                <span className="text-xs text-dark-300 font-medium">
                  Выбрано: {selectedIds.size}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="px-2.5 py-1 text-xs font-medium rounded-lg text-dark-400 hover:bg-white/[0.06] transition-colors"
                  >
                    Снять
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Detail panel */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedCard ? (
              <>
                {/* Detail tabs: Личные заметки / Резюме */}
                <div className="flex items-center border-b border-white/[0.06] px-5 flex-shrink-0">
                  <button
                    onClick={() => setDetailTab('info')}
                    className={clsx(
                      'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                      detailTab === 'info'
                        ? 'border-accent-500 text-dark-100'
                        : 'border-transparent text-dark-400 hover:text-dark-200',
                    )}
                  >
                    Личные заметки
                  </button>
                  <button
                    onClick={() => setDetailTab('resume')}
                    className={clsx(
                      'px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5',
                      detailTab === 'resume'
                        ? 'border-accent-500 text-dark-100'
                        : 'border-transparent text-dark-400 hover:text-dark-200',
                    )}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Резюме
                  </button>
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto">
                  {detailTab === 'info' ? (
                    <InfoTab
                      card={selectedCard}
                      status={selectedStatus}
                      statusLabel={board?.columns.find(c => c.status === selectedStatus)?.label || selectedStatus}
                      columns={board?.columns || []}
                      onStatusChange={handleStatusChange}
                      onOpenContact={() => navigate(`/contacts/${selectedCard.id}`)}
                    />
                  ) : (
                    <ResumeTab card={selectedCard} />
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-dark-500">
                <div className="text-center">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Выберите кандидата из списка</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {showStageSettings && <StageSettingsModal onClose={() => setShowStageSettings(false)} />}
      </AnimatePresence>
    </div>
  );
}


// ================================================================
// INFO TAB (matches RecruiterFunnelsPage detail panel exactly)
// ================================================================

function InfoTab({ card, status, statusLabel, columns, onStatusChange, onOpenContact }: {
  card: KanbanCard;
  status: string;
  statusLabel: string;
  columns: KanbanColumn[];
  onStatusChange: (s: string) => void;
  onOpenContact: () => void;
}) {
  const [showStageDD, setShowStageDD] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const sc = STATUS_COLORS[status] || FALLBACK_COLOR;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (stageRef.current && !stageRef.current.contains(e.target as Node)) setShowStageDD(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="p-5 max-w-3xl">
      {/* Action buttons */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onOpenContact}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.1] rounded-lg text-sm text-dark-300 hover:bg-white/[0.04] transition-colors"
        >
          <Users className="w-4 h-4" /> Открыть профиль
        </button>
        <button className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.1] rounded-lg text-sm text-dark-300 hover:bg-white/[0.04] transition-colors">
          <Plus className="w-4 h-4" /> На вакансию
        </button>
      </div>

      {/* Name */}
      <h2 className="text-2xl font-semibold text-dark-100 mb-1">{card.name}</h2>
      {card.position && <p className="text-dark-400 mb-4">{card.position}</p>}

      {/* Contact info */}
      <div className="space-y-2 mb-6 text-sm">
        {card.phone && (
          <div className="flex items-center gap-3">
            <span className="text-dark-500 w-24">Телефон</span>
            <a href={`tel:${card.phone}`} className="text-dark-200 hover:text-white transition-colors">{card.phone}</a>
            <CopyBtn value={card.phone} />
          </div>
        )}
        {card.email && (
          <div className="flex items-center gap-3">
            <span className="text-dark-500 w-24">Email</span>
            <a href={`mailto:${card.email}`} className="text-dark-200 hover:text-white transition-colors">{card.email}</a>
            <CopyBtn value={card.email} />
          </div>
        )}
        {card.telegram_username && (
          <div className="flex items-center gap-3">
            <span className="text-dark-500 w-24">Telegram</span>
            <a href={`https://t.me/${card.telegram_username}`} target="_blank" rel="noopener noreferrer" className="text-dark-200 hover:text-white transition-colors">
              @{card.telegram_username}
            </a>
            <CopyBtn value={`@${card.telegram_username}`} />
          </div>
        )}
        {card.city && (
          <div className="flex items-center gap-3">
            <span className="text-dark-500 w-24">Город</span>
            <span className="text-dark-200">{card.city}</span>
          </div>
        )}
        {card.age && (
          <div className="flex items-center gap-3">
            <span className="text-dark-500 w-24">Возраст</span>
            <span className="text-dark-200">{card.age}</span>
          </div>
        )}
        {card.salary && (
          <div className="flex items-center gap-3">
            <span className="text-dark-500 w-24">Зарплата</span>
            <span className="text-dark-200">{card.salary}</span>
          </div>
        )}
        {card.total_experience && (
          <div className="flex items-center gap-3">
            <span className="text-dark-500 w-24">Опыт</span>
            <span className="text-dark-200">{card.total_experience}</span>
          </div>
        )}
        {card.source && (
          <div className="flex items-center gap-3">
            <span className="text-dark-500 w-24">Источник</span>
            <span className="text-dark-200">{card.source}</span>
          </div>
        )}
      </div>

      {/* Tags */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Tag className="w-3.5 h-3.5 text-dark-500" />
          <span className="text-xs font-medium text-dark-500 uppercase tracking-wider">Метки</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {card.tags.length > 0 ? (
            card.tags.map(t => (
              <span key={t} className="px-2 py-0.5 rounded-full text-xs font-medium bg-accent-500/15 text-accent-400 border border-accent-500/20">
                {t}
              </span>
            ))
          ) : null}
          <button className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-dark-400 border border-dashed border-white/[0.1] hover:border-white/[0.2] hover:text-dark-300 transition-colors">
            <Plus className="w-3 h-3" /> Добавить
          </button>
        </div>
      </div>

      {/* Quick action icons row */}
      <div className="flex items-center gap-1 mb-6 pb-5 border-b border-white/[0.06]">
        <ActionIcon icon={Mail} label="Письмо" onClick={() => card.email ? window.open(`mailto:${card.email}`) : toast.error('Email не указан')} />
        <ActionIcon icon={Calendar} label="Интервью" onClick={() => toast('Скоро', { icon: '📅' })} />
        <ActionIcon icon={MessageSquare} label="Комментарий" onClick={() => toast('Скоро', { icon: '💬' })} />
        <ActionIcon icon={ThumbsUp} label="Оффер" onClick={() => toast('Скоро', { icon: '👍' })} />
        <ActionIcon icon={Paperclip} label="Файл" onClick={() => toast('Скоро', { icon: '📎' })} />
        <ActionIcon icon={XCircle} label="Отказ" onClick={() => onStatusChange('rejected')} danger />
      </div>

      {/* Current stage block */}
      <div className="mb-6 p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-dark-500 mb-1">Текущий этап</div>
            <div className={clsx('text-sm font-medium', sc.text)}>{statusLabel}</div>
            {card.vacancy_name && (
              <div className="text-xs text-dark-600 mt-1">{card.vacancy_name}</div>
            )}
            {card.rejection_reason && (
              <div className="text-xs text-red-400/80 mt-1">{card.rejection_reason}</div>
            )}
          </div>

          {/* Stage change dropdown */}
          <div className="relative" ref={stageRef}>
            <button
              onClick={() => setShowStageDD(!showStageDD)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent-500/15 text-accent-400 hover:bg-accent-500/25 transition-colors"
            >
              Сменить этап подбора
            </button>
            {showStageDD && (
              <div className="absolute right-0 top-full mt-1 z-50 w-56 py-1 bg-dark-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] text-dark-500 uppercase tracking-wider font-semibold">
                  Перенести в
                </div>
                {columns.map(col => {
                  const colSc = STATUS_COLORS[col.status] || FALLBACK_COLOR;
                  return (
                    <button
                      key={col.status}
                      onClick={() => { onStatusChange(col.status); setShowStageDD(false); }}
                      className={clsx(
                        'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors text-sm',
                        col.status === status
                          ? 'bg-white/[0.06] text-dark-100'
                          : 'text-dark-300 hover:bg-white/[0.04] hover:text-dark-100',
                      )}
                    >
                      <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', colSc.dot)} />
                      <span className="flex-1">{col.label}</span>
                      {col.status === status && <Check className="w-3.5 h-3.5 text-accent-400" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* History timeline */}
      <div className="mt-6">
        <div className="text-xs text-dark-500 mb-3 uppercase tracking-wider">История</div>
        <div className="relative pl-6 border-l border-white/[0.08]">
          {/* At minimum: created event */}
          <div className="relative pb-5">
            <div className={clsx('absolute -left-[25px] w-3 h-3 rounded-full border-2 border-dark-800', sc.dot)} />
            <div className="text-xs text-dark-600 mb-1">{formatDateFull(card.created_at)}</div>
            <div className="text-sm text-dark-300">Кандидат добавлен</div>
          </div>
          {card.recruiter_name && (
            <div className="relative pb-5">
              <div className="absolute -left-[25px] w-3 h-3 rounded-full border-2 border-dark-800 bg-gray-500" />
              <div className="text-xs text-dark-600 mb-1">{formatDateFull(card.created_at)}</div>
              <div className="text-sm text-dark-300">Рекрутер: {card.recruiter_name}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ================================================================
// RESUME TAB
// ================================================================

function ResumeTab({ card }: { card: KanbanCard }) {
  return (
    <div className="p-5 max-w-3xl">
      <p className="text-xs text-dark-600 text-center mb-3">
        Сохранено {formatDateFull(card.created_at)}
      </p>
      <div className="flex items-center justify-center gap-3 mb-4">
        <button className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] rounded-lg text-xs text-dark-400 hover:text-dark-200 transition-colors">
          <Eye className="w-3.5 h-3.5" /> Показать текст
        </button>
        <button className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] rounded-lg text-xs text-dark-400 hover:text-dark-200 transition-colors">
          <Printer className="w-3.5 h-3.5" /> Распечатать
        </button>
        <button className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] rounded-lg text-xs text-dark-400 hover:text-dark-200 transition-colors">
          <Download className="w-3.5 h-3.5" /> Скачать
        </button>
      </div>
      <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-8 text-center text-dark-600 text-sm min-h-[200px] flex items-center justify-center">
        Резюме кандидата
      </div>
    </div>
  );
}


// ================================================================
// SUB-COMPONENTS
// ================================================================

function ActionIcon({ icon: Icon, label, onClick, danger }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors',
        danger
          ? 'text-dark-400 hover:text-red-400 hover:bg-white/[0.04]'
          : 'text-dark-400 hover:text-dark-200 hover:bg-white/[0.04]',
      )}
    >
      <Icon className="w-4 h-4" />
      <span className="text-[10px]">{label}</span>
    </button>
  );
}

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 p-1 text-dark-500 hover:text-dark-300 transition-all"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}


// ================================================================
// STAGE SETTINGS MODAL (admin only)
// ================================================================

function StageSettingsModal({ onClose }: { onClose: () => void }) {
  const [stages, setStages] = useState([
    { key: 'new', label: 'Новый', color: '#3b82f6' },
    { key: 'screening', label: 'Скрининг', color: '#06b6d4' },
    { key: 'practice', label: 'Практика', color: '#a855f7' },
    { key: 'tech_practice', label: 'Тех-практика', color: '#6366f1' },
    { key: 'is_interview', label: 'ИС', color: '#f97316' },
    { key: 'offer', label: 'Оффер', color: '#eab308' },
    { key: 'hired', label: 'Принят', color: '#22c55e' },
    { key: 'rejected', label: 'Отклонён', color: '#ef4444' },
  ]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-dark-800 border border-white/10 rounded-xl w-full max-w-lg p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-dark-100">Настройка этапов</h3>
          <button onClick={onClose} className="text-dark-400 hover:text-dark-200"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-dark-500 mb-4">Настройте названия и цвета этапов воронки.</p>
        <div className="space-y-1.5 mb-6">
          {stages.map((s, i) => (
            <div key={s.key} className="flex items-center gap-3 p-2.5 bg-white/[0.02] rounded-lg border border-white/[0.05]">
              <GripVertical className="w-4 h-4 text-dark-600 cursor-grab" />
              <input type="color" value={s.color} onChange={(e) => setStages(p => p.map((x,j) => j===i ? {...x,color:e.target.value} : x))} className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent" />
              <input type="text" value={s.label} onChange={(e) => setStages(p => p.map((x,j) => j===i ? {...x,label:e.target.value} : x))} className="flex-1 bg-transparent text-sm text-dark-200 focus:outline-none" />
              <span className="text-[10px] text-dark-600 font-mono">{s.key}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-dark-400 hover:text-dark-200">Отмена</button>
          <button onClick={() => { toast.success('Сохранено'); onClose(); }} className="flex items-center gap-2 px-5 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium rounded-lg transition-colors">
            <Save className="w-4 h-4" /> Сохранить
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
