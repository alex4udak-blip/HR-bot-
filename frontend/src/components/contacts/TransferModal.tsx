import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, ArrowRightLeft, User, AlertTriangle, MessageSquare, Phone } from 'lucide-react';
import clsx from 'clsx';
import { useEntityStore } from '@/stores/entityStore';
import { getSharableUsers } from '@/services/api';
import type { Entity } from '@/types';
import type { UserSimple } from '@/services/api';

interface TransferModalProps {
  entity: Entity;
  onClose: () => void;
  onSuccess: () => void;
}

export default function TransferModal({ entity, onClose, onSuccess }: TransferModalProps) {
  const { transferEntity, loading } = useEntityStore();
  const [users, setUsers] = useState<UserSimple[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const data = await getSharableUsers();
      setUsers(data);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;

    try {
      await transferEntity(entity.id, selectedUserId, comment || undefined);
      onSuccess();
    } catch {
      // Error handled by store
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-gray-900 rounded-2xl w-full max-w-md max-w-[calc(100%-2rem)] max-h-[90vh] overflow-hidden flex flex-col border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="p-2 bg-purple-500/20 rounded-lg flex-shrink-0">
              <ArrowRightLeft size={20} className="text-purple-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold text-white">Передача контакта</h2>
              <p className="text-sm text-white/60 truncate">{entity.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
          >
            <X size={20} className="text-white/60" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Warning */}
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 flex gap-3">
            <AlertTriangle className="text-yellow-400 flex-shrink-0" size={20} />
            <div className="text-sm text-yellow-200/80">
              <p className="font-medium mb-1">Важно!</p>
              <p>После передачи владельцем станет выбранный пользователь. У вас останется копия, но она не будет обновляться.</p>
            </div>
          </div>

          {/* What will be transferred */}
          {(entity.chats_count || entity.calls_count) && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <p className="text-sm font-medium text-white mb-2">Что будет передано:</p>
              <ul className="space-y-1 text-sm text-white/60">
                <li className="flex items-center gap-2">
                  <User size={14} />
                  Контакт: <span className="text-white">{entity.name}</span>
                </li>
                {entity.chats_count > 0 && (
                  <li className="flex items-center gap-2">
                    <MessageSquare size={14} />
                    Чатов: <span className="text-white">{entity.chats_count}</span>
                  </li>
                )}
                {entity.calls_count > 0 && (
                  <li className="flex items-center gap-2">
                    <Phone size={14} />
                    Звонков: <span className="text-white">{entity.calls_count}</span>
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Select User */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Передать кому</label>
            {loadingUsers ? (
              <div className="flex items-center justify-center py-4">
                <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {users.map((user) => {
                  const roleInfo = [];
                  if (user.org_role) roleInfo.push(user.org_role);
                  if (user.department_name) roleInfo.push(user.department_name);
                  if (user.department_role && user.department_role !== 'member') {
                    roleInfo.push(user.department_role);
                  }

                  return (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => setSelectedUserId(user.id)}
                      className={clsx(
                        'w-full p-3 rounded-lg flex items-center gap-3 transition-colors text-left',
                        selectedUserId === user.id
                          ? 'bg-purple-500/20 border border-purple-500/50'
                          : 'bg-white/5 border border-white/10 hover:bg-white/10'
                      )}
                    >
                      <div className={clsx(
                        'p-2 rounded-full flex-shrink-0',
                        selectedUserId === user.id ? 'bg-purple-500/30' : 'bg-white/10'
                      )}>
                        <User size={16} className={selectedUserId === user.id ? 'text-purple-400' : 'text-white/60'} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium truncate">{user.name}</p>
                        <p className="text-xs text-white/40 truncate">
                          {user.email}
                          {roleInfo.length > 0 && ` • ${roleInfo.join(', ')}`}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Comment */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">
              Комментарий (опционально)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500/50 resize-none"
              rows={3}
              placeholder="Добавьте заметку о передаче..."
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-white/5 text-white/60 rounded-lg hover:bg-white/10 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading || !selectedUserId}
              className="flex-1 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              Передать
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
