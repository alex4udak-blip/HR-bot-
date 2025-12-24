import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone,
  Mail,
  MessageSquare,
  Building2,
  Briefcase,
  ArrowRightLeft,
  Clock,
  FileText,
  ChevronRight,
  Tag,
  User,
  Link2,
  X,
  Loader2
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import type { EntityWithRelations, Chat, CallRecording } from '@/types';
import { STATUS_LABELS, STATUS_COLORS, CALL_STATUS_LABELS, CALL_STATUS_COLORS } from '@/types';
import EntityAI from './EntityAI';
import * as api from '@/services/api';
import { useEntityStore } from '@/stores/entityStore';

interface ContactDetailProps {
  entity: EntityWithRelations;
  showAIInOverview?: boolean;
}

export default function ContactDetail({ entity, showAIInOverview = true }: ContactDetailProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'overview' | 'chats' | 'calls' | 'history'>('overview');
  const [showLinkChatModal, setShowLinkChatModal] = useState(false);
  const [showLinkCallModal, setShowLinkCallModal] = useState(false);
  const [unlinkedChats, setUnlinkedChats] = useState<Chat[]>([]);
  const [unlinkedCalls, setUnlinkedCalls] = useState<CallRecording[]>([]);
  const [loadingLink, setLoadingLink] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const { fetchEntity } = useEntityStore();

  // Load unlinked chats when modal opens
  useEffect(() => {
    if (showLinkChatModal) {
      loadUnlinkedChats();
    }
  }, [showLinkChatModal]);

  // Load unlinked calls when modal opens
  useEffect(() => {
    if (showLinkCallModal) {
      loadUnlinkedCalls();
    }
  }, [showLinkCallModal]);

  const loadUnlinkedChats = async () => {
    setLoadingData(true);
    try {
      const allChats = await api.getChats();
      setUnlinkedChats(allChats.filter(c => !c.entity_id));
    } catch (e) {
      console.error('Failed to load chats:', e);
    } finally {
      setLoadingData(false);
    }
  };

  const loadUnlinkedCalls = async () => {
    setLoadingData(true);
    try {
      const allCalls = await api.getCalls({});
      setUnlinkedCalls(allCalls.filter(c => !c.entity_id));
    } catch (e) {
      console.error('Failed to load calls:', e);
    } finally {
      setLoadingData(false);
    }
  };

  const handleLinkChat = async (chatId: number) => {
    setLoadingLink(true);
    try {
      await api.linkChatToEntity(entity.id, chatId);
      toast.success('Чат привязан к контакту');
      setShowLinkChatModal(false);
      fetchEntity(entity.id);
    } catch (e) {
      toast.error('Не удалось привязать чат');
    } finally {
      setLoadingLink(false);
    }
  };

  const handleLinkCall = async (callId: number) => {
    setLoadingLink(true);
    try {
      await api.linkCallToEntity(callId, entity.id);
      toast.success('Звонок привязан к контакту');
      setShowLinkCallModal(false);
      fetchEntity(entity.id);
    } catch (e) {
      toast.error('Не удалось привязать звонок');
    } finally {
      setLoadingLink(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="p-6">
      {/* Contact Info Card */}
      <div className="bg-white/5 rounded-xl p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 aspect-square rounded-xl bg-gradient-to-br from-cyan-500/30 to-purple-500/30 flex items-center justify-center flex-shrink-0">
            <User size={32} className="text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold text-white truncate">{entity.name}</h2>
              <span className={clsx('text-sm px-3 py-1 rounded-full flex-shrink-0 whitespace-nowrap', STATUS_COLORS[entity.status])}>
                {STATUS_LABELS[entity.status]}
              </span>
            </div>

            {/* Transferred entity indicator */}
            {entity.is_transferred && (
              <div className="mb-4 p-3 bg-orange-500/20 border border-orange-500/30 rounded-lg">
                <div className="flex items-center gap-2 text-orange-300">
                  <ArrowRightLeft size={16} className="flex-shrink-0" />
                  <span className="text-sm font-medium">
                    Контакт передан → {entity.transferred_to_name || 'другому пользователю'}
                  </span>
                </div>
                {entity.transferred_at && (
                  <p className="text-xs text-orange-300/70 mt-1 ml-6">
                    {formatDate(entity.transferred_at)}
                  </p>
                )}
                <p className="text-xs text-orange-300/70 mt-1 ml-6">
                  Это копия только для просмотра. Редактирование недоступно.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {entity.email && (
                <a
                  href={`mailto:${entity.email}`}
                  className="flex items-center gap-2 text-white/60 hover:text-cyan-400 transition-colors min-w-0"
                >
                  <Mail size={16} className="flex-shrink-0" />
                  <span className="truncate">{entity.email}</span>
                </a>
              )}
              {entity.phone && (
                <a
                  href={`tel:${entity.phone}`}
                  className="flex items-center gap-2 text-white/60 hover:text-cyan-400 transition-colors min-w-0"
                >
                  <Phone size={16} className="flex-shrink-0" />
                  <span className="truncate">{entity.phone}</span>
                </a>
              )}
              {entity.company && (
                <div className="flex items-center gap-2 text-white/60 min-w-0">
                  <Building2 size={16} className="flex-shrink-0" />
                  <span className="truncate">{entity.company}</span>
                </div>
              )}
              {entity.position && (
                <div className="flex items-center gap-2 text-white/60 min-w-0">
                  <Briefcase size={16} className="flex-shrink-0" />
                  <span className="truncate">{entity.position}</span>
                </div>
              )}
            </div>

            {entity.tags && entity.tags.length > 0 && (
              <div className="flex items-center gap-2 mt-4">
                <Tag size={16} className="text-white/40" />
                <div className="flex flex-wrap gap-2">
                  {entity.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 bg-white/10 text-white/60 text-xs rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[
          { id: 'overview', label: 'Обзор' },
          { id: 'chats', label: `Чаты (${entity.chats?.length || 0})` },
          { id: 'calls', label: `Звонки (${entity.calls?.length || 0})` },
          { id: 'history', label: 'История' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={clsx(
              'px-4 py-2 rounded-lg text-sm transition-colors whitespace-nowrap',
              activeTab === tab.id
                ? 'bg-cyan-500/20 text-cyan-400'
                : 'bg-white/5 text-white/60 hover:bg-white/10'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {activeTab === 'overview' && (
          <>
            {/* AI Assistant - only show if showAIInOverview is true */}
            {showAIInOverview && <EntityAI entity={entity} />}

            <div className={clsx("grid grid-cols-1 xl:grid-cols-2 gap-4", showAIInOverview && "mt-6")}>
            {/* Recent Chats */}
            <div className="bg-white/5 rounded-xl p-4">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h3 className="text-base font-semibold text-white flex items-center gap-2 min-w-0">
                  <MessageSquare size={18} className="text-cyan-400 flex-shrink-0" />
                  <span className="truncate">Последние чаты</span>
                </h3>
                <button
                  onClick={() => setShowLinkChatModal(true)}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors flex-shrink-0 whitespace-nowrap"
                >
                  <Link2 size={12} />
                  Привязать
                </button>
              </div>
              {entity.chats && entity.chats.length > 0 ? (
                <div className="space-y-2">
                  {entity.chats.slice(0, 3).map((chat) => (
                    <div
                      key={chat.id}
                      onClick={() => navigate(`/chats/${chat.id}`)}
                      className="p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium truncate">{chat.title}</p>
                        <p className="text-xs text-white/40 truncate">{formatDate(chat.created_at)}</p>
                      </div>
                      <ChevronRight size={16} className="text-white/40 flex-shrink-0" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-white/40 text-sm">Нет связанных чатов</p>
              )}
            </div>

            {/* Recent Calls */}
            <div className="bg-white/5 rounded-xl p-4">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h3 className="text-base font-semibold text-white flex items-center gap-2 min-w-0">
                  <Phone size={18} className="text-green-400 flex-shrink-0" />
                  <span className="truncate">Последние звонки</span>
                </h3>
                <button
                  onClick={() => setShowLinkCallModal(true)}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors flex-shrink-0 whitespace-nowrap"
                >
                  <Link2 size={12} />
                  Привязать
                </button>
              </div>
              {entity.calls && entity.calls.length > 0 ? (
                <div className="space-y-2">
                  {entity.calls.slice(0, 3).map((call) => (
                    <div
                      key={call.id}
                      onClick={() => navigate(`/calls/${call.id}`)}
                      className="p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full', CALL_STATUS_COLORS[call.status])}>
                          {CALL_STATUS_LABELS[call.status]}
                        </span>
                        <span className="text-xs text-white/40">
                          {formatDuration(call.duration_seconds)}
                        </span>
                      </div>
                      <p className="text-xs text-white/40">{formatDate(call.created_at)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-white/40 text-sm">Нет записей звонков</p>
              )}
            </div>

            {/* Transfer History */}
            <div className="bg-white/5 rounded-xl p-4 xl:col-span-2">
              <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                <ArrowRightLeft size={18} className="text-purple-400" />
                История передач
              </h3>
              {entity.transfers && entity.transfers.length > 0 ? (
                <div className="space-y-2">
                  {entity.transfers.slice(0, 5).map((transfer) => (
                    <div key={transfer.id} className="p-3 bg-white/5 rounded-lg">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-white/60">{transfer.from_user_name || 'Неизвестно'}</span>
                        <ArrowRightLeft size={14} className="text-white/40" />
                        <span className="text-white">{transfer.to_user_name || 'Неизвестно'}</span>
                      </div>
                      {transfer.comment && (
                        <p className="text-xs text-white/40 mt-1">{transfer.comment}</p>
                      )}
                      <p className="text-xs text-white/30 mt-1">{formatDate(transfer.created_at)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-white/40 text-sm">Нет истории передач</p>
              )}
            </div>
          </div>
          </>
        )}

        {activeTab === 'chats' && (
          <div className="space-y-2">
            {entity.chats && entity.chats.length > 0 ? (
              entity.chats.map((chat) => (
                <motion.div
                  key={chat.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => navigate(`/chats/${chat.id}`)}
                  className="p-4 bg-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-2 bg-cyan-500/20 rounded-lg flex-shrink-0">
                      <MessageSquare size={20} className="text-cyan-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-medium truncate">{chat.title}</p>
                      <p className="text-sm text-white/40 truncate">
                        {chat.chat_type} • Создан {formatDate(chat.created_at)}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-white/40 flex-shrink-0" />
                </motion.div>
              ))
            ) : (
              <div className="text-center py-8 text-white/40">
                <MessageSquare className="mx-auto mb-2" size={40} />
                <p>Нет связанных чатов</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'calls' && (
          <div className="space-y-2">
            {entity.calls && entity.calls.length > 0 ? (
              entity.calls.map((call) => (
                <motion.div
                  key={call.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => navigate(`/calls/${call.id}`)}
                  className="p-4 bg-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="p-2 bg-green-500/20 rounded-lg flex-shrink-0">
                        <Phone size={20} className="text-green-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium truncate">
                          Звонок {call.source_type.toUpperCase()}
                        </p>
                        <p className="text-sm text-white/40 truncate">{formatDate(call.created_at)}</p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full whitespace-nowrap', CALL_STATUS_COLORS[call.status])}>
                        {CALL_STATUS_LABELS[call.status]}
                      </span>
                      <p className="text-sm text-white/60 mt-1">
                        {formatDuration(call.duration_seconds)}
                      </p>
                    </div>
                  </div>
                  {call.summary && (
                    <p className="text-sm text-white/60 line-clamp-2 mt-2">{call.summary}</p>
                  )}
                </motion.div>
              ))
            ) : (
              <div className="text-center py-8 text-white/40">
                <Phone className="mx-auto mb-2" size={40} />
                <p>Нет записей звонков</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-4">
            {/* Transfers */}
            {entity.transfers && entity.transfers.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-white/60 mb-2">Передачи</h4>
                <div className="space-y-2">
                  {entity.transfers.map((transfer) => (
                    <div key={transfer.id} className="p-3 bg-white/5 rounded-lg flex items-start gap-3">
                      <div className="p-2 bg-purple-500/20 rounded-lg">
                        <ArrowRightLeft size={16} className="text-purple-400" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-white/60">{transfer.from_user_name}</span>
                          <span className="text-white/30">→</span>
                          <span className="text-white">{transfer.to_user_name}</span>
                        </div>
                        {transfer.comment && (
                          <p className="text-xs text-white/50 mt-1">{transfer.comment}</p>
                        )}
                        <p className="text-xs text-white/30 mt-1">{formatDate(transfer.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Analyses */}
            {entity.analyses && entity.analyses.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-white/60 mb-2">Анализы</h4>
                <div className="space-y-2">
                  {entity.analyses.map((analysis) => (
                    <div key={analysis.id} className="p-3 bg-white/5 rounded-lg flex items-start gap-3">
                      <div className="p-2 bg-cyan-500/20 rounded-lg">
                        <FileText size={16} className="text-cyan-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-white font-medium">
                          {analysis.report_type || 'Анализ'}
                        </p>
                        {analysis.result && (
                          <p className="text-xs text-white/50 mt-1 line-clamp-2">{analysis.result}</p>
                        )}
                        <p className="text-xs text-white/30 mt-1">{formatDate(analysis.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(!entity.transfers || entity.transfers.length === 0) &&
              (!entity.analyses || entity.analyses.length === 0) && (
                <div className="text-center py-8 text-white/40">
                  <Clock className="mx-auto mb-2" size={40} />
                  <p>История пуста</p>
                </div>
              )}
          </div>
        )}
      </div>

      {/* Link Chat Modal */}
      <AnimatePresence>
        {showLinkChatModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={() => setShowLinkChatModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-md max-w-[calc(100%-2rem)] max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="text-lg font-semibold text-white">Привязать чат</h3>
                <button
                  onClick={() => setShowLinkChatModal(false)}
                  className="p-1 rounded-lg hover:bg-white/10"
                >
                  <X size={20} className="text-white/60" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 max-h-[60vh]">
                {loadingData ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
                  </div>
                ) : unlinkedChats.length === 0 ? (
                  <div className="text-center py-8 text-white/40">
                    <MessageSquare className="mx-auto mb-2" size={40} />
                    <p>Нет доступных чатов для привязки</p>
                    <p className="text-sm mt-1">Все чаты уже привязаны к контактам</p>
                  </div>
                ) : (
                  unlinkedChats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => handleLinkChat(chat.id)}
                      disabled={loadingLink}
                      className="w-full p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-left flex items-center justify-between gap-3 disabled:opacity-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium truncate">{chat.title}</p>
                        <p className="text-xs text-white/40 truncate">{chat.chat_type} • {formatDate(chat.created_at)}</p>
                      </div>
                      {loadingLink ? (
                        <Loader2 size={16} className="text-cyan-400 animate-spin flex-shrink-0" />
                      ) : (
                        <Link2 size={16} className="text-cyan-400 flex-shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Link Call Modal */}
      <AnimatePresence>
        {showLinkCallModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={() => setShowLinkCallModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-md max-w-[calc(100%-2rem)] max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="text-lg font-semibold text-white">Привязать звонок</h3>
                <button
                  onClick={() => setShowLinkCallModal(false)}
                  className="p-1 rounded-lg hover:bg-white/10"
                >
                  <X size={20} className="text-white/60" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 max-h-[60vh]">
                {loadingData ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-green-400 animate-spin" />
                  </div>
                ) : unlinkedCalls.length === 0 ? (
                  <div className="text-center py-8 text-white/40">
                    <Phone className="mx-auto mb-2" size={40} />
                    <p>Нет доступных звонков для привязки</p>
                    <p className="text-sm mt-1">Все звонки уже привязаны к контактам</p>
                  </div>
                ) : (
                  unlinkedCalls.map((call) => (
                    <button
                      key={call.id}
                      onClick={() => handleLinkCall(call.id)}
                      disabled={loadingLink}
                      className="w-full p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-left flex items-center justify-between gap-3 disabled:opacity-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium truncate">
                          Звонок {call.source_type?.toUpperCase() || 'N/A'}
                        </p>
                        <p className="text-xs text-white/40 truncate">
                          {formatDuration(call.duration_seconds)} • {formatDate(call.created_at)}
                        </p>
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full mt-1 inline-block whitespace-nowrap', CALL_STATUS_COLORS[call.status])}>
                          {CALL_STATUS_LABELS[call.status]}
                        </span>
                      </div>
                      {loadingLink ? (
                        <Loader2 size={16} className="text-green-400 animate-spin flex-shrink-0" />
                      ) : (
                        <Link2 size={16} className="text-green-400 flex-shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
