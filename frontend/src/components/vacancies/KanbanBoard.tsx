import { useState, useEffect, useCallback, useRef } from 'react';
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
  Users,
  GripVertical
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import type { Vacancy, VacancyApplication, ApplicationStage, CompatibilityScore } from '@/types';
import { APPLICATION_STAGE_LABELS, APPLICATION_STAGE_COLORS } from '@/types';
import { useVacancyStore } from '@/stores/vacancyStore';
import { updateApplication, calculateCompatibilityScore } from '@/services/api';
import AddCandidateModal from './AddCandidateModal';
import ApplicationDetailModal from './ApplicationDetailModal';
import { KanbanCardSkeleton, Skeleton, EmptyKanban, ConfirmDialog, ErrorMessage } from '@/components/ui';
import { OnboardingTooltip } from '@/components/onboarding';
import CompatibilityBadge from '@/components/CompatibilityBadge';

interface KanbanBoardProps {
  vacancy: Vacancy;
}

interface DropTarget {
  stage: ApplicationStage;
  index: number | null; // null means end of column, number means before that index
}

// Use existing PostgreSQL enum values (mapped to HR labels in backend stage_config)
const VISIBLE_STAGES: ApplicationStage[] = [
  'applied',      // Новый
  'screening',    // Скрининг
  'phone_screen', // Практика
  'interview',    // Тех-практика
  'assessment',   // ИС (итоговое собеседование)
  'offer',        // Оффер
  'hired',        // Принят
  'rejected'      // Отказ
];

export default function KanbanBoard({ vacancy }: KanbanBoardProps) {
  const navigate = useNavigate();
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<VacancyApplication | null>(null);
  const [draggedApp, setDraggedApp] = useState<VacancyApplication | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef<Map<string, number>>(new Map());
  const autoScrollIntervalRef = useRef<number | null>(null);

  // Auto-scroll configuration
  const AUTO_SCROLL_THRESHOLD = 100; // pixels from edge to trigger scroll
  const AUTO_SCROLL_SPEED = 15; // pixels per frame

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    application: VacancyApplication | null;
  }>({ open: false, application: null });
  const [deleteLoading, setDeleteLoading] = useState(false);

  // AI Scoring state - tracks loading and errors per application
  const [scoringState, setScoringState] = useState<Record<number, {
    loading: boolean;
    error: string | null;
    score: CompatibilityScore | null;
  }>>({});

  const {
    kanbanBoard,
    isKanbanLoading,
    error,
    fetchKanbanBoard,
    moveApplication,
    removeApplication,
    clearError
  } = useVacancyStore();

  useEffect(() => {
    fetchKanbanBoard(vacancy.id);
  }, [vacancy.id, fetchKanbanBoard]);

  // Cleanup auto-scroll on unmount
  useEffect(() => {
    return () => {
      if (autoScrollIntervalRef.current !== null) {
        cancelAnimationFrame(autoScrollIntervalRef.current);
      }
    };
  }, []);

  // Stop auto-scroll
  const stopAutoScroll = useCallback(() => {
    if (autoScrollIntervalRef.current !== null) {
      cancelAnimationFrame(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
  }, []);

  // Start auto-scroll based on mouse position
  const handleBoardDragOver = useCallback((e: React.DragEvent) => {
    if (!boardRef.current || !isDragging) return;

    const board = boardRef.current;
    const rect = board.getBoundingClientRect();
    const mouseX = e.clientX;

    // Calculate distance from edges
    const distanceFromLeft = mouseX - rect.left;
    const distanceFromRight = rect.right - mouseX;

    // Determine scroll direction and speed
    let scrollDirection = 0;
    if (distanceFromLeft < AUTO_SCROLL_THRESHOLD) {
      // Scroll left - speed increases as mouse gets closer to edge
      scrollDirection = -1 * (1 - distanceFromLeft / AUTO_SCROLL_THRESHOLD);
    } else if (distanceFromRight < AUTO_SCROLL_THRESHOLD) {
      // Scroll right - speed increases as mouse gets closer to edge
      scrollDirection = 1 * (1 - distanceFromRight / AUTO_SCROLL_THRESHOLD);
    }

    if (scrollDirection !== 0) {
      // Start auto-scroll if not already running
      if (autoScrollIntervalRef.current === null) {
        const scroll = () => {
          if (boardRef.current) {
            boardRef.current.scrollLeft += AUTO_SCROLL_SPEED * scrollDirection;
          }
          autoScrollIntervalRef.current = requestAnimationFrame(scroll);
        };
        autoScrollIntervalRef.current = requestAnimationFrame(scroll);
      }
    } else {
      // Stop auto-scroll when not near edges
      stopAutoScroll();
    }
  }, [isDragging, stopAutoScroll]);

  const handleDragStart = (e: React.DragEvent, app: VacancyApplication) => {
    setDraggedApp(app);
    setIsDragging(true);
    // Set drag image
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', app.id.toString());
    }
  };

  const handleDragEnd = async () => {
    if (draggedApp && dropTarget) {
      const column = kanbanBoard?.columns.find(c => c.stage === dropTarget.stage);
      const apps = column?.applications || [];

      // Check if moving to different stage
      if (dropTarget.stage !== draggedApp.stage) {
        try {
          await moveApplication(draggedApp.id, dropTarget.stage);
          toast.success(`Кандидат перемещён в "${APPLICATION_STAGE_LABELS[dropTarget.stage]}"`);
        } catch {
          toast.error('Ошибка при перемещении кандидата');
        }
      } else if (dropTarget.index !== null) {
        // Reordering within same column
        const currentIndex = apps.findIndex(a => a.id === draggedApp.id);
        if (currentIndex !== -1 && currentIndex !== dropTarget.index && currentIndex !== dropTarget.index - 1) {
          try {
            // Calculate new stage_order
            let newOrder: number;
            const targetIndex = dropTarget.index;

            if (targetIndex === 0) {
              // Moving to the beginning
              newOrder = (apps[0]?.stage_order || 1000) - 1000;
            } else if (targetIndex >= apps.length) {
              // Moving to the end
              newOrder = (apps[apps.length - 1]?.stage_order || 0) + 1000;
            } else {
              // Moving between two cards
              const prevOrder = apps[targetIndex - 1]?.stage_order || 0;
              const nextOrder = apps[targetIndex]?.stage_order || prevOrder + 2000;
              newOrder = Math.floor((prevOrder + nextOrder) / 2);
            }

            await updateApplication(draggedApp.id, { stage_order: newOrder });
            await fetchKanbanBoard(vacancy.id); // Refresh to get updated order
            toast.success('Карточка переупорядочена');
          } catch {
            toast.error('Ошибка при переупорядочивании');
          }
        }
      }
    }

    setDraggedApp(null);
    setDropTarget(null);
    setIsDragging(false);
    dragCounterRef.current.clear();
    stopAutoScroll();
  };

  const handleColumnDragOver = (e: React.DragEvent, stage: ApplicationStage) => {
    e.preventDefault();
    if (!draggedApp) return;

    // Get the column's card container
    const columnElement = e.currentTarget as HTMLElement;
    const cardsContainer = columnElement.querySelector('[data-cards-container]');
    if (!cardsContainer) return;

    const cards = Array.from(cardsContainer.querySelectorAll('[data-card-id]'));
    const mouseY = e.clientY;

    // Find the drop position
    let dropIndex: number | null = null;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i] as HTMLElement;
      const rect = card.getBoundingClientRect();
      const cardMiddle = rect.top + rect.height / 2;

      if (mouseY < cardMiddle) {
        dropIndex = i;
        break;
      }
    }

    // If no card was found, drop at the end
    if (dropIndex === null) {
      dropIndex = cards.length;
    }

    setDropTarget({ stage, index: dropIndex });
  };

  const handleColumnDragEnter = (e: React.DragEvent, stage: ApplicationStage) => {
    e.preventDefault();
    const key = stage;
    const count = (dragCounterRef.current.get(key) || 0) + 1;
    dragCounterRef.current.set(key, count);
  };

  const handleColumnDragLeave = (e: React.DragEvent, stage: ApplicationStage) => {
    e.preventDefault();
    const key = stage;
    const count = (dragCounterRef.current.get(key) || 0) - 1;
    dragCounterRef.current.set(key, count);

    if (count <= 0) {
      dragCounterRef.current.delete(key);
      if (dropTarget?.stage === stage) {
        setDropTarget(null);
      }
    }
  };

  const handleDeleteClick = (app: VacancyApplication) => {
    setConfirmDialog({ open: true, application: app });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDialog.application) return;
    setDeleteLoading(true);
    try {
      await removeApplication(confirmDialog.application.id);
      toast.success('Кандидат удалён из вакансии');
      setConfirmDialog({ open: false, application: null });
    } catch {
      toast.error('Не удалось удалить кандидата');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCancelConfirm = () => {
    if (!deleteLoading) {
      setConfirmDialog({ open: false, application: null });
    }
  };

  const handleRetryFetch = () => {
    clearError();
    fetchKanbanBoard(vacancy.id);
  };

  const handleViewCandidate = (app: VacancyApplication) => {
    navigate(`/contacts/${app.entity_id}`);
  };

  // Handle AI score calculation
  const handleCalculateScore = useCallback(async (app: VacancyApplication) => {
    // Set loading state
    setScoringState(prev => ({
      ...prev,
      [app.id]: { loading: true, error: null, score: prev[app.id]?.score || null }
    }));

    try {
      const response = await calculateCompatibilityScore({
        entity_id: app.entity_id,
        vacancy_id: app.vacancy_id
      });

      setScoringState(prev => ({
        ...prev,
        [app.id]: { loading: false, error: null, score: response.score }
      }));

      if (!response.cached) {
        toast.success('AI скоринг рассчитан');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ошибка расчёта скора';
      setScoringState(prev => ({
        ...prev,
        [app.id]: { loading: false, error: errorMessage, score: null }
      }));
      toast.error('Не удалось рассчитать AI скор');
    }
  }, []);

  // Get score state for an application
  const getScoreState = useCallback((app: VacancyApplication) => {
    const state = scoringState[app.id];
    return {
      score: state?.score || app.compatibility_score || null,
      isLoading: state?.loading || false,
      error: state?.error || null
    };
  }, [scoringState]);

  if (isKanbanLoading) {
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

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <ErrorMessage
          error={error}
          onRetry={handleRetryFetch}
        />
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

  // Show empty state when there are no candidates at all
  if (kanbanBoard.total_count === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold">Kanban доска</h2>
            <span className="text-white/40 text-sm">0 кандидатов</span>
          </div>
          <button
            onClick={() => setShowAddCandidate(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Добавить кандидата
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <EmptyKanban onAddFromBase={() => setShowAddCandidate(true)} />
        </div>
        {showAddCandidate && (
          <AddCandidateModal
            vacancyId={vacancy.id}
            onClose={() => setShowAddCandidate(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 sm:p-4 border-b border-white/10">
        <div className="flex items-center gap-2 sm:gap-4">
          <OnboardingTooltip
            id="kanban-board"
            content="Перетаскивайте кандидатов между этапами для обновления статуса"
            position="bottom"
          >
            <h2 className="text-base sm:text-lg font-semibold">Kanban доска</h2>
          </OnboardingTooltip>
          <span className="text-white/40 text-xs sm:text-sm">
            {kanbanBoard.total_count} кандидатов
          </span>
        </div>
        <button
          onClick={() => setShowAddCandidate(true)}
          className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs sm:text-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Добавить кандидата</span>
          <span className="sm:hidden">Добавить</span>
        </button>
      </div>

      {/* Board - horizontal scroll on mobile with touch-friendly spacing */}
      <div
        className="flex-1 overflow-x-auto overflow-y-hidden p-3 sm:p-4 touch-pan-x"
        ref={boardRef}
        style={{ WebkitOverflowScrolling: 'touch' }}
        onDragOver={handleBoardDragOver}
        onDragLeave={stopAutoScroll}
      >
        <div className="flex gap-3 sm:gap-4 h-full min-w-max pb-2">
          {VISIBLE_STAGES.map((stage) => {
            const column = kanbanBoard.columns.find((c) => c.stage === stage);
            const apps = column?.applications || [];
            const isDropping = dropTarget?.stage === stage && draggedApp?.stage !== stage;
            const isReorderTarget = dropTarget?.stage === stage && draggedApp?.stage === stage;

            return (
              <div
                key={stage}
                data-kanban-column
                className={clsx(
                  'w-64 sm:w-72 flex-shrink-0 flex flex-col rounded-xl border transition-all duration-200',
                  isDropping
                    ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/20'
                    : 'border-white/10 bg-white/5'
                )}
                onDragOver={(e) => handleColumnDragOver(e, stage)}
                onDragEnter={(e) => handleColumnDragEnter(e, stage)}
                onDragLeave={(e) => handleColumnDragLeave(e, stage)}
                onDrop={handleDragEnd}
              >
                {/* Column Header */}
                <div className={clsx(
                  'p-2 sm:p-3 border-b border-white/10 flex items-center justify-between',
                  APPLICATION_STAGE_COLORS[stage]
                )}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm sm:text-base">{APPLICATION_STAGE_LABELS[stage]}</span>
                    <span className="text-xs px-2 py-0.5 bg-black/20 rounded-full">
                      {apps.length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div
                  data-cards-container
                  className="flex-1 overflow-y-auto p-1.5 sm:p-2 space-y-2"
                >
                  <AnimatePresence mode="popLayout">
                    {apps.map((app, appIndex) => {
                      const showDropIndicatorBefore = isReorderTarget &&
                        dropTarget?.index === appIndex &&
                        draggedApp?.id !== app.id;

                      return (
                        <div key={app.id}>
                          {/* Drop indicator before this card */}
                          {showDropIndicatorBefore && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 4 }}
                              exit={{ opacity: 0, height: 0 }}
                              className="bg-blue-500 rounded-full mb-2"
                            />
                          )}

                          <motion.div
                            layout
                            data-card-id={app.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{
                              opacity: draggedApp?.id === app.id ? 0.5 : 1,
                              y: 0,
                              scale: draggedApp?.id === app.id ? 0.98 : 1,
                            }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            draggable
                            onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, app)}
                            onDragEnd={handleDragEnd}
                            className={clsx(
                              'p-2.5 sm:p-3 bg-gray-800 rounded-lg border cursor-grab active:cursor-grabbing',
                              'hover:border-white/30 transition-all duration-200 group touch-manipulation',
                              draggedApp?.id === app.id
                                ? 'border-blue-500/50 shadow-lg shadow-blue-500/20 ring-2 ring-blue-500/30'
                                : 'border-white/10',
                              isDragging && draggedApp?.id !== app.id && 'pointer-events-none'
                            )}
                          >
                            {/* Card Header */}
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                {/* Drag handle */}
                                <GripVertical className="w-4 h-4 text-white/30 flex-shrink-0 cursor-grab" />
                                <div className="flex-1 min-w-0">
                                  <h4 className="font-medium truncate text-sm sm:text-base">{app.entity_name}</h4>
                                  {app.entity_position && (
                                    <p className="text-xs text-white/40 truncate">{app.entity_position}</p>
                                  )}
                                </div>
                              </div>
                              {/* Action buttons - always visible on touch, hover on desktop */}
                              <div className="flex items-center gap-0.5 sm:gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedApplication(app);
                                  }}
                                  className="p-1.5 sm:p-1 hover:bg-white/10 rounded touch-manipulation"
                                  title="Детали"
                                >
                                  <Edit className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleViewCandidate(app);
                                  }}
                                  className="p-1.5 sm:p-1 hover:bg-white/10 rounded touch-manipulation"
                                  title="Профиль"
                                >
                                  <ExternalLink className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteClick(app);
                                  }}
                                  className="p-1.5 sm:p-1 hover:bg-red-500/20 text-red-400 rounded touch-manipulation"
                                  title="Удалить"
                                >
                                  <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Contact Info */}
                            <div className="space-y-1 text-xs text-white/60 ml-6">
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
                            <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/5 ml-6">
                              <div className="flex items-center gap-2">
                                {/* AI Compatibility Badge */}
                                {(() => {
                                  const { score, isLoading, error } = getScoreState(app);
                                  return (
                                    <CompatibilityBadge
                                      score={score}
                                      isLoading={isLoading}
                                      error={error}
                                      onCalculate={() => handleCalculateScore(app)}
                                      size="sm"
                                      showDetails={true}
                                    />
                                  );
                                })()}
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
                              <div className="mt-2 p-2 bg-white/5 rounded text-xs text-white/60 line-clamp-2 ml-6">
                                {app.notes}
                              </div>
                            )}
                          </motion.div>
                        </div>
                      );
                    })}
                  </AnimatePresence>

                  {/* Drop indicator at the end of column */}
                  {isReorderTarget && dropTarget?.index === apps.length && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 4 }}
                      exit={{ opacity: 0, height: 0 }}
                      className="bg-blue-500 rounded-full"
                    />
                  )}

                  {/* Empty state */}
                  {apps.length === 0 && !isDropping && (
                    <div className="h-24 flex flex-col items-center justify-center text-white/20 text-sm">
                      <Users className="w-6 h-6 mb-1" />
                      <span>Пусто</span>
                    </div>
                  )}

                  {/* Drop zone indicator for empty columns */}
                  {apps.length === 0 && isDropping && (
                    <div className="h-24 flex flex-col items-center justify-center border-2 border-dashed border-blue-500/50 rounded-lg text-blue-400 text-sm">
                      <span>Отпустите здесь</span>
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

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title="Удалить кандидата"
        message="Удалить этого кандидата из вакансии? Это действие невозможно отменить."
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelConfirm}
        loading={deleteLoading}
      />
    </div>
  );
}
