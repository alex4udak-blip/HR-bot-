import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail,
  Phone,
  Star,
  Clock,
  Plus,
  Trash2,
  Edit,
  ExternalLink,
  Users
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import type { Vacancy, VacancyApplication, ApplicationStage } from '@/types';
import { APPLICATION_STAGE_LABELS, APPLICATION_STAGE_COLORS } from '@/types';
import { useVacancyStore } from '@/stores/vacancyStore';
import AddCandidateModal from './AddCandidateModal';
import ApplicationDetailModal from './ApplicationDetailModal';
import { KanbanCardSkeleton, Skeleton } from '@/components/ui';

interface KanbanBoardProps {
  vacancy: Vacancy;
}

const VISIBLE_STAGES: ApplicationStage[] = [
  'applied',
  'screening',
  'phone_screen',
  'interview',
  'assessment',
  'offer',
  'hired',
  'rejected'
];

export default function KanbanBoard({ vacancy }: KanbanBoardProps) {
  const navigate = useNavigate();
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<VacancyApplication | null>(null);
  const [draggedApp, setDraggedApp] = useState<VacancyApplication | null>(null);
  const [dropTarget, setDropTarget] = useState<ApplicationStage | null>(null);

  const {
    kanbanBoard,
    kanbanLoading,
    fetchKanbanBoard,
    moveApplication,
    removeApplication
  } = useVacancyStore();

  useEffect(() => {
    fetchKanbanBoard(vacancy.id);
  }, [vacancy.id, fetchKanbanBoard]);

  const handleDragStart = (app: VacancyApplication) => {
    setDraggedApp(app);
  };

  const handleDragEnd = async () => {
    if (draggedApp && dropTarget && dropTarget !== draggedApp.stage) {
      try {
        await moveApplication(draggedApp.id, dropTarget);
        toast.success(`Кандидат перемещён в "${APPLICATION_STAGE_LABELS[dropTarget]}"`);
      } catch {
        toast.error('Ошибка при перемещении');
      }
    }
    setDraggedApp(null);
    setDropTarget(null);
  };

  const handleDragOver = (e: React.DragEvent, stage: ApplicationStage) => {
    e.preventDefault();
    setDropTarget(stage);
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDelete = async (app: VacancyApplication) => {
    if (!confirm(`Удалить кандидата "${app.entity_name}" из вакансии?`)) return;
    try {
      await removeApplication(app.id);
      toast.success('Кандидат удалён из вакансии');
    } catch {
      toast.error('Ошибка при удалении');
    }
  };

  const handleViewCandidate = (app: VacancyApplication) => {
    navigate(`/contacts/${app.entity_id}`);
  };

  if (kanbanLoading) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-4">
            <Skeleton variant="text" className="h-6 w-32" />
            <Skeleton variant="text" className="h-4 w-24" />
          </div>
          <Skeleton variant="rounded" className="h-9 w-40" />
        </div>
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
          <div className="flex gap-4 h-full min-w-max">
            {VISIBLE_STAGES.slice(0, 5).map((stage) => (
              <div key={stage} className="w-72 flex-shrink-0 flex flex-col rounded-xl border border-white/10 bg-white/5">
                <div className="p-3 border-b border-white/10">
                  <Skeleton variant="text" className="h-5 w-24" />
                </div>
                <div className="flex-1 p-2 space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <KanbanCardSkeleton key={i} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!kanbanBoard) {
    return (
      <div className="flex items-center justify-center h-full text-white/40">
        Не удалось загрузить доску
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">Kanban-доска</h2>
          <span className="text-white/40 text-sm">
            {kanbanBoard.total_count} кандидатов
          </span>
        </div>
        <button
          onClick={() => setShowAddCandidate(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          Добавить кандидата
        </button>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <div className="flex gap-4 h-full min-w-max">
          {VISIBLE_STAGES.map((stage) => {
            const column = kanbanBoard.columns.find((c) => c.stage === stage);
            const apps = column?.applications || [];
            const isDropping = dropTarget === stage && draggedApp?.stage !== stage;

            return (
              <div
                key={stage}
                className={clsx(
                  'w-72 flex-shrink-0 flex flex-col rounded-xl border transition-colors',
                  isDropping
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-white/10 bg-white/5'
                )}
                onDragOver={(e) => handleDragOver(e, stage)}
                onDragLeave={handleDragLeave}
                onDrop={handleDragEnd}
              >
                {/* Column Header */}
                <div className={clsx(
                  'p-3 border-b border-white/10 flex items-center justify-between',
                  APPLICATION_STAGE_COLORS[stage]
                )}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{APPLICATION_STAGE_LABELS[stage]}</span>
                    <span className="text-xs px-2 py-0.5 bg-black/20 rounded-full">
                      {apps.length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  <AnimatePresence mode="popLayout">
                    {apps.map((app) => (
                      <motion.div
                        key={app.id}
                        layout
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        draggable
                        onDragStart={() => handleDragStart(app)}
                        onDragEnd={handleDragEnd}
                        className={clsx(
                          'p-3 bg-gray-800 rounded-lg border border-white/10 cursor-grab active:cursor-grabbing',
                          'hover:border-white/20 transition-colors group',
                          draggedApp?.id === app.id && 'opacity-50'
                        )}
                      >
                        {/* Card Header */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium truncate">{app.entity_name}</h4>
                            {app.entity_position && (
                              <p className="text-xs text-white/40 truncate">{app.entity_position}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedApplication(app);
                              }}
                              className="p-1 hover:bg-white/10 rounded"
                              title="Подробнее"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewCandidate(app);
                              }}
                              className="p-1 hover:bg-white/10 rounded"
                              title="Открыть карточку"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(app);
                              }}
                              className="p-1 hover:bg-red-500/20 text-red-400 rounded"
                              title="Удалить"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Contact Info */}
                        <div className="space-y-1 text-xs text-white/60">
                          {app.entity_email && (
                            <div className="flex items-center gap-1.5 truncate">
                              <Mail className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{app.entity_email}</span>
                            </div>
                          )}
                          {app.entity_phone && (
                            <div className="flex items-center gap-1.5">
                              <Phone className="w-3 h-3 flex-shrink-0" />
                              <span>{app.entity_phone}</span>
                            </div>
                          )}
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/5">
                          <div className="flex items-center gap-2">
                            {app.rating && (
                              <div className="flex items-center gap-0.5 text-yellow-400">
                                <Star className="w-3 h-3 fill-current" />
                                <span className="text-xs">{app.rating}</span>
                              </div>
                            )}
                            {app.source && (
                              <span className="text-xs px-1.5 py-0.5 bg-white/5 rounded text-white/40">
                                {app.source}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-white/40">
                            <Clock className="w-3 h-3" />
                            {new Date(app.applied_at).toLocaleDateString('ru-RU', {
                              day: 'numeric',
                              month: 'short'
                            })}
                          </div>
                        </div>

                        {/* Notes Preview */}
                        {app.notes && (
                          <div className="mt-2 p-2 bg-white/5 rounded text-xs text-white/60 line-clamp-2">
                            {app.notes}
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  {/* Empty state */}
                  {apps.length === 0 && (
                    <div className="h-24 flex flex-col items-center justify-center text-white/20 text-sm">
                      <Users className="w-6 h-6 mb-1" />
                      <span>Пусто</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modals */}
      {showAddCandidate && (
        <AddCandidateModal
          vacancyId={vacancy.id}
          onClose={() => setShowAddCandidate(false)}
        />
      )}

      {selectedApplication && (
        <ApplicationDetailModal
          application={selectedApplication}
          onClose={() => setSelectedApplication(null)}
        />
      )}
    </div>
  );
}
