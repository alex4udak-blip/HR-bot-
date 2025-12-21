import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, UserCheck, Building2, Wrench, Target, Users, User } from 'lucide-react';
import clsx from 'clsx';
import { useEntityStore } from '@/stores/entityStore';
import type { Entity, EntityType, EntityStatus } from '@/types';
import { ENTITY_TYPES, STATUS_LABELS } from '@/types';

interface ContactFormProps {
  entity?: Entity | null;
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

export default function ContactForm({ entity, defaultType, onClose, onSuccess }: ContactFormProps) {
  const { createEntity, updateEntity, loading } = useEntityStore();

  const [formData, setFormData] = useState({
    type: (entity?.type || defaultType || 'candidate') as EntityType,
    name: entity?.name || '',
    status: (entity?.status || 'new') as EntityStatus,
    phone: entity?.phone || '',
    email: entity?.email || '',
    company: entity?.company || '',
    position: entity?.position || '',
    tags: entity?.tags?.join(', ') || ''
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
      newErrors.name = 'Name is required';
    }
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      const data = {
        type: formData.type,
        name: formData.name.trim(),
        status: formData.status,
        phone: formData.phone.trim() || undefined,
        email: formData.email.trim() || undefined,
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
        className="bg-gray-900 rounded-2xl w-full max-w-lg border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 className="text-xl font-semibold text-white">
            {entity ? 'Edit Contact' : 'New Contact'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={20} className="text-white/60" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Entity Type */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Type</label>
            <div className="grid grid-cols-3 gap-2">
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
                    <Icon size={20} />
                    <span className="text-xs">{typeInfo.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className={clsx(
                'w-full px-4 py-2 bg-white/5 border rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50',
                errors.name ? 'border-red-500/50' : 'border-white/10'
              )}
              placeholder="John Doe"
            />
            {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Status</label>
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

          {/* Contact Info Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                className={clsx(
                  'w-full px-4 py-2 bg-white/5 border rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50',
                  errors.email ? 'border-red-500/50' : 'border-white/10'
                )}
                placeholder="john@example.com"
              />
              {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
                placeholder="+1 234 567 890"
              />
            </div>
          </div>

          {/* Company & Position */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Company</label>
              <input
                type="text"
                value={formData.company}
                onChange={(e) => setFormData((prev) => ({ ...prev, company: e.target.value }))}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
                placeholder="Acme Inc"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Position</label>
              <input
                type="text"
                value={formData.position}
                onChange={(e) => setFormData((prev) => ({ ...prev, position: e.target.value }))}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
                placeholder="Software Engineer"
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Tags (comma-separated)</label>
            <input
              type="text"
              value={formData.tags}
              onChange={(e) => setFormData((prev) => ({ ...prev, tags: e.target.value }))}
              className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
              placeholder="senior, remote, frontend"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-white/5 text-white/60 rounded-lg hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {entity ? 'Save Changes' : 'Create Contact'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
