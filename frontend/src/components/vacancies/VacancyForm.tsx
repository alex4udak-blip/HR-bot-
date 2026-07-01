import { useState, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import {
  Loader2,
  PlayCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useVacancyStore } from '@/stores/vacancyStore';
import { useAuthStore } from '@/stores/authStore';
import type { Vacancy, VacancyStatus } from '@/types';
import { getAssignableUsers, assignVacancy, takeVacancy } from '@/services/api';
import type { AssignableUser } from '@/services/api';
import { getCurrencySymbol, SALARY_INPUT_CURRENCIES } from '@/utils/currency';

interface VacancyFormProps {
  vacancy?: Vacancy;
  prefillData?: Partial<Vacancy>;
  onClose: () => void;
  onSuccess: () => void;
}

type HfSelectOption = {
  value: string | number;
  label: string;
  icon?: ReactNode;
};

type HfSelectMenuRect = {
  id: string;
  left: number;
  top: number;
};

function HfSpriteIcon({ id, className }: { id: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <use href={`/huntflow-sprite.svg#${id}`} />
    </svg>
  );
}

// F1: WYSIWYG rich-text редактор (contentEditable). Кнопки реально форматируют
// через execCommand, списки продолжаются по Enter (нативно в браузере), значение
// хранится как HTML и рендерится с санитайзером в VacancyDetail/VacancyDetailModal.
function RichTextField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Активные форматы под курсором — чтобы кнопки визуально «нажимались»
  // (иначе жирный/курсив срабатывали, но было не видно, что применено).
  const [activeFormats, setActiveFormats] = useState<Record<string, boolean>>({});

  // Инициализация / внешняя синхронизация без перезаписи при наборе (курсор не прыгает).
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== (value || '')) el.innerHTML = value || '';
  }, [value]);

  const sync = () => onChange(ref.current?.innerHTML || '');

  const refreshActiveFormats = () => {
    if (document.activeElement !== ref.current) return;
    setActiveFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      insertUnorderedList: document.queryCommandState('insertUnorderedList'),
      insertOrderedList: document.queryCommandState('insertOrderedList'),
    });
  };

  // Курсор/выделение может двигаться кликом или стрелками без событий на самом
  // contentEditable — слушаем на уровне document и фильтруем по фокусу.
  useEffect(() => {
    document.addEventListener('selectionchange', refreshActiveFormats);
    return () => document.removeEventListener('selectionchange', refreshActiveFormats);
  }, []);

  const exec = (command: string, arg?: string) => {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(command, false, arg);
    sync();
    refreshActiveFormats();
  };

  const addLink = () => {
    if (disabled) return;
    const url = (window.prompt('Ссылка (URL):', 'https://') || '').trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast.error('Ссылка должна начинаться с http:// или https://');
      return;
    }
    ref.current?.focus();
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      document.execCommand('createLink', false, url);
    } else {
      document.execCommand('insertHTML', false, `<a href="${url}">${url}</a>`);
    }
    sync();
  };

  const btnClass = 'hf-vacancy-editor-btn flex items-center justify-center';

  return (
    <div className="hf-vacancy-editor">
      <div className="hf-vacancy-editor-toolbar flex items-center">
        <button type="button" aria-label="Жирный" aria-pressed={activeFormats.bold} disabled={disabled}
          className={clsx(btnClass, activeFormats.bold && 'hf-vacancy-editor-btn-active')}
          onMouseDown={(e) => { e.preventDefault(); exec('bold'); }}>
          <HfSpriteIcon id="bold" className="hf-vacancy-editor-icon" />
        </button>
        <button type="button" aria-label="Курсив" aria-pressed={activeFormats.italic} disabled={disabled}
          className={clsx(btnClass, activeFormats.italic && 'hf-vacancy-editor-btn-active')}
          onMouseDown={(e) => { e.preventDefault(); exec('italic'); }}>
          <HfSpriteIcon id="italic" className="hf-vacancy-editor-icon" />
        </button>
        <button type="button" aria-label="Подчёркнутый" aria-pressed={activeFormats.underline} disabled={disabled}
          className={clsx(btnClass, activeFormats.underline && 'hf-vacancy-editor-btn-active')}
          onMouseDown={(e) => { e.preventDefault(); exec('underline'); }}>
          <span className="text-[13px] font-semibold leading-none underline">U</span>
        </button>
        <button type="button" aria-label="Маркированный список" aria-pressed={activeFormats.insertUnorderedList} disabled={disabled}
          className={clsx(btnClass, activeFormats.insertUnorderedList && 'hf-vacancy-editor-btn-active')}
          onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }}>
          <HfSpriteIcon id="bullet-list" className="hf-vacancy-editor-icon" />
        </button>
        <button type="button" aria-label="Нумерованный список" aria-pressed={activeFormats.insertOrderedList} disabled={disabled}
          className={clsx(btnClass, activeFormats.insertOrderedList && 'hf-vacancy-editor-btn-active')}
          onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList'); }}>
          <HfSpriteIcon id="numbered-list" className="hf-vacancy-editor-icon" />
        </button>
        <button type="button" aria-label="Ссылка" disabled={disabled} className={btnClass}
          onMouseDown={(e) => { e.preventDefault(); addLink(); }}>
          <HfSpriteIcon id="link" className="hf-vacancy-editor-icon" />
        </button>
      </div>
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        onInput={sync}
        onKeyUp={refreshActiveFormats}
        onMouseUp={refreshActiveFormats}
        onFocus={refreshActiveFormats}
        onBlur={() => setActiveFormats({})}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
        className="hf-vacancy-textarea hf-vacancy-richtext"
      />
    </div>
  );
}

const WEEKDAYS_MON_FIRST = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function toDeadlineIso(y: number, m: number, d: number): string {
  // Дедлайн = конец выбранного дня. ВАЖНО: если писать T00:00:00, для «сегодня»
  // бэк (validate_closes_at, naive datetime.utcnow()) сочтёт момент уже прошедшим
  // и отклонит 422-й — «closes_at cannot be in the past».
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m + 1)}-${pad(d)}T23:59:59`;
}

// F-fix: «Без дедлайна» была нередактируемым readOnly-инпутом — просто текст,
// без реальной привязки к closes_at. Заменил на попап-календарь: сегодня и
// будущее кликабельны, прошлые дни — нет.
function DeadlinePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  const selectedDate = useMemo(() => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [value]);

  const [viewMonth, setViewMonth] = useState(() => {
    const base = selectedDate || today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => {
    if (open) {
      const base = selectedDate || today;
      setViewMonth(new Date(base.getFullYear(), base.getMonth(), 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest('[data-deadline-root]') && !target?.closest('[data-deadline-menu]')) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, [open]);

  const openPicker = () => {
    if (disabled) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ left: r.left, top: r.bottom + 4 });
    setOpen(true);
  };

  const monthLabel = viewMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const firstWeekday = (new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1).getDay() + 6) % 7;
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const displayValue = selectedDate
    ? selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Без дедлайна';

  const menu = open && menuPos ? createPortal(
    <div
      data-deadline-menu
      className="hf-vacancy-calendar-menu"
      style={{ left: menuPos.left, top: menuPos.top }}
    >
      <div className="hf-vacancy-calendar-header">
        <button
          type="button"
          className="hf-vacancy-calendar-nav"
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
          aria-label="Предыдущий месяц"
        >
          ‹
        </button>
        <span className="hf-vacancy-calendar-title">{monthLabel}</span>
        <button
          type="button"
          className="hf-vacancy-calendar-nav"
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
          aria-label="Следующий месяц"
        >
          ›
        </button>
      </div>
      <div className="hf-vacancy-calendar-weekdays">
        {WEEKDAYS_MON_FIRST.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="hf-vacancy-calendar-grid">
        {cells.map((day, i) => {
          if (day === null) return <span key={`blank-${i}`} />;
          const cellDate = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
          const isPast = cellDate < today;
          const isToday = cellDate.getTime() === today.getTime();
          const isSelected = !!selectedDate
            && cellDate.getFullYear() === selectedDate.getFullYear()
            && cellDate.getMonth() === selectedDate.getMonth()
            && cellDate.getDate() === selectedDate.getDate();
          return (
            <button
              key={day}
              type="button"
              disabled={isPast}
              className={clsx(
                'hf-vacancy-calendar-day',
                isPast && 'hf-vacancy-calendar-day-disabled',
                isToday && 'hf-vacancy-calendar-day-today',
                isSelected && 'hf-vacancy-calendar-day-selected',
              )}
              onClick={() => {
                onChange(toDeadlineIso(viewMonth.getFullYear(), viewMonth.getMonth(), day));
                setOpen(false);
              }}
            >
              {day}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="hf-vacancy-calendar-clear"
        onClick={() => { onChange(''); setOpen(false); }}
      >
        Без дедлайна
      </button>
    </div>,
    document.body,
  ) : null;

  return (
    <div data-deadline-root>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        className="hf-vacancy-input hf-vacancy-deadline-trigger"
        onClick={openPicker}
      >
        <span className={clsx(!selectedDate && 'hf-vacancy-deadline-placeholder')}>{displayValue}</span>
      </button>
      {menu}
    </div>
  );
}

function HuntflowClose28Icon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" className={className} fill="none">
      <path
        d="M19.833 8.167 8.167 19.833m0-11.666 11.666 11.666"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HuntflowChevronDown24Icon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none">
      <path
        d="M7.5 10.5 12 15l4.5-4.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HuntflowEyeOffIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none">
      <path
        d="m2.5 2.5 15 15M8.233 8.233A2.083 2.083 0 0 0 10 12.083c.557 0 1.063-.218 1.437-.573M6.821 6.821C4.04 8.116 2.5 10 2.5 10s2.727 5 7.5 5a8.53 8.53 0 0 0 3.179-.595M10 5c4.773 0 7.5 5 7.5 5a13.218 13.218 0 0 1-1.722 2.24"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HuntflowCheckIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none">
      <path
        d="m5 10.25 3.125 3.125L15 6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HuntflowFlagIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="currentColor">
      <path d="M5.5 3.75a.75.75 0 0 1 .75-.75h7.27a.75.75 0 0 1 .66 1.106l-1.58 2.925 1.58 2.925a.75.75 0 0 1-.66 1.106H7v5.188a.75.75 0 0 1-1.5 0V3.75Z" />
    </svg>
  );
}

export default function VacancyForm({ vacancy, prefillData, onClose, onSuccess }: VacancyFormProps) {
  const { user } = useAuthStore();
  const { vacancies, fetchVacancies } = useVacancyStore();

  // Режим заявки: рекрутёр без прав на редактирование смотрит чужую заявку.
  // - не админ
  // - не creator и не hiring_manager
  // - назначен (assigned_to / assigned_to_all)
  const isAdmin = user?.role === 'superadmin' || user?.org_role === 'owner' || user?.org_role === 'admin';
  const isMineByOwnership = !!(user && vacancy && (vacancy.created_by === user.id || vacancy.hiring_manager_id === user.id));
  const isAssignedToMe = !!(user && vacancy && (vacancy.assigned_to_all || (vacancy.assigned_to || []).includes(user.id)));
  const isReadOnlyRequest = !!vacancy && !isAdmin && !isMineByOwnership && isAssignedToMe;

  // Уже ли рекрутёр взял эту заявку (есть клон с cloned_from_request_id)
  const alreadyTaken = useMemo(() => {
    if (!isReadOnlyRequest || !vacancy || !user) return false;
    return vacancies.some(v =>
      v.created_by === user.id &&
      (v.extra_data as Record<string, unknown> | undefined)?.cloned_from_request_id === vacancy.id
    );
  }, [vacancies, vacancy, user, isReadOnlyRequest]);

  const [taking, setTaking] = useState(false);
  const handleTake = async () => {
    if (!vacancy) return;
    setTaking(true);
    try {
      await takeVacancy(vacancy.id);
      toast.success('Заявка взята в работу — открыта в "Мои вакансии"');
      await fetchVacancies();
      onClose();
    } catch {
      toast.error('Не удалось взять заявку');
    } finally {
      setTaking(false);
    }
  };

  const { createVacancy, updateVacancy, deleteVacancy } = useVacancyStore();
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<AssignableUser[]>([]);

  // Use prefillData when creating new vacancy, vacancy when editing
  const initialData = vacancy || prefillData;

  const [formData, setFormData] = useState({
    title: initialData?.title || '',
    description: initialData?.description || '',
    requirements: initialData?.requirements || '',
    responsibilities: initialData?.responsibilities || '',
    salary_min: initialData?.salary_min || '',
    salary_max: initialData?.salary_max || '',
    salary_currency: initialData?.salary_currency || 'RUB',
    location: initialData?.location || '',
    employment_type: initialData?.employment_type || '',
    experience_level: initialData?.experience_level || '',
    status: vacancy?.status || 'pending_review' as VacancyStatus,
    priority: vacancy?.priority || 0,
    tags: initialData?.tags?.join(', ') || '',
    hiring_manager_id: vacancy?.hiring_manager_id || '',
    visible_to_all: vacancy?.visible_to_all ?? initialData?.visible_to_all ?? true,
    closes_at: vacancy?.closes_at || '',
  });

  const [selectedRecruiters, setSelectedRecruiters] = useState<number[]>(vacancy?.assigned_to || []);
  const [assignAll, setAssignAll] = useState(vacancy?.assigned_to_all ?? false);
  const [showRecruiterDD, setShowRecruiterDD] = useState(false);
  const [openSelectId, setOpenSelectId] = useState<string | null>(null);
  const [selectMenuRect, setSelectMenuRect] = useState<HfSelectMenuRect | null>(null);

  useEffect(() => {
    getAssignableUsers()
      .then(setUsers)
      .catch((err) => console.error('Failed to load assignable users:', err));
  }, []);

  useEffect(() => {
    const closeSelect = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest("[data-hf-select-root]") && !target?.closest("[data-hf-select-menu]")) {
        setOpenSelectId(null);
        setSelectMenuRect(null);
      }
    };

    document.addEventListener("pointerdown", closeSelect);
    return () => document.removeEventListener("pointerdown", closeSelect);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnlyRequest) return;
    if (!formData.title.trim()) {
      toast.error('Введите название вакансии');
      return;
    }
    if (formData.title.trim().length < 3) {
      // На бэке validate_title требует ≥3 символов — раньше падало 422 с общим
      // тостом «Ошибка при создании», и было непонятно, что не так.
      toast.error('Название должно содержать минимум 3 символа');
      return;
    }

    const minNum = formData.salary_min !== '' ? Number(formData.salary_min) : null;
    const maxNum = formData.salary_max !== '' ? Number(formData.salary_max) : null;
    if ((minNum !== null && minNum < 0) || (maxNum !== null && maxNum < 0)) {
      toast.error('Зарплата не может быть отрицательной');
      return;
    }
    if (minNum !== null && maxNum !== null && minNum > maxNum) {
      toast.error('"Зарплата от" не может быть больше "Зарплата до"');
      return;
    }

    setLoading(true);
    try {
      const data = {
        title: formData.title.trim(),
        description: formData.description.trim() || undefined,
        requirements: formData.requirements.trim() || undefined,
        responsibilities: formData.responsibilities.trim() || undefined,
        salary_min: formData.salary_min ? parseInt(String(formData.salary_min)) : undefined,
        salary_max: formData.salary_max ? parseInt(String(formData.salary_max)) : undefined,
        salary_currency: formData.salary_currency,
        location: formData.location.trim() || undefined,
        employment_type: formData.employment_type || undefined,
        experience_level: formData.experience_level || undefined,
        status: formData.status,
        priority: formData.priority,
        tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
        visible_to_all: formData.visible_to_all,
        hiring_manager_id: formData.hiring_manager_id ? parseInt(String(formData.hiring_manager_id)) : undefined,
        // ВАЖНО: при редактировании бэк применяет model_dump(exclude_unset=True) —
        // undefined убирает ключ из JSON и старый closes_at НЕ очистится. Нужен
        // явный null, чтобы «Без дедлайна» реально снимал ранее сохранённый дедлайн.
        closes_at: formData.closes_at || null,
      };

      if (vacancy) {
        await updateVacancy(vacancy.id, data);
        // Save recruiter assignments
        await assignVacancy(vacancy.id, selectedRecruiters, assignAll);
        toast.success('Вакансия обновлена');
      } else {
        const created = await createVacancy(data);
        // Save recruiter assignments for new vacancy
        if (selectedRecruiters.length > 0 || assignAll) {
          await assignVacancy(created.id, selectedRecruiters, assignAll);
        }
        toast.success('Вакансия создана');
      }
      onSuccess();
    } catch (error) {
      // Достаём реальную причину из ответа бэка (422 валидация / 403 и т.п.),
      // иначе показываем общий текст.
      const err = error as { response?: { data?: { detail?: unknown } } };
      const detail = err?.response?.data?.detail;
      let msg = vacancy ? 'Ошибка при обновлении' : 'Ошибка при создании';
      if (typeof detail === 'string') {
        msg = detail;
      } else if (Array.isArray(detail) && detail[0] && typeof detail[0] === 'object') {
        const first = detail[0] as { msg?: string };
        if (first.msg) msg = first.msg;
      }
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Действия над существующей вакансией: закрыть / в архив / удалить.
  const [statusAction, setStatusAction] = useState(false);
  const runStatusAction = async (status: VacancyStatus, msg: string) => {
    if (!vacancy) return;
    setStatusAction(true);
    try {
      await updateVacancy(vacancy.id, { status });
      toast.success(msg);
      onSuccess();
      onClose();
    } catch (_) {
      toast.error('Не удалось изменить статус вакансии');
    } finally {
      setStatusAction(false);
    }
  };
  const handleDeleteVacancy = async () => {
    if (!vacancy) return;
    if (!window.confirm('Удалить вакансию навсегда? Её заявки и история тоже удалятся. Действие необратимо.')) return;
    setStatusAction(true);
    try {
      await deleteVacancy(vacancy.id);
      toast.success('Вакансия удалена');
      onSuccess();
      onClose();
    } catch (_) {
      toast.error('Не удалось удалить вакансию');
    } finally {
      setStatusAction(false);
    }
  };

  const hfLabelClass = "hf-vacancy-label";
  const hfInputClass = "hf-vacancy-input";

  const HfSelect = ({
    id,
    value,
    options,
    disabled,
    showSelectedIcon,
    onChange,
  }: {
    id: string;
    value: string | number;
    options: HfSelectOption[];
    disabled?: boolean;
    showSelectedIcon?: boolean;
    onChange?: (value: string) => void;
  }) => {
    const isOpen = openSelectId === id && !disabled;
    const selectedOption = options.find((option) => String(option.value) === String(value)) || options[0];
    const menu = isOpen && selectMenuRect?.id === id ? createPortal(
      <div
        className="hf-vacancy-select-menu"
        data-hf-select-menu
        style={{
          left: selectMenuRect.left,
          top: selectMenuRect.top,
        }}
      >
        {options.map((option) => {
          const isSelected = String(option.value) === String(value);
          const icon = option.icon || (showSelectedIcon && isSelected ? <HuntflowCheckIcon className="hf-vacancy-select-icon-svg" /> : null);
          return (
            <button
              key={String(option.value)}
              type="button"
              className={clsx("hf-vacancy-select-option", isSelected && "hf-vacancy-select-option-active")}
              onMouseDown={(event) => {
                event.preventDefault();
                onChange?.(String(option.value));
                setOpenSelectId(null);
                setSelectMenuRect(null);
              }}
            >
              <span className="hf-vacancy-select-option-inner">
                <span className="hf-vacancy-select-option-icon">
                  {icon}
                </span>
                <span className="truncate">{option.label}</span>
              </span>
            </button>
          );
        })}
      </div>,
      document.body,
    ) : null;

    return (
      <div className="hf-vacancy-select-wrap" data-hf-select-root>
        <button
          type="button"
          disabled={disabled}
          className={clsx(hfInputClass, "hf-vacancy-select-trigger", isOpen && "hf-vacancy-select-trigger-open")}
          onClick={(event) => {
            if (isOpen) {
              setOpenSelectId(null);
              setSelectMenuRect(null);
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            setOpenSelectId(id);
            setSelectMenuRect({
              id,
              left: rect.left,
              top: rect.bottom + Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hf-vacancy-select-menu-top")),
            });
          }}
        >
          <span className="hf-vacancy-select-label">
            <span className="truncate">{selectedOption?.label}</span>
          </span>
          <HuntflowChevronDown24Icon className="hf-vacancy-select-chevron" />
        </button>
        {menu}
      </div>
    );
  };

  // markdown applyEditorFormat удалён — теперь WYSIWYG (см. RichTextField выше).

  const renderEditor = (
    value: string,
    onChange: (value: string) => void,
  ) => (
    <RichTextField value={value} onChange={onChange} disabled={isReadOnlyRequest} />
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="hf-vacancy-modal-overlay font-hf-body"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="hf-vacancy-modal"
      >
        <div className="hf-vacancy-modal-header">
          <h2 className="hf-vacancy-modal-title">
            {isReadOnlyRequest ? 'Заявка' : (vacancy ? 'Редактировать заявку' : 'Новая заявка')}
          </h2>
          <div className="hf-vacancy-header-actions">
          <button
            onClick={onClose}
              className="hf-vacancy-close-btn"
          >
              <HuntflowClose28Icon className="hf-vacancy-close-icon" />
          </button>
          </div>
        </div>

        <form
          id="vacancy-form"
          onSubmit={handleSubmit}
          className="hf-vacancy-form-scroll"
        >
          <div className="hf-vacancy-modal-grid grid min-h-full">
            <div className="hf-vacancy-modal-main grid">
              <div>
                <label className={hfLabelClass}>Должность</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  disabled={isReadOnlyRequest}
                  className={hfInputClass}
                />
              </div>

              <div>
                <label className={hfLabelClass}>Зарплата</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                  {/* Сумма с авто-подстановкой символа выбранной валюты (₽/$). */}
                  <div style={{ position: 'relative', flex: 1 }}>
                    <span
                      style={{
                        position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                        color: 'var(--hf-main-500)', fontSize: 14, pointerEvents: 'none',
                      }}
                    >
                      {getCurrencySymbol(formData.salary_currency)}
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={formData.salary_min || formData.salary_max}
                      onChange={(e) => setFormData({ ...formData, salary_min: e.target.value, salary_max: e.target.value })}
                      disabled={isReadOnlyRequest}
                      className="hf-vacancy-input hf-vacancy-salary-input"
                      style={{ paddingLeft: 26 }}
                    />
                  </div>
                  {/* Валюта — только рубль или доллар. */}
                  <div style={{ width: 150, flexShrink: 0 }}>
                    <HfSelect
                      id="salary_currency"
                      value={formData.salary_currency}
                      options={SALARY_INPUT_CURRENCIES}
                      onChange={(value) => setFormData({ ...formData, salary_currency: String(value) })}
                      disabled={isReadOnlyRequest}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className={hfLabelClass}>Описание вакансии</label>
                {renderEditor(
                  formData.description,
                  (value) => setFormData({ ...formData, description: value }),
                )}
              </div>

              <div>
                <label className={hfLabelClass}>Обязанности</label>
                {renderEditor(
                  formData.responsibilities,
                  (value) => setFormData({ ...formData, responsibilities: value }),
                )}
              </div>

              <div>
                <label className={hfLabelClass}>Требования</label>
                {renderEditor(
                  formData.requirements,
                  (value) => setFormData({ ...formData, requirements: value }),
                )}
              </div>
            </div>

            <aside className="hf-vacancy-modal-aside">
              {!isReadOnlyRequest && isAdmin && (
                <div className="hf-vacancy-recruiters">
                  <label className={hfLabelClass}>Назначенные рекрутеры</label>
                  <div className="hf-vacancy-recruiter-row">
                    <span className="hf-vacancy-avatar">Я</span>
                    <span className="truncate">Я, {user?.name || user?.email || "Профиль"}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRecruiterDD(!showRecruiterDD)}
                    className="hf-vacancy-side-link hf-vacancy-recruiter-add"
                  >
                    + Добавить
                  </button>
                  {showRecruiterDD && (
                    <div className="hf-vacancy-dropdown">
                      <button
                        type="button"
                        onClick={() => { setAssignAll(!assignAll); if (!assignAll) setSelectedRecruiters([]); }}
                        className="hf-vacancy-dropdown-item"
                      >
                        <span className={clsx("hf-vacancy-dropdown-check", assignAll && "hf-vacancy-dropdown-check-active")} />
                        Всем рекрутерам
                      </button>
                      {users.map((u) => {
                        const isSelected = selectedRecruiters.includes(u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => {
                              setSelectedRecruiters(isSelected
                                ? selectedRecruiters.filter(id => id !== u.id)
                                : [...selectedRecruiters, u.id]
                              );
                            }}
                            className="hf-vacancy-dropdown-item"
                          >
                            <span className={clsx("hf-vacancy-dropdown-check", isSelected && "hf-vacancy-dropdown-check-active")} />
                            <span className="truncate">{u.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="hf-vacancy-side-stack">
                <div className="hf-vacancy-side-section">
                  <label className="hf-vacancy-side-title">Сколько человек нужно нанять</label>
                  <input className={hfInputClass} defaultValue="1" />
                </div>
                <div>
                  <label className={hfLabelClass}>Дедлайн</label>
                  <DeadlinePicker
                    value={formData.closes_at}
                    onChange={(value) => setFormData({ ...formData, closes_at: value })}
                    disabled={isReadOnlyRequest}
                  />
                </div>
                <div>
                  <label className={hfLabelClass}>Видимость</label>
                  <HfSelect
                    id="visibility"
                    value={formData.visible_to_all ? "all" : "private"}
                    options={[
                      { value: "all", label: "Видна коллегам" },
                      { value: "private", label: "Скрыта от коллег", icon: <HuntflowEyeOffIcon className="hf-vacancy-select-icon-svg" /> },
                    ]}
                    onChange={(value) => setFormData({ ...formData, visible_to_all: value === "all" })}
                  />
                </div>
                <div>
                  <label className={hfLabelClass}>Приоритет</label>
                  <HfSelect
                    id="priority"
                    value={formData.priority}
                    options={[
                      { value: 0, label: "Обычный" },
                      { value: 1, label: "Высокий", icon: <HuntflowFlagIcon className="hf-vacancy-select-icon-svg hf-vacancy-select-icon-danger" /> },
                    ]}
                    onChange={(value) => setFormData({ ...formData, priority: parseInt(value) })}
                    disabled={isReadOnlyRequest}
                  />
                </div>
                {vacancy && !isReadOnlyRequest && (
                  <div className="mt-[var(--hf-space-l)] pt-[var(--hf-space-l)] border-t border-[var(--hf-ui-border)] flex flex-col gap-[8px]">
                    <span className={hfLabelClass}>Действия с вакансией</span>
                    <button
                      type="button"
                      onClick={() => runStatusAction('closed', 'Вакансия закрыта')}
                      disabled={statusAction}
                      className="w-full h-[36px] rounded-[8px] border border-[var(--hf-ui-border)] text-[13px] font-medium text-[var(--hf-main-800)] transition-colors hover:bg-[var(--hf-ui-hover)] disabled:opacity-50"
                    >
                      Закрыть вакансию
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteVacancy}
                      disabled={statusAction}
                      className="w-full h-[36px] rounded-[8px] border border-[var(--hf-status-red-badge)] text-[13px] font-medium text-[var(--hf-status-red)] transition-colors hover:bg-[var(--hf-status-red-badge)] disabled:opacity-50"
                    >
                      Удалить вакансию
                    </button>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </form>

        <div className="hf-vacancy-footer">
          {isReadOnlyRequest ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="hf-vacancy-secondary-btn"
              >
                Закрыть
              </button>
              {!alreadyTaken && (
              <button
                onClick={handleTake}
                disabled={taking}
                  className="hf-vacancy-primary-btn"
              >
                  {taking ? <Loader2 className="hf-vacancy-button-icon animate-spin" /> : <PlayCircle className="hf-vacancy-button-icon" />}
                {taking ? 'Беру...' : 'Взять в работу'}
              </button>
              )}
            </>
          ) : (
            <>
              <button
                type="submit"
                form="vacancy-form"
                disabled={loading}
                className="hf-vacancy-primary-btn"
              >
                {loading ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="hf-vacancy-secondary-btn"
              >
                Отмена
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
