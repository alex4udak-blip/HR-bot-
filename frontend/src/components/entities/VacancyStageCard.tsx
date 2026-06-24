import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Mail,
  Calendar,
  MessageSquare,
  ThumbsUp,
  Paperclip,
  XCircle,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { HuntflowComposer } from '@/components/hr/HuntflowComposer';
import { HuntflowActionChip } from '@/components/hr/HuntflowControls';
import { HuntflowRichInput } from '@/components/hr/HuntflowRichInput';
import { sanitizeHtml } from '@/utils/sanitizeHtml';

// ── Per-vacancy "Huntflow card": full interactive stage card, one instance per
// application. Self-contained local state so N cards work independently.
// Visual: neutral GRAY card (the funnel's green card was a single special-case);
// here every vacancy is an equal gray card, stacked.

export interface VacancyStageCardEvent {
  id?: number;
  from_stage?: string | null;
  to_stage: string;
  comment?: string | null;
  changed_by_name?: string | null;
  created_at: string;
}

export interface VacancyStageCardProps {
  applicationId: number;
  vacancyTitle: string;
  vacancySubtitle?: string;
  currentStage: string;
  entityId: number;
  entityEmail?: string | null;
  events: VacancyStageCardEvent[];
  stageOptions: Array<{ status: string; label: string }>;
  getStageLabel: (stage: string) => string;
  getStageColors: (stage: string) => { badge: string; dot: string };
  onChangeStage: (applicationId: number, stage: string, comment?: string) => Promise<void> | void;
  onComment: (applicationId: number, stage: string, stageLabel: string, text: string) => Promise<void> | void;
  onDeleteHistory: (applicationId: number, historyId: number) => Promise<void> | void;
  onUploadFile: (entityId: number, file: File) => Promise<void> | void;
  onScheduleInterview: (applicationId: number) => void;
  onRemoveFromVacancy: (applicationId: number) => void;
}

// Цвет карточки по этапу: ЗЕЛЁНАЯ для всех активных этапов, СЕРАЯ только для
// отклонённых (rejected). Переопределяем CSS-переменные, которые читает
// .hf-stage-card (--hf-stage-accent — левый бордер + заголовок, --hf-stage-card-bg — фон).
const greenCardStyle: CSSProperties = {
  '--hf-stage-accent': '#22c55e',
  '--hf-stage-card-bg': 'rgba(34, 197, 94, 0.1)',
} as CSSProperties;
const grayCardStyle: CSSProperties = {
  '--hf-stage-accent': 'var(--hf-main-300)',
  '--hf-stage-card-bg': 'var(--hf-bg-panel)',
} as CSSProperties;

export default function VacancyStageCard({
  applicationId,
  vacancyTitle,
  vacancySubtitle,
  currentStage,
  entityId,
  entityEmail,
  events,
  stageOptions,
  getStageLabel,
  getStageColors,
  onChangeStage,
  onComment,
  onDeleteHistory,
  onUploadFile,
  onScheduleInterview,
  onRemoveFromVacancy,
}: VacancyStageCardProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPending, setPickerPending] = useState<string | null>(null);
  const [pickerComment, setPickerComment] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [fileUploading, setFileUploading] = useState(false);

  const pickerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // Самая свежая запись истории = переход в ТЕКУЩИЙ этап (кто и когда его поставил).
  const latestEvent =
    Array.isArray(events) && events.length > 0
      ? [...events].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )[0]
      : null;
  // Прошлый этап для отката — from_stage самой свежей записи.
  const prevStage = latestEvent?.from_stage || null;

  // Цвет карточки: серая только для отклонённых, иначе зелёная.
  const cardStyle = currentStage === 'rejected' ? grayCardStyle : greenCardStyle;

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const sendEmail = () => {
    if (entityEmail) {
      window.open(`mailto:${entityEmail}`);
    } else {
      toast.error('Email кандидата не указан');
    }
  };

  const handlePickerSave = async () => {
    const target = pickerPending ?? currentStage;
    const text = pickerComment.trim();
    if (target !== currentStage) {
      // Коммент уходит В САМ переход → история «X → Y: текст».
      await onChangeStage(applicationId, target, text || undefined);
    } else if (text) {
      // Без смены этапа — обычный коммент к текущему этапу.
      await onComment(applicationId, currentStage, getStageLabel(currentStage), text);
    }
    setPickerComment('');
    setPickerOpen(false);
  };

  const submitComposer = async () => {
    const text = commentText.trim();
    if (!text) return;
    await onComment(applicationId, currentStage, getStageLabel(currentStage), text);
    setCommentText('');
    setComposerOpen(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileUploading(true);
    try {
      await onUploadFile(entityId, file);
    } finally {
      setFileUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  return (
    <div className="hf-stage-card" style={cardStyle}>
      <div className="hf-stage-card-head">
        <div className="hf-stage-card-head-row">
          <div>
            <div className="hf-stage-card-title">{getStageLabel(currentStage)}</div>
            <div className="hf-stage-card-subtitle">
              {vacancyTitle || 'Вакансия'}
              {vacancySubtitle ? ` (${vacancySubtitle})` : ''}
            </div>
            {latestEvent && (
              <div className="text-xs text-[var(--hf-dark-500)] mt-1">
                {new Date(latestEvent.created_at).toLocaleString('ru', {
                  day: 'numeric', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
                {latestEvent.changed_by_name ? ` · ${latestEvent.changed_by_name}` : ''}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative" ref={pickerRef}>
              <button
                type="button"
                onClick={() => {
                  setPickerPending(currentStage);
                  setPickerComment('');
                  setPickerOpen((v) => !v);
                }}
                className="hf-stage-change-btn"
              >
                Сменить этап подбора
              </button>
              {pickerOpen && (
                <div className="hf-stage-picker">
                  <div className="hf-stage-picker-list huntflow-scrollbar">
                    {stageOptions.map((option) => {
                      const isSelected = (pickerPending ?? currentStage) === option.status;
                      return (
                        <button
                          type="button"
                          key={option.status}
                          onClick={() => setPickerPending(option.status)}
                          className={clsx(
                            'hf-stage-picker-option',
                            isSelected
                              ? 'hf-stage-picker-option-active'
                              : 'hf-stage-picker-option-idle',
                          )}
                        >
                          <span className="truncate">{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="hf-stage-picker-editor-wrap">
                    <div className="hf-stage-picker-editor">
                      <HuntflowRichInput
                        value={pickerComment}
                        onChange={setPickerComment}
                        placeholder="Записать комментарий"
                        showMention
                        toolbarClassName="hf-stage-picker-toolbar"
                        editableClassName="hf-stage-picker-textarea overflow-y-auto"
                      />
                      <div className="hf-stage-picker-actions">
                        <HuntflowActionChip icon={Mail} label="Письмо" onClick={sendEmail} />
                        <HuntflowActionChip
                          icon={Calendar}
                          label="Интервью"
                          onClick={() => onScheduleInterview(applicationId)}
                        />
                        <HuntflowActionChip
                          icon={ThumbsUp}
                          label="Оффер"
                          onClick={() => onChangeStage(applicationId, 'offer')}
                        />
                      </div>
                    </div>
                    <div className="hf-stage-picker-footer">
                      <button
                        type="button"
                        onClick={handlePickerSave}
                        className="inline-flex h-[33px] min-w-[74px] items-center justify-center rounded-[var(--hf-radius-s)] border border-[var(--hf-main-900)] bg-[var(--hf-main-900)] px-[11px] text-[length:var(--hf-fs-xxs)] font-medium leading-[var(--hf-lh-secondary)] !text-[var(--hf-white)] transition-colors hover:bg-[var(--hf-main-800)]"
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPickerComment('');
                          setPickerOpen(false);
                        }}
                        className="inline-flex h-[33px] min-w-[65px] items-center justify-center rounded-[var(--hf-radius-s)] border border-[var(--hf-alpha-200)] bg-[var(--hf-white)] px-[11px] text-[length:var(--hf-fs-xxs)] font-medium leading-[var(--hf-lh-secondary)] text-[var(--hf-main-900)] transition-colors hover:bg-[var(--hf-ui-hover)]"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                title="Действия со статусом"
                className="inline-flex h-[33px] w-[33px] items-center justify-center rounded-[var(--hf-radius-s)] border border-[var(--hf-alpha-200)] bg-[var(--hf-white)] text-[var(--hf-main-700)] transition-colors hover:bg-[var(--hf-ui-hover)]"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-[260] mt-1 w-[240px] overflow-hidden rounded-[var(--hf-radius-s)] border border-[var(--hf-ui-border)] bg-[var(--hf-white)] py-1 shadow-[0_2px_16px_var(--hf-alpha-300)]">
                  {prevStage && prevStage !== currentStage && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onChangeStage(applicationId, prevStage);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[length:var(--hf-fs-xs)] text-[var(--hf-main-900)] transition-colors hover:bg-[var(--hf-bg-panel)]"
                    >
                      <RotateCcw className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">Вернуть на «{getStageLabel(prevStage)}»</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onRemoveFromVacancy(applicationId);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[length:var(--hf-fs-xs)] text-[var(--hf-status-red)] transition-colors hover:bg-[var(--hf-bg-panel)]"
                  >
                    <Trash2 className="h-4 w-4 flex-shrink-0" />
                    <span>Убрать из вакансии</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Comment input — Huntflow style */}
      <HuntflowComposer
        wrapperClassName="px-[var(--hf-space-xxl)] pt-[var(--hf-space-xxl)] pb-[6px]"
        value={commentText}
        onChange={setCommentText}
        open={composerOpen}
        onOpenChange={setComposerOpen}
        placeholder="Написать комментарий"
        onSubmit={submitComposer}
        onCancel={() => {
          setCommentText('');
          setComposerOpen(false);
        }}
        showMention
        collapsedRows={2}
        textareaRef={composerRef}
        collapsedClassName="h-[58px] w-full resize-none rounded-[var(--hf-radius-s)] border border-[color:var(--hf-black-alpha-16)] bg-transparent px-[var(--hf-space-xxl)] py-[var(--hf-space-l)] text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-primary)] text-[var(--hf-main-900)] placeholder:text-[var(--hf-main-600)] focus:border-[var(--hf-cyan-500)] focus:outline-none disabled:opacity-50"
        actions={[
          { icon: Mail, label: 'Письмо', onClick: sendEmail },
          { icon: Calendar, label: 'Интервью', onClick: () => onScheduleInterview(applicationId) },
          { icon: ThumbsUp, label: 'Оффер', onClick: () => onChangeStage(applicationId, 'offer') },
          {
            icon: Paperclip,
            label: 'Файл',
            onClick: () => fileInputRef.current?.click(),
            loading: fileUploading,
            loadingLabel: 'Загрузка…',
          },
        ]}
      />

      <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />

      {/* Action chips — Huntflow outlined style */}
      {!composerOpen && !commentText.trim() && (
        <div className="hf-vacancy-stage-action-row">
          <HuntflowActionChip icon={Mail} label="Письмо" onClick={sendEmail} />
          <HuntflowActionChip
            icon={Calendar}
            label="Интервью"
            onClick={() => onScheduleInterview(applicationId)}
          />
          <HuntflowActionChip
            icon={MessageSquare}
            label="Комментарий"
            onClick={() => {
              setComposerOpen(true);
              requestAnimationFrame(() => composerRef.current?.focus());
            }}
          />
          <HuntflowActionChip
            icon={ThumbsUp}
            label="Оффер"
            onClick={() => onChangeStage(applicationId, 'offer')}
          />
          <HuntflowActionChip
            icon={Paperclip}
            label="Файл"
            onClick={() => fileInputRef.current?.click()}
            disabled={fileUploading}
            loading={fileUploading}
            displayLabel={fileUploading ? 'Загрузка…' : 'Файл'}
          />
          <HuntflowActionChip
            icon={XCircle}
            label="Отказ"
            danger
            onClick={() => onChangeStage(applicationId, 'rejected')}
          />
        </div>
      )}

      {/* History timeline — Huntflow style */}
      <div className="hf-vacancy-stage-history">
        {events.length === 0 ? (
          <div className="text-sm text-[var(--hf-dark-600)]">Нет записей</div>
        ) : (
          <div className="relative pl-6 border-l border-[color:var(--hf-white-alpha-08)]">
            {events.map((entry, i) => {
              const toColors = getStageColors(entry.to_stage);
              const fromColors = entry.from_stage ? getStageColors(entry.from_stage) : null;
              return (
                <div key={entry.id ?? i} className="relative pb-5 last:pb-0">
                  {entry.id ? (
                    <button
                      type="button"
                      onClick={() => onDeleteHistory(applicationId, entry.id as number)}
                      title="Удалить запись"
                      className="absolute right-0 top-0 rounded p-1 text-[var(--hf-dark-500)] transition-colors hover:text-[var(--hf-status-red)]"
                    >
                      <Trash2 className="h-[14px] w-[14px]" />
                    </button>
                  ) : null}
                  {/* Timeline dot */}
                  <div
                    className={clsx(
                      'absolute -left-[25px] w-3 h-3 rounded-full border-2 border-[color:var(--hf-dark-800)]',
                      toColors.dot,
                    )}
                  />

                  {/* Date */}
                  <div className="text-xs text-[var(--hf-dark-600)] mb-1">
                    {entry.created_at &&
                      new Date(entry.created_at).toLocaleString('ru', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                  </div>

                  {/* Stage change badges */}
                  {entry.from_stage ? (
                    <div className="flex items-center gap-1.5 flex-wrap text-xs mb-1">
                      <span className={clsx('px-2 py-0.5 rounded-full', fromColors?.badge)}>
                        {getStageLabel(entry.from_stage)}
                      </span>
                      <span className="text-[var(--hf-dark-600)]">&rarr;</span>
                      <span className={clsx('px-2 py-0.5 rounded-full', toColors.badge)}>
                        {getStageLabel(entry.to_stage)}
                      </span>
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--hf-dark-300)] mb-1">
                      <span className={clsx('inline-block px-2 py-0.5 rounded-full text-xs', toColors.badge)}>
                        {getStageLabel(entry.to_stage)}
                      </span>
                    </div>
                  )}

                  {/* Comment */}
                  {entry.comment && (
                    <div
                      className="text-sm text-[var(--hf-dark-400)] mt-1 whitespace-pre-wrap pl-0.5 hf-rich-content"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(entry.comment) }}
                    />
                  )}

                  {/* Changed by */}
                  {entry.changed_by_name && (
                    <div className="text-xs text-[var(--hf-dark-600)] mt-1">{entry.changed_by_name}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
