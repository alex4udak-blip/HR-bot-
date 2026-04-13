import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Loader2,
  Clock,
  X,
  RefreshCw,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  Calendar,
  Tag,
  MessageCircle,
  ChevronRight,
  Settings2,
  Save,
  GripVertical,
  Send,
  User2,
  DollarSign,
  ExternalLink,
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

const AVATAR_COLORS: string[] = [
  'bg-blue-500', 'bg-cyan-500', 'bg-purple-500', 'bg-indigo-500',
  'bg-orange-500', 'bg-emerald-500', 'bg-pink-500', 'bg-teal-500',
  'bg-rose-500', 'bg-amber-500', 'bg-violet-500', 'bg-lime-500',
];

const STATUS_COLORS: Record<string, string> = {
  new: '#3b82f6',
  screening: '#06b6d4',
  practice: '#a855f7',
  tech_practice: '#6366f1',
  is_interview: '#f97316',
  offer: '#eab308',
  hired: '#22c55e',
  rejected: '#ef4444',
};

const STATUS_BG: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-400',
  screening: 'bg-cyan-500/10 text-cyan-400',
  practice: 'bg-purple-500/10 text-purple-400',
  tech_practice: 'bg-indigo-500/10 text-indigo-400',
  is_interview: 'bg-orange-500/10 text-orange-400',
  offer: 'bg-yellow-500/10 text-yellow-400',
  hired: 'bg-green-500/10 text-green-400',
  rejected: 'bg-red-500/10 text-red-400',
};

const SOURCE_LABELS: Record<string, string> = {
  hh: 'hh.ru',
  'hh.ru': 'hh.ru',
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

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
}

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ---------- main component ----------

export default function AllCandidatesPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [board, setBoard] = useState<KanbanBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [recruiters, setRecruiters] = useState<RecruiterOption[]>([]);

  // Filters
  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebounce(searchText, 400);
  const [activeTab, setActiveTab] = useState('all'); // 'all' or status name
  const [recruiterId, setRecruiterId] = useState<number | undefined>(undefined);

  // Selected candidate
  const [selectedCard, setSelectedCard] = useState<KanbanCard | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('');

  // Stage settings modal (admin only)
  const [showStageSettings, setShowStageSettings] = useState(false);

  // Comment
  const [comment, setComment] = useState('');

  const isAdmin = user?.role === 'superadmin' || user?.org_role === 'owner' || user?.org_role === 'admin';

  useEffect(() => {
    getCandidateRecruiters().then(setRecruiters).catch(() => {});
  }, []);

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCandidatesKanban({
        q: debouncedSearch || undefined,
        recruiter_id: recruiterId,
      });
      setBoard(data);
    } catch {
      console.error('Failed to load kanban');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, recruiterId]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  // Get filtered candidates for current tab
  const getFilteredCards = useCallback((): { card: KanbanCard; status: string }[] => {
    if (!board) return [];
    const items: { card: KanbanCard; status: string }[] = [];
    for (const col of board.columns) {
      if (activeTab === 'all' || col.status === activeTab) {
        for (const card of col.cards) {
          items.push({ card, status: col.status });
        }
      }
    }
    return items;
  }, [board, activeTab]);

  const filteredCards = getFilteredCards();

  // Auto-select first candidate when list changes
  useEffect(() => {
    if (filteredCards.length > 0 && !selectedCard) {
      setSelectedCard(filteredCards[0].card);
      setSelectedStatus(filteredCards[0].status);
    }
  }, [filteredCards.length]);

  // Handle status change
  const handleStatusChange = async (newStatus: string) => {
    if (!selectedCard || newStatus === selectedStatus) return;
    const oldStatus = selectedStatus;
    const cardName = selectedCard.name;

    // Optimistic update
    setBoard(prev => {
      if (!prev) return prev;
      const newColumns = prev.columns.map(col => {
        if (col.status === oldStatus) {
          return { ...col, cards: col.cards.filter(c => c.id !== selectedCard.id), count: col.count - 1 };
        }
        if (col.status === newStatus) {
          return { ...col, cards: [selectedCard, ...col.cards], count: col.count + 1 };
        }
        return col;
      });
      return { ...prev, columns: newColumns };
    });
    setSelectedStatus(newStatus);

    try {
      await changeCandidateStatus(selectedCard.id, newStatus);
      const label = board?.columns.find(c => c.status === newStatus)?.label || newStatus;
      toast.success(`${cardName} -> ${label}`);
    } catch {
      toast.error('Ошибка перемещения');
      fetchBoard();
    }
  };

  const totalCount = board?.total || 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ===== TOP TABS (like Huntflow) ===== */}
      <div className="flex-shrink-0 border-b border-white/5">
        {/* Search + filters row */}
        <div className="px-4 lg:px-6 py-3 flex items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Поиск по имени, email, телефону..."
              className="w-full pl-9 pr-8 py-2 glass-light rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            />
            {searchText && (
              <button onClick={() => setSearchText('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Recruiter filter */}
          <select
            value={recruiterId || ''}
            onChange={(e) => setRecruiterId(e.target.value ? Number(e.target.value) : undefined)}
            className="px-3 py-2 glass-light rounded-xl text-sm text-white/80 min-w-[150px]"
          >
            <option value="">Все рекрутеры</option>
            {recruiters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>

          {/* Refresh */}
          <button onClick={fetchBoard} disabled={loading} className="p-2 glass-light rounded-xl text-white/50 hover:text-white/80 transition-colors">
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          </button>

          {/* Admin: stage settings */}
          {isAdmin && (
            <button
              onClick={() => setShowStageSettings(true)}
              className="p-2 glass-light rounded-xl text-white/50 hover:text-amber-400 transition-colors"
              title="Настроить этапы"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tabs row */}
        <div className="px-4 lg:px-6 flex items-center gap-1 overflow-x-auto pb-0">
          {/* "Все" tab */}
          <button
            onClick={() => { setActiveTab('all'); setSelectedCard(null); }}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap',
              activeTab === 'all'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-white/40 hover:text-white/60'
            )}
          >
            Все
            <span className={clsx(
              'text-xs px-1.5 py-0.5 rounded-md font-semibold',
              activeTab === 'all' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/5 text-white/30'
            )}>
              {totalCount}
            </span>
          </button>

          {board?.columns.map(col => (
            <button
              key={col.status}
              onClick={() => { setActiveTab(col.status); setSelectedCard(null); }}
              className={clsx(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap',
                activeTab === col.status
                  ? 'text-white/90'
                  : 'border-transparent text-white/40 hover:text-white/60'
              )}
              style={activeTab === col.status ? { borderBottomColor: STATUS_COLORS[col.status] || '#06b6d4' } : {}}
            >
              {col.label}
              <span className={clsx(
                'text-xs px-1.5 py-0.5 rounded-md font-semibold',
                activeTab === col.status ? STATUS_BG[col.status] : 'bg-white/5 text-white/30'
              )}>
                {col.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ===== MAIN CONTENT: List + Detail ===== */}
      {loading && !board ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT: Candidate List */}
          <div className="w-[380px] lg:w-[420px] flex-shrink-0 border-r border-white/5 overflow-y-auto">
            {filteredCards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-white/20">
                <User2 className="w-10 h-10 mb-3" />
                <p className="text-sm">Кандидатов не найдено</p>
              </div>
            ) : (
              filteredCards.map(({ card, status }) => (
                <CandidateListItem
                  key={card.id}
                  card={card}
                  status={status}
                  isSelected={selectedCard?.id === card.id}
                  statusLabel={board?.columns.find(c => c.status === status)?.label || status}
                  onClick={() => {
                    setSelectedCard(card);
                    setSelectedStatus(status);
                  }}
                />
              ))
            )}
          </div>

          {/* RIGHT: Candidate Detail */}
          <div className="flex-1 overflow-y-auto">
            {selectedCard ? (
              <CandidateDetail
                card={selectedCard}
                status={selectedStatus}
                statusLabel={board?.columns.find(c => c.status === selectedStatus)?.label || selectedStatus}
                columns={board?.columns || []}
                comment={comment}
                setComment={setComment}
                onStatusChange={handleStatusChange}
                onOpenContact={() => navigate(`/contacts/${selectedCard.id}`)}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-white/20">
                <div className="text-center">
                  <User2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Выберите кандидата</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stage Settings Modal (admin only) */}
      <AnimatePresence>
        {showStageSettings && (
          <StageSettingsModal onClose={() => setShowStageSettings(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}


// ---------- Candidate List Item ----------

function CandidateListItem({
  card,
  status,
  isSelected,
  statusLabel,
  onClick,
}: {
  card: KanbanCard;
  status: string;
  isSelected: boolean;
  statusLabel: string;
  onClick: () => void;
}) {
  const initials = getInitials(card.name);
  const avatarColor = getAvatarColor(card.name);

  return (
    <div
      onClick={onClick}
      className={clsx(
        'flex items-start gap-3 px-4 py-3.5 cursor-pointer transition-all border-b border-white/[0.03]',
        isSelected
          ? 'bg-cyan-500/[0.08] border-l-2 border-l-cyan-400'
          : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
      )}
    >
      {/* Avatar */}
      <div className={clsx(
        'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white',
        avatarColor,
      )}>
        {initials}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-white/90 truncate">{card.name}</span>
        </div>
        {card.position && (
          <p className="text-xs text-white/40 truncate mt-0.5">{card.position}</p>
        )}
        {card.company && (
          <p className="text-xs text-white/30 truncate">{card.company}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          {/* Status badge */}
          <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium', STATUS_BG[status])}>
            {statusLabel}
          </span>
          {card.source && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">
              {SOURCE_LABELS[card.source] || card.source}
            </span>
          )}
          {card.vacancy_name && (
            <span className="text-[10px] text-white/25 truncate max-w-[120px]">
              {card.vacancy_name}
            </span>
          )}
        </div>
      </div>

      {/* Time */}
      <div className="flex-shrink-0 flex items-center gap-1 text-[10px] text-white/20 mt-1">
        <Clock className="w-3 h-3" />
        {timeAgo(card.created_at)}
      </div>
    </div>
  );
}


// ---------- Candidate Detail Panel ----------

function CandidateDetail({
  card,
  status,
  statusLabel,
  columns,
  comment,
  setComment,
  onStatusChange,
  onOpenContact,
}: {
  card: KanbanCard;
  status: string;
  statusLabel: string;
  columns: KanbanColumn[];
  comment: string;
  setComment: (v: string) => void;
  onStatusChange: (newStatus: string) => void;
  onOpenContact: () => void;
}) {
  const initials = getInitials(card.name);
  const avatarColor = getAvatarColor(card.name);

  return (
    <div className="p-6 max-w-3xl">
      {/* Action buttons */}
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={onOpenContact}
          className="flex items-center gap-2 px-4 py-2 glass-light rounded-xl text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          Открыть карточку
        </button>
        <button className="flex items-center gap-2 px-4 py-2 glass-light rounded-xl text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors">
          <Send className="w-4 h-4" />
          Отправить
        </button>
      </div>

      {/* Name + Avatar */}
      <div className="flex items-start gap-5 mb-6">
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-white/95">{card.name}</h2>
          {(card.position || card.company) && (
            <p className="text-sm text-white/50 mt-1">
              {card.position}
              {card.position && card.company && ' \u00b7 '}
              {card.company}
            </p>
          )}
        </div>
        <div className={clsx(
          'w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold text-white flex-shrink-0',
          avatarColor,
        )}>
          {initials}
        </div>
      </div>

      {/* Info table */}
      <div className="space-y-3 mb-6">
        {card.phone && (
          <InfoRow icon={Phone} label="Телефон">
            <a href={`tel:${card.phone}`} className="text-cyan-400 hover:underline">{card.phone}</a>
          </InfoRow>
        )}
        {card.email && (
          <InfoRow icon={Mail} label="Эл. почта">
            <a href={`mailto:${card.email}`} className="text-cyan-400 hover:underline">{card.email}</a>
          </InfoRow>
        )}
        {card.telegram_username && (
          <InfoRow icon={MessageCircle} label="Telegram">
            <a href={`https://t.me/${card.telegram_username}`} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
              @{card.telegram_username}
            </a>
          </InfoRow>
        )}
        {card.city && (
          <InfoRow icon={MapPin} label="Город">
            <span className="text-white/70">{card.city}</span>
          </InfoRow>
        )}
        {card.age && (
          <InfoRow icon={Calendar} label="Возраст">
            <span className="text-white/70">{card.age}</span>
          </InfoRow>
        )}
        {card.salary && (
          <InfoRow icon={DollarSign} label="Зарплата">
            <span className="text-white/70">{card.salary}</span>
          </InfoRow>
        )}
        {card.total_experience && (
          <InfoRow icon={Briefcase} label="Опыт">
            <span className="text-white/70">{card.total_experience}</span>
          </InfoRow>
        )}
        {card.recruiter_name && (
          <InfoRow icon={User2} label="Рекрутер">
            <span className="text-white/70">{card.recruiter_name}</span>
          </InfoRow>
        )}
        {card.tags.length > 0 && (
          <InfoRow icon={Tag} label="Метки">
            <div className="flex flex-wrap gap-1.5">
              {card.tags.map(tag => (
                <span key={tag} className="text-xs px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400/70">
                  {tag}
                </span>
              ))}
            </div>
          </InfoRow>
        )}
      </div>

      {/* Stage card (like Huntflow) */}
      <div className={clsx(
        'rounded-xl border p-5 mb-6',
        status === 'rejected' ? 'border-red-500/20 bg-red-500/5' : 'border-white/10 bg-white/[0.02]'
      )}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[status] || '#06b6d4' }}
              />
              <span className="font-semibold text-white/90">{statusLabel}</span>
            </div>
            {card.vacancy_name && (
              <p className="text-sm text-white/40 mt-1 ml-[18px]">{card.vacancy_name}</p>
            )}
            {card.rejection_reason && (
              <p className="text-sm text-red-400/70 mt-1 ml-[18px]">{card.rejection_reason}</p>
            )}
          </div>

          {/* Change stage dropdown */}
          <div className="relative">
            <select
              value={status}
              onChange={(e) => onStatusChange(e.target.value)}
              className="appearance-none px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-colors bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 pr-8"
              style={{ borderColor: STATUS_COLORS[status] || '#06b6d4' }}
            >
              {columns.map(col => (
                <option key={col.status} value={col.status}>{col.label}</option>
              ))}
            </select>
            <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 rotate-90 pointer-events-none" />
          </div>
        </div>

        {/* Date */}
        <p className="text-xs text-white/25 mt-3 ml-[18px]">
          Добавлен: {formatDateTime(card.created_at)}
        </p>
      </div>

      {/* Comment section */}
      <div className="mb-6">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Написать комментарий..."
          rows={3}
          className="w-full px-4 py-3 glass-light rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50 placeholder:text-white/20"
        />
      </div>

      {/* Source info */}
      {card.source && (
        <div className="text-xs text-white/20 flex items-center gap-2">
          <span>Источник:</span>
          <span className="text-white/40">{SOURCE_LABELS[card.source] || card.source}</span>
        </div>
      )}
    </div>
  );
}


// ---------- Info Row ----------

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-28 flex-shrink-0 flex items-center gap-2 text-white/30">
        <Icon className="w-4 h-4" />
        <span className="text-xs">{label}</span>
      </div>
      <div className="flex-1 text-sm">{children}</div>
    </div>
  );
}


// ---------- Stage Settings Modal (admin only) ----------

function StageSettingsModal({ onClose }: { onClose: () => void }) {
  // Default stages — admin can reorder / rename
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

  const handleLabelChange = (idx: number, value: string) => {
    setStages(prev => prev.map((s, i) => i === idx ? { ...s, label: value } : s));
  };

  const handleColorChange = (idx: number, value: string) => {
    setStages(prev => prev.map((s, i) => i === idx ? { ...s, color: value } : s));
  };

  const handleSave = () => {
    // TODO: Save to backend when API is ready
    toast.success('Настройки этапов сохранены');
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-dark-900 border border-white/10 rounded-2xl w-full max-w-lg p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-white/90">Настройка этапов</h3>
          <button onClick={onClose} className="text-white/30 hover:text-white/60">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-white/30 mb-4">
          Настройте названия и цвета этапов воронки. Изменения применятся для всей организации.
        </p>

        <div className="space-y-2 mb-6">
          {stages.map((stage, idx) => (
            <div key={stage.key} className="flex items-center gap-3 p-2.5 glass-light rounded-xl">
              <GripVertical className="w-4 h-4 text-white/15 flex-shrink-0 cursor-grab" />
              <input
                type="color"
                value={stage.color}
                onChange={(e) => handleColorChange(idx, e.target.value)}
                className="w-7 h-7 rounded-lg border-0 cursor-pointer bg-transparent flex-shrink-0"
              />
              <input
                type="text"
                value={stage.label}
                onChange={(e) => handleLabelChange(idx, e.target.value)}
                className="flex-1 bg-transparent text-sm text-white/80 focus:outline-none"
              />
              <span className="text-[10px] text-white/15 font-mono flex-shrink-0">{stage.key}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-white/50 hover:text-white/80 transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <Save className="w-4 h-4" />
            Сохранить
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
