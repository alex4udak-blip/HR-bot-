import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Info,
  ArrowLeft,
  Mail,
  Phone,
  AtSign,
  Building2,
  Briefcase,
  User,
  Calendar,
  MessageSquare,
  GitBranch,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import { MOCK_INTERNS, MOCK_INFO } from '@/data/mockInterns';
import type { InternChat, InternTrail, InternWork } from '@/data/mockInterns';
import { formatDate } from '@/utils';

function getAvatarInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase();
}

// Chat type labels and colors
const CHAT_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  work: { label: 'Рабочий', color: 'bg-blue-500/20 text-blue-400' },
  hr: { label: 'HR', color: 'bg-emerald-500/20 text-emerald-400' },
  project: { label: 'Проект', color: 'bg-purple-500/20 text-purple-400' },
  client: { label: 'Клиент', color: 'bg-amber-500/20 text-amber-400' },
};

// Trail status labels and colors
const TRAIL_STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  active: { label: 'Активный', color: 'bg-blue-500/20 text-blue-400', icon: Clock },
  completed: { label: 'Завершён', color: 'bg-emerald-500/20 text-emerald-400', icon: CheckCircle2 },
  pending: { label: 'Ожидает', color: 'bg-gray-500/20 text-gray-400', icon: Clock },
};

// Work status labels and colors
const WORK_STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  submitted: { label: 'Отправлено', color: 'bg-blue-500/20 text-blue-400', icon: Clock },
  reviewed: { label: 'Проверено', color: 'bg-emerald-500/20 text-emerald-400', icon: CheckCircle2 },
  pending: { label: 'Ожидает', color: 'bg-gray-500/20 text-gray-400', icon: AlertCircle },
  returned: { label: 'Возвращено', color: 'bg-amber-500/20 text-amber-400', icon: RotateCcw },
};

// Paginated scrollable list component
const ITEMS_PER_PAGE = 3;

function PaginatedList<T>({
  title,
  icon: Icon,
  items,
  renderItem,
  emptyText,
}: {
  title: string;
  icon: typeof MessageSquare;
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  emptyText: string;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const pagedItems = items.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl flex flex-col h-full">
      {/* List header */}
      <div className="p-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-blue-400" />
          <h4 className="text-sm font-medium">{title}</h4>
          <span className="px-1.5 py-0.5 text-xs rounded-full bg-white/10 text-white/50">
            {items.length}
          </span>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 p-3 space-y-2 min-h-0">
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-white/30 text-sm py-6">
            {emptyText}
          </div>
        ) : (
          pagedItems.map(renderItem)
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="p-2 border-t border-white/5 flex items-center justify-between">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1.5 hover:bg-white/5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4 text-white/50" />
          </button>
          <span className="text-xs text-white/40">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="p-1.5 hover:bg-white/5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4 text-white/50" />
          </button>
        </div>
      )}
    </div>
  );
}

// Meta info card component
function MetaCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <div className="flex items-center gap-2 text-white/40 mb-1">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-sm font-medium truncate" title={value}>{value}</p>
    </div>
  );
}

// Render functions for list items
function ChatItem({ chat }: { chat: InternChat }) {
  const config = CHAT_TYPE_CONFIG[chat.type] || CHAT_TYPE_CONFIG.work;
  return (
    <button
      className="w-full p-2.5 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-left"
      onClick={() => { /* stub - clickable but no action */ }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium truncate">{chat.title}</span>
        <span className={`px-2 py-0.5 text-xs rounded-full flex-shrink-0 ${config.color}`}>
          {config.label}
        </span>
      </div>
      <div className="text-xs text-white/40">
        Активность: {formatDate(chat.lastActivity, 'short')}
      </div>
    </button>
  );
}

function TrailItem({ trail }: { trail: InternTrail }) {
  const config = TRAIL_STATUS_CONFIG[trail.status] || TRAIL_STATUS_CONFIG.pending;
  const StatusIcon = config.icon;
  return (
    <button
      className="w-full p-2.5 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-left"
      onClick={() => { /* stub */ }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium truncate">{trail.name}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <StatusIcon className="w-3 h-3" />
          <span className={`px-2 py-0.5 text-xs rounded-full ${config.color}`}>
            {config.label}
          </span>
        </div>
      </div>
      {trail.status !== 'completed' ? (
        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-400 rounded-full transition-all"
            style={{ width: `${trail.progress}%` }}
          />
        </div>
      ) : (
        <div className="text-xs text-emerald-400/70">100% завершён</div>
      )}
    </button>
  );
}

function WorkItem({ work }: { work: InternWork }) {
  const config = WORK_STATUS_CONFIG[work.status] || WORK_STATUS_CONFIG.pending;
  const StatusIcon = config.icon;
  return (
    <button
      className="w-full p-2.5 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-left"
      onClick={() => { /* stub */ }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium truncate">{work.title}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <StatusIcon className="w-3 h-3" />
          <span className={`px-2 py-0.5 text-xs rounded-full ${config.color}`}>
            {config.label}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-white/40">
        {work.submittedDate && (
          <span>{formatDate(work.submittedDate, 'short')}</span>
        )}
        {work.grade !== undefined && (
          <span className={`font-medium px-1.5 py-0.5 rounded ${
            work.grade >= 90 ? 'bg-emerald-500/20 text-emerald-400' :
            work.grade >= 75 ? 'bg-blue-500/20 text-blue-400' :
            'bg-amber-500/20 text-amber-400'
          }`}>
            {work.grade}
          </span>
        )}
      </div>
    </button>
  );
}

export default function InternInfoPage() {
  const { internId } = useParams<{ internId: string }>();
  const navigate = useNavigate();

  const intern = useMemo(
    () => MOCK_INTERNS.find(i => i.id === Number(internId)),
    [internId]
  );
  const info = useMemo(
    () => MOCK_INFO[Number(internId)],
    [internId]
  );

  if (!intern || !info) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-white/10">
          <button
            onClick={() => navigate('/interns')}
            className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm">Назад к списку</span>
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-white/40">
            <Info className="w-16 h-16 mx-auto mb-4 opacity-50 text-blue-400/50" />
            <h3 className="text-lg font-medium mb-2">Практикант не найден</h3>
            <p className="text-sm">Проверьте корректность ссылки</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/interns')}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-white/60" />
          </button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-medium text-sm flex-shrink-0">
              {getAvatarInitials(intern.name)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <h1 className="text-lg font-bold truncate">Информация</h1>
              </div>
              <p className="text-sm text-white/50 truncate">{intern.name} — {intern.position}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Meta information cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h3 className="text-sm font-medium text-white/50 mb-3">Личные характеристики</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetaCard icon={User} label="ФИО" value={intern.name} />
            <MetaCard icon={Mail} label="Email" value={intern.email} />
            <MetaCard icon={Phone} label="Телефон" value={intern.phone} />
            <MetaCard icon={AtSign} label="Telegram" value={intern.telegramUsername || '—'} />
            <MetaCard icon={Building2} label="Отдел" value={intern.department} />
            <MetaCard icon={Briefcase} label="Позиция" value={intern.position} />
            <MetaCard icon={User} label="Ментор" value={intern.mentor} />
            <MetaCard icon={Calendar} label="Дата начала" value={formatDate(intern.startDate, 'medium')} />
          </div>
        </motion.div>

        {/* Tags */}
        {intern.tags.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <h3 className="text-sm font-medium text-white/50 mb-3">Навыки</h3>
            <div className="flex flex-wrap gap-2">
              {intern.tags.map(tag => (
                <span
                  key={tag}
                  className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white/70"
                >
                  {tag}
                </span>
              ))}
            </div>
          </motion.div>
        )}

        {/* Three-column scrollable lists */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h3 className="text-sm font-medium text-white/50 mb-3">Детальная информация</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Chats list */}
            <PaginatedList
              title="В каких чатах состоит"
              icon={MessageSquare}
              items={info.chats}
              emptyText="Нет чатов"
              renderItem={(chat: InternChat) => (
                <ChatItem key={chat.id} chat={chat} />
              )}
            />

            {/* Trails list */}
            <PaginatedList
              title="На какие трейлы записан"
              icon={GitBranch}
              items={info.trails}
              emptyText="Нет трейлов"
              renderItem={(trail: InternTrail) => (
                <TrailItem key={trail.id} trail={trail} />
              )}
            />

            {/* Works list */}
            <PaginatedList
              title="Контроль работ"
              icon={ClipboardCheck}
              items={info.works}
              emptyText="Нет работ"
              renderItem={(work: InternWork) => (
                <WorkItem key={work.id} work={work} />
              )}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
