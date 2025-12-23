import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Share2, Users, Loader2, Trash2, Eye, Edit3, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import * as api from '@/services/api';
import type { ResourceType, AccessLevel, ShareResponse, UserSimple } from '@/services/api';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  resourceType: ResourceType;
  resourceId: number;
  resourceName: string;
}

const ACCESS_LEVELS: { id: AccessLevel; label: string; icon: typeof Eye; description: string }[] = [
  { id: 'view', label: 'Просмотр', icon: Eye, description: 'Только просмотр' },
  { id: 'edit', label: 'Редактирование', icon: Edit3, description: 'Просмотр и редактирование' },
  { id: 'full', label: 'Полный', icon: Shield, description: 'Полный доступ + может делиться' },
];

export default function ShareModal({ isOpen, onClose, resourceType, resourceId, resourceName }: ShareModalProps) {
  const [users, setUsers] = useState<UserSimple[]>([]);
  const [shares, setShares] = useState<ShareResponse[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('view');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, resourceType, resourceId]);

  const loadData = async () => {
    setLoadingUsers(true);
    try {
      const [usersData, sharesData] = await Promise.all([
        api.getSharableUsers(),
        api.getResourceShares(resourceType, resourceId)
      ]);
      setUsers(usersData);
      setShares(sharesData);
    } catch (e) {
      console.error('Failed to load sharing data:', e);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleShare = async () => {
    if (!selectedUserId) {
      toast.error('Выберите пользователя');
      return;
    }

    setLoading(true);
    try {
      await api.shareResource({
        resource_type: resourceType,
        resource_id: resourceId,
        shared_with_id: selectedUserId,
        access_level: accessLevel,
        note: note || undefined
      });
      toast.success('Доступ предоставлен');
      setSelectedUserId(null);
      setNote('');
      loadData();
    } catch (e) {
      toast.error('Не удалось предоставить доступ');
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (shareId: number) => {
    if (!confirm('Отозвать доступ?')) return;

    try {
      await api.revokeShare(shareId);
      toast.success('Доступ отозван');
      loadData();
    } catch (e) {
      toast.error('Не удалось отозвать доступ');
    }
  };

  const getResourceTypeLabel = (type: ResourceType) => {
    switch (type) {
      case 'chat': return 'чат';
      case 'entity': return 'контакт';
      case 'call': return 'звонок';
    }
  };

  // Filter out users who already have access
  const availableUsers = users.filter(u => !shares.find(s => s.shared_with_id === u.id));

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-lg max-w-[calc(100%-2rem)] max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-cyan-500/20 rounded-lg">
                <Share2 className="text-cyan-400" size={20} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Поделиться</h3>
                <p className="text-sm text-white/60">{resourceName}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/60"
            >
              <X size={20} />
            </button>
          </div>

          {loadingUsers ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
            </div>
          ) : (
            <>
              {/* Add new share */}
              <div className="bg-white/5 rounded-xl p-4 mb-6 flex-shrink-0">
                <h4 className="text-sm font-medium text-white mb-3">Добавить доступ</h4>

                {availableUsers.length === 0 ? (
                  <p className="text-sm text-white/40">Нет доступных пользователей для шаринга</p>
                ) : (
                  <>
                    {/* User selection */}
                    <select
                      value={selectedUserId || ''}
                      onChange={(e) => setSelectedUserId(e.target.value ? Number(e.target.value) : null)}
                      className="w-full p-2 bg-white/5 border border-white/10 rounded-lg text-white mb-3"
                    >
                      <option value="">Выберите пользователя...</option>
                      {availableUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name} ({user.email})
                        </option>
                      ))}
                    </select>

                    {/* Access level */}
                    <div className="flex gap-2 mb-3">
                      {ACCESS_LEVELS.map((level) => {
                        const Icon = level.icon;
                        return (
                          <button
                            key={level.id}
                            onClick={() => setAccessLevel(level.id)}
                            className={clsx(
                              'flex-1 p-2 rounded-lg border transition-colors text-sm',
                              accessLevel === level.id
                                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
                                : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                            )}
                          >
                            <Icon size={16} className="mx-auto mb-1" />
                            {level.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Note */}
                    <input
                      type="text"
                      placeholder="Комментарий (опционально)"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="w-full p-2 bg-white/5 border border-white/10 rounded-lg text-white mb-3 placeholder-white/40"
                    />

                    {/* Share button */}
                    <button
                      onClick={handleShare}
                      disabled={!selectedUserId || loading}
                      className="w-full py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Share2 size={16} />
                      )}
                      Поделиться
                    </button>
                  </>
                )}
              </div>

              {/* Current shares */}
              <div className="flex-1 overflow-y-auto min-h-0">
                <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                  <Users size={16} />
                  Кому доступен этот {getResourceTypeLabel(resourceType)}
                </h4>

                {shares.length === 0 ? (
                  <p className="text-sm text-white/40 text-center py-4">
                    Пока никому не предоставлен доступ
                  </p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {shares.map((share) => {
                      const level = ACCESS_LEVELS.find(l => l.id === share.access_level);
                      const LevelIcon = level?.icon || Eye;
                      return (
                        <div
                          key={share.id}
                          className="p-3 bg-white/5 rounded-lg flex items-center justify-between"
                        >
                          <div>
                            <p className="text-white font-medium">{share.shared_with_name}</p>
                            <div className="flex items-center gap-2 text-xs text-white/40">
                              <LevelIcon size={12} />
                              {level?.label}
                              {share.note && <span>• {share.note}</span>}
                            </div>
                          </div>
                          <button
                            onClick={() => handleRevoke(share.id)}
                            className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400"
                            title="Отозвать доступ"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
