import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Loader2,
  X,
  RefreshCw,
  Phone,
  Mail,
  ChevronDown,
  Settings2,
  Save,
  GripVertical,
  Send,
  User2,
  Pencil,
  Plus,
  CalendarDays,
  MessageSquare,
  ClipboardList,
  Paperclip,
  Gift,
  MoreHorizontal,
  PhoneCall,
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
  '#6366f1', '#8b5cf6', '#06b6d4', '#0ea5e9', '#f59e0b',
  '#10b981', '#ec4899', '#14b8a6', '#f43f5e', '#a855f7',
  '#3b82f6', '#84cc16',
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

// ---------- helpers ----------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDate();
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${mins}`;
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

  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebounce(searchText, 400);
  const [activeTab, setActiveTab] = useState('all');
  const [recruiterId, setRecruiterId] = useState<number | undefined>(undefined);

  const [selectedCard, setSelectedCard] = useState<KanbanCard | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [showStageSettings, setShowStageSettings] = useState(false);
  const [showStageDropdown, setShowStageDropdown] = useState(false);
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
      // ignore
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, recruiterId]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  // Filtered candidates for current tab
  const filteredCards = (() => {
    if (!board) return [];
    const items: { card: KanbanCard; status: string; label: string }[] = [];
    for (const col of board.columns) {
      if (activeTab === 'all' || col.status === activeTab) {
        for (const card of col.cards) {
          items.push({ card, status: col.status, label: col.label });
        }
      }
    }
    return items;
  })();

  // Auto-select first candidate
  useEffect(() => {
    if (filteredCards.length > 0 && !selectedCard) {
      setSelectedCard(filteredCards[0].card);
      setSelectedStatus(filteredCards[0].status);
    }
  }, [filteredCards.length]);

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedCard || newStatus === selectedStatus) return;
    const oldStatus = selectedStatus;
    const cardName = selectedCard.name;

    setBoard(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        columns: prev.columns.map(col => {
          if (col.status === oldStatus) return { ...col, cards: col.cards.filter(c => c.id !== selectedCard.id), count: col.count - 1 };
          if (col.status === newStatus) return { ...col, cards: [selectedCard, ...col.cards], count: col.count + 1 };
          return col;
        }),
      };
    });
    setSelectedStatus(newStatus);
    setShowStageDropdown(false);

    try {
      await changeCandidateStatus(selectedCard.id, newStatus);
      const label = board?.columns.find(c => c.status === newStatus)?.label || newStatus;
      toast.success(`${cardName} \u2192 ${label}`);
    } catch {
      toast.error('Ошибка перемещения');
      fetchBoard();
    }
  };

  const totalCount = board?.total || 0;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0d1117]">
      {/* ====== TOP TAB BAR (Huntflow style) ====== */}
      <div className="flex-shrink-0 bg-[#161b22] border-b border-[#21262d]">
        <div className="flex items-center h-12 px-2 overflow-x-auto scrollbar-none">
          {/* Search icon */}
          <button className="p-2 text-white/30 hover:text-white/60 flex-shrink-0">
            <Search className="w-4 h-4" />
          </button>

          {/* Tabs */}
          <div className="flex items-center gap-0 ml-2">
            {/* "Все" tab */}
            <button
              onClick={() => { setActiveTab('all'); setSelectedCard(null); }}
              className={clsx(
                'relative flex items-center gap-2 px-4 h-12 text-sm font-medium transition-colors whitespace-nowrap',
                activeTab === 'all' ? 'text-[#58a6ff]' : 'text-[#8b949e] hover:text-[#c9d1d9]',
              )}
            >
              Все
              <span className={clsx(
                'text-xs px-2 py-0.5 rounded-full font-semibold',
                activeTab === 'all' ? 'bg-[#1f6feb] text-white' : 'bg-[#21262d] text-[#8b949e]'
              )}>
                {totalCount}
              </span>
              {activeTab === 'all' && <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-[#58a6ff] rounded-full" />}
            </button>

            {board?.columns.map(col => (
              <button
                key={col.status}
                onClick={() => { setActiveTab(col.status); setSelectedCard(null); }}
                className={clsx(
                  'relative flex items-center gap-2 px-4 h-12 text-sm font-medium transition-colors whitespace-nowrap',
                  activeTab === col.status ? 'text-[#c9d1d9]' : 'text-[#8b949e] hover:text-[#c9d1d9]',
                )}
              >
                {col.label}
                {col.count > 0 && (
                  <span className={clsx(
                    'text-xs px-1.5 py-0.5 rounded-full font-medium',
                    activeTab === col.status ? 'bg-[#21262d] text-[#c9d1d9]' : 'text-[#8b949e]',
                  )}>
                    {col.count}
                  </span>
                )}
                {activeTab === col.status && (
                  <span
                    className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[col.status] }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Right side: settings */}
          <div className="ml-auto flex items-center gap-1 flex-shrink-0">
            {/* Recruiter filter */}
            <select
              value={recruiterId || ''}
              onChange={(e) => setRecruiterId(e.target.value ? Number(e.target.value) : undefined)}
              className="px-2 py-1 bg-[#21262d] border border-[#30363d] rounded-md text-xs text-[#c9d1d9] focus:outline-none"
            >
              <option value="">Все рекрутеры</option>
              {recruiters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>

            <button onClick={fetchBoard} disabled={loading} className="p-1.5 text-[#8b949e] hover:text-[#c9d1d9]">
              <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
            </button>

            {isAdmin && (
              <button onClick={() => setShowStageSettings(true)} className="p-1.5 text-[#8b949e] hover:text-[#f0883e]" title="Настроить этапы">
                <Settings2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ====== MAIN: List + Detail ====== */}
      {loading && !board ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#58a6ff]" />
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* ====== LEFT: Candidate List ====== */}
          <div className="w-[340px] lg:w-[380px] flex-shrink-0 border-r border-[#21262d] bg-[#0d1117] overflow-y-auto">
            {/* Search in list */}
            <div className="sticky top-0 z-10 bg-[#0d1117] p-3 border-b border-[#21262d]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#484f58]" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Поиск кандидатов..."
                  className="w-full pl-9 pr-8 py-2 bg-[#161b22] border border-[#30363d] rounded-lg text-sm text-[#c9d1d9] placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff]"
                />
                {searchText && (
                  <button onClick={() => setSearchText('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#484f58] hover:text-[#8b949e]">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {filteredCards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-[#484f58]">
                <User2 className="w-10 h-10 mb-3" />
                <p className="text-sm">Кандидатов не найдено</p>
              </div>
            ) : (
              filteredCards.map(({ card, status }) => {
                const isSelected = selectedCard?.id === card.id;
                const initials = getInitials(card.name);
                const color = getAvatarColor(card.name);

                return (
                  <div
                    key={card.id}
                    onClick={() => { setSelectedCard(card); setSelectedStatus(status); }}
                    className={clsx(
                      'flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-[#21262d]/50',
                      isSelected ? 'bg-[#161b22]' : 'hover:bg-[#161b22]/50',
                    )}
                  >
                    {/* Avatar circle */}
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {initials}
                    </div>

                    {/* Name + position + company */}
                    <div className="flex-1 min-w-0">
                      <p className={clsx(
                        'text-sm font-semibold truncate',
                        isSelected ? 'text-[#c9d1d9]' : 'text-[#c9d1d9]',
                      )}>
                        {card.name}
                      </p>
                      {card.position && (
                        <p className="text-xs text-[#8b949e] truncate">{card.position}</p>
                      )}
                      {card.company && (
                        <p className="text-xs text-[#484f58] truncate">{card.company}</p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ====== RIGHT: Candidate Detail (Huntflow style) ====== */}
          <div className="flex-1 overflow-y-auto bg-[#0d1117]">
            {selectedCard ? (
              <HuntflowDetail
                card={selectedCard}
                status={selectedStatus}
                statusLabel={board?.columns.find(c => c.status === selectedStatus)?.label || selectedStatus}
                columns={board?.columns || []}
                comment={comment}
                setComment={setComment}
                onStatusChange={handleStatusChange}
                showStageDropdown={showStageDropdown}
                setShowStageDropdown={setShowStageDropdown}
                onOpenContact={() => navigate(`/contacts/${selectedCard.id}`)}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-[#484f58]">
                <div className="text-center">
                  <User2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Выберите кандидата</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stage Settings Modal */}
      <AnimatePresence>
        {showStageSettings && <StageSettingsModal onClose={() => setShowStageSettings(false)} />}
      </AnimatePresence>
    </div>
  );
}


// ================================================================
// HUNTFLOW-STYLE DETAIL PANEL
// ================================================================

function HuntflowDetail({
  card,
  status,
  statusLabel,
  columns,
  comment,
  setComment,
  onStatusChange,
  showStageDropdown,
  setShowStageDropdown,
  onOpenContact,
}: {
  card: KanbanCard;
  status: string;
  statusLabel: string;
  columns: KanbanColumn[];
  comment: string;
  setComment: (v: string) => void;
  onStatusChange: (s: string) => void;
  showStageDropdown: boolean;
  setShowStageDropdown: (v: boolean) => void;
  onOpenContact: () => void;
}) {
  const initials = getInitials(card.name);
  const color = getAvatarColor(card.name);

  return (
    <div className="max-w-[780px] mx-auto">
      {/* ---- Top action buttons (like Huntflow) ---- */}
      <div className="flex items-center gap-2 px-6 py-4 border-b border-[#21262d]">
        <button className="flex items-center gap-1.5 px-3 py-1.5 border border-[#30363d] rounded-lg text-sm text-[#c9d1d9] hover:bg-[#21262d] transition-colors">
          <Plus className="w-4 h-4" />
          Взять на вакансию
        </button>
        <button className="flex items-center gap-1.5 px-3 py-1.5 border border-[#30363d] rounded-lg text-sm text-[#c9d1d9] hover:bg-[#21262d] transition-colors">
          <Send className="w-4 h-4" />
          Отправить
        </button>
        <button
          onClick={onOpenContact}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-[#30363d] rounded-lg text-sm text-[#c9d1d9] hover:bg-[#21262d] transition-colors"
        >
          <Pencil className="w-4 h-4" />
          Редактировать
        </button>
      </div>

      {/* ---- Candidate Header ---- */}
      <div className="px-6 pt-6 pb-4 flex items-start gap-5">
        <div className="flex-1 min-w-0">
          <h1 className="text-[22px] font-bold text-[#e6edf3] leading-tight">{card.name}</h1>
          {(card.position || card.company) && (
            <p className="text-sm text-[#8b949e] mt-1.5">
              {card.position}
              {card.position && card.company && (
                <span className="mx-2 text-[#30363d]">&middot;</span>
              )}
              {card.company && <span>{card.company}</span>}
            </p>
          )}
        </div>

        {/* Avatar (large, like Huntflow photo) */}
        <div
          className="w-[80px] h-[80px] rounded-xl flex items-center justify-center text-2xl font-bold text-white flex-shrink-0"
          style={{ backgroundColor: color }}
        >
          {initials}
        </div>
      </div>

      {/* ---- Info Table (dotted lines like Huntflow) ---- */}
      <div className="px-6 pb-6">
        <table className="w-full">
          <tbody>
            {card.phone && (
              <InfoTableRow label="Телефон">
                <div className="flex items-center gap-2">
                  <a href={`tel:${card.phone}`} className="text-[#c9d1d9] hover:text-[#58a6ff]">{card.phone}</a>
                  {/* Messenger icons like Huntflow */}
                  <div className="flex items-center gap-1">
                    <span className="w-5 h-5 rounded-full bg-[#25D366] flex items-center justify-center" title="WhatsApp">
                      <Phone className="w-3 h-3 text-white" />
                    </span>
                    <span className="w-5 h-5 rounded-full bg-[#0088cc] flex items-center justify-center" title="Telegram">
                      <Send className="w-3 h-3 text-white" />
                    </span>
                  </div>
                </div>
              </InfoTableRow>
            )}
            {card.email && (
              <InfoTableRow label="Эл. почта">
                <a href={`mailto:${card.email}`} className="text-[#c9d1d9] hover:text-[#58a6ff]">{card.email}</a>
              </InfoTableRow>
            )}
            {card.telegram_username && (
              <InfoTableRow label="Telegram">
                <a href={`https://t.me/${card.telegram_username}`} target="_blank" rel="noopener noreferrer" className="text-[#58a6ff] hover:underline">
                  {card.telegram_username}
                </a>
              </InfoTableRow>
            )}
            {card.age && (
              <InfoTableRow label="Возраст">
                <span className="text-[#c9d1d9]">{card.age}</span>
              </InfoTableRow>
            )}
            {card.city && (
              <InfoTableRow label="Город">
                <span className="text-[#c9d1d9]">{card.city}</span>
              </InfoTableRow>
            )}
            {card.salary && (
              <InfoTableRow label="Зарплата">
                <span className="text-[#c9d1d9]">{card.salary}</span>
              </InfoTableRow>
            )}
            {card.total_experience && (
              <InfoTableRow label="Опыт">
                <span className="text-[#c9d1d9]">{card.total_experience}</span>
              </InfoTableRow>
            )}
            {card.recruiter_name && (
              <InfoTableRow label="Рекрутер">
                <span className="text-[#c9d1d9]">{card.recruiter_name}</span>
              </InfoTableRow>
            )}
            <InfoTableRow label="Метки">
              {card.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {card.tags.map(tag => (
                    <span key={tag} className="text-xs px-2 py-0.5 rounded bg-[#1f6feb]/20 text-[#58a6ff]">{tag}</span>
                  ))}
                  <button className="text-xs text-[#58a6ff] hover:underline">Добавить</button>
                </div>
              ) : (
                <button className="text-sm text-[#58a6ff] hover:underline">Добавить</button>
              )}
            </InfoTableRow>
          </tbody>
        </table>
      </div>

      {/* ---- Stage Card (Huntflow exact style) ---- */}
      <div className="px-6 pb-4">
        <div
          className="rounded-xl p-5 relative"
          style={{
            backgroundColor: status === 'rejected'
              ? 'rgba(248,81,73,0.08)'
              : status === 'hired'
                ? 'rgba(63,185,80,0.08)'
                : 'rgba(56,139,253,0.06)',
            border: `1px solid ${status === 'rejected' ? 'rgba(248,81,73,0.2)' : status === 'hired' ? 'rgba(63,185,80,0.2)' : 'rgba(56,139,253,0.15)'}`,
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-base font-semibold" style={{ color: STATUS_COLORS[status] || '#58a6ff' }}>
                {statusLabel}
                {card.rejection_reason && (
                  <span className="font-normal text-[#f85149]">. {card.rejection_reason}</span>
                )}
              </p>
              {card.vacancy_name && (
                <p className="text-sm text-[#8b949e] mt-1">{card.vacancy_name}</p>
              )}
            </div>

            {/* Stage change button (like Huntflow "Сменить этап подбора") */}
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setShowStageDropdown(!showStageDropdown)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors"
                style={{ backgroundColor: STATUS_COLORS[status] || '#388bfd' }}
              >
                Сменить этап подбора
              </button>

              {/* Dropdown */}
              {showStageDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowStageDropdown(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[#161b22] border border-[#30363d] rounded-xl shadow-xl overflow-hidden">
                    {columns.map(col => (
                      <button
                        key={col.status}
                        onClick={() => onStatusChange(col.status)}
                        className={clsx(
                          'w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors',
                          col.status === status
                            ? 'bg-[#1f6feb]/10 text-[#58a6ff]'
                            : 'text-[#c9d1d9] hover:bg-[#21262d]'
                        )}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: STATUS_COLORS[col.status] }}
                        />
                        {col.label}
                        {col.status === status && <span className="ml-auto text-[#58a6ff]">✓</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Comment Input ---- */}
      <div className="px-6 pb-4">
        <div className="border border-[#30363d] rounded-xl overflow-hidden bg-[#0d1117]">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Написать комментарий..."
            rows={2}
            className="w-full px-4 py-3 bg-transparent text-sm text-[#c9d1d9] placeholder-[#484f58] resize-none focus:outline-none"
          />

          {/* Action chips (Huntflow style: Письмо, Интервью, СМС...) */}
          <div className="flex items-center gap-1.5 px-3 py-2.5 border-t border-[#21262d] flex-wrap">
            <ActionChip icon={Mail} label="Письмо" />
            <ActionChip icon={CalendarDays} label="Интервью" />
            <ActionChip icon={MessageSquare} label="СМС" />
            <ActionChip icon={PhoneCall} label="Обратная связь" />
            <ActionChip icon={ClipboardList} label="Анкета" />
            <ActionChip icon={Gift} label="Оффер" />
            <ActionChip icon={Paperclip} label="Файл" />
          </div>
        </div>
      </div>

      {/* ---- Actions History ---- */}
      <div className="px-6 pb-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-[#c9d1d9] font-medium">Действия:</span>
          <button className="flex items-center gap-1 text-sm text-[#8b949e] hover:text-[#c9d1d9]">
            Все <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Timeline entry */}
        <div className="space-y-4">
          <TimelineEntry
            date={formatDateTime(card.created_at)}
            text={`Кандидат добавлен (${statusLabel})`}
            status={status}
          />
          {card.source && (
            <TimelineEntry
              date={formatDateTime(card.created_at)}
              text={`Источник: ${card.source}`}
              status="info"
            />
          )}
        </div>
      </div>
    </div>
  );
}


// ---- Info Table Row (with dotted separator like Huntflow) ----

function InfoTableRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-dotted border-[#21262d]">
      <td className="py-2.5 pr-4 text-sm text-[#8b949e] whitespace-nowrap align-top w-[120px]">{label}</td>
      <td className="py-2.5 text-sm align-top">{children}</td>
    </tr>
  );
}


// ---- Action Chip (Письмо, Интервью...) ----

function ActionChip({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <button className="flex items-center gap-1.5 px-3 py-1.5 border border-[#30363d] rounded-lg text-xs text-[#8b949e] hover:text-[#c9d1d9] hover:border-[#484f58] transition-colors">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}


// ---- Timeline Entry ----

function TimelineEntry({ date, text, status }: { date: string; text: string; status: string }) {
  return (
    <div className="flex items-start gap-3 relative">
      <div className="flex flex-col items-center">
        <div
          className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
          style={{ backgroundColor: STATUS_COLORS[status] || '#484f58' }}
        />
        <div className="w-px flex-1 bg-[#21262d] mt-1" />
      </div>
      <div className="flex-1 pb-2">
        <div className="flex items-center gap-2 text-xs text-[#484f58]">
          <span>Я</span>
          <span>{date}</span>
          <button className="ml-auto text-[#484f58] hover:text-[#8b949e]">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-[#c9d1d9] mt-1">{text}</p>
      </div>
    </div>
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

  const handleLabelChange = (idx: number, value: string) => {
    setStages(prev => prev.map((s, i) => i === idx ? { ...s, label: value } : s));
  };

  const handleColorChange = (idx: number, value: string) => {
    setStages(prev => prev.map((s, i) => i === idx ? { ...s, color: value } : s));
  };

  const handleSave = () => {
    toast.success('Настройки этапов сохранены');
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[#161b22] border border-[#30363d] rounded-2xl w-full max-w-lg p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-[#e6edf3]">Настройка этапов</h3>
          <button onClick={onClose} className="text-[#484f58] hover:text-[#8b949e]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-[#484f58] mb-4">
          Настройте названия и цвета этапов воронки. Изменения применятся для всей организации.
        </p>

        <div className="space-y-1.5 mb-6">
          {stages.map((stage, idx) => (
            <div key={stage.key} className="flex items-center gap-3 p-2.5 bg-[#0d1117] rounded-lg border border-[#21262d]">
              <GripVertical className="w-4 h-4 text-[#30363d] flex-shrink-0 cursor-grab" />
              <input
                type="color"
                value={stage.color}
                onChange={(e) => handleColorChange(idx, e.target.value)}
                className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent flex-shrink-0"
              />
              <input
                type="text"
                value={stage.label}
                onChange={(e) => handleLabelChange(idx, e.target.value)}
                className="flex-1 bg-transparent text-sm text-[#c9d1d9] focus:outline-none"
              />
              <span className="text-[10px] text-[#30363d] font-mono flex-shrink-0">{stage.key}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#8b949e] hover:text-[#c9d1d9] transition-colors">
            Отмена
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 bg-[#238636] hover:bg-[#2ea043] text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Save className="w-4 h-4" />
            Сохранить
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
