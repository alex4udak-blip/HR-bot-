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
import { getDepartments, getAssignableUsers, assignVacancy, takeVacancy } from '@/services/api';
import type { Department, AssignableUser } from '@/services/api';
import { getStatusTemplates, type StatusTemplate } from '@/services/api/auth';

// EntityStatus-ключ шаблона → ApplicationStage-ключ колонки канбана.
// custom_stages.columns должны содержать ApplicationStage-значения.
const TEMPLATE_KEY_TO_APP_STAGE: Record<string, string> = {
  new: 'applied',
  screening: 'screening',
  practice: 'phone_screen',
  tech_practice: 'interview',
  is_interview: 'assessment',
  offer: 'offer',
  hired: 'hired',
  rejected: 'rejected',
};

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

  // Инициализация / внешняя синхронизация без перезаписи при наборе (курсор не прыгает).
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== (value || '')) el.innerHTML = value || '';
  }, [value]);

  const sync = () => onChange(ref.current?.innerHTML || '');

  const exec = (command: string, arg?: string) => {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(command, false, arg);
    sync();
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
        <button type="button" aria-label="Жирный" disabled={disabled} className={btnClass}
          onMouseDown={(e) => { e.preventDefault(); exec('bold'); }}>
          <HfSpriteIcon id="bold" className="hf-vacancy-editor-icon" />
        </button>
        <button type="button" aria-label="Курсив" disabled={disabled} className={btnClass}
          onMouseDown={(e) => { e.preventDefault(); exec('italic'); }}>
          <HfSpriteIcon id="italic" className="hf-vacancy-editor-icon" />
        </button>
        <button type="button" aria-label="Подчёркнутый" disabled={disabled} className={btnClass}
          onMouseDown={(e) => { e.preventDefault(); exec('underline'); }}>
          <span className="text-[13px] font-semibold leading-none underline">U</span>
        </button>
        <button type="button" aria-label="Маркированный список" disabled={disabled} className={btnClass}
          onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }}>
          <HfSpriteIcon id="bullet-list" className="hf-vacancy-editor-icon" />
        </button>
        <button type="button" aria-label="Нумерованный список" disabled={disabled} className={btnClass}
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

  const { createVacancy, updateVacancy } = useVacancyStore();
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [statusTemplates, setStatusTemplates] = useState<StatusTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

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
    department_id: vacancy?.department_id || '',
    hiring_manager_id: vacancy?.hiring_manager_id || '',
    visible_to_all: vacancy?.visible_to_all ?? initialData?.visible_to_all ?? true,
  });

  const [selectedRecruiters, setSelectedRecruiters] = useState<number[]>(vacancy?.assigned_to || []);
  const [assignAll, setAssignAll] = useState(vacancy?.assigned_to_all ?? false);
  const [showRecruiterDD, setShowRecruiterDD] = useState(false);
  const [openSelectId, setOpenSelectId] = useState<string | null>(null);
  const [selectMenuRect, setSelectMenuRect] = useState<HfSelectMenuRect | null>(null);

  useEffect(() => {
    // Load departments and users independently so one failure doesn't block the other
    getDepartments(-1)
      .then(setDepartments)
      .catch((err) => console.error('Failed to load departments:', err));
    getAssignableUsers()
      .then(setUsers)
      .catch((err) => console.error('Failed to load assignable users:', err));
    getStatusTemplates()
      .then((r) => setStatusTemplates(r.templates))
      .catch((err) => console.error('Failed to load status templates:', err));
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
      // Выбранный шаблон статусов → custom_stages воронки. Ключи шаблона
      // (EntityStatus) конвертируем в ApplicationStage для колонок канбана.
      const selectedTemplate = statusTemplates.find(t => t.id === selectedTemplateId);
      const customStages = selectedTemplate
        ? {
            columns: selectedTemplate.stages.map(s => {
              const appKey = TEMPLATE_KEY_TO_APP_STAGE[s.key] || s.key;
              return { key: appKey, maps_to: appKey, label: s.label, visible: true };
            }),
          }
        : undefined;

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
        department_id: formData.department_id ? parseInt(String(formData.department_id)) : undefined,
        hiring_manager_id: formData.hiring_manager_id ? parseInt(String(formData.hiring_manager_id)) : undefined,
        ...(customStages ? { custom_stages: customStages } : {}),
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
      toast.error(vacancy ? 'Ошибка при обновлении' : 'Ошибка при создании');
    } finally {
      setLoading(false);
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
                <label className={hfLabelClass}>Отдел, подразделение</label>
                <HfSelect
                  id="department"
                  value={formData.department_id}
                  options={[
                    { value: "", label: "Не выбрано" },
                    ...departments.map((dept) => ({ value: dept.id, label: dept.name })),
                  ]}
                  onChange={(value) => setFormData({ ...formData, department_id: value })}
                  disabled={isReadOnlyRequest}
                />
              </div>

              <div>
                <label className={hfLabelClass}>Зарплата</label>
                <input
                  type="number"
                  min={0}
                  value={formData.salary_min || formData.salary_max}
                  onChange={(e) => setFormData({ ...formData, salary_min: e.target.value })}
                  disabled={isReadOnlyRequest}
                  className="hf-vacancy-input hf-vacancy-salary-input"
                />
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

              <div>
                <label className={hfLabelClass}>Условия работы</label>
                {renderEditor(
                  formData.description,
                  (value) => setFormData({ ...formData, description: value }),
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
                  <div className="hf-vacancy-people-grid">
                    <input className={hfInputClass} defaultValue="1" />
                    <input
                      className="hf-vacancy-input"
                      value="Без дедлайна"
                      readOnly
                    />
                  </div>
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
                <div>
                  <label className={hfLabelClass}>Шаблон статусов</label>
                  <HfSelect
                    id="status-template"
                    value={selectedTemplateId}
                    options={[
                      { value: "", label: "Все этапы (по умолчанию)" },
                      ...statusTemplates.map((t) => ({ value: t.id, label: t.name })),
                    ]}
                    onChange={(value) => setSelectedTemplateId(String(value))}
                    showSelectedIcon
                    disabled={isReadOnlyRequest}
                  />
                </div>
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
