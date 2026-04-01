import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Save,
  Trash2,
  FileText,
  MessageSquare,
  Paperclip,
  ListTree,
  Settings2,
  Plus,
  Download,
  Pencil,
  Check,
  Loader2,
  Calendar,
  Clock,
  User,
  Flag,
  Send,
  Upload,
  AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import * as api from '@/services/api';
import type {
  ProjectTask,
  ProjectMember,
  TaskComment,
  TaskAttachment,
  ProjectTaskStatusDef,
  TaskFieldValue,
  ProjectCustomField,
} from '@/services/api/projects';

// ============================================================
// CONSTANTS
// ============================================================

const PRIORITY_LABELS: Record<number, string> = {
  0: 'Низкий',
  1: 'Нормальный',
  2: 'Высокий',
  3: 'Критический',
};

const PRIORITY_COLORS: Record<number, string> = {
  0: 'bg-white/10 text-white/50 border-white/10',
  1: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  2: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  3: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const DEFAULT_STATUS_LABELS: Record<string, string> = {
  backlog: 'Бэклог',
  todo: 'К выполнению',
  in_progress: 'В работе',
  review: 'Ревью',
  done: 'Готово',
  cancelled: 'Отменена',
};

type ModalTab = 'description' | 'comments' | 'attachments' | 'subtasks' | 'custom_fields';

const TABS: { id: ModalTab; label: string; icon: React.ReactNode }[] = [
  { id: 'description', label: 'Описание', icon: <FileText className="w-4 h-4" /> },
  { id: 'comments', label: 'Комментарии', icon: <MessageSquare className="w-4 h-4" /> },
  { id: 'attachments', label: 'Файлы', icon: <Paperclip className="w-4 h-4" /> },
  { id: 'subtasks', label: 'Подзадачи', icon: <ListTree className="w-4 h-4" /> },
  { id: 'custom_fields', label: 'Поля', icon: <Settings2 className="w-4 h-4" /> },
];

// ============================================================
// HELPERS
// ============================================================

function formatDate(date: string | undefined | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatDateTime(date: string | undefined | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================
// PROPS
// ============================================================

interface TaskDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  taskId?: number | null;  // null = create mode
  mode?: 'create' | 'edit';  // defaults to 'edit' if taskId provided
  members: ProjectMember[];
  statuses?: ProjectTaskStatusDef[];
  onTaskUpdated?: () => void;
  onTaskDeleted?: () => void;
  onTaskCreated?: (task: api.ProjectTask) => void;
  parentTaskId?: number;
}

// ============================================================
// DESCRIPTION TAB
// ============================================================

function DescriptionTab({
  description,
  tags,
  onDescriptionChange,
  onTagsChange,
}: {
  description: string;
  tags: string[];
  onDescriptionChange: (v: string) => void;
  onTagsChange: (v: string[]) => void;
}) {
  const [tagInput, setTagInput] = useState('');

  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      onTagsChange([...tags, tag]);
    }
    setTagInput('');
  };

  const removeTag = (t: string) => {
    onTagsChange(tags.filter((x) => x !== t));
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-white/40 uppercase tracking-wider mb-2 block">Описание</label>
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={8}
          placeholder="Добавьте описание задачи..."
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20 resize-y"
        />
      </div>
      <div>
        <label className="text-xs text-white/40 uppercase tracking-wider mb-2 block">Теги</label>
        <div className="flex flex-wrap gap-2 mb-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-purple-500/20 text-purple-300 rounded-lg border border-purple-500/20"
            >
              {tag}
              <button onClick={() => removeTag(tag)} className="hover:text-white transition-colors">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="Новый тег..."
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
          />
          <button
            onClick={addTag}
            className="px-3 py-1.5 text-xs font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// COMMENTS TAB
// ============================================================

function CommentsTab({
  projectId,
  taskId,
}: {
  projectId: number;
  taskId: number;
}) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');

  const loadComments = useCallback(async () => {
    try {
      const data = await api.getTaskComments(projectId, taskId);
      setComments(data);
    } catch {
      toast.error('Не удалось загрузить комментарии');
    } finally {
      setLoading(false);
    }
  }, [projectId, taskId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handleAdd = async () => {
    const text = newComment.trim();
    if (!text) return;
    setSending(true);
    try {
      await api.createTaskComment(projectId, taskId, text);
      setNewComment('');
      await loadComments();
      toast.success('Комментарий добавлен');
    } catch {
      toast.error('Не удалось добавить комментарий');
    } finally {
      setSending(false);
    }
  };

  const handleUpdate = async (commentId: number) => {
    const text = editContent.trim();
    if (!text) return;
    try {
      await api.updateTaskComment(projectId, taskId, commentId, text);
      setEditingId(null);
      setEditContent('');
      await loadComments();
      toast.success('Комментарий обновлён');
    } catch {
      toast.error('Не удалось обновить комментарий');
    }
  };

  const handleDelete = async (commentId: number) => {
    try {
      await api.deleteTaskComment(projectId, taskId, commentId);
      await loadComments();
      toast.success('Комментарий удалён');
    } catch {
      toast.error('Не удалось удалить комментарий');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Comment list */}
      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
        {comments.length === 0 ? (
          <p className="text-sm text-white/20 text-center py-8">Нет комментариев</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="bg-white/[0.03] border border-white/5 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500/40 to-purple-500/40 flex items-center justify-center border border-white/10">
                    <span className="text-[9px] text-white/70">
                      {(c.user_name || '?').charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-white/70">{c.user_name || `User ${c.user_id}`}</span>
                  <span className="text-[10px] text-white/20">{formatDateTime(c.created_at)}</span>
                  {c.edited_at && <span className="text-[10px] text-white/15">(ред.)</span>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditingId(c.id);
                      setEditContent(c.content);
                    }}
                    className="p-1 text-white/20 hover:text-white/50 transition-colors"
                    title="Редактировать"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="p-1 text-white/20 hover:text-red-400 transition-colors"
                    title="Удалить"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {editingId === c.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20 resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUpdate(c.id)}
                      className="px-3 py-1 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                    >
                      Сохранить
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(null);
                        setEditContent('');
                      }}
                      className="px-3 py-1 text-xs text-white/40 hover:text-white/60 transition-colors"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-white/50 whitespace-pre-wrap">{c.content}</p>
              )}
            </div>
          ))
        )}
      </div>

      {/* New comment input */}
      <div className="flex gap-2">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleAdd();
            }
          }}
          rows={2}
          placeholder="Написать комментарий... (Ctrl+Enter — отправить)"
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20 resize-none"
        />
        <button
          onClick={handleAdd}
          disabled={sending || !newComment.trim()}
          className="self-end px-3 py-2 text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// ATTACHMENTS TAB
// ============================================================

function AttachmentsTab({
  projectId,
  taskId,
}: {
  projectId: number;
  taskId: number;
}) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAttachments = useCallback(async () => {
    try {
      const data = await api.getTaskAttachments(projectId, taskId);
      setAttachments(data);
    } catch {
      toast.error('Не удалось загрузить файлы');
    } finally {
      setLoading(false);
    }
  }, [projectId, taskId]);

  useEffect(() => {
    loadAttachments();
  }, [loadAttachments]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await api.uploadTaskAttachment(projectId, taskId, file);
      await loadAttachments();
      toast.success('Файл загружен');
    } catch {
      toast.error('Не удалось загрузить файл');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (attachmentId: number) => {
    try {
      await api.deleteTaskAttachment(projectId, taskId, attachmentId);
      await loadAttachments();
      toast.success('Файл удалён');
    } catch {
      toast.error('Не удалось удалить файл');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Upload button */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleUpload}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-colors disabled:opacity-40"
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          {uploading ? 'Загрузка...' : 'Загрузить файл'}
        </button>
      </div>

      {/* File list */}
      {attachments.length === 0 ? (
        <p className="text-sm text-white/20 text-center py-8">Нет файлов</p>
      ) : (
        <div className="space-y-2">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Paperclip className="w-4 h-4 text-white/30 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{a.original_filename}</p>
                  <div className="flex items-center gap-2 text-[10px] text-white/20">
                    <span>{formatFileSize(a.file_size)}</span>
                    {a.user_name && <span>{a.user_name}</span>}
                    {a.created_at && <span>{formatDateTime(a.created_at)}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <a
                  href={`/api/projects/${projectId}/tasks/${taskId}/attachments/${a.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 text-white/20 hover:text-white/50 transition-colors"
                  title="Скачать"
                >
                  <Download className="w-4 h-4" />
                </a>
                <button
                  onClick={() => handleDelete(a.id)}
                  className="p-1.5 text-white/20 hover:text-red-400 transition-colors"
                  title="Удалить"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// SUBTASKS TAB
// ============================================================

function SubtasksTab({
  projectId,
  taskId,
  members,
  statuses,
}: {
  projectId: number;
  taskId: number;
  members: ProjectMember[];
  statuses: ProjectTaskStatusDef[];
}) {
  const [subtasks, setSubtasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newAssignee, setNewAssignee] = useState<number | ''>('');
  const [creating, setCreating] = useState(false);

  const loadSubtasks = useCallback(async () => {
    try {
      const data = await api.getSubtasks(projectId, taskId);
      setSubtasks(data);
    } catch {
      toast.error('Не удалось загрузить подзадачи');
    } finally {
      setLoading(false);
    }
  }, [projectId, taskId]);

  useEffect(() => {
    loadSubtasks();
  }, [loadSubtasks]);

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      await api.createProjectTask(projectId, {
        title,
        parent_task_id: taskId,
        assignee_id: newAssignee || undefined,
      });
      setNewTitle('');
      setNewAssignee('');
      setShowAdd(false);
      await loadSubtasks();
      toast.success('Подзадача создана');
    } catch {
      toast.error('Не удалось создать подзадачу');
    } finally {
      setCreating(false);
    }
  };

  const getStatusLabel = (slug: string): string => {
    const st = statuses.find((s) => s.slug === slug);
    return st?.name || DEFAULT_STATUS_LABELS[slug] || slug;
  };

  const getStatusColor = (slug: string): string | undefined => {
    return statuses.find((s) => s.slug === slug)?.color;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add subtask button */}
      {!showAdd ? (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Добавить подзадачу
        </button>
      ) : (
        <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-3">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder="Название подзадачи..."
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
            autoFocus
          />
          <select
            value={newAssignee}
            onChange={(e) => setNewAssignee(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 appearance-none"
          >
            <option value="">Без исполнителя</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.user_name || m.user_email || `User ${m.user_id}`}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newTitle.trim()}
              className="px-4 py-1.5 text-xs font-medium text-white bg-purple-500 hover:bg-purple-600 disabled:opacity-40 rounded-lg transition-colors"
            >
              {creating ? 'Создание...' : 'Создать'}
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setNewTitle('');
                setNewAssignee('');
              }}
              className="px-4 py-1.5 text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Subtask list */}
      {subtasks.length === 0 ? (
        <p className="text-sm text-white/20 text-center py-8">Нет подзадач</p>
      ) : (
        <div className="space-y-2">
          {subtasks.map((st) => {
            const dotColor = getStatusColor(st.status);
            return (
              <div
                key={st.id}
                className="flex items-center justify-between bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {dotColor ? (
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: dotColor }}
                    />
                  ) : (
                    <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', {
                      'bg-green-400': st.status === 'done',
                      'bg-amber-400': st.status === 'in_progress',
                      'bg-blue-400': st.status === 'todo',
                      'bg-white/20': st.status === 'backlog' || st.status === 'cancelled',
                      'bg-purple-400': st.status === 'review',
                    })} />
                  )}
                  <div className="min-w-0">
                    <p className={clsx('text-sm truncate', st.status === 'done' ? 'text-white/40 line-through' : 'text-white')}>
                      {st.title}
                    </p>
                    <span className="text-[10px] text-white/20">{getStatusLabel(st.status)}</span>
                  </div>
                </div>
                {st.assignee_name && (
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500/40 to-purple-500/40 flex items-center justify-center border border-white/10">
                      <span className="text-[8px] text-white/70">{st.assignee_name.charAt(0).toUpperCase()}</span>
                    </div>
                    <span className="text-xs text-white/30">{st.assignee_name}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// CUSTOM FIELDS TAB
// ============================================================

function CustomFieldsTab({
  projectId,
  taskId,
}: {
  projectId: number;
  taskId: number;
}) {
  const [fields, setFields] = useState<ProjectCustomField[]>([]);
  const [values, setValues] = useState<TaskFieldValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const [f, v] = await Promise.all([
          api.getCustomFields(projectId),
          api.getTaskFieldValues(projectId, taskId),
        ]);
        setFields(f);
        setValues(v);
      } catch {
        toast.error('Не удалось загрузить поля');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [projectId, taskId]);

  const handleChange = async (fieldId: number, value: string) => {
    // Optimistic update
    setValues((prev) =>
      prev.map((v) => (v.field_id === fieldId ? { ...v, value } : v))
    );
    setSaving((prev) => ({ ...prev, [fieldId]: true }));
    try {
      await api.setTaskFieldValue(projectId, taskId, fieldId, value);
    } catch {
      toast.error('Не удалось сохранить значение');
    } finally {
      setSaving((prev) => ({ ...prev, [fieldId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
      </div>
    );
  }

  if (fields.length === 0) {
    return <p className="text-sm text-white/20 text-center py-8">Настраиваемые поля не добавлены</p>;
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const fv = values.find((v) => v.field_id === field.id);
        const currentValue = fv?.value ?? '';
        const isSaving = saving[field.id] ?? false;

        return (
          <div key={field.id}>
            <label className="flex items-center gap-2 text-xs text-white/40 uppercase tracking-wider mb-1.5">
              {field.name}
              {field.is_required && <span className="text-red-400">*</span>}
              {isSaving && <Loader2 className="w-3 h-3 animate-spin text-white/20" />}
            </label>
            {field.field_type === 'text' && (
              <input
                value={currentValue}
                onChange={(e) => handleChange(field.id, e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
              />
            )}
            {(field.field_type === 'number' || field.field_type === 'currency') && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={currentValue}
                  onChange={(e) => handleChange(field.id, e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
                />
                {field.field_type === 'currency' && field.currency && (
                  <span className="text-xs text-white/30">{field.currency}</span>
                )}
              </div>
            )}
            {field.field_type === 'select' && (
              <select
                value={currentValue}
                onChange={(e) => handleChange(field.id, e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 appearance-none"
              >
                <option value="">— Не выбрано —</option>
                {field.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            )}
            {field.field_type === 'date' && (
              <input
                type="date"
                value={currentValue}
                onChange={(e) => handleChange(field.id, e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
              />
            )}
            {field.field_type === 'checkbox' && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentValue === 'true'}
                  onChange={(e) => handleChange(field.id, e.target.checked ? 'true' : 'false')}
                  className="w-4 h-4 rounded bg-white/5 border border-white/10"
                />
                <span className="text-sm text-white/50">{currentValue === 'true' ? 'Да' : 'Нет'}</span>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// MAIN MODAL
// ============================================================

export default function TaskDetailModal({
  isOpen,
  onClose,
  projectId,
  taskId,
  mode: modeProp,
  members,
  statuses = [],
  onTaskUpdated,
  onTaskDeleted,
  onTaskCreated,
  parentTaskId,
}: TaskDetailModalProps) {
  const isCreateMode = modeProp === 'create' || !taskId;

  // ---- State ----
  const [task, setTask] = useState<ProjectTask | null>(null);
  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<ModalTab>('description');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Editable fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState(statuses.find(s => s.is_default)?.slug || statuses[0]?.slug || 'backlog');
  const [priority, setPriority] = useState(1);
  const [assigneeId, setAssigneeId] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(isCreateMode);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // ---- Reset for create mode ----
  useEffect(() => {
    if (!isOpen || !isCreateMode) return;
    setTask(null);
    setTitle('');
    setDescription('');
    setStatus(statuses.find(s => s.is_default)?.slug || statuses[0]?.slug || 'backlog');
    setPriority(1);
    setAssigneeId('');
    setDueDate('');
    setEstimatedHours('');
    setTags([]);
    setLoading(false);
    setActiveTab('description');
    setShowDeleteConfirm(false);
    setIsEditingTitle(true);
  }, [isOpen, isCreateMode]);

  // ---- Load task data ----
  useEffect(() => {
    if (!isOpen || !taskId || isCreateMode) return;
    setLoading(true);
    setActiveTab('description');
    setShowDeleteConfirm(false);

    const loadTask = async () => {
      try {
        const tasks = await api.getProjectTasks(projectId);
        const found = tasks.find((t) => t.id === taskId);
        if (found) {
          setTask(found);
          setTitle(found.title);
          setDescription(found.description || '');
          setStatus(found.status);
          setPriority(found.priority);
          setAssigneeId(found.assignee_id || '');
          setDueDate(found.due_date || '');
          setEstimatedHours(found.estimated_hours != null ? String(found.estimated_hours) : '');
          setTags(found.tags || []);
        } else {
          toast.error('Задача не найдена');
          onClose();
        }
      } catch {
        toast.error('Не удалось загрузить задачу');
        onClose();
      } finally {
        setLoading(false);
      }
    };

    loadTask();
  }, [isOpen, taskId, projectId, onClose]);

  // Focus title input when editing
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // ---- Handlers ----
  const handleSave = async () => {
    setSaving(true);
    try {
      if (isCreateMode) {
        // CREATE new task
        if (!title.trim()) {
          toast.error('Введите название задачи');
          setSaving(false);
          return;
        }
        const newTask = await api.createProjectTask(projectId, {
          title: title.trim(),
          description: description || undefined,
          status: status || undefined,
          priority,
          assignee_id: assigneeId || undefined,
          due_date: dueDate || undefined,
          estimated_hours: estimatedHours ? Number(estimatedHours) : undefined,
          tags,
          parent_task_id: parentTaskId,
        });
        toast.success('Задача создана');
        onTaskCreated?.(newTask);
        onTaskUpdated?.();
        onClose();
      } else {
        // UPDATE existing task
        if (!task) return;
        await api.updateProjectTask(projectId, task.id, {
          title: title.trim() || task.title,
          description: description || undefined,
          status: status || undefined,
          priority,
          assignee_id: assigneeId || undefined,
          due_date: dueDate || undefined,
          estimated_hours: estimatedHours ? Number(estimatedHours) : undefined,
          tags,
        });
        toast.success('Задача обновлена');
        onTaskUpdated?.();
      }
    } catch {
      toast.error(isCreateMode ? 'Не удалось создать задачу' : 'Не удалось сохранить изменения');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    try {
      await api.deleteProjectTask(projectId, task.id);
      toast.success('Задача удалена');
      onTaskDeleted?.();
    } catch {
      toast.error('Не удалось удалить задачу');
    }
  };

  // ESC to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // ---- Helpers ----
  const getStatusLabel = (slug: string): string => {
    const st = statuses.find((s) => s.slug === slug);
    return st?.name || DEFAULT_STATUS_LABELS[slug] || slug;
  };

  const getStatusColor = (slug: string): string | undefined => {
    return statuses.find((s) => s.slug === slug)?.color;
  };

  const statusOptions = statuses.length > 0
    ? statuses.map((s) => ({ value: s.slug, label: s.name, color: s.color }))
    : Object.entries(DEFAULT_STATUS_LABELS).map(([value, label]) => ({ value, label, color: undefined }));

  // ---- Render ----
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 pt-[5vh] overflow-y-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            className="bg-dark-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl w-full max-w-5xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Loading state */}
            {loading ? (
              <div className="flex items-center justify-center py-32">
                <Loader2 className="w-8 h-8 text-white/30 animate-spin" />
              </div>
            ) : (task || isCreateMode) ? (
              <>
                {/* ========== HEADER ========== */}
                <div className="flex items-start justify-between gap-4 p-6 pb-4 border-b border-white/5">
                  <div className="flex-1 min-w-0">
                    {/* Title */}
                    {isEditingTitle || isCreateMode ? (
                      <input
                        ref={titleInputRef}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onBlur={() => !isCreateMode && setIsEditingTitle(false)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !isCreateMode) setIsEditingTitle(false);
                          if (e.key === 'Escape' && !isCreateMode) {
                            setTitle(task?.title || '');
                            setIsEditingTitle(false);
                          }
                        }}
                        placeholder={isCreateMode ? 'Название задачи...' : undefined}
                        className="w-full text-xl font-bold text-white bg-transparent border-b-2 border-blue-400 pb-1 focus:outline-none placeholder-white/20"
                        autoFocus={isCreateMode}
                      />
                    ) : (
                      <h2
                        className="text-xl font-bold text-white cursor-pointer hover:text-white/80 transition-colors truncate"
                        onClick={() => setIsEditingTitle(true)}
                        title="Нажмите для редактирования"
                      >
                        {title || task?.title || 'Без названия'}
                      </h2>
                    )}

                    {/* Status + Priority badges */}
                    <div className="flex items-center gap-2 mt-2">
                      {(() => {
                        const dotColor = getStatusColor(status);
                        return dotColor ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-lg border border-white/10">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dotColor }} />
                            {getStatusLabel(status)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-lg border bg-white/10 text-white/50 border-white/10">
                            {getStatusLabel(status)}
                          </span>
                        );
                      })()}
                      <span className={clsx('inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-lg border', PRIORITY_COLORS[priority] || PRIORITY_COLORS[1])}>
                        <Flag className="w-3 h-3" />
                        {PRIORITY_LABELS[priority] ?? 'Нормальный'}
                      </span>
                      {task?.parent_task_id && (
                        <span className="text-[10px] text-white/20">Подзадача</span>
                      )}
                    </div>
                  </div>

                  {/* Close button */}
                  <button
                    onClick={onClose}
                    className="p-2 text-white/30 hover:text-white hover:bg-white/10 rounded-xl transition-colors flex-shrink-0"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* ========== BODY: LEFT + RIGHT ========== */}
                <div className="flex flex-col lg:flex-row">
                  {/* ---- LEFT: TABS ---- */}
                  <div className="flex-1 min-w-0 p-6 border-r border-white/5">
                    {/* Tab buttons */}
                    <div className="flex gap-1 mb-5 bg-white/5 rounded-xl p-1 border border-white/10 overflow-x-auto">
                      {(isCreateMode ? TABS.filter(t => t.id === 'description') : TABS).map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={clsx(
                            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap',
                            activeTab === tab.id
                              ? 'bg-white/10 text-white shadow-sm'
                              : 'text-white/40 hover:text-white/70'
                          )}
                        >
                          {tab.icon}
                          {tab.label}
                          {tab.id === 'comments' && (task?.comment_count || 0) > 0 && (
                            <span className="text-[10px] text-white/30">{task?.comment_count}</span>
                          )}
                          {tab.id === 'attachments' && (task?.attachment_count || 0) > 0 && (
                            <span className="text-[10px] text-white/30">{task?.attachment_count}</span>
                          )}
                          {tab.id === 'subtasks' && (task?.subtask_count || 0) > 0 && (
                            <span className="text-[10px] text-white/30">{task?.subtask_count}</span>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Tab content */}
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        transition={{ duration: 0.15 }}
                      >
                        {activeTab === 'description' && (
                          <DescriptionTab
                            description={description}
                            tags={tags}
                            onDescriptionChange={setDescription}
                            onTagsChange={setTags}
                          />
                        )}
                        {activeTab === 'comments' && task && (
                          <CommentsTab projectId={projectId} taskId={task.id} />
                        )}
                        {activeTab === 'attachments' && task && (
                          <AttachmentsTab projectId={projectId} taskId={task.id} />
                        )}
                        {activeTab === 'subtasks' && task && (
                          <SubtasksTab
                            projectId={projectId}
                            taskId={task.id}
                            members={members}
                            statuses={statuses}
                          />
                        )}
                        {activeTab === 'custom_fields' && task && (
                          <CustomFieldsTab projectId={projectId} taskId={task.id} />
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  {/* ---- RIGHT: SIDEBAR ---- */}
                  <div className="lg:w-[300px] flex-shrink-0 p-6 space-y-5">
                    {/* Status */}
                    <div>
                      <label className="flex items-center gap-1.5 text-xs text-white/40 uppercase tracking-wider mb-1.5">
                        <Check className="w-3.5 h-3.5" />
                        Статус
                      </label>
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 appearance-none cursor-pointer"
                      >
                        {statusOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Assignee */}
                    <div>
                      <label className="flex items-center gap-1.5 text-xs text-white/40 uppercase tracking-wider mb-1.5">
                        <User className="w-3.5 h-3.5" />
                        Исполнитель
                      </label>
                      <select
                        value={assigneeId}
                        onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : '')}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 appearance-none cursor-pointer"
                      >
                        <option value="">Не назначен</option>
                        {members.map((m) => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.user_name || m.user_email || `User ${m.user_id}`}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Priority */}
                    <div>
                      <label className="flex items-center gap-1.5 text-xs text-white/40 uppercase tracking-wider mb-1.5">
                        <Flag className="w-3.5 h-3.5" />
                        Приоритет
                      </label>
                      <select
                        value={priority}
                        onChange={(e) => setPriority(Number(e.target.value))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 appearance-none cursor-pointer"
                      >
                        {Object.entries(PRIORITY_LABELS).map(([val, label]) => (
                          <option key={val} value={val}>{label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Due date */}
                    <div>
                      <label className="flex items-center gap-1.5 text-xs text-white/40 uppercase tracking-wider mb-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        Дедлайн
                      </label>
                      <input
                        type="date"
                        value={dueDate ? dueDate.slice(0, 10) : ''}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 [color-scheme:dark]"
                      />
                    </div>

                    {/* Estimated hours */}
                    <div>
                      <label className="flex items-center gap-1.5 text-xs text-white/40 uppercase tracking-wider mb-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        Оценка (часы)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={estimatedHours}
                        onChange={(e) => setEstimatedHours(e.target.value)}
                        placeholder="0"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
                      />
                    </div>

                    {/* Divider */}
                    {!isCreateMode && task && (
                      <div className="border-t border-white/5 pt-4 space-y-3">
                        {task.task_key && (
                          <div>
                            <span className="text-[10px] text-white/25 uppercase tracking-wider">ID</span>
                            <p className="text-xs text-white/50 mt-0.5 font-mono">{task.task_key}</p>
                          </div>
                        )}
                        <div>
                          <span className="text-[10px] text-white/25 uppercase tracking-wider">Создал</span>
                          <p className="text-xs text-white/40 mt-0.5">
                            {task.creator_name || (task.created_by ? `User ${task.created_by}` : '—')}
                          </p>
                        </div>
                        <div>
                          <span className="text-[10px] text-white/25 uppercase tracking-wider">Создано</span>
                          <p className="text-xs text-white/40 mt-0.5">{formatDate(task.created_at)}</p>
                        </div>
                        {task.updated_at && (
                          <div>
                            <span className="text-[10px] text-white/25 uppercase tracking-wider">Обновлено</span>
                            <p className="text-xs text-white/40 mt-0.5">{formatDateTime(task.updated_at)}</p>
                          </div>
                        )}
                        {task.total_hours_logged > 0 && (
                          <div>
                            <span className="text-[10px] text-white/25 uppercase tracking-wider">Залогировано</span>
                            <p className="text-xs text-white/40 mt-0.5">{task.total_hours_logged}ч</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* ========== FOOTER ========== */}
                <div className="flex items-center justify-between p-6 pt-4 border-t border-white/5">
                  {!isCreateMode ? (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Удалить
                    </button>
                  ) : <div />}

                  <div className="flex items-center gap-3">
                    <button
                      onClick={onClose}
                      className="px-4 py-2 text-sm text-white/50 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving || (isCreateMode && !title.trim())}
                      className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 rounded-xl transition-colors"
                    >
                      {saving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      {isCreateMode ? 'Создать' : 'Сохранить'}
                    </button>
                  </div>
                </div>

                {/* ========== DELETE CONFIRMATION ========== */}
                <AnimatePresence>
                  {showDeleteConfirm && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 backdrop-blur-sm rounded-2xl"
                      onClick={() => setShowDeleteConfirm(false)}
                    >
                      <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="bg-dark-900/95 backdrop-blur-xl border border-white/20 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-3 mb-4">
                          <div className="p-2 rounded-xl bg-red-500/20">
                            <AlertTriangle className="w-5 h-5 text-red-400" />
                          </div>
                          <h3 className="text-lg font-semibold text-white">Удалить задачу?</h3>
                        </div>
                        <p className="text-sm text-white/50 mb-6">
                          Задача &laquo;{task?.title}&raquo; будет удалена безвозвратно.
                        </p>
                        <div className="flex justify-end gap-3">
                          <button
                            onClick={() => setShowDeleteConfirm(false)}
                            className="px-4 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
                          >
                            Отмена
                          </button>
                          <button
                            onClick={handleDelete}
                            className="px-5 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl transition-colors"
                          >
                            Удалить
                          </button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
