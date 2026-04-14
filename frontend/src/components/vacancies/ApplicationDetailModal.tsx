import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Save, Star, ExternalLink, Trash2, GraduationCap, Loader2, History, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { useVacancyStore } from '@/stores/vacancyStore';
import { getApplicationHistory } from '@/services/api';
import type { ApplicationHistoryEntry } from '@/services/api/vacancies';
import type { VacancyApplication, ApplicationStage } from '@/types';
import { APPLICATION_STAGE_LABELS } from '@/types';

interface ApplicationDetailModalProps {
  application: VacancyApplication;
  onClose: () => void;
}

export default function ApplicationDetailModal({ application, onClose }: ApplicationDetailModalProps) {
  const navigate = useNavigate();
  const { updateApplication, removeApplication, fetchKanbanBoard, kanbanBoard } = useVacancyStore();
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState(false);

  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details');
  const [history, setHistory] = useState<ApplicationHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'history' && history.length === 0) {
      setHistoryLoading(true);
      getApplicationHistory(application.id)
        .then((data) => setHistory(data))
        .catch(() => { /* silently fail — history is optional */ })
        .finally(() => setHistoryLoading(false));
    }
  }, [activeTab, application.id, history.length]);

  const [formData, setFormData] = useState({
    stage: application.stage,
    rating: application.rating || 0,
    notes: application.notes || '',
    rejection_reason: application.rejection_reason || '',
    next_interview_at: application.next_interview_at
      ? new Date(application.next_interview_at).toISOString().slice(0, 16)
      : ''
  });

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await updateApplication(application.id, {
        stage: formData.stage,
        rating: formData.rating || undefined,
        notes: formData.notes || undefined,
        rejection_reason: formData.rejection_reason || undefined,
        next_interview_at: formData.next_interview_at || undefined
      });

      if (kanbanBoard) {
        fetchKanbanBoard(kanbanBoard.vacancy_id);
      }

      toast.success('Заявка обновлена');
      onClose();
    } catch {
      toast.error('Ошибка при обновлении');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Удалить кандидата из вакансии?')) return;

    setLoading(true);
    try {
      await removeApplication(application.id);
      toast.success('Кандидат удалён из вакансии');
      onClose();
    } catch {
      toast.error('Ошибка при удалении');
    } finally {
      setLoading(false);
    }
  };

  const handleViewCandidate = () => {
    navigate(`/all-candidates?entity=${application.entity_id}`);
    onClose();
  };

  const handleInvitePrometheus = async () => {
    setInviting(true);
    try {
      const resp = await fetch('/api/prometheus/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_id: application.entity_id,
          vacancy_id: kanbanBoard?.vacancy_id,
        }),
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.detail || 'Ошибка при отправке приглашения');
      }
    } catch {
      toast.error('Ошибка сети');
    } finally {
      setInviting(false);
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
        onClick={(e) => e.stopPropagation()}
        className="glass rounded-xl w-full max-w-lg overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div>
            <h2 className="text-lg font-semibold">{application.entity_name}</h2>
            {application.entity_position && (
              <p className="text-sm text-white/60">{application.entity_position}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleViewCandidate}
              className="p-2 hover:bg-dark-800/50 rounded-lg transition-colors"
              title="Открыть карточку кандидата"
            >
              <ExternalLink className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-dark-800/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setActiveTab('details')}
            className={clsx(
              'flex-1 px-4 py-2.5 text-sm font-medium transition-colors',
              activeTab === 'details'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-white/40 hover:text-white/60'
            )}
          >
            Детали
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={clsx(
              'flex-1 px-4 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5',
              activeTab === 'history'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-white/40 hover:text-white/60'
            )}
          >
            <History className="w-3.5 h-3.5" />
            История
          </button>
        </div>

        {activeTab === 'details' ? (
        <div className="p-4 space-y-4">
          {/* Stage */}
          <div>
            <label className="block text-sm text-white/60 mb-1">Этап</label>
            <select
              value={formData.stage}
              onChange={(e) => setFormData({ ...formData, stage: e.target.value as ApplicationStage })}
              className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500"
            >
              {Object.entries(APPLICATION_STAGE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Rating */}
          <div>
            <label className="block text-sm text-white/60 mb-1">Рейтинг</label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  onClick={() => setFormData({ ...formData, rating: value })}
                  className={clsx(
                    'p-1.5 rounded transition-colors',
                    value <= formData.rating
                      ? 'text-yellow-400'
                      : 'text-white/20 hover:text-white/40'
                  )}
                >
                  <Star className={clsx('w-6 h-6', value <= formData.rating && 'fill-current')} />
                </button>
              ))}
              {formData.rating > 0 && (
                <button
                  onClick={() => setFormData({ ...formData, rating: 0 })}
                  className="ml-2 text-xs text-white/40 hover:text-white/60"
                >
                  Сбросить
                </button>
              )}
            </div>
          </div>

          {/* Next Interview */}
          <div>
            <label className="block text-sm text-white/60 mb-1">Следующее интервью</label>
            <input
              type="datetime-local"
              value={formData.next_interview_at}
              onChange={(e) => setFormData({ ...formData, next_interview_at: e.target.value })}
              className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm text-white/60 mb-1">Заметки</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 resize-none"
              placeholder="Добавьте заметки о кандидате..."
            />
          </div>

          {/* Rejection Reason (shown when stage is rejected) */}
          {formData.stage === 'rejected' && (
            <div>
              <label className="block text-sm text-white/60 mb-1">Причина отказа</label>
              <input
                type="text"
                value={formData.rejection_reason}
                onChange={(e) => setFormData({ ...formData, rejection_reason: e.target.value })}
                className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500"
                placeholder="Укажите причину отказа"
              />
            </div>
          )}

          {/* Info */}
          <div className="text-sm text-white/40 space-y-1">
            <p>Источник: {application.source || 'Не указан'}</p>
            <p>Добавлен: {new Date(application.applied_at).toLocaleDateString('ru-RU')}</p>
            <p>Последнее изменение: {new Date(application.last_stage_change_at).toLocaleDateString('ru-RU')}</p>
          </div>

          {/* Invite to Prometheus */}
          <button
            onClick={handleInvitePrometheus}
            disabled={inviting}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/20 rounded-lg text-purple-300 transition-all disabled:opacity-50"
          >
            {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <GraduationCap className="w-4 h-4" />}
            {inviting ? 'Отправка...' : 'Пригласить в Prometheus'}
          </button>
        </div>
        ) : (
        <div className="p-4 max-h-80 overflow-y-auto">
          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-white/40" />
              <span className="ml-2 text-sm text-white/40">Загрузка истории...</span>
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-white/30 text-sm">
              История переходов пока пуста
            </div>
          ) : (
            <div className="relative pl-6">
              {/* Vertical timeline line */}
              <div className="absolute left-[9px] top-2 bottom-2 w-px bg-white/10" />

              <div className="space-y-4">
                {history
                  .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                  .map((entry) => {
                    const stageLabelTo = APPLICATION_STAGE_LABELS[entry.to_stage as ApplicationStage] || entry.to_stage;
                    const stageLabelFrom = entry.from_stage
                      ? (APPLICATION_STAGE_LABELS[entry.from_stage as ApplicationStage] || entry.from_stage)
                      : null;

                    return (
                      <div key={entry.id} className="relative">
                        {/* Timeline dot */}
                        <div className="absolute -left-6 top-1 w-[10px] h-[10px] rounded-full bg-blue-500 border-2 border-[#1a1a2e] z-10" />

                        <div className="space-y-1">
                          {/* Stage transition badges */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {stageLabelFrom && (
                              <>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.06] text-white/50 border border-white/[0.06]">
                                  {stageLabelFrom}
                                </span>
                                <ArrowRight className="w-3 h-3 text-white/30" />
                              </>
                            )}
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                              {stageLabelTo}
                            </span>
                          </div>

                          {/* Meta info */}
                          <div className="flex items-center gap-2 text-[11px] text-white/30">
                            <span>
                              {new Date(entry.created_at).toLocaleDateString('ru-RU', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            {entry.changed_by && (
                              <>
                                <span className="text-white/10">|</span>
                                <span>{entry.changed_by}</span>
                              </>
                            )}
                          </div>

                          {/* Comment */}
                          {entry.comment && (
                            <p className="text-xs text-white/50 mt-0.5">{entry.comment}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
        )}

        <div className="flex items-center justify-between p-4 border-t border-white/10">
          <button
            onClick={handleDelete}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Удалить
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-white/60 hover:text-white transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
            >
              <Save className="w-4 h-4" />
              {loading ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
