import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  Paperclip,
  Mail,
  Calendar,
  ThumbsUp,
  XCircle,
  FileText,
  Eye,
  Printer,
  Download,
  CheckSquare,
  Square,
  Pencil,
  Phone,
  Send,
  Check,
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
import { updateEntity, uploadEntityFile, getEntityFiles, downloadEntityFile } from '@/services/api/entities';
import SendEmailModal from '@/components/entities/SendEmailModal';
import type { EntityFile } from '@/services/api/entities';
import AddToVacancyModal from '@/components/entities/AddToVacancyModal';
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
  const [searchParams] = useSearchParams();
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
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddToVacancy, setShowAddToVacancy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const VISIBLE_STEP = 50;
  const [visibleCount, setVisibleCount] = useState(VISIBLE_STEP);

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

  // Reset visible count when filters change
  useEffect(() => { setVisibleCount(VISIBLE_STEP); }, [activeTab, debouncedSearch, recruiterId]);

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

  // Auto-select from URL ?entity=ID or first card
  const entityParam = searchParams.get('entity');
  useEffect(() => {
    if (filteredCards.length === 0) return;
    // Try to select entity from URL param
    if (entityParam) {
      const entityId = parseInt(entityParam);
      const match = filteredCards.find(fc => fc.card.id === entityId);
      if (match) {
        setSelectedCard(match.card);
        setSelectedStatus(match.status);
        return;
      }
    }
    // Fallback: auto-select first
    if (!selectedCard) {
      setSelectedCard(filteredCards[0].card);
      setSelectedStatus(filteredCards[0].status);
    }
  }, [filteredCards.length, entityParam]);

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

  // After editing candidate, update the card in state
  const handleCardUpdated = (updated: Partial<KanbanCard>) => {
    if (!selectedCard) return;
    const newCard = { ...selectedCard, ...updated };
    setSelectedCard(newCard);
    // Also update in board
    setBoard(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        columns: prev.columns.map(col => ({
          ...col,
          cards: col.cards.map(c => c.id === newCard.id ? newCard : c),
        })),
      };
    });
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
      {/* ===== TOP: Stage tabs ===== */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-white/[0.06] overflow-x-auto no-scrollbar flex-shrink-0">
        <button
          onClick={() => { setActiveTab('all'); setSelectedCard(null); }}
          className={clsx(
            'px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
            activeTab === 'all' ? 'bg-accent-500 text-white' : 'text-dark-400 hover:bg-white/[0.06]',
          )}
        >
          Все <span className="ml-1 text-xs opacity-70">{totalCount}</span>
        </button>

        {board?.columns.map(col => (
          <button
            key={col.status}
            onClick={() => { setActiveTab(col.status); setSelectedCard(null); }}
            className={clsx(
              'px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
              activeTab === col.status ? 'bg-accent-500 text-white' : 'text-dark-400 hover:bg-white/[0.06]',
            )}
          >
            {col.label} <span className="ml-1 text-xs opacity-70">{col.count}</span>
          </button>
        ))}

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

      {/* ===== MASTER-DETAIL ===== */}
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
                  placeholder="Поиск по имени, должности, компании..."
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
                <div className="flex items-center justify-center h-40 text-dark-500 text-sm">Нет кандидатов</div>
              ) : (<>
                {filteredCards.slice(0, visibleCount).map(({ card, status }) => {
                  const isSelected = selectedCard?.id === card.id;
                  const isChecked = selectedIds.has(card.id);
                  const initials = getInitials(card.name);
                  return (
                    <div
                      key={card.id}
                      onClick={() => { setSelectedCard(card); setSelectedStatus(status); setDetailTab('info'); }}
                      className={clsx(
                        'flex items-start gap-2 px-3 py-3 cursor-pointer border-b border-white/[0.04] transition-colors group/card',
                        isChecked || isSelected
                          ? 'bg-accent-500/10 border-l-2 border-l-accent-500'
                          : 'hover:bg-white/[0.03] border-l-2 border-l-transparent',
                      )}
                    >
                      <div
                        onClick={(e) => { e.stopPropagation(); toggleSelection(card.id); }}
                        className={clsx(
                          'flex items-center justify-center w-4 h-4 mt-2.5 flex-shrink-0 cursor-pointer transition-opacity',
                          anySelected ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100',
                        )}
                      >
                        {isChecked ? <CheckSquare className="w-4 h-4 text-accent-400" /> : <Square className="w-4 h-4 text-dark-500 hover:text-dark-300" />}
                      </div>
                      <div className="w-9 h-9 rounded-full bg-accent-500/20 flex items-center justify-center text-accent-400 text-sm font-medium flex-shrink-0">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-dark-100 truncate">{card.name}</div>
                        {card.position && <div className="text-xs text-dark-500 truncate mt-0.5">{card.position}</div>}
                        <div className="text-xs text-dark-600 mt-0.5">
                          {card.source || ''}{card.created_at && <span className="ml-1">{formatDateShort(card.created_at)}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {filteredCards.length > visibleCount && (
                  <button
                    onClick={() => setVisibleCount(prev => prev + VISIBLE_STEP)}
                    className="w-full py-3 text-sm text-accent-400 hover:bg-white/[0.04] transition-colors border-b border-white/[0.04]"
                  >
                    Показать ещё ({filteredCards.length - visibleCount})
                  </button>
                )}
              </>)}
            </div>

            {anySelected && (
              <div className="absolute bottom-0 left-0 right-0 p-3 bg-dark-800 border-t border-white/[0.08] flex items-center justify-between">
                <span className="text-xs text-dark-300 font-medium">Выбрано: {selectedIds.size}</span>
                <button onClick={() => setSelectedIds(new Set())} className="px-2.5 py-1 text-xs font-medium rounded-lg text-dark-400 hover:bg-white/[0.06]">Снять</button>
              </div>
            )}
          </div>

          {/* RIGHT: Detail panel */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedCard ? (
              <>
                <div className="flex items-center border-b border-white/[0.06] px-5 flex-shrink-0">
                  <button onClick={() => setDetailTab('info')} className={clsx('px-4 py-3 text-sm font-medium border-b-2 transition-colors', detailTab === 'info' ? 'border-accent-500 text-dark-100' : 'border-transparent text-dark-400 hover:text-dark-200')}>
                    Личные заметки
                  </button>
                  <button onClick={() => setDetailTab('resume')} className={clsx('px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5', detailTab === 'resume' ? 'border-accent-500 text-dark-100' : 'border-transparent text-dark-400 hover:text-dark-200')}>
                    <FileText className="w-3.5 h-3.5" /> Резюме
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {detailTab === 'info' ? (
                    <InfoTab
                      card={selectedCard}
                      status={selectedStatus}
                      statusLabel={board?.columns.find(c => c.status === selectedStatus)?.label || selectedStatus}
                      columns={board?.columns || []}
                      onStatusChange={handleStatusChange}
                      onOpenContact={() => {
                        if (selectedCard.source_url) {
                          window.open(selectedCard.source_url, '_blank');
                        } else {
                          toast.error('Нет ссылки на источник');
                        }
                      }}
                      onAddToVacancy={() => setShowAddToVacancy(true)}
                      onEdit={() => setShowEditModal(true)}
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
        {showEditModal && selectedCard && (
          <EditCandidateModal
            card={selectedCard}
            onClose={() => setShowEditModal(false)}
            onSaved={(updated) => {
              handleCardUpdated(updated);
              setShowEditModal(false);
            }}
          />
        )}
        {showAddToVacancy && selectedCard && (
          <AddToVacancyModal
            entityId={selectedCard.id}
            entityName={selectedCard.name}
            onClose={() => setShowAddToVacancy(false)}
            onSuccess={() => { setShowAddToVacancy(false); fetchBoard(); toast.success('Кандидат добавлен на вакансию'); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}


// ================================================================
// INFO TAB — Huntflow-style detail panel with working actions
// ================================================================

const InfoTab = memo(function InfoTab({ card, status, statusLabel, columns, onStatusChange, onOpenContact, onAddToVacancy, onEdit }: {
  card: KanbanCard;
  status: string;
  statusLabel: string;
  columns: KanbanColumn[];
  onStatusChange: (s: string) => void;
  onOpenContact: () => void;
  onAddToVacancy: () => void;
  onEdit: () => void;
}) {
  const [showStageDD, setShowStageDD] = useState(false);
  const [comment, setComment] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [localTags, setLocalTags] = useState<string[]>(card.tags || []);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const sc = STATUS_COLORS[status] || FALLBACK_COLOR;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (stageRef.current && !stageRef.current.contains(e.target as Node)) setShowStageDD(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // --- Action handlers ---

  const [showEmailModal, setShowEmailModal] = useState(false);

  const handleEmail = () => {
    setShowEmailModal(true);
  };

  const handleInterview = () => {
    // TODO: Full interview scheduling modal
    toast('Назначение интервью — скоро будет доступно', { icon: '📅' });
  };

  const handleComment = async () => {
    if (!comment.trim()) {
      toast.error('Введите комментарий');
      return;
    }
    try {
      const existingNotes: string[] = card.extra_data?.notes || [];
      const newNote = {
        text: comment.trim(),
        date: new Date().toISOString(),
      };
      await updateEntity(card.id, {
        extra_data: {
          ...(card.extra_data || {}),
          notes: [...existingNotes, newNote],
        },
      });
      // Update card in-place so history shows immediately
      if (!card.extra_data) card.extra_data = {};
      card.extra_data.notes = [...existingNotes, newNote];
      toast.success('Комментарий сохранён');
      setComment('');
    } catch {
      toast.error('Ошибка сохранения комментария');
    }
  };

  const handleOffer = () => {
    onStatusChange('offer');
    toast.success(`${card.name} → Оффер`);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadEntityFile(card.id, file, 'resume');
      toast.success(`Файл "${file.name}" загружен`);
    } catch {
      toast.error('Ошибка загрузки файла');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleReject = () => {
    onStatusChange('rejected');
  };

  const handleAddTag = async () => {
    const tag = tagInput.trim();
    if (!tag) return;
    if (localTags.includes(tag)) {
      toast.error('Метка уже существует');
      return;
    }
    const newTags = [...localTags, tag];
    try {
      await updateEntity(card.id, { tags: newTags });
      setLocalTags(newTags);
      setTagInput('');
      toast.success(`Метка "${tag}" добавлена`);
    } catch {
      toast.error('Ошибка добавления метки');
    }
  };

  const handleRemoveTag = async (tag: string) => {
    const newTags = localTags.filter(t => t !== tag);
    try {
      await updateEntity(card.id, { tags: newTags });
      setLocalTags(newTags);
      toast.success(`Метка "${tag}" удалена`);
    } catch {
      toast.error('Ошибка удаления метки');
    }
  };

  return (
    <div className="p-5 max-w-3xl">
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" />

      {/* Send Email Modal */}
      <AnimatePresence>
        {showEmailModal && (
          <SendEmailModal
            entityId={card.id}
            entityName={card.name}
            entityEmail={card.email}
            onClose={() => setShowEmailModal(false)}
          />
        )}
      </AnimatePresence>

      {/* ---- Top action buttons (Huntflow: Взять на вакансию | Редактировать) ---- */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={onOpenContact}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.1] rounded-lg text-sm text-dark-300 hover:bg-white/[0.04] transition-colors"
        >
          <Users className="w-4 h-4" /> Открыть профиль
        </button>
        <button
          onClick={onAddToVacancy}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.1] rounded-lg text-sm text-dark-300 hover:bg-white/[0.04] transition-colors"
        >
          <Plus className="w-4 h-4" /> На вакансию
        </button>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.1] rounded-lg text-sm text-dark-300 hover:bg-white/[0.04] transition-colors"
        >
          <Pencil className="w-4 h-4" /> Редактировать
        </button>
      </div>

      {/* ---- Name + Avatar (Huntflow layout: name left, photo right) ---- */}
      <div className="flex items-start gap-4 mb-1">
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-semibold text-dark-100">{card.name}</h2>
          {(card.position || card.company) && (
            <p className="text-dark-400 mt-1">
              {card.position}
              {card.position && card.company && <span className="mx-1.5 text-dark-600">&bull;</span>}
              {card.company}
            </p>
          )}
        </div>
        {/* Avatar photo placeholder */}
        <div className="w-[72px] h-[88px] rounded-lg bg-accent-500/20 flex items-center justify-center text-accent-400 text-xl font-bold flex-shrink-0">
          {getInitials(card.name)}
        </div>
      </div>

      {/* ---- Contact info (Huntflow: dotted-line rows) ---- */}
      <div className="mt-4 mb-5">
        {card.phone && (
          <InfoRow label="Телефон">
            <div className="flex items-center gap-2">
              <a href={`tel:${card.phone}`} className="text-dark-200 hover:text-white transition-colors">{card.phone}</a>
              {/* Messenger icons */}
              <a href={`https://wa.me/${card.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                className="w-[22px] h-[22px] rounded-full bg-[#25D366] flex items-center justify-center hover:opacity-80" title="WhatsApp">
                <Phone className="w-[11px] h-[11px] text-white" />
              </a>
              <a href={`https://t.me/${card.telegram_username || card.phone}`} target="_blank" rel="noopener noreferrer"
                className="w-[22px] h-[22px] rounded-full bg-[#229ED9] flex items-center justify-center hover:opacity-80" title="Telegram">
                <Send className="w-[11px] h-[11px] text-white" />
              </a>
            </div>
          </InfoRow>
        )}
        {card.email && (
          <InfoRow label="Эл. почта">
            <a href={`mailto:${card.email}`} className="text-dark-200 hover:text-white transition-colors">{card.email}</a>
          </InfoRow>
        )}
        {card.telegram_username && (
          <InfoRow label="Telegram">
            <a href={`https://t.me/${card.telegram_username}`} target="_blank" rel="noopener noreferrer" className="text-dark-200 hover:text-white transition-colors">
              {card.telegram_username}
            </a>
          </InfoRow>
        )}
        {card.age && <InfoRow label="Возраст"><span className="text-dark-200">{card.age}</span></InfoRow>}
        {card.city && <InfoRow label="Город"><span className="text-dark-200">{card.city}</span></InfoRow>}
        {card.salary && <InfoRow label="Зарплата"><span className="text-dark-200">{card.salary}</span></InfoRow>}
        {card.total_experience && <InfoRow label="Опыт"><span className="text-dark-200">{card.total_experience}</span></InfoRow>}
        {card.source && <InfoRow label="Источник"><span className="text-dark-200">{card.source}</span></InfoRow>}

        {/* Tags row */}
        <InfoRow label="Метки">
          <div className="flex flex-wrap items-center gap-1.5">
            {localTags.map(t => (
              <span key={t} className="group inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent-500/15 text-accent-400 border border-accent-500/20">
                {t}
                <button onClick={() => handleRemoveTag(t)} className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {showTagInput ? (
              <form
                onSubmit={(e) => { e.preventDefault(); handleAddTag(); }}
                className="inline-flex items-center gap-1"
              >
                <input
                  ref={tagInputRef}
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onBlur={() => { if (!tagInput.trim()) setShowTagInput(false); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setShowTagInput(false); setTagInput(''); } }}
                  placeholder="Метка..."
                  autoFocus
                  className="w-24 px-2 py-0.5 rounded text-xs bg-white/5 border border-white/10 text-dark-200 placeholder-dark-500 focus:outline-none focus:border-accent-500/50"
                />
              </form>
            ) : (
              <button
                onClick={() => setShowTagInput(true)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-dark-400 border border-white/[0.1] hover:border-white/[0.2] hover:text-dark-300 transition-colors"
              >
                Добавить
              </button>
            )}
          </div>
        </InfoRow>
      </div>

      {/* ---- Stage block (Huntflow: colored bg + vacancy name + change button) ---- */}
      <div className="mb-5 p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-dark-500 mb-1">Текущий этап</div>
            <div className={clsx('text-base font-semibold', sc.text)}>{statusLabel}</div>
            {card.vacancy_name && <div className="text-xs text-dark-600 mt-1">{card.vacancy_name}</div>}
            {card.rejection_reason && <div className="text-xs text-red-400/80 mt-1">{card.rejection_reason}</div>}
          </div>
          <div className="relative" ref={stageRef}>
            <button
              onClick={() => setShowStageDD(!showStageDD)}
              className="px-3.5 py-2 rounded-lg text-xs font-medium bg-accent-500 text-white hover:bg-accent-600 transition-colors"
            >
              Сменить этап подбора
            </button>
            {showStageDD && (
              <div className="absolute right-0 top-full mt-1 z-50 w-56 py-1 bg-dark-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] text-dark-500 uppercase tracking-wider font-semibold">Перенести в</div>
                {columns.map(col => {
                  const colSc = STATUS_COLORS[col.status] || FALLBACK_COLOR;
                  return (
                    <button
                      key={col.status}
                      onClick={() => { onStatusChange(col.status); setShowStageDD(false); }}
                      className={clsx(
                        'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors text-sm',
                        col.status === status ? 'bg-white/[0.06] text-dark-100' : 'text-dark-300 hover:bg-white/[0.04]',
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

      {/* ---- Comment textarea (Huntflow: "Написать комментарий") ---- */}
      <div className="mb-4 relative">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Написать комментарий..."
          rows={2}
          className="w-full px-4 py-3 pr-20 bg-white/[0.02] border border-white/[0.06] rounded-lg text-sm text-dark-200 placeholder-dark-500 resize-none focus:outline-none focus:border-accent-500/30"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleComment(); }}
        />
        {comment.trim() && (
          <button
            onClick={handleComment}
            className="absolute right-3 bottom-3 px-3 py-1 bg-accent-500 text-white text-xs rounded-md hover:bg-accent-600"
          >
            Отправить
          </button>
        )}
      </div>

      {/* ---- Action chips (Huntflow: Письмо | Интервью | Комментарий | Оффер | Файл | Отказ) ---- */}
      <div className="flex items-center gap-1.5 mb-6 pb-5 border-b border-white/[0.06] flex-wrap">
        <ActionChip icon={Mail} label="Письмо" onClick={handleEmail} />
        <ActionChip icon={Calendar} label="Интервью" onClick={handleInterview} />
        <ActionChip icon={ThumbsUp} label="Оффер" onClick={handleOffer} />
        <ActionChip icon={Paperclip} label="Файл" onClick={() => fileInputRef.current?.click()} loading={uploading} />
        <ActionChip icon={XCircle} label="Отказ" onClick={handleReject} danger />
      </div>

      {/* ---- History timeline ---- */}
      <div>
        <div className="text-xs text-dark-500 mb-3 uppercase tracking-wider">История</div>
        <div className="relative pl-6 border-l border-white/[0.08]">
          {/* Saved notes (newest first) */}
          {(card.extra_data?.notes || []).slice().reverse().map((note: any, i: number) => (
            <div key={`note-${i}`} className="relative pb-5">
              <div className="absolute -left-[25px] w-3 h-3 rounded-full border-2 border-dark-800 bg-blue-500" />
              <div className="text-xs text-dark-600 mb-1">{note.date ? formatDateFull(note.date) : ''}</div>
              <div className="text-sm text-dark-300">{note.text}</div>
            </div>
          ))}
          {/* Created event */}
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
});


// ================================================================
// RESUME TAB
// ================================================================

const ResumeTab = memo(function ResumeTab({ card }: { card: KanbanCard }) {
  const [files, setFiles] = useState<EntityFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewUrls, setPreviewUrls] = useState<Record<number, string>>({});

  useEffect(() => {
    setLoading(true);
    getEntityFiles(card.id)
      .then((data) => {
        setFiles(data);
        // Generate preview URLs for image files
        data.filter(f => f.mime_type?.startsWith('image/')).forEach(async (f) => {
          try {
            const blob = await downloadEntityFile(card.id, f.id);
            setPreviewUrls(prev => ({ ...prev, [f.id]: URL.createObjectURL(blob) }));
          } catch { /* ignore */ }
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [card.id]);

  const resumeFiles = files.filter(f => f.file_type === 'resume');
  const pdfFile = resumeFiles.find(f => f.mime_type === 'application/pdf');
  const imageFiles = resumeFiles.filter(f => f.mime_type?.startsWith('image/'));

  const handleDownload = async (file: EntityFile) => {
    try {
      const blob = await downloadEntityFile(card.id, file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Ошибка скачивания');
    }
  };

  const handlePrint = () => {
    if (imageFiles.length > 0) {
      const urls = imageFiles.map(f => previewUrls[f.id]).filter(Boolean);
      if (urls.length === 0) { toast.error('Загрузка...'); return; }
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(`<html><body style="margin:0">${urls.map(u => `<img src="${u}" style="width:100%;page-break-after:always"/>`).join('')}</body></html>`);
        w.document.close();
        w.onload = () => w.print();
      }
    } else if (pdfFile) {
      handleDownload(pdfFile);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-dark-400" />
      </div>
    );
  }

  if (resumeFiles.length === 0) {
    return (
      <div className="p-5 max-w-3xl">
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-8 text-center text-dark-500 text-sm min-h-[200px] flex flex-col items-center justify-center gap-2">
          <FileText className="w-8 h-8 opacity-30" />
          <p>Резюме ещё не сгенерировано</p>
          <p className="text-xs text-dark-600">Резюме создаётся автоматически после добавления кандидата через Волшебную кнопку</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 max-w-3xl">
      <p className="text-xs text-dark-600 text-center mb-3">
        Сохранено {formatDateFull(resumeFiles[0]?.created_at || card.created_at)}
      </p>
      <div className="flex items-center justify-center gap-3 mb-4">
        {card.source_url && (
          <button
            onClick={() => window.open(card.source_url!, '_blank')}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] rounded-lg text-xs text-dark-400 hover:text-dark-200 transition-colors"
          >
            <Eye className="w-3.5 h-3.5" /> Открыть источник
          </button>
        )}
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] rounded-lg text-xs text-dark-400 hover:text-dark-200 transition-colors"
        >
          <Printer className="w-3.5 h-3.5" /> Распечатать
        </button>
        {pdfFile && (
          <button
            onClick={() => handleDownload(pdfFile)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] rounded-lg text-xs text-dark-400 hover:text-dark-200 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Скачать PDF
          </button>
        )}
      </div>
      {/* Resume preview — show JPEG pages */}
      {imageFiles.length > 0 ? (
        <div className="space-y-3">
          {imageFiles.map((f) => (
            <div key={f.id} className="bg-white/[0.02] border border-white/[0.06] rounded-lg overflow-hidden">
              {previewUrls[f.id] ? (
                <img src={previewUrls[f.id]} alt={f.file_name} className="w-full" />
              ) : (
                <div className="p-8 text-center text-dark-500 text-sm">Загрузка...</div>
              )}
            </div>
          ))}
        </div>
      ) : pdfFile ? (
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-6 text-center">
          <FileText className="w-10 h-10 mx-auto mb-3 text-dark-400" />
          <p className="text-sm text-dark-300 mb-2">{pdfFile.file_name}</p>
          <p className="text-xs text-dark-500 mb-3">{(pdfFile.file_size / 1024).toFixed(0)} КБ</p>
          <button
            onClick={() => handleDownload(pdfFile)}
            className="px-4 py-2 bg-accent-500/20 text-accent-400 rounded-lg text-sm hover:bg-accent-500/30 transition-colors"
          >
            <Download className="w-4 h-4 inline mr-1.5" /> Скачать
          </button>
        </div>
      ) : (
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-8 text-center text-dark-500 text-sm">
          {resumeFiles.map(f => <p key={f.id}>{f.file_name}</p>)}
        </div>
      )}
    </div>
  );
});


// ================================================================
// SUB-COMPONENTS
// ================================================================

/** Huntflow info row with dotted line separator */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start py-[7px] group">
      <span className="text-[13px] text-dark-500 w-[100px] flex-shrink-0">{label}</span>
      <span className="flex-1 border-b border-dotted border-white/[0.06] mx-2 mb-2 self-end" />
      <div className="text-[13px] flex-shrink-0 max-w-[420px]">{children}</div>
    </div>
  );
}

/** Action chip button (Huntflow: bordered pill with icon + text) */
function ActionChip({ icon: Icon, label, onClick, danger, loading }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors',
        danger
          ? 'border-red-500/20 text-red-400/70 hover:bg-red-500/10 hover:text-red-400'
          : 'border-white/[0.08] text-dark-400 hover:bg-white/[0.04] hover:text-dark-200',
        loading && 'opacity-50 cursor-wait',
      )}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
}

// ================================================================
// EDIT CANDIDATE MODAL
// ================================================================

function EditCandidateModal({ card, onClose, onSaved }: {
  card: KanbanCard;
  onClose: () => void;
  onSaved: (updated: Partial<KanbanCard>) => void;
}) {
  const [name, setName] = useState(card.name);
  const [phone, setPhone] = useState(card.phone || '');
  const [email, setEmail] = useState(card.email || '');
  const [telegram, setTelegram] = useState(card.telegram_username || '');
  const [position, setPosition] = useState(card.position || '');
  const [company, setCompany] = useState(card.company || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Имя обязательно'); return; }
    setSaving(true);
    try {
      await updateEntity(card.id, {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        telegram_usernames: telegram.trim() ? [telegram.trim().replace(/^@/, '')] : undefined,
        position: position.trim() || undefined,
        company: company.trim() || undefined,
      });
      toast.success('Кандидат обновлён');
      onSaved({
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        telegram_username: telegram.trim() || undefined,
        position: position.trim() || undefined,
        company: company.trim() || undefined,
      });
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

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
          <h3 className="text-lg font-bold text-dark-100">Редактировать кандидата</h3>
          <button onClick={onClose} className="text-dark-400 hover:text-dark-200"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <EditField label="ФИО" value={name} onChange={setName} required />
          <EditField label="Телефон" value={phone} onChange={setPhone} placeholder="+7 999 123 4567" />
          <EditField label="Email" value={email} onChange={setEmail} placeholder="email@example.com" type="email" />
          <EditField label="Telegram" value={telegram} onChange={setTelegram} placeholder="@username" />
          <EditField label="Должность" value={position} onChange={setPosition} placeholder="Frontend Developer" />
          <EditField label="Компания" value={company} onChange={setCompany} placeholder="Google" />
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-dark-400 hover:text-dark-200">Отмена</button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex items-center gap-2 px-5 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Сохранить
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function EditField({ label, value, onChange, placeholder, type, required }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-dark-500 mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type={type || 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-dark-200 placeholder-dark-600 focus:outline-none focus:border-accent-500/40"
      />
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
