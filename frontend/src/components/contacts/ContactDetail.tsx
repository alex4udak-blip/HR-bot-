import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
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
  User
} from 'lucide-react';
import clsx from 'clsx';
import type { EntityWithRelations } from '@/types';
import { STATUS_LABELS, STATUS_COLORS, CALL_STATUS_LABELS, CALL_STATUS_COLORS } from '@/types';
import EntityAI from './EntityAI';

interface ContactDetailProps {
  entity: EntityWithRelations;
}

export default function ContactDetail({ entity }: ContactDetailProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'overview' | 'chats' | 'calls' | 'history'>('overview');

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
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-cyan-500/30 to-purple-500/30 flex items-center justify-center">
            <User size={32} className="text-white" />
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold text-white">{entity.name}</h2>
              <span className={clsx('text-sm px-3 py-1 rounded-full', STATUS_COLORS[entity.status])}>
                {STATUS_LABELS[entity.status]}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              {entity.email && (
                <a
                  href={`mailto:${entity.email}`}
                  className="flex items-center gap-2 text-white/60 hover:text-cyan-400 transition-colors"
                >
                  <Mail size={16} />
                  {entity.email}
                </a>
              )}
              {entity.phone && (
                <a
                  href={`tel:${entity.phone}`}
                  className="flex items-center gap-2 text-white/60 hover:text-cyan-400 transition-colors"
                >
                  <Phone size={16} />
                  {entity.phone}
                </a>
              )}
              {entity.company && (
                <div className="flex items-center gap-2 text-white/60">
                  <Building2 size={16} />
                  {entity.company}
                </div>
              )}
              {entity.position && (
                <div className="flex items-center gap-2 text-white/60">
                  <Briefcase size={16} />
                  {entity.position}
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
      <div className="flex gap-2 mb-6">
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
              'px-4 py-2 rounded-lg text-sm transition-colors',
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
            {/* AI Assistant */}
            <EntityAI entity={entity} />

            <div className="grid grid-cols-2 gap-6 mt-6">
            {/* Recent Chats */}
            <div className="bg-white/5 rounded-xl p-4">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <MessageSquare size={20} className="text-cyan-400" />
                Последние чаты
              </h3>
              {entity.chats && entity.chats.length > 0 ? (
                <div className="space-y-2">
                  {entity.chats.slice(0, 3).map((chat) => (
                    <div
                      key={chat.id}
                      onClick={() => navigate(`/chats/${chat.id}`)}
                      className="p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors flex items-center justify-between"
                    >
                      <div>
                        <p className="text-white font-medium">{chat.title}</p>
                        <p className="text-xs text-white/40">{formatDate(chat.created_at)}</p>
                      </div>
                      <ChevronRight size={16} className="text-white/40" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-white/40 text-sm">Нет связанных чатов</p>
              )}
            </div>

            {/* Recent Calls */}
            <div className="bg-white/5 rounded-xl p-4">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Phone size={20} className="text-green-400" />
                Последние звонки
              </h3>
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
            <div className="bg-white/5 rounded-xl p-4 col-span-2">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <ArrowRightLeft size={20} className="text-purple-400" />
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
                  className="p-4 bg-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-cyan-500/20 rounded-lg">
                      <MessageSquare size={20} className="text-cyan-400" />
                    </div>
                    <div>
                      <p className="text-white font-medium">{chat.title}</p>
                      <p className="text-sm text-white/40">
                        {chat.chat_type} • Создан {formatDate(chat.created_at)}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-white/40" />
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
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-500/20 rounded-lg">
                        <Phone size={20} className="text-green-400" />
                      </div>
                      <div>
                        <p className="text-white font-medium">
                          Звонок {call.source_type.toUpperCase()}
                        </p>
                        <p className="text-sm text-white/40">{formatDate(call.created_at)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full', CALL_STATUS_COLORS[call.status])}>
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
    </div>
  );
}
