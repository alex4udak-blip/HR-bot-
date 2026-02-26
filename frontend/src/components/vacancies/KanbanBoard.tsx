import { useState, useEffect, useCallback, useRef, useReducer } from 'react';
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

// Drag state management with useReducer
type DragState = {
  isDragging: boolean;
  draggedApp: VacancyApplication | null;
  dropTarget: DropTarget | null;
};

type DragAction =
  | { type: 'START_DRAG'; payload: { app: VacancyApplication } }
  | { type: 'UPDATE_TARGET'; payload: DropTarget | null }
  | { type: 'END_DRAG' }
  | { type: 'CANCEL_DRAG' };

const initialDragState: DragState = {
  isDragging: false,
  draggedApp: null,
  dropTarget: null,
};

function dragReducer(state: DragState, action: DragAction): DragState {
  switch (action.type) {
    case 'START_DRAG':
      return {
        isDragging: true,
        draggedApp: action.payload.app,
        dropTarget: null,
      };
    case 'UPDATE_TARGET':
      return {
        ...state,
        dropTarget: action.payload,
      };
    case 'END_DRAG':
      return initialDragState;
    case 'CANCEL_DRAG':
      return initialDragState;
    default:
      return state;
  }
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

  // Drag state managed by useReducer
  const [dragState, dispatchDrag] = useReducer(dragReducer, initialDragState);
  const { isDragging, draggedApp, dropTarget } = dragState;

  const boardRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef<Map<string, number>>(new Map());
  const autoScrollIntervalRef = useRef<number | null>(null);

  // Auto-scroll configuration
  const AUTO_SCROLL_THRESHOLD = 200; // pixels from edge to trigger scroll
  const AUTO_SCROLL_SPEED = 30; // pixels per frame

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    application: VacancyApplication | null;
  }>({ open: false, application: null });
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Track which applications are currently being moved (prevents double-click)
  const [movingApps, setMovingApps] = useState<Set<number>>(new Set());

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

  const scrollDirectionRef = useRef<number>(0);

  // Stop auto-scroll
  const stopAutoScroll = useCallback(() => {
    if (autoScrollIntervalRef.current !== null) {
      cancelAnimationFrame(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
    scrollDirectionRef.current = 0;
  }, []);

  // Start auto-scroll loop
  const startAutoScroll = useCallback(() => {
    if (autoScrollIntervalRef.current !== null) return;

    const scroll = () => {
      if (boardRef.current && scrollDirectionRef.current !== 0) {
        boardRef.current.scrollLeft += AUTO_SCROLL_SPEED * scrollDirectionRef.current;
        autoScrollIntervalRef.current = requestAnimationFrame(scroll);
      } else {
        stopAutoScroll();
      }
    };
    autoScrollIntervalRef.current = requestAnimationFrame(scroll);
  }, [stopAutoScroll]);

  // Handle drag over for auto-scroll
  const handleBoardDragOver = useCallback((e: React.DragEvent) => {
    if (!boardRef.current || !isDragging) return;

    const board = boardRef.current;
    const rect = board.getBoundingClientRect();
    const mouseX = e.clientX;

    // Calculate distance from edges
    const distanceFromLeft = mouseX - rect.left;
    const distanceFromRight = rect.right - mouseX;

    // Determine scroll direction and speed
    let newDirection = 0;
    if (distanceFromLeft < AUTO_SCROLL_THRESHOLD) {
      // Scroll left - speed increases as mouse gets closer to edge
      newDirection = -1 * (1 - Math.max(0, distanceFromLeft) / AUTO_SCROLL_THRESHOLD);
    } else if (distanceFromRight < AUTO_SCROLL_THRESHOLD) {
      // Scroll right - speed increases as mouse gets closer to edge
      newDirection = 1 * (1 - Math.max(0, distanceFromRight) / AUTO_SCROLL_THRESHOLD);
    }

    if (newDirection !== 0) {
      scrollDirectionRef.current = newDirection;
      startAutoScroll();
    } else {
      stopAutoScroll();
    }
  }, [isDragging, startAutoScroll, stopAutoScroll]);

  const handleDragStart = (e: React.DragEvent, app: VacancyApplication) => {
    dispatchDrag({ type: 'START_DRAG', payload: { app } });
    // Set drag image
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', app.id.toString());
    }
  };

  const isMovingRef = useRef(false);

  const handleDragEnd = async () => {
    if (draggedApp && dropTarget && !isMovingRef.current) {
      isMovingRef.current = true;
      const column = kanbanBoard?.columns.find(c => c.stage === dropTarget.stage);
      const apps = column?.applications || [];

      // Capture before resetting
      const currentApp = draggedApp;
      const currentTarget = dropTarget;

      // Check if moving to different stage
      if (currentTarget.stage !== currentApp.stage) {
        try {
          await moveApplication(currentApp.id, currentTarget.stage);
          toast.success(`Кандидат перемещён в "${APPLICATION_STAGE_LABELS[currentTarget.stage]}"`);
        } catch {
          toast.error('Ошибка при перемещении кандидата');
        }
      } else if (currentTarget.index !== null) {
        // Reordering within same column
        const currentIndex = apps.findIndex(a => a.id === currentApp.id);
        if (currentIndex !== -1 && currentIndex !== currentTarget.index && currentIndex !== currentTarget.index - 1) {
          try {
            // Calculate new stage_order
            let newOrder: number;
            const targetIndex = currentTarget.index;

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

            await updateApplication(currentApp.id, { stage_order: newOrder });
            await fetchKanbanBoard(vacancy.id); // Refresh to get updated order
            toast.success('Карточка переупорядочена');
          } catch {
            toast.error('Ошибка при переупорядочивании');
          }
        }
      }
    }

    dispatchDrag({ type: 'END_DRAG' });
    dragCounterRef.current.clear();
    stopAutoScroll();
    isMovingRef.current = false;
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

    dispatchDrag({ type: 'UPDATE_TARGET', payload: { stage, index: dropIndex } });
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
        dispatchDrag({ type: 'UPDATE_TARGET', payload: null });
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
              <div key={stage} className="w-72 flex-shrink-0 flex flex-col rounded-xl glass-light">
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
                    : 'border-white/10 glass-light'
                )}
                onDragOver={(e) => {
                  handleColumnDragOver(e, stage);
                  // Allow bubbling to board container for auto-scroll
                }}
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
                  className="flex-1 overflow-y-auto p-1.5 sm:p-2 space-y-3"
                >
                  <AnimatePresence mode="popLayout">
                    {apps.map((app, appIndex) => {
                      const showDropIndicatorBefore = isReorderTarget &&
                        dropTarget?.index === appIndex &&
                        draggedApp?.id !== app.id;

                      const nextStage = (() => {
                        const currentIndex = VISIBLE_STAGES.indexOf(stage);
                        return currentIndex >= 0 && currentIndex < VISIBLE_STAGES.length - 1
                          ? VISIBLE_STAGES[currentIndex + 1]
                          : null;
                      })();

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
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{
                              opacity: draggedApp?.id === app.id ? 0.5 : 1,
                              scale: draggedApp?.id === app.id ? 0.98 : 1,
                            }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            draggable
                            onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, app)}
                            onDragEnd={handleDragEnd}
                            className={clsx(
                              'p-3 glass-light hover:bg-white/10 border rounded-xl cursor-grab active:cursor-grabbing transition-all duration-200 group touch-manipulation',
                              draggedApp?.id === app.id
                                ? 'border-blue-500/50 bg-blue-500/10 shadow-lg shadow-blue-500/20'
                                : 'border-white/10',
                              isDragging && draggedApp?.id !== app.id && 'pointer-events-none'
                            )}
                          >
                            {/* Card Header */}
                            <div className="flex items-start gap-2 mb-2">
                              {/* Drag handle */}
                              <GripVertical className="w-4 h-4 text-white/20 flex-shrink-0 mt-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" />

                              <div className="flex-1 min-w-0">
                                <h4 className="font-medium truncate text-sm sm:text-base group-hover:text-white transition-colors">
                                  {app.entity_name}
                                </h4>
                                {app.entity_position && (
                                  <p className="text-xs text-white/40 truncate">{app.entity_position}</p>
                                )}
                              </div>

                              {/* Action buttons */}
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all scale-95 group-hover:scale-100">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedApplication(app);
                                  }}
                                  className="p-1.5 hover:bg-white/10 rounded-lg text-white/40 hover:text-white transition-all active:scale-90"
                                  title="Детали"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleViewCandidate(app);
                                  }}
                                  className="p-1.5 hover:bg-white/10 rounded-lg text-white/40 hover:text-white transition-all active:scale-90"
                                  title="Профиль"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteClick(app);
                                  }}
                                  className="p-1.5 hover:bg-red-500/20 text-red-400 rounded-lg transition-all active:scale-90"
                                  title="Удалить"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Contact Info */}
                            <div className="space-y-1.5 text-xs text-white/50 ml-6">
                              {app.entity_email && (
                                <div className="flex items-center gap-2 truncate">
                                  <Mail className="w-3 h-3 flex-shrink-0" />
                                  <span className="truncate">{app.entity_email}</span>
                                </div>
                              )}
                              {app.entity_phone && (
                                <div className="flex items-center gap-2 truncate">
                                  <Phone className="w-3 h-3 flex-shrink-0" />
                                  <span className="truncate">{app.entity_phone}</span>
                                </div>
                              )}
                            </div>

                            {/* Footer / Scoring */}
                            <div className="mt-3 pt-2 border-t border-white/5 ml-6 flex items-center justify-between">
                              <div className="flex items-center gap-2">
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
                                  <div className="flex items-center gap-1 text-yellow-400">
                                    <Star className="w-3 h-3 fill-current" />
                                    <span className="text-xs font-medium">{app.rating}</span>
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1 text-[10px] text-white/30">
                                  <Clock className="w-3 h-3" />
                                  {new Date(app.applied_at).toLocaleDateString('ru-RU', {
                                    day: 'numeric',
                                    month: 'short'
                                  })}
                                </div>

                                {/* Quick stage transition arrow */}
                                {nextStage && (
                                  <button
                                    disabled={movingApps.has(app.id)}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      // Prevent double-click
                                      if (movingApps.has(app.id)) return;

                                      setMovingApps(prev => new Set(prev).add(app.id));
                                      try {
                                        await moveApplication(app.id, nextStage);
                                        toast.success(`→ ${APPLICATION_STAGE_LABELS[nextStage]}`);
                                      } catch {
                                        toast.error('Ошибка при смене этапа');
                                      } finally {
                                        setMovingApps(prev => {
                                          const next = new Set(prev);
                                          next.delete(app.id);
                                          return next;
                                        });
                                      }
                                    }}
                                    className={clsx(
                                      "p-1 hover:bg-white/10 rounded-lg text-white/30 hover:text-blue-400 transition-all active:scale-90",
                                      movingApps.has(app.id) && "opacity-50 cursor-not-allowed"
                                    )}
                                    title={`В "${APPLICATION_STAGE_LABELS[nextStage]}"`}
                                  >
                                    <span className="text-sm font-bold">{movingApps.has(app.id) ? '...' : '→'}</span>
                                  </button>
                                )}
                              </div>
                            </div>
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
                    <div className="flex-1 flex flex-col items-center justify-center py-12 px-4 text-center">
                      <div className="w-12 h-12 rounded-full glass-light flex items-center justify-center mb-3">
                        <Users className="w-6 h-6 text-white/20" />
                      </div>
                      <p className="text-sm font-medium text-white/30">Пусто</p>
                      <p className="text-xs text-white/20 mt-1 max-w-[140px]">
                        Перетащите сюда кандидата или добавьте нового
                      </p>
                    </div>
                  )}

                  {/* Drop zone indicator for empty columns */}
                  {apps.length === 0 && isDropping && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="h-32 flex flex-col items-center justify-center border-2 border-dashed border-blue-500/50 rounded-xl bg-blue-500/5 text-blue-400/80 text-sm"
                    >
                      <Plus className="w-6 h-6 mb-2 animate-bounce" />
                      <span className="font-medium">Отпустите здесь</span>
                    </motion.div>
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
