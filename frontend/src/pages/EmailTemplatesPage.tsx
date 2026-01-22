import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail,
  Plus,
  Search,
  Edit,
  Trash2,
  Copy,
  Eye,
  X,
  Save,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useAuthStore } from '@/stores/authStore';
import { ConfirmDialog, EmptyState, ErrorMessage } from '@/components/ui';
import api from '@/services/api/client';

// Types
interface EmailTemplate {
  id: number;
  org_id: number;
  name: string;
  description: string | null;
  template_type: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  is_active: boolean;
  is_default: boolean;
  variables: string[];
  tags: string[];
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

interface TemplateType {
  value: string;
  label: string;
}

interface TemplateVariable {
  name: string;
  description: string;
  example: string;
}

const TEMPLATE_TYPE_ICONS: Record<string, string> = {
  interview_invite: '📅',
  interview_reminder: '⏰',
  offer: '🎉',
  rejection: '❌',
  screening_request: '📋',
  test_assignment: '📝',
  welcome: '👋',
  follow_up: '📞',
  custom: '✏️',
};

export default function EmailTemplatesPage() {
  useAuthStore();

  // State
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templateTypes, setTemplateTypes] = useState<TemplateType[]>([]);
  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<boolean | null>(null);

  // Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<EmailTemplate | null>(null);

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [templatesRes, typesRes, varsRes] = await Promise.all([
        api.get<EmailTemplate[]>('/email-templates/templates'),
        api.get<TemplateType[]>('/email-templates/templates/types/list'),
        api.get<TemplateVariable[]>('/email-templates/templates/variables/list'),
      ]);

      setTemplates(templatesRes.data);
      setTemplateTypes(typesRes.data);
      setVariables(varsRes.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load templates');
      toast.error('Ошибка загрузки шаблонов');
    } finally {
      setIsLoading(false);
    }
  };

  // Filtered templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!t.name.toLowerCase().includes(q) && !t.subject.toLowerCase().includes(q)) {
          return false;
        }
      }
      if (typeFilter && t.template_type !== typeFilter) {
        return false;
      }
      if (activeFilter !== null && t.is_active !== activeFilter) {
        return false;
      }
      return true;
    });
  }, [templates, searchQuery, typeFilter, activeFilter]);

  // Handlers
  const handleCreate = () => {
    setEditingTemplate(null);
    setIsFormOpen(true);
  };

  const handleEdit = (template: EmailTemplate) => {
    setEditingTemplate(template);
    setIsFormOpen(true);
  };

  const handleDuplicate = async (template: EmailTemplate) => {
    try {
      const res = await api.post<EmailTemplate>(`/email-templates/templates/${template.id}/duplicate`);
      setTemplates([res.data, ...templates]);
      toast.success('Шаблон скопирован');
    } catch (err: any) {
      toast.error(err.message || 'Ошибка копирования');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/email-templates/templates/${deleteTarget.id}`);
      setTemplates(templates.filter((t) => t.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success('Шаблон удалён');
    } catch (err: any) {
      toast.error(err.message || 'Ошибка удаления');
    }
  };

  const handleFormSubmit = async (data: Partial<EmailTemplate>) => {
    try {
      if (editingTemplate) {
        const res = await api.put<EmailTemplate>(`/email-templates/templates/${editingTemplate.id}`, data);
        setTemplates(templates.map((t) => (t.id === editingTemplate.id ? res.data : t)));
        toast.success('Шаблон обновлён');
      } else {
        const res = await api.post<EmailTemplate>('/email-templates/templates', data);
        setTemplates([res.data, ...templates]);
        toast.success('Шаблон создан');
      }
      setIsFormOpen(false);
      setEditingTemplate(null);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка сохранения');
    }
  };

  const getTypeLabel = (type: string) => {
    return templateTypes.find((t) => t.value === type)?.label || type;
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-dark-900">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-dark-700">
        <div className="flex items-center gap-3">
          <Mail className="w-6 h-6 text-accent-500" />
          <h1 className="text-xl font-semibold text-white">Email шаблоны</h1>
          <span className="px-2 py-1 bg-dark-700 rounded text-sm text-dark-400">
            {filteredTemplates.length}
          </span>
        </div>

        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition"
        >
          <Plus size={18} />
          <span>Создать шаблон</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 p-4 border-b border-dark-700">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по названию или теме..."
            className="w-full pl-10 pr-4 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white placeholder:text-dark-400 focus:outline-none focus:border-accent-500"
          />
        </div>

        {/* Type filter */}
        <select
          value={typeFilter || ''}
          onChange={(e) => setTypeFilter(e.target.value || null)}
          className="px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-accent-500"
        >
          <option value="">Все типы</option>
          {templateTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {TEMPLATE_TYPE_ICONS[type.value]} {type.label}
            </option>
          ))}
        </select>

        {/* Active filter */}
        <select
          value={activeFilter === null ? '' : activeFilter ? 'active' : 'inactive'}
          onChange={(e) =>
            setActiveFilter(e.target.value === '' ? null : e.target.value === 'active')
          }
          className="px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-accent-500"
        >
          <option value="">Все статусы</option>
          <option value="active">Активные</option>
          <option value="inactive">Неактивные</option>
        </select>
      </div>

      {/* Content */}
      {error ? (
        <ErrorMessage error={error} onRetry={loadData} />
      ) : filteredTemplates.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="Нет шаблонов"
          description={
            searchQuery || typeFilter
              ? 'Попробуйте изменить фильтры'
              : 'Создайте первый email шаблон для отправки писем кандидатам'
          }
          actions={
            !searchQuery && !typeFilter
              ? [{ label: 'Создать шаблон', onClick: handleCreate }]
              : undefined
          }
        />
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {filteredTemplates.map((template) => (
                <motion.div
                  key={template.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className={clsx(
                    'p-4 bg-dark-800 rounded-lg border transition cursor-pointer',
                    template.is_active
                      ? 'border-dark-600 hover:border-accent-500'
                      : 'border-dark-700 opacity-60'
                  )}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">
                        {TEMPLATE_TYPE_ICONS[template.template_type] || '📧'}
                      </span>
                      <div>
                        <h3 className="font-medium text-white">{template.name}</h3>
                        <span className="text-xs text-dark-400">{getTypeLabel(template.template_type)}</span>
                      </div>
                    </div>

                    {/* Status badges */}
                    <div className="flex items-center gap-1">
                      {template.is_default && (
                        <span className="px-2 py-0.5 bg-accent-500/20 text-accent-400 text-xs rounded">
                          По умолчанию
                        </span>
                      )}
                      {!template.is_active && (
                        <span className="px-2 py-0.5 bg-dark-600 text-dark-400 text-xs rounded">
                          Неактивен
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Subject */}
                  <p className="text-sm text-dark-300 mb-2 truncate">{template.subject}</p>

                  {/* Description */}
                  {template.description && (
                    <p className="text-xs text-dark-400 mb-3 line-clamp-2">
                      {template.description}
                    </p>
                  )}

                  {/* Variables */}
                  {template.variables.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {template.variables.slice(0, 4).map((v) => (
                        <span
                          key={v}
                          className="px-1.5 py-0.5 bg-dark-700 text-dark-400 text-xs rounded"
                        >
                          {`{{${v}}}`}
                        </span>
                      ))}
                      {template.variables.length > 4 && (
                        <span className="text-xs text-dark-400">
                          +{template.variables.length - 4}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-3 border-t border-dark-700">
                    <button
                      onClick={() => setPreviewTemplate(template)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 text-dark-300 hover:text-white hover:bg-dark-700 rounded transition"
                    >
                      <Eye size={14} />
                      <span className="text-xs">Просмотр</span>
                    </button>
                    <button
                      onClick={() => handleEdit(template)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 text-dark-300 hover:text-white hover:bg-dark-700 rounded transition"
                    >
                      <Edit size={14} />
                      <span className="text-xs">Изменить</span>
                    </button>
                    <button
                      onClick={() => handleDuplicate(template)}
                      className="flex items-center justify-center p-1.5 text-dark-300 hover:text-white hover:bg-dark-700 rounded transition"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(template)}
                      className="flex items-center justify-center p-1.5 text-dark-300 hover:text-red-400 hover:bg-dark-700 rounded transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Template Form Modal */}
      <AnimatePresence>
        {isFormOpen && (
          <TemplateFormModal
            template={editingTemplate}
            templateTypes={templateTypes}
            variables={variables}
            onSubmit={handleFormSubmit}
            onClose={() => {
              setIsFormOpen(false);
              setEditingTemplate(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Preview Modal */}
      <AnimatePresence>
        {previewTemplate && (
          <TemplatePreviewModal
            template={previewTemplate}
            onClose={() => setPreviewTemplate(null)}
          />
        )}
      </AnimatePresence>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Удалить шаблон?"
        message={`Вы уверены, что хотите удалить шаблон "${deleteTarget?.name}"? Это действие нельзя отменить.`}
        confirmLabel="Удалить"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="danger"
      />
    </div>
  );
}

// Template Form Modal Component
function TemplateFormModal({
  template,
  templateTypes,
  variables,
  onSubmit,
  onClose,
}: {
  template: EmailTemplate | null;
  templateTypes: TemplateType[];
  variables: TemplateVariable[];
  onSubmit: (data: Partial<EmailTemplate>) => Promise<void>;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState({
    name: template?.name || '',
    description: template?.description || '',
    template_type: template?.template_type || 'custom',
    subject: template?.subject || '',
    body_html: template?.body_html || '',
    is_active: template?.is_active ?? true,
    is_default: template?.is_default ?? false,
    tags: template?.tags || [],
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.subject || !formData.body_html) {
      toast.error('Заполните все обязательные поля');
      return;
    }
    setIsSaving(true);
    try {
      await onSubmit(formData);
    } finally {
      setIsSaving(false);
    }
  };

  const insertVariable = (varName: string) => {
    const textarea = document.getElementById('body_html') as HTMLTextAreaElement;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = formData.body_html;
      const before = text.substring(0, start);
      const after = text.substring(end);
      setFormData({ ...formData, body_html: `${before}{{${varName}}}${after}` });
    } else {
      setFormData({ ...formData, body_html: `${formData.body_html}{{${varName}}}` });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.9 }}
        className="w-full max-w-3xl max-h-[90vh] bg-dark-800 rounded-xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-700">
          <h2 className="text-lg font-semibold text-white">
            {template ? 'Редактировать шаблон' : 'Новый шаблон'}
          </h2>
          <button onClick={onClose} className="p-1 text-dark-400 hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-auto p-4 space-y-4">
          {/* Name and Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">
                Название *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-accent-500"
                placeholder="Приглашение на собеседование"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">Тип</label>
              <select
                value={formData.template_type}
                onChange={(e) => setFormData({ ...formData, template_type: e.target.value })}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-accent-500"
              >
                {templateTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {TEMPLATE_TYPE_ICONS[type.value]} {type.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1">Описание</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-accent-500"
              placeholder="Краткое описание шаблона"
            />
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1">
              Тема письма *
            </label>
            <input
              type="text"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-accent-500"
              placeholder="Приглашение на собеседование - {{vacancy_title}}"
            />
          </div>

          {/* Variables panel */}
          <div className="p-3 bg-dark-700 rounded-lg">
            <p className="text-xs text-dark-400 mb-2">Доступные переменные (кликните для вставки):</p>
            <div className="flex flex-wrap gap-1">
              {variables.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  onClick={() => insertVariable(v.name)}
                  className="px-2 py-1 bg-dark-600 hover:bg-dark-500 text-dark-300 text-xs rounded transition"
                  title={`${v.description} (${v.example})`}
                >
                  {`{{${v.name}}}`}
                </button>
              ))}
            </div>
          </div>

          {/* Body HTML */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1">
              Содержимое письма (HTML) *
            </label>
            <textarea
              id="body_html"
              value={formData.body_html}
              onChange={(e) => setFormData({ ...formData, body_html: e.target.value })}
              rows={10}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-accent-500"
              placeholder="<p>Здравствуйте, {{candidate_name}}!</p>&#10;&#10;<p>Приглашаем вас на собеседование...</p>"
            />
          </div>

          {/* Flags */}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="w-4 h-4 rounded border-dark-600 text-accent-500 focus:ring-accent-500"
              />
              <span className="text-sm text-dark-300">Активен</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="w-4 h-4 rounded border-dark-600 text-accent-500 focus:ring-accent-500"
              />
              <span className="text-sm text-dark-300">Использовать по умолчанию</span>
            </label>
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-dark-700">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-dark-300 hover:text-white transition"
          >
            Отмена
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-white rounded-lg transition"
          >
            <Save size={18} />
            {isSaving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Preview Modal Component
function TemplatePreviewModal({
  template,
  onClose,
}: {
  template: EmailTemplate;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.9 }}
        className="w-full max-w-2xl max-h-[80vh] bg-white rounded-xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Предпросмотр: {template.name}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 transition">
            <X size={20} />
          </button>
        </div>

        {/* Email preview */}
        <div className="flex-1 overflow-auto p-4">
          {/* Subject */}
          <div className="mb-4 p-3 bg-gray-100 rounded-lg">
            <span className="text-xs text-gray-500">Тема:</span>
            <p className="font-medium text-gray-900">{template.subject}</p>
          </div>

          {/* Body */}
          <div
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: template.body_html }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
