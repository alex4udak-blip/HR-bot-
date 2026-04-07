import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Loader2,
  Users,
  Clock,
  Filter,
  X,
  RefreshCw,
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
  RecruiterOption,
} from '@/services/api/candidates';

// ---------- constants ----------

const STATUS_BORDER_LEFT: Record<string, string> = {
  new: 'border-l-blue-500/60',
  screening: 'border-l-cyan-500/60',
  practice: 'border-l-purple-500/60',
  tech_practice: 'border-l-indigo-500/60',
  is_interview: 'border-l-orange-500/60',
  offer: 'border-l-yellow-500/60',
  hired: 'border-l-green-500/60',
  rejected: 'border-l-red-500/60',
};

const STATUS_HEADER_COLORS: Record<string, string> = {
  new: 'bg-blue-500',
  screening: 'bg-cyan-500',
  practice: 'bg-purple-500',
  tech_practice: 'bg-indigo-500',
  is_interview: 'bg-orange-500',
  offer: 'bg-yellow-500',
  hired: 'bg-green-500',
  rejected: 'bg-red-500',
};

const STATUS_DOT_COLORS: Record<string, string> = {
  new: 'bg-blue-400',
  screening: 'bg-cyan-400',
  practice: 'bg-purple-400',
  tech_practice: 'bg-indigo-400',
  is_interview: 'bg-orange-400',
  offer: 'bg-yellow-400',
  hired: 'bg-green-400',
  rejected: 'bg-red-400',
};

const AVATAR_COLORS: string[] = [
  'bg-blue-600',
  'bg-cyan-600',
  'bg-purple-600',
  'bg-indigo-600',
  'bg-orange-600',
  'bg-emerald-600',
  'bg-pink-600',
  'bg-teal-600',
];

const SOURCE_LABELS: Record<string, string> = {
  hh: 'hh.ru',
  linkedin: 'LinkedIn',
  telegram: 'Telegram',
  web: 'Web',
  referral: 'Реферал',
};

// ---------- helpers ----------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}м`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}ч`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}д`;
  const months = Math.floor(days / 30);
  return `${months}мес`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (parts[0]?.[0] || '?').toUpperCase();
}

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ---------- component ----------

export default function AllCandidatesPage() {
  const navigate = useNavigate();
  const [board, setBoard] = useState<KanbanBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [recruiters, setRecruiters] = useState<RecruiterOption[]>([]);

  // Filters
  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebounce(searchText, 400);
  const [recruiterId, setRecruiterId] = useState<number | undefined>(undefined);
  const [showFilters, setShowFilters] = useState(false);

  // Drag state
  const [draggedCard, setDraggedCard] = useState<KanbanCard | null>(null);
  const [dragSourceStatus, setDragSourceStatus] = useState<string>('');
  const [dropTarget, setDropTarget] = useState<string>('');

  // Load recruiters once
  useEffect(() => {
    getCandidateRecruiters().then(setRecruiters).catch(() => {});
  }, []);

  // Fetch kanban
  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCandidatesKanban({
        q: debouncedSearch || undefined,
        recruiter_id: recruiterId,
      });
      setBoard(data);
    } catch (err) {
      console.error('Failed to load kanban:', err);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, recruiterId]);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  // Drag handlers
  const handleDragStart = (card: KanbanCard, sourceStatus: string) => {
    setDraggedCard(card);
    setDragSourceStatus(sourceStatus);
  };

  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    if (status !== dragSourceStatus) {
      setDropTarget(status);
    }
  };

  const handleDragLeave = () => {
    setDropTarget('');
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    setDropTarget('');

    if (!draggedCard || targetStatus === dragSourceStatus) {
      setDraggedCard(null);
      return;
    }

    // Optimistic update
    setBoard(prev => {
      if (!prev) return prev;
      const newColumns = prev.columns.map(col => {
        if (col.status === dragSourceStatus) {
          return { ...col, cards: col.cards.filter(c => c.id !== draggedCard.id), count: col.count - 1 };
        }
        if (col.status === targetStatus) {
          return { ...col, cards: [draggedCard, ...col.cards], count: col.count + 1 };
        }
        return col;
      });
      return { ...prev, columns: newColumns };
    });

    try {
      await changeCandidateStatus(draggedCard.id, targetStatus);
      toast.success(`${draggedCard.name} → ${board?.columns.find(c => c.status === targetStatus)?.label}`);
    } catch (err) {
      toast.error('Ошибка перемещения');
      fetchBoard(); // Rollback
    }

    setDraggedCard(null);
    setDragSourceStatus('');
  };

  const handleDragEnd = () => {
    setDraggedCard(null);
    setDragSourceStatus('');
    setDropTarget('');
  };

  // Total count
  const totalCount = board?.total || 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 lg:px-6 py-3 border-b border-white/5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-cyan-400" />
            <div>
              <h1 className="text-lg font-bold">База кандидатов</h1>
              <p className="text-xs text-white/40">{totalCount} кандидатов</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Поиск..."
                className="w-48 lg:w-64 pl-9 pr-3 py-1.5 glass-light rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
              {searchText && (
                <button
                  onClick={() => setSearchText('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filters toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={clsx(
                'p-2 rounded-xl transition-colors',
                showFilters ? 'bg-cyan-500/20 text-cyan-400' : 'glass-light text-white/50 hover:text-white/80'
              )}
            >
              <Filter className="w-4 h-4" />
            </button>

            {/* Refresh */}
            <button
              onClick={fetchBoard}
              disabled={loading}
              className="p-2 glass-light rounded-xl text-white/50 hover:text-white/80"
            >
              <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Filters row */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/5">
                <select
                  value={recruiterId || ''}
                  onChange={(e) => setRecruiterId(e.target.value ? Number(e.target.value) : undefined)}
                  className="px-3 py-1.5 glass-light rounded-lg text-sm text-white"
                >
                  <option value="">Все рекрутеры</option>
                  {recruiters.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats pills */}
        {board && (
          <div className="flex gap-1.5 mt-2.5 overflow-x-auto pb-1">
            {board.columns.map(col => (
              <div
                key={col.status}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.03] text-[11px] whitespace-nowrap"
              >
                <span className={clsx('w-1.5 h-1.5 rounded-full', STATUS_DOT_COLORS[col.status])} />
                <span className="text-white/40">{col.label}</span>
                <span className="font-medium text-white/70">{col.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Kanban Board */}
      {loading && !board ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-2.5 p-3 lg:p-4 h-full min-w-max">
            {board?.columns.map(column => (
              <div
                key={column.status}
                className={clsx(
                  'flex flex-col w-[272px] lg:w-[296px] rounded-lg border transition-colors',
                  dropTarget === column.status
                    ? 'border-cyan-400/50 bg-cyan-500/5 ring-1 ring-cyan-500/20'
                    : 'border-white/[0.04] bg-white/[0.015]'
                )}
                onDragOver={(e) => handleDragOver(e, column.status)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, column.status)}
              >
                {/* Column header */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04] sticky top-0 z-10 bg-inherit rounded-t-lg">
                  <span className={clsx('w-2 h-2 rounded-full', STATUS_HEADER_COLORS[column.status])} />
                  <span className="text-[13px] font-semibold text-white/80 tracking-tight">{column.label}</span>
                  <span className="ml-auto text-[11px] text-white/30 bg-white/[0.05] px-1.5 py-0.5 rounded font-medium min-w-[20px] text-center">
                    {column.count}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-1.5 space-y-1 min-h-0">
                  {column.cards.map(card => (
                    <CandidateCard
                      key={card.id}
                      card={card}
                      status={column.status}
                      isDragging={draggedCard?.id === card.id}
                      onDragStart={() => handleDragStart(card, column.status)}
                      onDragEnd={handleDragEnd}
                      onClick={() => navigate(`/contacts/${card.id}`)}
                    />
                  ))}
                  {column.cards.length === 0 && (
                    <div className="text-center py-8 text-white/15 text-xs">
                      Пусто
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ---------- Card component ----------

function CandidateCard({
  card,
  status,
  isDragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  card: KanbanCard;
  status: string;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const initials = getInitials(card.name);
  const avatarColor = getAvatarColor(card.name);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={clsx(
        'group rounded-md border-l-2 border border-r-white/[0.04] border-t-white/[0.04] border-b-white/[0.04]',
        'px-2.5 py-2 cursor-pointer transition-all duration-150',
        'hover:bg-white/[0.04] hover:shadow-lg hover:shadow-black/20 hover:-translate-y-[1px]',
        'bg-white/[0.02]',
        STATUS_BORDER_LEFT[status],
        isDragging && 'opacity-40 scale-95',
      )}
    >
      {/* Avatar + Name + Position */}
      <div className="flex items-center gap-2">
        <div className={clsx(
          'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-semibold text-white/90',
          avatarColor,
        )}>
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[13px] text-white/80 truncate leading-tight">{card.name}</div>
          {card.position && (
            <div className="text-[11px] text-white/40 truncate leading-tight mt-0.5">{card.position}</div>
          )}
        </div>
      </div>

      {/* Footer: source + tags + time */}
      <div className="flex items-center justify-between mt-1.5 gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {card.source && (
            <span className="text-[10px] px-1.5 py-[1px] rounded bg-white/[0.05] text-white/35 flex-shrink-0">
              {SOURCE_LABELS[card.source] || card.source}
            </span>
          )}
          {card.tags.length > 0 && (
            <>
              {card.tags.slice(0, 2).map(tag => (
                <span key={tag} className="text-[10px] px-1.5 py-[1px] rounded bg-cyan-500/8 text-cyan-400/50 truncate max-w-[60px] flex-shrink-0">
                  {tag}
                </span>
              ))}
              {card.tags.length > 2 && (
                <span className="text-[10px] text-white/20 flex-shrink-0">+{card.tags.length - 2}</span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-0.5 text-[10px] text-white/20 flex-shrink-0">
          <Clock className="w-2.5 h-2.5" />
          {timeAgo(card.created_at)}
        </div>
      </div>
    </div>
  );
}
