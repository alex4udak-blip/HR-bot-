import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ListTodo, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ProjectTask, TaskCreate, TaskUpdate, TaskStatus } from '@/services/api/projects';
import type { ProjectMember } from '@/services/api/projects';

const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Бэклог' },
  { value: 'todo', label: 'К выполнению' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'review', label: 'Ревью' },
  { value: 'done', label: 'Готово' },
  { value: 'cancelled', label: 'Отменена' },
];

const PRIORITY_OPTIONS = [
  { value: 0, label: 'Низкий' },
  { value: 1, label: 'Нормальный' },
  { value: 2, label: 'Высокий' },
  { value: 3, label: 'Критический' },
];

interface TaskFormProps {
  task?: ProjectTask | null;
  members?: ProjectMember[];
  parentTaskId?: number;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: TaskCreate | TaskUpdate) => Promise<void>;
}

export default function TaskForm({ task, members = [], parentTaskId, isOpen, onClose, onSubmit }: TaskFormProps) {
  const isEditing = !!task;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<string>('todo');
  const [priority, setPriority] = useState(1);
  const [assigneeId, setAssigneeId] = useState<number | ''>('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setStatus(task.status);
      setPriority(task.priority);
      setAssigneeId(task.assignee_id || '');
      setEstimatedHours(task.estimated_hours != null ? String(task.estimated_hours) : '');
      setDueDate(task.due_date?.slice(0, 10) || '');
    } else {
      setTitle('');
      setDescription('');
      setStatus('todo');
      setPriority(1);
      setAssigneeId('');
      setEstimatedHours('');
      setDueDate('');
    }
  }, [task, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Название задачи обязательно');
      return;
    }

    const data: TaskCreate = {
      title: title.trim(),
      description: description.trim() || undefined,
      status,
      priority,
      assignee_id: assigneeId ? Number(assigneeId) : undefined,
      estimated_hours: estimatedHours ? Number(estimatedHours) : undefined,
      due_date: dueDate || undefined,
      parent_task_id: parentTaskId || undefined,
    };

    setIsSubmitting(true);
    try {
      await onSubmit(data);
      onClose();
    } catch {
      // error handled by caller
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-purple-500/20">
                  <ListTodo className="w-5 h-5 text-purple-400" />
                </div>
                <h2 className="text-lg font-semibold text-white">
                  {isEditing ? 'Редактировать задачу' : 'Новая задача'}
                </h2>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
                <X className="w-5 h-5 text-white/60" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1">Название *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Название задачи"
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50"
                  required
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1">Описание</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Описание задачи..."
                  rows={3}
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 resize-none"
                />
              </div>

              {/* Status & Priority row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1">Статус</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as TaskStatus)}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  >
                    {TASK_STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1">Приоритет</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value))}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  >
                    {PRIORITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Assignee */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1">Исполнитель</label>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                >
                  <option value="">Не назначен</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>{m.user_name || m.user_email || `User ${m.user_id}`}</option>
                  ))}
                </select>
              </div>

              {/* Estimated hours & Due date row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1">Оценка (часы)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={estimatedHours}
                    onChange={(e) => setEstimatedHours(e.target.value)}
                    placeholder="0"
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1">Дедлайн</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                </div>
              </div>

              {/* Submit */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-purple-500 hover:bg-purple-600 disabled:opacity-50 rounded-xl transition-colors"
                >
                  <Save className="w-4 h-4" />
                  {isSubmitting ? 'Сохранение...' : isEditing ? 'Сохранить' : 'Создать'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
