import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import * as Tabs from '@radix-ui/react-tabs';
import {
  MessageSquare,
  Users,
  Settings,
  FileText,
  Download,
  Edit3,
  Check,
  X,
  File,
  Image,
  FileSpreadsheet,
  Presentation,
  Archive,
  Mail,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  UserCheck,
  FolderKanban,
  Building2,
  Briefcase,
  DollarSign,
  Headphones,
  MoreHorizontal,
  Trash2,
  Loader2,
  Upload,
  Mic
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Chat, Message, ChatTypeId } from '@/types';
import { getMessages, getParticipants, updateChat, deleteChat, downloadReport, transcribeMessage } from '@/services/api';
import CriteriaPanel from './CriteriaPanel';
import ImportHistoryModal from './ImportHistoryModal';
import toast from 'react-hot-toast';
import clsx from 'clsx';

// Helper to get file URL with auth token (img/video tags can't send headers)
const getFileUrl = (fileId: string) => {
  const token = localStorage.getItem('token');
  return `/api/chats/file/${fileId}${token ? `?token=${token}` : ''}`;
};

// Helper to get local file URL for imported media
const getLocalFileUrl = (filePath: string) => {
  const token = localStorage.getItem('token');
  // filePath format: "uploads/{chat_id}/{filename}"
  // Convert to: "/api/chats/local/{chat_id}/{filename}"
  const parts = filePath.replace('uploads/', '').split('/');
  if (parts.length >= 2) {
    const chatId = parts[0];
    const filename = parts.slice(1).join('/');
    return `/api/chats/local/${chatId}/${filename}${token ? `?token=${token}` : ''}`;
  }
  return '';
};

// Get media URL for a message (either from Telegram or local import)
const getMediaUrl = (message: { file_id?: string; file_path?: string }) => {
  if (message.file_id) {
    return getFileUrl(message.file_id);
  }
  if (message.file_path) {
    return getLocalFileUrl(message.file_path);
  }
  return '';
};

// Chat type options
const CHAT_TYPES: { id: ChatTypeId; name: string; icon: typeof UserCheck }[] = [
  { id: 'work', name: 'Рабочий чат', icon: MessageSquare },
  { id: 'hr', name: 'HR / Кандидаты', icon: UserCheck },
  { id: 'project', name: 'Проект', icon: FolderKanban },
  { id: 'client', name: 'Клиент', icon: Building2 },
  { id: 'contractor', name: 'Подрядчик', icon: Briefcase },
  { id: 'sales', name: 'Продажи', icon: DollarSign },
  { id: 'support', name: 'Поддержка', icon: Headphones },
  { id: 'custom', name: 'Другое', icon: MoreHorizontal },
];

// File type icon mapping
const getFileIcon = (contentType: string, fileName?: string) => {
  const ext = fileName?.split('.').pop()?.toLowerCase();

  if (contentType === 'photo' || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'].includes(ext || '')) {
    return Image;
  }
  if (['xlsx', 'xls', 'csv', 'ods'].includes(ext || '')) {
    return FileSpreadsheet;
  }
  if (['pptx', 'ppt', 'odp'].includes(ext || '')) {
    return Presentation;
  }
  if (['zip', 'rar', '7z'].includes(ext || '')) {
    return Archive;
  }
  if (['eml', 'msg'].includes(ext || '')) {
    return Mail;
  }
  return FileText;
};

// Parse status badge
const ParseStatusBadge = ({ status, error }: { status?: string; error?: string }) => {
  if (!status) return null;

  const config = {
    parsed: { icon: CheckCircle, color: 'bg-green-500/20 text-green-400', label: 'Parsed' },
    partial: { icon: AlertTriangle, color: 'bg-yellow-500/20 text-yellow-400', label: 'Partial' },
    failed: { icon: XCircle, color: 'bg-red-500/20 text-red-400', label: 'Failed' },
    skipped: { icon: AlertTriangle, color: 'bg-gray-500/20 text-gray-400', label: 'Skipped' },
  }[status] || { icon: File, color: 'bg-gray-500/20 text-gray-400', label: status };

  const Icon = config.icon;

  return (
    <span
      className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs', config.color)}
      title={error}
    >
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
};

// Document message component
const DocumentMessage = ({ message }: { message: Message }) => {
  const [expanded, setExpanded] = useState(false);
  const FileIcon = getFileIcon(message.content_type, message.file_name);
  const meta = message.document_metadata;

  const preview = message.content.length > 300
    ? message.content.substring(0, 300) + '...'
    : message.content;

  const hasFullContent = message.content.length > 300;

  return (
    <div className="space-y-2">
      {/* Document header */}
      <div className="flex items-start gap-3 p-3 glass rounded-lg">
        <div className="p-2 rounded-lg bg-accent-500/20">
          <FileIcon className="w-5 h-5 text-accent-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{message.file_name}</span>
            {meta?.file_type && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-dark-700 text-dark-300 uppercase">
                {meta.file_type}
              </span>
            )}
            <ParseStatusBadge status={message.parse_status} error={message.parse_error} />
          </div>
          {/* Metadata */}
          <div className="flex flex-wrap gap-3 mt-1 text-xs text-dark-500">
            {meta?.file_size && (
              <span>{(meta.file_size / 1024).toFixed(1)} KB</span>
            )}
            {meta?.pages_count && (
              <span>{meta.pages_count} pages</span>
            )}
            {meta?.sheets_count && (
              <span>{meta.sheets_count} sheets</span>
            )}
            {meta?.slides_count && (
              <span>{meta.slides_count} slides</span>
            )}
            {meta?.tables_count && meta.tables_count > 0 && (
              <span>{meta.tables_count} tables</span>
            )}
            {meta?.extracted_files && (
              <span>{meta.extracted_files.length} files</span>
            )}
          </div>
        </div>
      </div>

      {/* Content preview */}
      {message.parse_status === 'parsed' && message.content && !message.content.startsWith('[') && (
        <div className="pl-4 border-l-2 border-accent-500/30">
          <p className="text-sm text-dark-300 whitespace-pre-wrap">
            {expanded ? message.content : preview}
          </p>
          {hasFullContent && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 mt-2 text-xs text-accent-400 hover:text-accent-300"
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3 h-3" />
                  Свернуть
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />
                  Показать полностью
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

interface ChatDetailProps {
  chat: Chat;
}

export default function ChatDetail({ chat }: ChatDetailProps) {
  const [activeTab, setActiveTab] = useState('messages');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(chat.custom_name || chat.title);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState<string | null>(null);
  const [transcribingMessageId, setTranscribingMessageId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], isLoading: loadingMessages } = useQuery({
    queryKey: ['messages', chat.id],
    queryFn: () => getMessages(chat.id),
  });

  const { data: participants = [], isLoading: loadingParticipants } = useQuery({
    queryKey: ['participants', chat.id],
    queryFn: () => getParticipants(chat.id),
  });

  // Scroll to bottom when messages load
  useEffect(() => {
    if (messages.length > 0 && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const updateNameMutation = useMutation({
    mutationFn: (name: string) => updateChat(chat.id, { custom_name: name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      setIsEditing(false);
      toast.success('Название обновлено');
    },
  });

  const updateTypeMutation = useMutation({
    mutationFn: (chatType: ChatTypeId) => updateChat(chat.id, { chat_type: chatType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setShowTypeDropdown(false);
      toast.success('Тип чата изменён');
    },
  });

  const deleteChatMutation = useMutation({
    mutationFn: () => deleteChat(chat.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      toast.success('Чат удалён');
      navigate('/chats');
    },
    onError: () => {
      toast.error('Ошибка удаления чата');
    },
  });

  const handleDownloadReport = async (format: string) => {
    if (downloadingReport) return;

    setDownloadingReport(format);
    try {
      const blob = await downloadReport(chat.id, 'full_analysis', format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${chat.id}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Отчёт скачан');
    } catch {
      toast.error('Ошибка скачивания');
    } finally {
      setDownloadingReport(null);
    }
  };

  const handleTranscribe = async (messageId: number) => {
    if (transcribingMessageId) return;

    setTranscribingMessageId(messageId);
    try {
      const result = await transcribeMessage(messageId);
      if (result.success) {
        toast.success('Транскрипция завершена');
        queryClient.invalidateQueries({ queryKey: ['messages', chat.id] });
      }
    } catch {
      toast.error('Ошибка транскрипции');
    } finally {
      setTranscribingMessageId(null);
    }
  };

  const formatTime = (dateString: string) => {
    // Ensure timestamp is parsed as UTC
    const utcDate = dateString.endsWith('Z') ? dateString : dateString + 'Z';
    const date = new Date(utcDate);
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const tabs = [
    { id: 'messages', label: 'Сообщения', icon: MessageSquare },
    { id: 'participants', label: 'Участники', icon: Users },
    { id: 'criteria', label: 'Критерии', icon: Settings },
    { id: 'reports', label: 'Отчёты', icon: FileText },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-white/5 hidden lg:block">
        <div className="flex items-center gap-3">
          {isEditing ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 glass-light rounded-lg px-3 py-1.5 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                autoFocus
              />
              <button
                onClick={() => updateNameMutation.mutate(editName)}
                className="p-2 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditName(chat.custom_name || chat.title);
                }}
                className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold flex-1 truncate">
                {chat.custom_name || chat.title}
              </h2>
              <button
                onClick={() => setIsEditing(true)}
                className="p-2 rounded-lg hover:bg-white/5 text-dark-400 hover:text-dark-200"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <p className="text-sm text-dark-400">
            {chat.messages_count} сообщ. | {chat.participants_count} участн.
          </p>

          {/* Chat Type Selector */}
          <div className="relative">
            <button
              onClick={() => setShowTypeDropdown(!showTypeDropdown)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 transition-colors"
            >
              {(() => {
                const typeInfo = CHAT_TYPES.find(t => t.id === chat.chat_type);
                const Icon = typeInfo?.icon || MoreHorizontal;
                return (
                  <>
                    <Icon className="w-3.5 h-3.5" />
                    {typeInfo?.name || chat.chat_type}
                    <ChevronDown className="w-3 h-3" />
                  </>
                );
              })()}
            </button>

            {showTypeDropdown && (
              <div className="absolute top-full left-0 mt-1 w-48 glass rounded-xl border border-white/10 shadow-xl z-50 overflow-hidden">
                {CHAT_TYPES.map((type) => {
                  const Icon = type.icon;
                  const isActive = chat.chat_type === type.id;
                  return (
                    <button
                      key={type.id}
                      onClick={() => updateTypeMutation.mutate(type.id)}
                      disabled={updateTypeMutation.isPending}
                      className={clsx(
                        'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
                        isActive
                          ? 'bg-accent-500/20 text-accent-400'
                          : 'text-dark-200 hover:bg-white/5'
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {type.name}
                      {isActive && <Check className="w-3.5 h-3.5 ml-auto" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Import History Button */}
          <button
            onClick={() => setShowImportModal(true)}
            className="p-1.5 rounded-lg text-dark-400 hover:text-accent-400 hover:bg-accent-500/10 transition-colors"
            title="Загрузить историю"
          >
            <Upload className="w-4 h-4" />
          </button>

          {/* Delete Button */}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-1.5 rounded-lg text-dark-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Удалить чат"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/80">
          <div className="glass rounded-2xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold">Удалить чат?</h3>
                <p className="text-sm text-dark-400">Это действие необратимо</p>
              </div>
            </div>
            <p className="text-sm text-dark-300">
              Будут удалены все сообщения, участники и критерии оценки для чата "{chat.custom_name || chat.title}".
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2 rounded-xl glass-light hover:bg-white/10 text-sm font-medium transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={() => deleteChatMutation.mutate()}
                disabled={deleteChatMutation.isPending}
                className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {deleteChatMutation.isPending ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <Tabs.List className="flex border-b border-white/5 px-4">
          {tabs.map((tab) => (
            <Tabs.Trigger
              key={tab.id}
              value={tab.id}
              className={clsx(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-accent-500 text-accent-400'
                  : 'border-transparent text-dark-400 hover:text-dark-200'
              )}
            >
              <tab.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Messages Tab */}
        <Tabs.Content value="messages" ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4">
          {loadingMessages ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="w-12 h-12 mx-auto text-dark-600 mb-3" />
              <p className="text-dark-400">Сообщений пока нет</p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message, index) => {
                // Only treat actual documents as documents (not photos/stickers/video notes)
                const isDocument = message.content_type === 'document' ||
                  (message.document_metadata && !['photo', 'sticker', 'video_note'].includes(message.content_type));

                return (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className="glass-light rounded-xl p-3"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-full bg-accent-500/20 flex items-center justify-center text-xs font-medium text-accent-400">
                        {(message.first_name?.[0] || message.username?.[0] || '?').toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sm">
                          {message.first_name || message.username || 'Unknown'}
                        </span>
                        {message.username && message.first_name && (
                          <span className="text-dark-500 text-xs ml-1">@{message.username}</span>
                        )}
                      </div>
                      <span className="text-xs text-dark-500">{formatTime(message.timestamp)}</span>
                    </div>

                    {isDocument ? (
                      <DocumentMessage message={message} />
                    ) : message.content_type === 'photo' ? (
                      <div className="space-y-2">
                        {(message.file_id || message.file_path) ? (
                          <img
                            src={getMediaUrl(message)}
                            alt="Photo"
                            className="max-w-xs rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => window.open(getMediaUrl(message), '_blank')}
                            loading="lazy"
                            onError={(e) => {
                              // Hide broken images
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="flex items-center gap-2 text-dark-400">
                            <Image className="w-5 h-5" />
                            <span className="text-sm">[Фото недоступно]</span>
                          </div>
                        )}
                        {message.content && !message.content.startsWith('[Photo') && !message.content.startsWith('[Фото') && (
                          <p className="text-sm text-dark-300">{message.content}</p>
                        )}
                      </div>
                    ) : message.content_type === 'video_note' ? (
                      <div className="space-y-2">
                        {(message.file_id || message.file_path) ? (
                          <video
                            src={getMediaUrl(message)}
                            className="w-32 h-32 rounded-full object-cover cursor-pointer"
                            controls
                            preload="metadata"
                          />
                        ) : (
                          <div className="w-32 h-32 rounded-full bg-dark-700 flex items-center justify-center text-dark-400">
                            <span className="text-xs">Видео</span>
                          </div>
                        )}
                        {message.content && !message.content.startsWith('[Video') && !message.content.startsWith('[Видео') ? (
                          <p className="text-sm text-dark-300">{message.content}</p>
                        ) : message.file_path && (
                          <button
                            onClick={() => handleTranscribe(message.id)}
                            disabled={transcribingMessageId === message.id}
                            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 disabled:opacity-50"
                          >
                            {transcribingMessageId === message.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Mic className="w-3 h-3" />
                            )}
                            Транскрибировать
                          </button>
                        )}
                      </div>
                    ) : message.content_type === 'sticker' ? (
                      <div className="flex items-center gap-2">
                        {(message.file_id || message.file_path) && (
                          <img
                            src={getMediaUrl(message)}
                            alt="Sticker"
                            className="w-32 h-32 object-contain"
                            loading="lazy"
                            onError={(e) => {
                              // Hide broken sticker images (animated .tgs stickers)
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        )}
                        {message.content.includes('[Sticker') || message.content.includes('[Стикер') ? (
                          <span className="text-2xl">{message.content.replace('[Sticker: ', '').replace('[Стикер]', '').replace(']', '')}</span>
                        ) : (
                          <span className="text-2xl">{message.content}</span>
                        )}
                      </div>
                    ) : message.content_type === 'voice' ? (
                      <div className="space-y-2">
                        {(message.file_id || message.file_path) ? (
                          <audio
                            src={getMediaUrl(message)}
                            controls
                            preload="metadata"
                            className="w-full max-w-xs"
                          />
                        ) : (
                          <div className="flex items-center gap-2 text-dark-400">
                            <span className="text-sm">[Голосовое сообщение недоступно]</span>
                          </div>
                        )}
                        {message.content && !message.content.startsWith('[Голосов') && !message.content.startsWith('[Voice') ? (
                          <p className="text-sm text-dark-300">{message.content}</p>
                        ) : message.file_path && (
                          <button
                            onClick={() => handleTranscribe(message.id)}
                            disabled={transcribingMessageId === message.id}
                            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 disabled:opacity-50"
                          >
                            {transcribingMessageId === message.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Mic className="w-3 h-3" />
                            )}
                            Транскрибировать
                          </button>
                        )}
                      </div>
                    ) : message.content_type === 'video' ? (
                      <div className="space-y-2">
                        {(message.file_id || message.file_path) ? (
                          <video
                            src={getMediaUrl(message)}
                            className="max-w-xs rounded-lg"
                            controls
                            preload="metadata"
                          />
                        ) : (
                          <div className="flex items-center gap-2 text-dark-400">
                            <span className="text-sm">[Видео недоступно]</span>
                          </div>
                        )}
                        {message.content && !message.content.startsWith('[Видео') && !message.content.startsWith('[Video') ? (
                          <p className="text-sm text-dark-300">{message.content}</p>
                        ) : message.file_path && (
                          <button
                            onClick={() => handleTranscribe(message.id)}
                            disabled={transcribingMessageId === message.id}
                            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 disabled:opacity-50"
                          >
                            {transcribingMessageId === message.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Mic className="w-3 h-3" />
                            )}
                            Транскрибировать
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-dark-200 whitespace-pre-wrap">{message.content}</p>
                        {message.content_type !== 'text' && (
                          <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full bg-dark-700 text-dark-400">
                            {message.content_type}
                          </span>
                        )}
                      </>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </Tabs.Content>

        {/* Participants Tab */}
        <Tabs.Content value="participants" className="flex-1 overflow-y-auto p-4">
          {loadingParticipants ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : participants.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-12 h-12 mx-auto text-dark-600 mb-3" />
              <p className="text-dark-400">Участников пока нет</p>
            </div>
          ) : (
            <div className="space-y-2">
              {participants.map((participant, index) => (
                <motion.div
                  key={participant.telegram_user_id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center gap-3 glass-light rounded-xl p-3"
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-500/20 to-purple-500/20 flex items-center justify-center font-medium text-accent-400">
                    {(participant.first_name?.[0] || participant.username?.[0] || '?').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {participant.first_name} {participant.last_name}
                    </p>
                    {participant.username && (
                      <p className="text-sm text-dark-400">@{participant.username}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-accent-400">
                      {participant.messages_count}
                    </p>
                    <p className="text-xs text-dark-500">сообщ.</p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </Tabs.Content>

        {/* Criteria Tab */}
        <Tabs.Content value="criteria" className="flex-1 overflow-y-auto">
          <CriteriaPanel chatId={chat.id} />
        </Tabs.Content>

        {/* Reports Tab */}
        <Tabs.Content value="reports" className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            <div className="glass-light rounded-xl p-4">
              <h3 className="font-semibold mb-3">Создать отчёт</h3>
              <p className="text-sm text-dark-400 mb-4">
                Скачайте полный аналитический отчёт по этому чату
              </p>
              {downloadingReport && (
                <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-accent-500/10 text-accent-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Генерация отчёта... Это может занять до минуты</span>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleDownloadReport('pdf')}
                  disabled={!!downloadingReport}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-wait transition-colors"
                >
                  {downloadingReport === 'pdf' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  PDF
                </button>
                <button
                  onClick={() => handleDownloadReport('docx')}
                  disabled={!!downloadingReport}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-wait transition-colors"
                >
                  {downloadingReport === 'docx' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  DOCX
                </button>
                <button
                  onClick={() => handleDownloadReport('markdown')}
                  disabled={!!downloadingReport}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-wait transition-colors"
                >
                  {downloadingReport === 'markdown' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  Markdown
                </button>
              </div>
            </div>
          </div>
        </Tabs.Content>
      </Tabs.Root>

      {/* Import History Modal */}
      <ImportHistoryModal
        chatId={chat.id}
        chatTitle={chat.custom_name || chat.title}
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
      />
    </div>
  );
}
