import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, UserCheck, Building2, Wrench, Target, Users, User } from 'lucide-react';
import clsx from 'clsx';
import { useEntityStore } from '@/stores/entityStore';
import type { Entity, EntityType, EntityStatus } from '@/types';
import { ENTITY_TYPES, STATUS_LABELS } from '@/types';

interface ContactFormProps {
  entity?: Entity | null;
  prefillData?: Partial<Entity>;
  defaultType?: EntityType;
  onClose: () => void;
  onSuccess: (entity: Entity) => void;
}

const ENTITY_TYPE_OPTIONS: { id: EntityType; icon: typeof User }[] = [
  { id: 'candidate', icon: UserCheck },
  { id: 'client', icon: Building2 },
  { id: 'contractor', icon: Wrench },
  { id: 'lead', icon: Target },
  { id: 'partner', icon: Users },
  { id: 'custom', icon: User },
];

export default function ContactForm({ entity, prefillData, defaultType, onClose, onSuccess }: ContactFormProps) {
  const { createEntity, updateEntity, loading } = useEntityStore();

  // Use prefillData when creating new entity, entity when editing
  const initialData = entity || prefillData;

  const [formData, setFormData] = useState({
    type: (initialData?.type || defaultType || 'candidate') as EntityType,
    name: initialData?.name || '',
    status: (entity?.status || 'new') as EntityStatus,
    phone: initialData?.phone || '',
    email: initialData?.email || '',
    // Multiple identifiers (comma-separated in UI, array in API)
    telegram_usernames: initialData?.telegram_usernames?.join(', ') || '',
    emails: initialData?.emails?.join(', ') || '',
    phones: initialData?.phones?.join(', ') || '',
    company: initialData?.company || '',
    position: initialData?.position || '',
    tags: initialData?.tags?.join(', ') || ''
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const availableStatuses = ENTITY_TYPES[formData.type].statuses;

  // Reset status if not valid for current type
  useEffect(() => {
    if (!availableStatuses.includes(formData.status)) {
      setFormData((prev) => ({ ...prev, status: availableStatuses[0] }));
    }
  }, [formData.type]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) {
      newErrors.name = 'Имя обязательно';
    }
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Неверный формат email';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    // Helper to parse comma-separated values into array
    const parseList = (str: string): string[] =>
      str.split(',').map(s => s.trim()).filter(s => s.length > 0);

    try {
      const data = {
        type: formData.type,
        name: formData.name.trim(),
        status: formData.status,
        phone: formData.phone.trim() || undefined,
        email: formData.email.trim() || undefined,
        // Multiple identifiers
        telegram_usernames: parseList(formData.telegram_usernames),
        emails: parseList(formData.emails),
        phones: parseList(formData.phones),
        company: formData.company.trim() || undefined,
        position: formData.position.trim() || undefined,
        tags: formData.tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      };

      let result: Entity;
      if (entity) {
        await updateEntity(entity.id, data);
        result = { ...entity, ...data } as Entity;
      } else {
        result = await createEntity(data);
      }
      onSuccess(result);
    } catch (err) {
      // Error is handled by store
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
        className="bg-gray-900 rounded-2xl w-full max-w-lg border border-white/10 shadow-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10 flex-shrink-0">
          <h2 className="text-xl font-semibold text-white">
            {entity ? 'Редактирование контакта' : 'Новый контакт'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={20} className="text-white/60" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Entity Type */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Тип</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ENTITY_TYPE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const typeInfo = ENTITY_TYPES[option.id];
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, type: option.id }))}
                    className={clsx(
                      'p-3 rounded-lg flex flex-col items-center gap-2 transition-colors',
                      formData.type === option.id
                        ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-400'
                        : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'
                    )}
                  >
                    <Icon size={20} className="flex-shrink-0" />
                    <span className="text-xs text-center">{typeInfo.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name */}
          <div>
            <label htmlFor="contact-name" className="block text-sm font-medium text-white/60 mb-2">Имя *</label>
            <input
              id="contact-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className={clsx(
                'w-full px-4 py-2 bg-white/5 border rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50',
                errors.name ? 'border-red-500/50' : 'border-white/10'
              )}
              placeholder="Иван Иванов"
            />
            {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Статус</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData((prev) => ({ ...prev, status: e.target.value as EntityStatus }))}
              className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50"
            >
              {availableStatuses.map((status) => (
                <option key={status} value={status} className="bg-gray-900">
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>

          {/* Telegram Usernames */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">
              Telegram @username(ы) <span className="text-white/40">(через запятую)</span>
            </label>
            <input
              type="text"
              value={formData.telegram_usernames}
              onChange={(e) => setFormData((prev) => ({ ...prev, telegram_usernames: e.target.value }))}
              className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
              placeholder="@username1, @username2"
            />
            <p className="text-xs text-white/40 mt-1">Для связывания чатов с контактом</p>
          </div>

          {/* Contact Info Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">
                Email(ы) <span className="text-white/40">(через запятую)</span>
              </label>
              <input
                type="text"
                value={formData.emails}
                onChange={(e) => setFormData((prev) => ({ ...prev, emails: e.target.value }))}
                className={clsx(
                  'w-full px-4 py-2 bg-white/5 border rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50',
                  errors.email ? 'border-red-500/50' : 'border-white/10'
                )}
                placeholder="john@example.com, john.doe@company.com"
              />
              {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">
                Телефон(ы) <span className="text-white/40">(через запятую)</span>
              </label>
              <input
                type="text"
                value={formData.phones}
                onChange={(e) => setFormData((prev) => ({ ...prev, phones: e.target.value }))}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
                placeholder="+7 999 123-45-67, +1 234 567 890"
              />
            </div>
          </div>

          {/* Company & Position */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Компания</label>
              <input
                type="text"
                value={formData.company}
                onChange={(e) => setFormData((prev) => ({ ...prev, company: e.target.value }))}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
                placeholder="ООО Компания"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Должность</label>
              <input
                type="text"
                value={formData.position}
                onChange={(e) => setFormData((prev) => ({ ...prev, position: e.target.value }))}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
                placeholder="Разработчик"
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label htmlFor="contact-tags" className="block text-sm font-medium text-white/60 mb-2">Теги (через запятую)</label>
            <input
              id="contact-tags"
              type="text"
              value={formData.tags}
              onChange={(e) => setFormData((prev) => ({ ...prev, tags: e.target.value }))}
              className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
              placeholder="senior, удалённо, frontend"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-white/5 text-white/60 rounded-lg hover:bg-white/10 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {entity ? 'Сохранить' : 'Создать контакт'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
