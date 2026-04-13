import { useState, useEffect, useCallback, useRef } from 'react';
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
  Eye,
  Printer,
  Download,
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

const AVATAR_COLORS = [
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
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDate();
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const year = d.getFullYear();
  const h = String(d.getHours()).padStart(2,'0');
  const m = String(d.getMinutes()).padStart(2,'0');
  return `${day} ${months[d.getMonth()]} ${year}, ${h}:${m}`;
}

function getInitials(name: string): string {
  const p = name.trim().split(/\s+/);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  return (p[0]?.[0] || '?').toUpperCase();
}

function getAvatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
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
  const [showStageSettings, setShowStageSettings] = useState(false);

  const isAdmin = user?.role === 'superadmin' || user?.org_role === 'owner' || user?.org_role === 'admin';

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

  const totalCount = board?.total || 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ===== TOP TABS BAR (exact Huntflow) ===== */}
      <div className="flex-shrink-0 border-b border-white/[0.06] bg-[#0d1117]">
        <div className="flex items-center h-[52px] px-3 overflow-x-auto scrollbar-none gap-0">
          {/* Rocket / filter icon placeholder */}
          <button className="p-2 mr-2 text-white/20 hover:text-white/50 flex-shrink-0">
            <Search className="w-[18px] h-[18px]" />
          </button>

          {/* Все tab */}
          <TabBtn
            active={activeTab === 'all'}
            count={totalCount}
            countHighlight
            onClick={() => { setActiveTab('all'); setSelectedCard(null); }}
          >
            Все
          </TabBtn>

          {board?.columns.map(col => (
            <TabBtn
              key={col.status}
              active={activeTab === col.status}
              count={col.count > 0 ? col.count : undefined}
              color={STATUS_COLORS[col.status]}
              onClick={() => { setActiveTab(col.status); setSelectedCard(null); }}
            >
              {col.label}
            </TabBtn>
          ))}

          {/* Right: recruiter filter + settings */}
          <div className="ml-auto flex items-center gap-1 flex-shrink-0 pl-4">
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
      </div>

      {/* ===== LIST + DETAIL ===== */}
      {loading && !board ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-cyan-400" /></div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT: Candidate list (Huntflow style) */}
          <div className="w-[340px] lg:w-[380px] flex-shrink-0 border-r border-white/[0.06] flex flex-col">
            {/* Search */}
            <div className="p-3 border-b border-white/[0.04]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Поиск кандидатов..."
                  className="w-full pl-9 pr-8 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-white/80 placeholder-white/20 focus:outline-none focus:border-cyan-500/40"
                />
                {searchText && (
                  <button onClick={() => setSearchText('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/50">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {filteredCards.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-white/15">
                  <User2 className="w-10 h-10 mb-3" />
                  <p className="text-sm">Нет кандидатов</p>
                </div>
              ) : (
                filteredCards.map(({ card, status }) => (
                  <ListItem
                    key={card.id}
                    card={card}
                    selected={selectedCard?.id === card.id}
                    onClick={() => { setSelectedCard(card); setSelectedStatus(status); }}
                  />
                ))
              )}
            </div>
          </div>

          {/* RIGHT: Detail panel */}
          <div className="flex-1 overflow-y-auto">
            {selectedCard ? (
              <DetailPanel
                card={selectedCard}
                status={selectedStatus}
                statusLabel={board?.columns.find(c => c.status === selectedStatus)?.label || selectedStatus}
                columns={board?.columns || []}
                onStatusChange={handleStatusChange}
                onOpenContact={() => navigate(`/contacts/${selectedCard.id}`)}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-white/15">
                <div className="text-center">
                  <User2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
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
// TAB BUTTON (exact Huntflow style)
// ================================================================

function TabBtn({ children, active, count, countHighlight, color, onClick }: {
  children: React.ReactNode;
  active: boolean;
  count?: number;
  countHighlight?: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'relative flex items-center gap-1.5 px-3.5 h-[52px] text-[13px] font-medium whitespace-nowrap transition-colors',
        active ? 'text-white/90' : 'text-white/35 hover:text-white/55',
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span className={clsx(
          'text-[11px] font-semibold rounded-full px-1.5 py-[1px] min-w-[20px] text-center',
          active && countHighlight
            ? 'bg-[#1f6feb] text-white'
            : active
              ? 'bg-white/[0.08] text-white/60'
              : 'text-white/25',
        )}>
          {count}
        </span>
      )}
      {/* Active underline */}
      {active && (
        <span
          className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full"
          style={{ backgroundColor: color || '#1f6feb' }}
        />
      )}
    </button>
  );
}


// ================================================================
// LIST ITEM (exact Huntflow: avatar circle, name bold, position, company)
// ================================================================

function ListItem({ card, selected, onClick }: {
  card: KanbanCard;
  selected: boolean;
  onClick: () => void;
}) {
  const initials = getInitials(card.name);
  const color = getAvatarColor(card.name);

  return (
    <div
      onClick={onClick}
      className={clsx(
        'flex items-center gap-3 px-4 py-3 cursor-pointer transition-all border-l-[3px]',
        selected
          ? 'bg-white/[0.04] border-l-cyan-400'
          : 'border-l-transparent hover:bg-white/[0.02]',
      )}
    >
      {/* Avatar */}
      <div
        className="w-[42px] h-[42px] rounded-full flex items-center justify-center flex-shrink-0 text-[13px] font-bold text-white"
        style={{ backgroundColor: color }}
      >
        {initials}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-white/85 truncate leading-tight">{card.name}</p>
        {card.position && (
          <p className="text-[12px] text-white/40 truncate leading-tight mt-[2px]">{card.position}</p>
        )}
        {card.company && (
          <p className="text-[11px] text-white/25 truncate leading-tight mt-[1px]">{card.company}</p>
        )}
      </div>

      {/* Checkbox placeholder (like Huntflow) */}
      <div className="w-4 h-4 rounded border border-white/10 flex-shrink-0 opacity-0 group-hover:opacity-100" />
    </div>
  );
}


// ================================================================
// DETAIL PANEL (pixel-perfect Huntflow copy)
// ================================================================

function DetailPanel({ card, status, statusLabel, columns, onStatusChange, onOpenContact }: {
  card: KanbanCard;
  status: string;
  statusLabel: string;
  columns: KanbanColumn[];
  onStatusChange: (s: string) => void;
  onOpenContact: () => void;
}) {
  const initials = getInitials(card.name);
  const color = getAvatarColor(card.name);
  const [showDropdown, setShowDropdown] = useState(false);
  const [comment, setComment] = useState('');
  const [activeBottomTab, setActiveBottomTab] = useState<'notes' | 'resume'>('resume');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="max-w-[760px]">
      {/* ---- Action buttons row (Huntflow exact) ---- */}
      <div className="flex items-center gap-2 px-6 py-4 border-b border-white/[0.05]">
        <HFButton icon={Plus} label="Взять на вакансию" />
        <HFButton icon={Send} label="Отправить" />
        <HFButton icon={Pencil} label="Редактировать" onClick={onOpenContact} />
      </div>

      {/* ---- Name + Position + Photo ---- */}
      <div className="px-6 pt-5 pb-2 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-[24px] font-bold text-white/95 leading-tight tracking-[-0.01em]">{card.name}</h1>
          {(card.position || card.company) && (
            <p className="text-[14px] text-white/45 mt-2 leading-snug">
              {card.position}
              {card.position && card.company && (
                <span className="mx-1.5 text-white/15">&bull;</span>
              )}
              {card.company && <span>&#34;{card.company}&#34;</span>}
            </p>
          )}
        </div>
        {/* Photo / avatar */}
        <div
          className="w-[72px] h-[88px] rounded-lg flex items-center justify-center text-[22px] font-bold text-white flex-shrink-0 overflow-hidden"
          style={{ backgroundColor: color }}
        >
          {initials}
        </div>
      </div>

      {/* ---- Info Table (Huntflow dotted lines) ---- */}
      <div className="px-6 pt-2 pb-4">
        {card.phone && (
          <InfoRow label="Телефон">
            <div className="flex items-center gap-2.5">
              <a href={`tel:${card.phone}`} className="text-white/80 hover:text-cyan-400 transition-colors">{card.phone}</a>
              {/* WhatsApp Telegram Viber icons */}
              <div className="flex items-center gap-1.5">
                <span className="w-[22px] h-[22px] rounded-full bg-[#25D366] flex items-center justify-center cursor-pointer hover:opacity-80" title="WhatsApp">
                  <Phone className="w-[11px] h-[11px] text-white" />
                </span>
                <span className="w-[22px] h-[22px] rounded-full bg-[#229ED9] flex items-center justify-center cursor-pointer hover:opacity-80" title="Telegram">
                  <Send className="w-[11px] h-[11px] text-white" />
                </span>
                <span className="w-[22px] h-[22px] rounded-full bg-[#7360F2] flex items-center justify-center cursor-pointer hover:opacity-80" title="Viber">
                  <Phone className="w-[11px] h-[11px] text-white" />
                </span>
              </div>
            </div>
          </InfoRow>
        )}
        {card.email && (
          <InfoRow label="Эл. почта">
            <a href={`mailto:${card.email}`} className="text-white/80 hover:text-cyan-400 transition-colors">{card.email}</a>
          </InfoRow>
        )}
        {card.telegram_username && (
          <InfoRow label="Telegram">
            <button className="text-white/80 hover:text-cyan-400 transition-colors">{card.telegram_username}</button>
          </InfoRow>
        )}
        {card.age && (
          <InfoRow label="Возраст">
            <span className="text-white/70">{card.age}</span>
          </InfoRow>
        )}
        {card.city && (
          <InfoRow label="Город">
            <span className="text-white/70">{card.city}</span>
          </InfoRow>
        )}
        {card.salary && (
          <InfoRow label="Зарплата">
            <span className="text-white/70">{card.salary}</span>
          </InfoRow>
        )}
        {card.total_experience && (
          <InfoRow label="Опыт работы">
            <span className="text-white/70">{card.total_experience}</span>
          </InfoRow>
        )}
        <InfoRow label="Метки">
          {card.tags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {card.tags.map(t => (
                <span key={t} className="text-xs px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400/70">{t}</span>
              ))}
              <button className="text-xs text-white/30 hover:text-cyan-400 border border-white/10 hover:border-cyan-400/40 rounded px-2 py-0.5 transition-colors">Добавить</button>
            </div>
          ) : (
            <button className="text-sm text-white/30 hover:text-cyan-400 border border-dashed border-white/10 hover:border-cyan-400/40 rounded px-3 py-0.5 transition-colors">Добавить</button>
          )}
        </InfoRow>
      </div>

      {/* ---- Stage Block (Huntflow exact: colored bg, status text, "Сменить этап подбора") ---- */}
      <div className="px-6 pb-4">
        <div
          className="rounded-lg px-5 py-4"
          style={{
            backgroundColor: status === 'rejected' ? 'rgba(239,68,68,0.06)' : status === 'hired' ? 'rgba(34,197,94,0.06)' : 'rgba(59,130,246,0.04)',
            borderLeft: `3px solid ${STATUS_COLORS[status] || '#3b82f6'}`,
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[15px] font-semibold" style={{ color: STATUS_COLORS[status] || '#58a6ff' }}>
                {statusLabel}
                {card.rejection_reason && (
                  <span className="font-normal text-red-400/80">. {card.rejection_reason}</span>
                )}
              </p>
              {card.vacancy_name && (
                <p className="text-[13px] text-white/35 mt-1">{card.vacancy_name}</p>
              )}
            </div>

            {/* Сменить этап подбора button */}
            <div className="relative flex-shrink-0" ref={dropdownRef}>
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="px-4 py-2 rounded-lg text-[13px] font-medium text-white transition-colors hover:opacity-90"
                style={{ backgroundColor: STATUS_COLORS[status] || '#388bfd' }}
              >
                Сменить этап подбора
              </button>

              {showDropdown && (
                <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-[#1c2128] border border-white/10 rounded-lg shadow-2xl overflow-hidden">
                  {columns.map(col => (
                    <button
                      key={col.status}
                      onClick={() => { onStatusChange(col.status); setShowDropdown(false); }}
                      className={clsx(
                        'w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-left transition-colors',
                        col.status === status ? 'bg-white/[0.06] text-white/90' : 'text-white/60 hover:bg-white/[0.04]',
                      )}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[col.status] }} />
                      {col.label}
                      {col.status === status && <span className="ml-auto text-cyan-400 text-xs">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Comment + Action Chips (Huntflow exact) ---- */}
      <div className="px-6 pb-3">
        <div className="border border-white/[0.06] rounded-lg overflow-hidden">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Написать комментарий..."
            rows={2}
            className="w-full px-4 py-3 bg-transparent text-[13px] text-white/80 placeholder-white/20 resize-none focus:outline-none"
          />
          <div className="flex items-center gap-1.5 px-3 py-2 border-t border-white/[0.04] flex-wrap">
            <Chip icon={Mail} label="Письмо" />
            <Chip icon={CalendarDays} label="Интервью" />
            <Chip icon={MessageSquare} label="СМС" />
            <Chip icon={PhoneCall} label="Обратная связь" />
            <Chip icon={ClipboardList} label="Анкета" />
            <Chip icon={Gift} label="Оффер" />
            <Chip icon={Paperclip} label="Файл" />
          </div>
        </div>
      </div>

      {/* ---- Actions History (Huntflow: "Действия: Все ▼" + timeline) ---- */}
      <div className="px-6 pb-4">
        <div className="flex items-center gap-2 mb-3">
          <button className="flex items-center gap-1 text-[13px] text-white/50 hover:text-white/70">
            <span className="font-medium">Действия:</span>
            <span>Все</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Timeline */}
        <div className="relative pl-4 border-l border-white/[0.06] space-y-4">
          <TimelineItem
            date={formatDate(card.created_at)}
            text="Кандидат добавлен"
            color={STATUS_COLORS[status]}
          />
          {card.recruiter_name && (
            <TimelineItem
              date={formatDate(card.created_at)}
              text={`Рекрутер: ${card.recruiter_name}`}
              color="#8b949e"
            />
          )}
        </div>

        <button className="flex items-center gap-1 ml-4 mt-3 text-[12px] text-white/25 hover:text-white/45 transition-colors">
          Показать еще <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ---- Bottom Tabs (Huntflow: "Личные заметки" | "Резюме") ---- */}
      <div className="px-6 border-t border-white/[0.05]">
        <div className="flex gap-0">
          <button
            onClick={() => setActiveBottomTab('notes')}
            className={clsx(
              'px-4 py-3 text-[13px] font-medium border-b-2 transition-colors',
              activeBottomTab === 'notes'
                ? 'text-white/80 border-cyan-400'
                : 'text-white/30 border-transparent hover:text-white/50',
            )}
          >
            Личные заметки
          </button>
          <button
            onClick={() => setActiveBottomTab('resume')}
            className={clsx(
              'px-4 py-3 text-[13px] font-medium border-b-2 transition-colors',
              activeBottomTab === 'resume'
                ? 'text-white/80 border-cyan-400'
                : 'text-white/30 border-transparent hover:text-white/50',
            )}
          >
            Резюме
          </button>
        </div>
      </div>

      {/* Bottom tab content */}
      <div className="px-6 py-4">
        {activeBottomTab === 'notes' ? (
          <div>
            <textarea
              placeholder="Личные заметки по кандидату..."
              rows={3}
              className="w-full px-4 py-3 bg-white/[0.02] border border-white/[0.06] rounded-lg text-[13px] text-white/70 placeholder-white/15 resize-none focus:outline-none focus:border-cyan-500/30"
            />
            <div className="flex items-center gap-1.5 mt-2">
              <Chip icon={Mail} label="Письмо" />
              <Chip icon={MessageSquare} label="СМС" />
              <Chip icon={Paperclip} label="Файл" />
            </div>
          </div>
        ) : (
          <div>
            {/* Resume section (Huntflow: "Сохранено ... в ..." + buttons) */}
            <p className="text-xs text-white/20 text-center mb-3">
              Сохранено {formatDate(card.created_at)}
            </p>
            <div className="flex items-center justify-center gap-3 mb-4">
              <button className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] rounded-lg text-xs text-white/40 hover:text-white/70 transition-colors">
                <Eye className="w-3.5 h-3.5" />
                Показать текст
              </button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] rounded-lg text-xs text-white/40 hover:text-white/70 transition-colors">
                <Printer className="w-3.5 h-3.5" />
                Распечатать
              </button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] rounded-lg text-xs text-white/40 hover:text-white/70 transition-colors">
                <Download className="w-3.5 h-3.5" />
                Скачать
              </button>
            </div>
            {/* Placeholder for resume PDF preview */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-6 text-center text-white/15 text-sm">
              Резюме кандидата
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ================================================================
// SUB-COMPONENTS
// ================================================================

/** Huntflow action button (outline style with icon + text) */
function HFButton({ icon: Icon, label, onClick }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3.5 py-[7px] border border-white/[0.1] rounded-lg text-[13px] text-white/60 hover:text-white/90 hover:border-white/20 transition-colors"
    >
      <Icon className="w-[15px] h-[15px]" />
      {label}
    </button>
  );
}

/** Info row with dotted line separator (Huntflow style) */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start py-[7px]">
      <span className="text-[13px] text-white/30 w-[110px] flex-shrink-0">{label}</span>
      <span className="flex-1 border-b border-dotted border-white/[0.06] mx-2 mb-2 self-end" />
      <div className="text-[13px] flex-shrink-0 max-w-[420px]">{children}</div>
    </div>
  );
}

/** Action chip (Письмо, Интервью...) */
function Chip({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <button className="flex items-center gap-1.5 px-2.5 py-1 border border-white/[0.08] rounded-lg text-[11px] text-white/35 hover:text-white/60 hover:border-white/15 transition-colors">
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}

/** Timeline entry */
function TimelineItem({ date, text, color }: { date: string; text: string; color?: string }) {
  return (
    <div className="relative">
      <div className="absolute -left-[21px] top-[5px] w-[10px] h-[10px] rounded-full border-2 border-[#1c2128]" style={{ backgroundColor: color || '#484f58' }} />
      <div className="flex items-center gap-2 text-[11px] text-white/25">
        <span>Я</span>
        <span>{date}</span>
        <button className="ml-auto text-white/15 hover:text-white/35">
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
      <p className="text-[13px] text-white/65 mt-0.5">{text}</p>
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

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[#161b22] border border-white/10 rounded-xl w-full max-w-lg p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-white/90">Настройка этапов</h3>
          <button onClick={onClose} className="text-white/30 hover:text-white/60"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-white/25 mb-4">Настройте названия и цвета этапов воронки. Изменения применятся для всей организации.</p>
        <div className="space-y-1.5 mb-6">
          {stages.map((s, i) => (
            <div key={s.key} className="flex items-center gap-3 p-2.5 bg-white/[0.02] rounded-lg border border-white/[0.05]">
              <GripVertical className="w-4 h-4 text-white/10 cursor-grab" />
              <input type="color" value={s.color} onChange={(e) => setStages(p => p.map((x,j) => j===i ? {...x,color:e.target.value} : x))} className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent" />
              <input type="text" value={s.label} onChange={(e) => setStages(p => p.map((x,j) => j===i ? {...x,label:e.target.value} : x))} className="flex-1 bg-transparent text-sm text-white/70 focus:outline-none" />
              <span className="text-[10px] text-white/10 font-mono">{s.key}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-white/40 hover:text-white/70">Отмена</button>
          <button onClick={() => { toast.success('Сохранено'); onClose(); }} className="flex items-center gap-2 px-5 py-2 bg-[#238636] hover:bg-[#2ea043] text-white text-sm font-medium rounded-lg">
            <Save className="w-4 h-4" />Сохранить
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
