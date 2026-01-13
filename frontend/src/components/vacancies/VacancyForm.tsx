import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Save, Briefcase } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useVacancyStore } from '@/stores/vacancyStore';
import type { Vacancy, VacancyStatus } from '@/types';
import { VACANCY_STATUS_LABELS, EMPLOYMENT_TYPES, EXPERIENCE_LEVELS } from '@/types';
import { getDepartments, getUsers } from '@/services/api';
import type { Department, User } from '@/services/api';

interface VacancyFormProps {
  vacancy?: Vacancy;
  onClose: () => void;
  onSuccess: () => void;
}

export default function VacancyForm({ vacancy, onClose, onSuccess }: VacancyFormProps) {
  const { createVacancy, updateVacancy } = useVacancyStore();
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const [formData, setFormData] = useState({
    title: vacancy?.title || '',
    description: vacancy?.description || '',
    requirements: vacancy?.requirements || '',
    responsibilities: vacancy?.responsibilities || '',
    salary_min: vacancy?.salary_min || '',
    salary_max: vacancy?.salary_max || '',
    salary_currency: vacancy?.salary_currency || 'RUB',
    location: vacancy?.location || '',
    employment_type: vacancy?.employment_type || '',
    experience_level: vacancy?.experience_level || '',
    status: vacancy?.status || 'draft' as VacancyStatus,
    priority: vacancy?.priority || 0,
    tags: vacancy?.tags.join(', ') || '',
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Briefcase className="w-5 h-5 text-blue-400" />
            </div>
            <h2 className="text-lg font-semibold">
              {vacancy ? 'Редактировать вакансию' : 'Новая вакансия'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm text-white/60 mb-1">Название *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
                placeholder="Senior Python Developer"
              />
            </div>

            {/* Status and Priority */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Статус</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as VacancyStatus })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
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
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value={0}>Обычный</option>
                  <option value={1}>Важный</option>
                  <option value={2}>Срочный</option>
                </select>
              </div>
            </div>

            {/* Location and Employment Type */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Локация</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="Москва / Удалённо"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Тип занятости</label>
                <select
                  value={formData.employment_type}
                  onChange={(e) => setFormData({ ...formData, employment_type: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="">Не указано</option>
                  {EMPLOYMENT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Experience and Department */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Уровень</label>
                <select
                  value={formData.experience_level}
                  onChange={(e) => setFormData({ ...formData, experience_level: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="">Не указано</option>
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
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="">Не указано</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Salary */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Зарплата от</label>
                <input
                  type="number"
                  value={formData.salary_min}
                  onChange={(e) => setFormData({ ...formData, salary_min: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="100000"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Зарплата до</label>
                <input
                  type="number"
                  value={formData.salary_max}
                  onChange={(e) => setFormData({ ...formData, salary_max: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="200000"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Валюта</label>
                <select
                  value={formData.salary_currency}
                  onChange={(e) => setFormData({ ...formData, salary_currency: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="RUB">RUB</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>

            {/* Hiring Manager */}
            <div>
              <label className="block text-sm text-white/60 mb-1">Ответственный</label>
              <select
                value={formData.hiring_manager_id}
                onChange={(e) => setFormData({ ...formData, hiring_manager_id: e.target.value })}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
              >
                <option value="">Не назначен</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm text-white/60 mb-1">Описание</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500 resize-none"
                placeholder="Краткое описание позиции..."
              />
            </div>

            {/* Requirements */}
            <div>
              <label className="block text-sm text-white/60 mb-1">Требования</label>
              <textarea
                value={formData.requirements}
                onChange={(e) => setFormData({ ...formData, requirements: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500 resize-none"
                placeholder="Требуемые навыки и опыт..."
              />
            </div>

            {/* Responsibilities */}
            <div>
              <label className="block text-sm text-white/60 mb-1">Обязанности</label>
              <textarea
                value={formData.responsibilities}
                onChange={(e) => setFormData({ ...formData, responsibilities: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500 resize-none"
                placeholder="Основные обязанности..."
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-sm text-white/60 mb-1">Теги (через запятую)</label>
              <input
                type="text"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
                placeholder="python, backend, fastapi"
              />
            </div>
          </div>
        </form>

        <div className="flex items-center justify-end gap-3 p-4 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-white/60 hover:text-white transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
          >
            <Save className="w-4 h-4" />
            {loading ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
