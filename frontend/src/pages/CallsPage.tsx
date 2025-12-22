import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone,
  Upload,
  Video,
  Clock,
  ChevronLeft,
  RefreshCw,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useCallStore } from '@/stores/callStore';
import type { CallStatus, CallRecording } from '@/types';
import { CALL_STATUS_LABELS, CALL_STATUS_COLORS } from '@/types';
import CallRecorderModal from '@/components/calls/CallRecorderModal';
import CallDetail from '@/components/calls/CallDetail';

export default function CallsPage() {
  const { callId } = useParams();
  const navigate = useNavigate();
  const [showRecorderModal, setShowRecorderModal] = useState(false);

  const {
    calls,
    currentCall,
    activeRecording,
    loading,
    fetchCalls,
    fetchCall,
    deleteCall,
    reprocessCall,
    stopRecording,
    clearActiveRecording
  } = useCallStore();

  useEffect(() => {
    fetchCalls();
  }, []);

  useEffect(() => {
    if (callId) {
      fetchCall(parseInt(callId));
    }
  }, [callId]);

  const handleSelectCall = (id: number) => {
    navigate(`/calls/${id}`);
  };

  const handleBack = () => {
    navigate('/calls');
  };

  const handleDelete = async (call: CallRecording) => {
    if (!confirm('Вы уверены, что хотите удалить эту запись?')) return;

    try {
      await deleteCall(call.id);
      toast.success('Запись удалена');
      if (currentCall?.id === call.id) {
        navigate('/calls');
      }
    } catch {
      toast.error('Не удалось удалить запись');
    }
  };

  const handleReprocess = async (call: CallRecording) => {
    try {
      await reprocessCall(call.id);
      toast.success('Переобработка запущена');
    } catch {
      toast.error('Не удалось запустить переобработку');
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ru-RU', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusIcon = (status: CallStatus) => {
    switch (status) {
      case 'done':
        return <CheckCircle size={16} className="text-green-400" />;
      case 'failed':
        return <XCircle size={16} className="text-red-400" />;
      case 'recording':
        return <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />;
      default:
        return <Loader2 size={16} className="text-cyan-400 animate-spin" />;
    }
  };

  return (
    <div className="h-full flex">
      {/* Sidebar - Call List */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className={clsx(
          'flex-shrink-0 border-r border-white/5 flex flex-col bg-black/20',
          currentCall ? 'w-80' : 'w-full max-w-2xl'
        )}
      >
        {/* Header */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-semibold text-white">Записи звонков</h1>
            <button
              onClick={() => setShowRecorderModal(true)}
              className="px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors flex items-center gap-2"
            >
              <Phone size={18} />
              Новая запись
            </button>
          </div>

          {/* Active Recording Status */}
          <AnimatePresence>
            {activeRecording && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-gradient-to-r from-cyan-500/20 to-purple-500/20 rounded-xl p-4 border border-cyan-500/30"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">
                    {activeRecording.status === 'recording' ? 'Запись идёт' : 'Обработка...'}
                  </span>
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full', CALL_STATUS_COLORS[activeRecording.status])}>
                    {CALL_STATUS_LABELS[activeRecording.status]}
                  </span>
                </div>

                {activeRecording.status === 'recording' && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                      <span className="text-sm text-white/60">
                        {formatDuration(activeRecording.duration)}
                      </span>
                    </div>
                    <button
                      onClick={stopRecording}
                      className="px-3 py-1 bg-red-500/20 text-red-400 rounded-lg text-sm hover:bg-red-500/30 transition-colors"
                    >
                      Остановить
                    </button>
                  </div>
                )}

                {activeRecording.error && (
                  <p className="text-sm text-red-400 mt-2">{activeRecording.error}</p>
                )}

                {(activeRecording.status === 'done' || activeRecording.status === 'failed') && (
                  <button
                    onClick={clearActiveRecording}
                    className="text-xs text-white/40 hover:text-white/60 mt-2"
                  >
                    Скрыть
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Call List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && calls.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : calls.length === 0 ? (
            <div className="text-center py-8 text-white/40">
              <Phone className="mx-auto mb-2" size={40} />
              <p>Нет записей звонков</p>
              <button
                onClick={() => setShowRecorderModal(true)}
                className="mt-4 px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors"
              >
                Записать первый звонок
              </button>
            </div>
          ) : (
            calls.map((call) => {
              const isSelected = currentCall?.id === call.id;

              return (
                <motion.div
                  key={call.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => handleSelectCall(call.id)}
                  className={clsx(
                    'p-4 rounded-xl cursor-pointer transition-all group',
                    isSelected
                      ? 'bg-cyan-500/20 border border-cyan-500/30'
                      : 'bg-white/5 border border-white/5 hover:bg-white/10'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={clsx(
                      'p-2 rounded-lg',
                      isSelected ? 'bg-cyan-500/30' : 'bg-white/10'
                    )}>
                      {call.source_type === 'upload' ? (
                        <Upload size={20} className={isSelected ? 'text-cyan-400' : 'text-white/60'} />
                      ) : call.source_type === 'meet' || call.source_type === 'zoom' ? (
                        <Video size={20} className={isSelected ? 'text-cyan-400' : 'text-white/60'} />
                      ) : (
                        <Phone size={20} className={isSelected ? 'text-cyan-400' : 'text-white/60'} />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusIcon(call.status)}
                        <span className="text-sm font-medium text-white truncate">
                          {call.title || call.entity_name || 'Звонок ' + call.source_type.toUpperCase()}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-white/40">
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {formatDuration(call.duration_seconds)}
                        </span>
                        <span>{formatDate(call.created_at)}</span>
                        {call.entity_name && call.title && (
                          <span className="text-cyan-400/60">• {call.entity_name}</span>
                        )}
                      </div>

                      {call.summary && (
                        <p className="text-xs text-white/50 mt-2 line-clamp-2">{call.summary}</p>
                      )}
                    </div>

                    {/* Quick Actions */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                      {call.status === 'failed' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReprocess(call);
                          }}
                          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/60"
                          title="Переобработать"
                        >
                          <RefreshCw size={14} />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(call);
                        }}
                        className="p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </motion.div>

      {/* Main Content - Call Detail */}
      <AnimatePresence mode="wait">
        {currentCall && (
          <motion.div
            key={currentCall.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="flex-1 flex flex-col"
          >
            {/* Header */}
            <div className="p-4 border-b border-white/5 flex items-center gap-4">
              <button
                onClick={handleBack}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
              >
                <ChevronLeft size={20} className="text-white/60" />
              </button>
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-white">
                  {currentCall.title || currentCall.entity_name || 'Звонок ' + currentCall.source_type.toUpperCase()}
                </h2>
                <p className="text-sm text-white/60">
                  {formatDate(currentCall.created_at)} • {formatDuration(currentCall.duration_seconds)}
                  {currentCall.entity_name && currentCall.title && ` • ${currentCall.entity_name}`}
                </p>
              </div>
              <span className={clsx('px-3 py-1 rounded-full text-sm', CALL_STATUS_COLORS[currentCall.status])}>
                {CALL_STATUS_LABELS[currentCall.status]}
              </span>
            </div>

            {/* Detail Content */}
            <div className="flex-1 overflow-y-auto">
              <CallDetail call={currentCall} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recorder Modal */}
      <AnimatePresence>
        {showRecorderModal && (
          <CallRecorderModal
            onClose={() => setShowRecorderModal(false)}
            onSuccess={() => {
              setShowRecorderModal(false);
              toast.success('Recording started');
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
