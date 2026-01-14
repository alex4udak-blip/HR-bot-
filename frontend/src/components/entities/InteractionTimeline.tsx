import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  Phone,
  FileText,
  Briefcase,
  ChevronDown,
  ChevronRight,
  User,
  Calendar,
  CheckCircle,
  ArrowRight,
  History as HistoryIcon
} from 'lucide-react';
import clsx from 'clsx';

// Date formatting utilities
const formatDate = (dateStr: string, formatStr: string): string => {
  const date = new Date(dateStr);
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  if (formatStr === 'yyyy-MM-dd') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  if (formatStr === 'HH:mm') {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  if (formatStr === 'd MMMM yyyy') {
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }
  return dateStr;
};

interface TimelineEvent {
  id: string;
  type: 'chat_message' | 'call' | 'file_upload' | 'vacancy_applied' | 'stage_change' | 'note' | 'status_change';
  title: string;
  description?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface InteractionTimelineProps {
  entityId: number;
  chats?: Array<{
    id: number;
    title: string;
    messages?: Array<{
      id: number;
      text: string;
      timestamp: string;
      sender_name?: string;
    }>;
  }>;
  calls?: Array<{
    id: number;
    title: string;
    duration_seconds?: number;
    created_at: string;
    summary?: string;
  }>;
  files?: Array<{
    id: number;
    file_name: string;
    file_type: string;
    created_at: string;
  }>;
  applications?: Array<{
    id: number;
    vacancy_title: string;
    stage: string;
    applied_at?: string;
    updated_at?: string;
  }>;
  statusChanges?: Array<{
    from_status: string;
    to_status: string;
    changed_at: string;
    changed_by?: string;
  }>;
}

const eventTypeConfig = {
  chat_message: {
    icon: MessageSquare,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    label: 'Сообщение'
  },
  call: {
    icon: Phone,
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    label: 'Звонок'
  },
  file_upload: {
    icon: FileText,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
    label: 'Файл'
  },
  vacancy_applied: {
    icon: Briefcase,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20',
    label: 'Вакансия'
  },
  stage_change: {
    icon: ArrowRight,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/20',
    label: 'Этап'
  },
  note: {
    icon: FileText,
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/20',
    label: 'Заметка'
  },
  status_change: {
    icon: CheckCircle,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20',
    label: 'Статус'
  }
};

const stageLabels: Record<string, string> = {
  new: 'Новый',
  screening: 'Скрининг',
  practice: 'Практика',
  tech_practice: 'Техническая практика',
  is_interview: 'Интервью',
  offer: 'Оффер',
  hired: 'Принят',
  rejected: 'Отклонён',
  withdrawn: 'Отказался',
  on_hold: 'На паузе'
};

export default function InteractionTimeline({
  chats = [],
  calls = [],
  files = [],
  applications = [],
  statusChanges = []
}: InteractionTimelineProps) {
  const [expanded, setExpanded] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);

  // Convert all data sources to timeline events
  const events = useMemo(() => {
    const allEvents: TimelineEvent[] = [];

    // Add chat messages
    chats.forEach(chat => {
      if (chat.messages) {
        chat.messages.forEach(msg => {
          allEvents.push({
            id: `msg-${msg.id}`,
            type: 'chat_message',
            title: chat.title,
            description: msg.text?.slice(0, 100) + (msg.text?.length > 100 ? '...' : ''),
            timestamp: msg.timestamp,
            metadata: {
              sender: msg.sender_name,
              chatId: chat.id
            }
          });
        });
      }
    });

    // Add calls
    calls.forEach(call => {
      allEvents.push({
        id: `call-${call.id}`,
        type: 'call',
        title: call.title || 'Звонок',
        description: call.summary?.slice(0, 100) || (call.duration_seconds ? `Длительность: ${Math.floor(call.duration_seconds / 60)} мин` : undefined),
        timestamp: call.created_at,
        metadata: {
          duration: call.duration_seconds
        }
      });
    });

    // Add files
    files.forEach(file => {
      allEvents.push({
        id: `file-${file.id}`,
        type: 'file_upload',
        title: `Загружен файл`,
        description: file.file_name,
        timestamp: file.created_at,
        metadata: {
          fileType: file.file_type,
          fileName: file.file_name
        }
      });
    });

    // Add vacancy applications
    applications.forEach(app => {
      if (app.applied_at) {
        allEvents.push({
          id: `app-${app.id}`,
          type: 'vacancy_applied',
          title: 'Заявка на вакансию',
          description: app.vacancy_title,
          timestamp: app.applied_at,
          metadata: {
            stage: app.stage,
            vacancyTitle: app.vacancy_title
          }
        });
      }

      // Add stage changes if different from initial
      if (app.updated_at && app.updated_at !== app.applied_at) {
        allEvents.push({
          id: `stage-${app.id}`,
          type: 'stage_change',
          title: `Изменён этап: ${stageLabels[app.stage] || app.stage}`,
          description: app.vacancy_title,
          timestamp: app.updated_at,
          metadata: {
            stage: app.stage,
            vacancyTitle: app.vacancy_title
          }
        });
      }
    });

    // Add status changes
    statusChanges.forEach((change, idx) => {
      allEvents.push({
        id: `status-${idx}`,
        type: 'status_change',
        title: `Статус изменён`,
        description: `${change.from_status} → ${change.to_status}`,
        timestamp: change.changed_at,
        metadata: {
          from: change.from_status,
          to: change.to_status,
          by: change.changed_by
        }
      });
    });

    // Sort by timestamp (newest first)
    allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return allEvents;
  }, [chats, calls, files, applications, statusChanges]);

  // Filter events
  const filteredEvents = useMemo(() => {
    if (!filter) return events;
    return events.filter(e => e.type === filter);
  }, [events, filter]);

  // Show limited events unless expanded
  const displayedEvents = showAllEvents ? filteredEvents : filteredEvents.slice(0, 10);

  // Group events by date
  const groupedEvents = useMemo(() => {
    const groups: Record<string, TimelineEvent[]> = {};

    displayedEvents.forEach(event => {
      const date = formatDate(event.timestamp, 'yyyy-MM-dd');
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(event);
    });

    return groups;
  }, [displayedEvents]);

  const formatDateHeader = (dateStr: string) => {
    const todayStr = formatDate(new Date().toISOString(), 'yyyy-MM-dd');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatDate(yesterday.toISOString(), 'yyyy-MM-dd');

    if (dateStr === todayStr) {
      return 'Сегодня';
    }
    if (dateStr === yesterdayStr) {
      return 'Вчера';
    }
    return formatDate(dateStr, 'd MMMM yyyy');
  };

  if (events.length === 0) {
    return (
      <div className="p-6 text-center">
        <HistoryIcon className="w-10 h-10 mx-auto mb-3 text-white/20" />
        <p className="text-white/40 text-sm">Пока нет взаимодействий</p>
        <p className="text-white/20 text-xs mt-1">
          Здесь будет отображаться история сообщений, звонков и изменений
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-lg font-semibold hover:text-white/80 transition-colors"
        >
          {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
          <HistoryIcon size={18} className="text-purple-400" />
          История взаимодействий
          <span className="text-sm font-normal text-white/40">({events.length})</span>
        </button>

        {expanded && (
          <div className="flex items-center gap-2">
            {/* Filter buttons */}
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
              <button
                onClick={() => setFilter(null)}
                className={clsx(
                  'px-2 py-1 text-xs rounded transition-colors',
                  filter === null ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
                )}
              >
                Все
              </button>
              <button
                onClick={() => setFilter('chat_message')}
                className={clsx(
                  'p-1.5 rounded transition-colors',
                  filter === 'chat_message' ? 'bg-blue-500/20 text-blue-400' : 'text-white/40 hover:text-white/60'
                )}
                title="Сообщения"
              >
                <MessageSquare size={14} />
              </button>
              <button
                onClick={() => setFilter('call')}
                className={clsx(
                  'p-1.5 rounded transition-colors',
                  filter === 'call' ? 'bg-green-500/20 text-green-400' : 'text-white/40 hover:text-white/60'
                )}
                title="Звонки"
              >
                <Phone size={14} />
              </button>
              <button
                onClick={() => setFilter('file_upload')}
                className={clsx(
                  'p-1.5 rounded transition-colors',
                  filter === 'file_upload' ? 'bg-purple-500/20 text-purple-400' : 'text-white/40 hover:text-white/60'
                )}
                title="Файлы"
              >
                <FileText size={14} />
              </button>
              <button
                onClick={() => setFilter('vacancy_applied')}
                className={clsx(
                  'p-1.5 rounded transition-colors',
                  filter === 'vacancy_applied' ? 'bg-orange-500/20 text-orange-400' : 'text-white/40 hover:text-white/60'
                )}
                title="Вакансии"
              >
                <Briefcase size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Timeline */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-6"
          >
            {Object.entries(groupedEvents).map(([date, dateEvents]) => (
              <div key={date} className="relative">
                {/* Date header */}
                <div className="flex items-center gap-3 mb-3">
                  <Calendar size={14} className="text-white/30" />
                  <span className="text-sm font-medium text-white/60">
                    {formatDateHeader(date)}
                  </span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>

                {/* Events */}
                <div className="relative pl-6 space-y-3">
                  {/* Timeline line */}
                  <div className="absolute left-[11px] top-2 bottom-2 w-px bg-white/10" />

                  {dateEvents.map((event, idx) => {
                    const config = eventTypeConfig[event.type];
                    const Icon = config.icon;

                    return (
                      <motion.div
                        key={event.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="relative flex items-start gap-3"
                      >
                        {/* Icon */}
                        <div className={clsx(
                          'relative z-10 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center',
                          config.bgColor
                        )}>
                          <Icon size={12} className={config.color} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 pb-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-white truncate">
                                {event.title}
                              </p>
                              {event.description && (
                                <p className="text-xs text-white/50 mt-0.5 line-clamp-2">
                                  {event.description}
                                </p>
                              )}
                            </div>
                            <span className="text-xs text-white/30 flex-shrink-0">
                              {formatDate(event.timestamp, 'HH:mm')}
                            </span>
                          </div>

                          {/* Additional metadata */}
                          {(() => {
                            const sender = event.metadata?.sender;
                            if (sender && typeof sender === 'string') {
                              return (
                                <div className="flex items-center gap-1 mt-1 text-xs text-white/30">
                                  <User size={10} />
                                  {sender}
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Show more button */}
            {filteredEvents.length > 10 && !showAllEvents && (
              <button
                onClick={() => setShowAllEvents(true)}
                className="w-full py-3 text-center text-sm text-purple-400 hover:text-purple-300 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
              >
                Показать ещё {filteredEvents.length - 10} событий
              </button>
            )}

            {showAllEvents && filteredEvents.length > 10 && (
              <button
                onClick={() => setShowAllEvents(false)}
                className="w-full py-2 text-center text-xs text-white/40 hover:text-white/60 transition-colors"
              >
                Свернуть
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
