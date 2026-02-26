import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Save, Briefcase, Sparkles, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useVacancyStore } from '@/stores/vacancyStore';
import type { Vacancy, VacancyStatus, User } from '@/types';
import { VACANCY_STATUS_LABELS, EMPLOYMENT_TYPES, EXPERIENCE_LEVELS } from '@/types';
import { getDepartments, getUsers, splitVacancyDescription } from '@/services/api';
import type { Department } from '@/services/api';
import { CurrencySelect } from '@/components/ui';

interface VacancyFormProps {
  vacancy?: Vacancy;
  prefillData?: Partial<Vacancy>;
  onClose: () => void;
  onSuccess: () => void;
}

export default function VacancyForm({ vacancy, prefillData, onClose, onSuccess }: VacancyFormProps) {
  const { createVacancy, updateVacancy } = useVacancyStore();
  const [loading, setLoading] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);

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
    status: vacancy?.status || 'draft' as VacancyStatus,
    priority: vacancy?.priority || 0,
    tags: initialData?.tags?.join(', ') || '',
    department_id: vacancy?.department_id || '',
    hiring_manager_id: vacancy?.hiring_manager_id || '',
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        const [depts, usersList] = await Promise.all([
          getDepartments(-1),
          getUsers()
        ]);
        setDepartments(depts);
        setUsers(usersList);
      } catch (error) {
        console.error('Failed to load data:', error);
      }
    };
    loadData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      toast.error('Введите название вакансии');
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
        department_id: formData.department_id ? parseInt(String(formData.department_id)) : undefined,
        hiring_manager_id: formData.hiring_manager_id ? parseInt(String(formData.hiring_manager_id)) : undefined,
      };

      if (vacancy) {
        await updateVacancy(vacancy.id, data);
        toast.success('Вакансия обновлена');
      } else {
        await createVacancy(data);
        toast.success('Вакансия создана');
      }
      onSuccess();
    } catch (error) {
      toast.error(vacancy ? 'Ошибка при обновлении' : 'Ошибка при создании');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Use AI to split description into requirements and responsibilities.
   * Only works if description has content and requirements/responsibilities are empty.
   */
  const handleSplitDescription = async () => {
    if (!formData.description.trim()) {
      toast.error('Нет описания для разделения');
      return;
    }

    if (formData.description.length < 50) {
      toast.error('Описание слишком короткое (минимум 50 символов)');
      return;
    }

    setSplitting(true);
    try {
      const result = await splitVacancyDescription(formData.description);

      if (result.success) {
        setFormData(prev => ({
          ...prev,
          description: result.short_description || prev.description,
          requirements: result.requirements || prev.requirements,
          responsibilities: result.responsibilities || prev.responsibilities,
        }));
        toast.success('Текст успешно разделён');
      } else {
        toast.error(result.error || 'Не удалось разделить текст');
      }
    } catch (error) {
      toast.error('Ошибка при разделении текста');
    } finally {
      setSplitting(false);
    }
  };

  // Show split button if description has content but requirements/responsibilities are empty
  const canSplitDescription =
    formData.description.trim().length >= 50 &&
    !formData.requirements.trim() &&
    !formData.responsibilities.trim();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="glass rounded-xl w-full max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden"
      >
        <div className="flex items-center justify-between p-3 sm:p-4 border-b border-white/10">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-1.5 sm:p-2 bg-blue-500/20 rounded-lg">
              <Briefcase className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
            </div>
            <h2 className="text-base sm:text-lg font-semibold">
              {vacancy ? 'Редактировать вакансию' : 'Новая вакансия'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-dark-800/50 rounded-lg transition-colors touch-manipulation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-3 sm:p-4 overflow-y-auto max-h-[calc(95vh-140px)] sm:max-h-[calc(90vh-140px)]">
          <div className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm text-white/60 mb-1">Название *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2.5 sm:py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 text-sm sm:text-base"
                placeholder="Senior Python Developer"
              />
            </div>

            {/* Status and Priority - stack on mobile */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Статус</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as VacancyStatus })}
                  className="w-full px-3 py-2.5 sm:py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 text-sm sm:text-base"
                >
                  {Object.entries(VACANCY_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Приоритет</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                  className="w-full px-3 py-2.5 sm:py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 text-sm sm:text-base"
                >
                  <option value={0}>Обычный</option>
                  <option value={1}>Важно</option>
                  <option value={2}>Срочно</option>
                </select>
              </div>
            </div>

            {/* Location and Employment Type - stack on mobile */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Локация</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full px-3 py-2.5 sm:py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 text-sm sm:text-base"
                  placeholder="Удалённо / Москва"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Тип занятости</label>
                <select
                  value={formData.employment_type}
                  onChange={(e) => setFormData({ ...formData, employment_type: e.target.value })}
                  className="w-full px-3 py-2.5 sm:py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 text-sm sm:text-base"
                >
                  <option value="">Не указан</option>
                  {EMPLOYMENT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Experience and Department - stack on mobile */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Уровень опыта</label>
                <select
                  value={formData.experience_level}
                  onChange={(e) => setFormData({ ...formData, experience_level: e.target.value })}
                  className="w-full px-3 py-2.5 sm:py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 text-sm sm:text-base"
                >
                  <option value="">Не указан</option>
                  {EXPERIENCE_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>{level.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Отдел</label>
                <select
                  value={formData.department_id}
                  onChange={(e) => setFormData({ ...formData, department_id: e.target.value })}
                  className="w-full px-3 py-2.5 sm:py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 text-sm sm:text-base"
                >
                  <option value="">Не указан</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Salary - responsive grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Зарплата от</label>
                <input
                  type="number"
                  value={formData.salary_min}
                  onChange={(e) => setFormData({ ...formData, salary_min: e.target.value })}
                  className="w-full px-3 py-2.5 sm:py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 text-sm sm:text-base"
                  placeholder="100000"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Зарплата до</label>
                <input
                  type="number"
                  value={formData.salary_max}
                  onChange={(e) => setFormData({ ...formData, salary_max: e.target.value })}
                  className="w-full px-3 py-2.5 sm:py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 text-sm sm:text-base"
                  placeholder="200000"
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-sm text-white/60 mb-1">Валюта</label>
                <CurrencySelect
                  value={formData.salary_currency}
                  onChange={(currency) => setFormData({ ...formData, salary_currency: currency })}
                  className="w-full"
                />
              </div>
            </div>

            {/* Hiring Manager */}
            <div>
              <label className="block text-sm text-white/60 mb-1">Ответственный</label>
              <select
                value={formData.hiring_manager_id}
                onChange={(e) => setFormData({ ...formData, hiring_manager_id: e.target.value })}
                className="w-full px-3 py-2.5 sm:py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 text-sm sm:text-base"
              >
                <option value="">Не назначен</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-white/60">Описание</label>
                {canSplitDescription && (
                  <button
                    type="button"
                    onClick={handleSplitDescription}
                    disabled={splitting}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded transition-colors disabled:opacity-50"
                    title="Автоматически разделить описание на требования и обязанности"
                  >
                    {splitting ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    {splitting ? 'Разделяю...' : 'Авто-разделить'}
                  </button>
                )}
              </div>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 resize-none text-sm sm:text-base"
                placeholder="Краткое описание вакансии..."
              />
              {canSplitDescription && (
                <p className="text-xs text-white/40 mt-1">
                  Нажмите "Авто-разделить" чтобы AI разделил описание на требования и обязанности
                </p>
              )}
            </div>

            {/* Requirements */}
            <div>
              <label className="block text-sm text-white/60 mb-1">Требования</label>
              <textarea
                value={formData.requirements}
                onChange={(e) => setFormData({ ...formData, requirements: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 resize-none text-sm sm:text-base"
                placeholder="Необходимые навыки и опыт..."
              />
            </div>

            {/* Responsibilities */}
            <div>
              <label className="block text-sm text-white/60 mb-1">Обязанности</label>
              <textarea
                value={formData.responsibilities}
                onChange={(e) => setFormData({ ...formData, responsibilities: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 resize-none text-sm sm:text-base"
                placeholder="Ключевые обязанности..."
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-sm text-white/60 mb-1">Теги (через запятую)</label>
              <input
                type="text"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                className="w-full px-3 py-2.5 sm:py-2 glass-light rounded-lg focus:outline-none focus:border-blue-500 text-sm sm:text-base"
                placeholder="python, backend, fastapi"
              />
            </div>
          </div>
        </form>

        <div className="flex items-center justify-end gap-2 sm:gap-3 p-3 sm:p-4 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="px-3 sm:px-4 py-2 text-white/60 hover:text-white transition-colors text-sm sm:text-base touch-manipulation"
          >
            Отмена
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors text-sm sm:text-base touch-manipulation"
          >
            <Save className="w-4 h-4" />
            {loading ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
