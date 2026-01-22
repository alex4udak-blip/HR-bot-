import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, UserCheck, Building2, Wrench, Target, Users, User, DollarSign } from 'lucide-react';
import clsx from 'clsx';
import { useEntityStore } from '@/stores/entityStore';
import type { Entity, EntityType, EntityStatus, CurrencyCode } from '@/types';
import { ENTITY_TYPES, STATUS_LABELS, CURRENCIES } from '@/types';

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
  const { createEntity, updateEntity, isLoading } = useEntityStore();

  // Use prefillData when creating new entity, entity when editing
  const initialData = entity || prefillData;

  // Helper: get emails from multiple sources (emails array, single email, extra_data)
  const getInitialEmails = (): string => {
    // First try emails array
    if (initialData?.emails && initialData.emails.length > 0) {
      return initialData.emails.join(', ');
    }
    // Fallback to single email
    if (initialData?.email) {
      return initialData.email;
    }
    // Check extra_data for parsed resume data
    const extraEmails = initialData?.extra_data?.emails as string[] | undefined;
    if (extraEmails && extraEmails.length > 0) {
      return extraEmails.join(', ');
    }
    return '';
  };

  // Helper: get phones from multiple sources (phones array, single phone, extra_data)
  const getInitialPhones = (): string => {
    // First try phones array
    if (initialData?.phones && initialData.phones.length > 0) {
      return initialData.phones.join(', ');
    }
    // Fallback to single phone
    if (initialData?.phone) {
      return initialData.phone;
    }
    // Check extra_data for parsed resume data
    const extraPhones = initialData?.extra_data?.phones as string[] | undefined;
    if (extraPhones && extraPhones.length > 0) {
      return extraPhones.join(', ');
    }
    return '';
  };

  // Helper: get telegram usernames from multiple sources
  const getInitialTelegram = (): string => {
    if (initialData?.telegram_usernames && initialData.telegram_usernames.length > 0) {
      return initialData.telegram_usernames.join(', ');
    }
    // Check extra_data for telegram
    const extraTelegram = initialData?.extra_data?.telegram as string | undefined;
    if (extraTelegram) {
      return extraTelegram;
    }
    return '';
  };

  const [formData, setFormData] = useState({
    type: (initialData?.type || defaultType || 'candidate') as EntityType,
    name: initialData?.name || '',
    status: (entity?.status || 'new') as EntityStatus,
    phone: initialData?.phone || '',
    email: initialData?.email || '',
    // Multiple identifiers (comma-separated in UI, array in API)
    telegram_usernames: getInitialTelegram(),
    emails: getInitialEmails(),
    phones: getInitialPhones(),
    company: initialData?.company || '',
    position: initialData?.position || '',
    tags: initialData?.tags?.join(', ') || '',
    // Expected salary for candidates
    expected_salary_min: initialData?.expected_salary_min?.toString() || '',
    expected_salary_max: initialData?.expected_salary_max?.toString() || '',
    expected_salary_currency: (initialData?.expected_salary_currency || 'RUB') as CurrencyCode
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const availableStatuses = ENTITY_TYPES[formData.type].statuses;

  // Reset status if not valid for current type
  useEffect(() => {
    if (!availableStatuses.includes(formData.status)) {
      setFormData((prev) => ({ ...prev, status: availableStatuses[0] }));
    }
  }, [formData.type]);

  // Email validation regex (matches backend validation)
  const isValidEmail = (email: string): boolean => {
    return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) {
      newErrors.name = 'Имя обязательно';
    }
    // Validate single email field (legacy)
    if (formData.email && !isValidEmail(formData.email.trim())) {
      newErrors.email = 'Неверный формат email';
    }
    // Validate multiple emails field
    if (formData.emails) {
      const emailList = formData.emails.split(',').map(e => e.trim()).filter(e => e.length > 0);
      const invalidEmails = emailList.filter(email => !isValidEmail(email));
      if (invalidEmails.length > 0) {
        newErrors.emails = `Неверный формат email: ${invalidEmails.join(', ')}`;
      }
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
      // Parse salary values, ensuring they are valid numbers or undefined
      const salaryMin = formData.expected_salary_min ? parseInt(formData.expected_salary_min, 10) : undefined;
      const salaryMax = formData.expected_salary_max ? parseInt(formData.expected_salary_max, 10) : undefined;

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
          .filter((t) => t.length > 0),
        // Expected salary for candidates (only include if valid number)
        expected_salary_min: (salaryMin && !isNaN(salaryMin)) ? salaryMin : undefined,
        expected_salary_max: (salaryMax && !isNaN(salaryMax)) ? salaryMax : undefined,
        expected_salary_currency: formData.expected_salary_currency || 'RUB'
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
                  errors.emails ? 'border-red-500/50' : 'border-white/10'
                )}
                placeholder="john@example.com, john.doe@company.com"
              />
              {errors.emails && <p className="text-red-400 text-xs mt-1">{errors.emails}</p>}
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

          {/* Expected Salary - only for candidates */}
          {formData.type === 'candidate' && (
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2 flex items-center gap-2">
                <DollarSign size={16} />
                Expected Salary
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <input
                    type="number"
                    value={formData.expected_salary_min}
                    onChange={(e) => setFormData((prev) => ({ ...prev, expected_salary_min: e.target.value }))}
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
                    placeholder="Min"
                    min="0"
                  />
                </div>
                <div>
                  <input
                    type="number"
                    value={formData.expected_salary_max}
                    onChange={(e) => setFormData((prev) => ({ ...prev, expected_salary_max: e.target.value }))}
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
                    placeholder="Max"
                    min="0"
                  />
                </div>
                <div>
                  <select
                    value={formData.expected_salary_currency}
                    onChange={(e) => setFormData((prev) => ({ ...prev, expected_salary_currency: e.target.value as CurrencyCode }))}
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50"
                  >
                    {CURRENCIES.map((curr) => (
                      <option key={curr.code} value={curr.code} className="bg-gray-900">
                        {curr.code} ({curr.symbol})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-xs text-white/40 mt-1">Gross monthly salary expectation</p>
            </div>
          )}

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
              disabled={isLoading}
              className="flex-1 px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading && (
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
