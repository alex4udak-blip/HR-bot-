import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import {
  Plus,
  Trash2,
  GripVertical,
  Copy,
  Eye,
  Save,
  ArrowLeft,
  FileText,
  Mail,
  Phone,
  AlignLeft,
  List,
  CheckSquare,
  CircleDot,
  Upload,
  ExternalLink,
  Users,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import {
  getMyForms,
  createForm,
  getForm,
  updateForm,
  deleteForm,
  getFormSubmissions,
} from '@/services/api/forms';
import type { FormTemplate, FormField, FormSubmission } from '@/services/api/forms';

// ============================================================
// Field type config
// ============================================================

const FIELD_TYPES: { type: FormField['type']; label: string; icon: React.ElementType }[] = [
  { type: 'text', label: 'Текст', icon: FileText },
  { type: 'email', label: 'Email', icon: Mail },
  { type: 'phone', label: 'Телефон', icon: Phone },
  { type: 'textarea', label: 'Текстовое поле', icon: AlignLeft },
  { type: 'select', label: 'Выбор одного', icon: List },
  { type: 'multiselect', label: 'Множественный выбор', icon: CheckSquare },
  { type: 'radio', label: 'Радио-кнопки', icon: CircleDot },
  { type: 'file', label: 'Файл', icon: Upload },
  { type: 'url', label: 'Ссылка (URL)', icon: ExternalLink },
];

const TYPE_LABELS: Record<string, string> = {
  text: 'Текст',
  email: 'Email',
  phone: 'Телефон',
  textarea: 'Текстовое поле',
  select: 'Выбор одного',
  multiselect: 'Множественный выбор',
  radio: 'Радио-кнопки',
  file: 'Файл',
  url: 'Ссылка (URL)',
};

let fieldCounter = 0;
function nextFieldId(): string {
  fieldCounter += 1;
  return `f${Date.now()}_${fieldCounter}`;
}

// ============================================================
// List mode component
// ============================================================

function FormListView() {
  const navigate = useNavigate();
  const [forms, setForms] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const loadForms = useCallback(async () => {
    try {
      const data = await getMyForms();
      setForms(data);
    } catch {
      toast.error('Не удалось загрузить формы');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadForms(); }, [loadForms]);

  const handleCreate = async () => {
    try {
      const form = await createForm({
        title: 'Новая анкета',
        fields: [
          { id: nextFieldId(), type: 'text', label: 'ФИО', required: true, placeholder: 'Иван Иванов' },
          { id: nextFieldId(), type: 'email', label: 'Email', required: true },
        ],
      });
      navigate(`/form-builder/${form.id}`);
    } catch {
      toast.error('Не удалось создать форму');
    }
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Удалить форму? Все ответы будут потеряны.')) return;
    try {
      await deleteForm(id);
      setForms(prev => prev.filter(f => f.id !== id));
      toast.success('Форма удалена');
    } catch {
      toast.error('Не удалось удалить');
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Конструктор форм</h1>
          <p className="text-dark-400 text-sm mt-1">
            Создавайте анкеты для кандидатов и делитесь ссылкой
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent-500 hover:bg-accent-600 text-white rounded-xl font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Создать форму
        </button>
      </div>

      {forms.length === 0 ? (
        <div className="text-center py-20 text-dark-400">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg">Пока нет форм</p>
          <p className="text-sm mt-1">Создайте первую форму для сбора анкет кандидатов</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {forms.map(form => (
            <motion.div
              key={form.id}
              layout
              onClick={() => navigate(`/form-builder/${form.id}`)}
              className="bg-dark-800 border border-dark-700 rounded-xl p-4 hover:border-dark-600 cursor-pointer transition-colors group"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-white truncate">{form.title}</h3>
                    {!form.is_active && (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-dark-600 text-dark-400">
                        Неактивна
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-dark-400">
                    <span>{form.fields.length} {fieldWord(form.fields.length)}</span>
                    <span>{form.submissions_count} {submissionWord(form.submissions_count)}</span>
                    {form.created_at && (
                      <span>{new Date(form.created_at).toLocaleDateString('ru')}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const url = `${window.location.origin}/form/${form.slug}`;
                      navigator.clipboard.writeText(url);
                      toast.success('Ссылка скопирована');
                    }}
                    className="p-2 rounded-lg hover:bg-dark-700 text-dark-400 hover:text-white transition-colors"
                    title="Скопировать ссылку"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => handleDelete(form.id, e)}
                    className="p-2 rounded-lg hover:bg-red-500/20 text-dark-400 hover:text-red-400 transition-colors"
                    title="Удалить"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Edit mode component
// ============================================================

function FormEditView({ formId }: { formId: number }) {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormTemplate | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [showSubmissions, setShowSubmissions] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [selectedVacancyIds, setSelectedVacancyIds] = useState<number[]>([]);
  const [vacancies, setVacancies] = useState<{ id: number; title: string }[]>([]);

  useEffect(() => {
    // Load vacancies for multi-select
    import('@/services/api').then(api => {
      api.getVacancies().then((vacs: { id: number; title: string }[]) => setVacancies(vacs));
    });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await getForm(formId);
        setForm(data);
        setTitle(data.title);
        setDescription(data.description || '');
        setIsActive(data.is_active);
        setFields(data.fields || []);
        setSelectedVacancyIds(data.vacancy_ids || (data.vacancy_id ? [data.vacancy_id] : []));
      } catch {
        toast.error('Форма не найдена');
        navigate('/form-builder');
      } finally {
        setLoading(false);
      }
    })();
  }, [formId, navigate]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('Введите название формы');
      return;
    }
    setSaving(true);
    try {
      const updated = await updateForm(formId, {
        title: title.trim(),
        description: description.trim() || undefined,
        fields,
        is_active: isActive,
        vacancy_ids: selectedVacancyIds,
      });
      setForm(updated);
      toast.success('Форма сохранена');
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const addField = (type: FormField['type']) => {
    const label = TYPE_LABELS[type] || type;
    const newField: FormField = {
      id: nextFieldId(),
      type,
      label,
      required: false,
    };
    if (['select', 'multiselect', 'radio'].includes(type)) {
      newField.options = ['Вариант 1', 'Вариант 2'];
    }
    setFields(prev => [...prev, newField]);
    setEditingFieldId(newField.id);
  };

  const removeField = (id: string) => {
    setFields(prev => prev.filter(f => f.id !== id));
    if (editingFieldId === id) setEditingFieldId(null);
  };

  const updateField = (id: string, updates: Partial<FormField>) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const loadSubmissions = async () => {
    try {
      const data = await getFormSubmissions(formId);
      setSubmissions(data);
      setShowSubmissions(true);
    } catch {
      toast.error('Не удалось загрузить ответы');
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!form) return null;

  const publicUrl = `${window.location.origin}/form/${form.slug}`;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/form-builder')}
          className="p-2 rounded-lg hover:bg-dark-700 text-dark-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="text-xl font-bold text-white bg-transparent border-none outline-none w-full placeholder-dark-500"
            placeholder="Название формы"
          />
          <div className="flex items-center gap-3 mt-1">
            <button
              onClick={() => { navigator.clipboard.writeText(publicUrl); toast.success('Ссылка скопирована'); }}
              className="flex items-center gap-1 text-xs text-accent-400 hover:text-accent-300 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              {publicUrl}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsActive(!isActive)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-dark-700 text-dark-400'
            )}
          >
            {isActive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
            {isActive ? 'Активна' : 'Неактивна'}
          </button>
          <button
            onClick={loadSubmissions}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:text-white hover:bg-dark-600 text-sm transition-colors"
          >
            <Users className="w-4 h-4" />
            Ответы ({form.submissions_count})
          </button>
          <button
            onClick={() => window.open(publicUrl, '_blank')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:text-white hover:bg-dark-600 text-sm transition-colors"
          >
            <Eye className="w-4 h-4" />
            Предпросмотр
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="mb-4">
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="w-full px-3 py-2 bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-300 placeholder-dark-500 outline-none focus:border-dark-600"
          placeholder="Описание формы (необязательно)"
        />
      </div>

      {/* Linked vacancies (multi-select) */}
      <div className="mb-4">
        <label className="block text-sm text-dark-400 mb-1.5">Привязанные воронки</label>
        <div className="flex flex-wrap gap-2">
          {vacancies.map(v => {
            const selected = selectedVacancyIds.includes(v.id);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setSelectedVacancyIds(prev =>
                    selected ? prev.filter(id => id !== v.id) : [...prev, v.id]
                  );
                }}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm border transition-colors',
                  selected
                    ? 'bg-accent-500/20 border-accent-500/50 text-accent-400'
                    : 'bg-dark-800 border-dark-700 text-dark-400 hover:border-dark-600'
                )}
              >
                {v.title}
              </button>
            );
          })}
          {vacancies.length === 0 && (
            <span className="text-dark-500 text-sm">Нет доступных вакансий</span>
          )}
        </div>
      </div>

      {/* Add field buttons */}
      <div className="flex flex-wrap gap-2 mb-6">
        {FIELD_TYPES.map(ft => {
          const Icon = ft.icon;
          return (
            <button
              key={ft.type}
              onClick={() => addField(ft.type)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-300 hover:text-white hover:border-dark-600 transition-colors"
            >
              <Icon className="w-3.5 h-3.5" />
              {ft.label}
            </button>
          );
        })}
      </div>

      {/* Fields list */}
      {fields.length === 0 ? (
        <div className="text-center py-12 text-dark-500 border border-dashed border-dark-700 rounded-xl">
          <AlignLeft className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>Добавьте поля с помощью кнопок выше</p>
        </div>
      ) : (
        <Reorder.Group
          axis="y"
          values={fields}
          onReorder={setFields}
          className="space-y-2"
        >
          {fields.map((field, index) => (
            <Reorder.Item key={field.id} value={field}>
              <FieldCard
                field={field}
                index={index}
                isEditing={editingFieldId === field.id}
                onEdit={() => setEditingFieldId(editingFieldId === field.id ? null : field.id)}
                onRemove={() => removeField(field.id)}
                onUpdate={(updates) => updateField(field.id, updates)}
              />
            </Reorder.Item>
          ))}
        </Reorder.Group>
      )}

      {/* Submissions modal */}
      <AnimatePresence>
        {showSubmissions && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={() => setShowSubmissions(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-dark-800 border border-dark-700 rounded-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="px-6 py-4 border-b border-dark-700 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Ответы ({submissions.length})</h2>
                <button onClick={() => setShowSubmissions(false)} className="text-dark-400 hover:text-white">
                  &times;
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                {submissions.length === 0 ? (
                  <p className="text-center text-dark-500 py-8">Пока нет ответов</p>
                ) : (
                  <div className="space-y-4">
                    {submissions.map(sub => (
                      <div key={sub.id} className="bg-dark-900 border border-dark-700 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-sm font-medium text-white">
                            {sub.entity?.name || 'Без имени'}
                            {sub.entity?.email && (
                              <span className="text-dark-400 ml-2">{sub.entity.email}</span>
                            )}
                          </div>
                          <span className="text-xs text-dark-500">
                            {sub.submitted_at && new Date(sub.submitted_at).toLocaleString('ru')}
                          </span>
                        </div>
                        <div className="space-y-1 text-sm">
                          {fields.map(field => {
                            const val = sub.data[field.id];
                            if (val === undefined || val === null || val === '') return null;
                            return (
                              <div key={field.id} className="flex gap-2">
                                <span className="text-dark-400 min-w-[120px]">{field.label}:</span>
                                <span className="text-dark-200">
                                  {Array.isArray(val) ? val.join(', ') : String(val)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// Field card component
// ============================================================

function FieldCard({
  field,
  index,
  isEditing,
  onEdit,
  onRemove,
  onUpdate,
}: {
  field: FormField;
  index: number;
  isEditing: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onUpdate: (updates: Partial<FormField>) => void;
}) {
  const hasOptions = ['select', 'multiselect', 'radio'].includes(field.type);
  const [newOption, setNewOption] = useState('');

  return (
    <div
      className={clsx(
        'bg-dark-800 border rounded-xl transition-colors',
        isEditing ? 'border-accent-500/50' : 'border-dark-700 hover:border-dark-600'
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={onEdit}>
        <GripVertical className="w-4 h-4 text-dark-500 cursor-grab shrink-0" />
        <span className="text-dark-500 text-sm font-mono w-6">{index + 1}.</span>
        <span className="font-medium text-white flex-1 truncate">
          {field.label}
          {field.required && <span className="text-red-400 ml-1">*</span>}
        </span>
        <span className="text-xs text-dark-500 px-2 py-0.5 bg-dark-700 rounded-md">
          {TYPE_LABELS[field.type] || field.type}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          className="p-1 rounded hover:bg-red-500/20 text-dark-500 hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <AnimatePresence>
        {isEditing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-dark-700 pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-dark-400 mb-1 block">Название поля</label>
                  <input
                    value={field.label}
                    onChange={e => onUpdate({ label: e.target.value })}
                    className="w-full px-3 py-1.5 bg-dark-900 border border-dark-600 rounded-lg text-sm text-white outline-none focus:border-accent-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-dark-400 mb-1 block">Placeholder</label>
                  <input
                    value={field.placeholder || ''}
                    onChange={e => onUpdate({ placeholder: e.target.value || undefined })}
                    className="w-full px-3 py-1.5 bg-dark-900 border border-dark-600 rounded-lg text-sm text-white outline-none focus:border-accent-500"
                    placeholder="Подсказка..."
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-dark-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={e => onUpdate({ required: e.target.checked })}
                    className="w-4 h-4 rounded border-dark-600 bg-dark-900 text-accent-500 focus:ring-accent-500"
                  />
                  Обязательное поле
                </label>

                <label className="text-xs text-dark-400">Тип:</label>
                <select
                  value={field.type}
                  onChange={e => {
                    const newType = e.target.value as FormField['type'];
                    const updates: Partial<FormField> = { type: newType };
                    if (['select', 'multiselect', 'radio'].includes(newType) && !field.options?.length) {
                      updates.options = ['Вариант 1', 'Вариант 2'];
                    }
                    onUpdate(updates);
                  }}
                  className="px-2 py-1 bg-dark-900 border border-dark-600 rounded-lg text-sm text-white outline-none"
                >
                  {FIELD_TYPES.map(ft => (
                    <option key={ft.type} value={ft.type}>{ft.label}</option>
                  ))}
                </select>
              </div>

              {hasOptions && (
                <div>
                  <label className="text-xs text-dark-400 mb-1 block">Варианты ответа</label>
                  <div className="space-y-1">
                    {(field.options || []).map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          value={opt}
                          onChange={e => {
                            const newOpts = [...(field.options || [])];
                            newOpts[i] = e.target.value;
                            onUpdate({ options: newOpts });
                          }}
                          className="flex-1 px-3 py-1 bg-dark-900 border border-dark-600 rounded-lg text-sm text-white outline-none focus:border-accent-500"
                        />
                        <button
                          onClick={() => {
                            const newOpts = (field.options || []).filter((_, j) => j !== i);
                            onUpdate({ options: newOpts });
                          }}
                          className="p-1 text-dark-500 hover:text-red-400"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <input
                        value={newOption}
                        onChange={e => setNewOption(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && newOption.trim()) {
                            onUpdate({ options: [...(field.options || []), newOption.trim()] });
                            setNewOption('');
                          }
                        }}
                        placeholder="Добавить вариант..."
                        className="flex-1 px-3 py-1 bg-dark-900 border border-dashed border-dark-600 rounded-lg text-sm text-dark-400 outline-none focus:border-accent-500"
                      />
                      <button
                        onClick={() => {
                          if (newOption.trim()) {
                            onUpdate({ options: [...(field.options || []), newOption.trim()] });
                            setNewOption('');
                          }
                        }}
                        className="p-1 text-dark-500 hover:text-accent-400"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function fieldWord(n: number): string {
  const mod = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'полей';
  if (mod === 1) return 'поле';
  if (mod >= 2 && mod <= 4) return 'поля';
  return 'полей';
}

function submissionWord(n: number): string {
  const mod = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'ответов';
  if (mod === 1) return 'ответ';
  if (mod >= 2 && mod <= 4) return 'ответа';
  return 'ответов';
}

// ============================================================
// Main page
// ============================================================

export default function FormBuilderPage() {
  const { formId } = useParams<{ formId: string }>();

  if (formId) {
    return <FormEditView formId={parseInt(formId, 10)} />;
  }

  return <FormListView />;
}
