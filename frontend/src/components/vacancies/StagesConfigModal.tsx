import { useState } from 'react';
import { X, GripVertical, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import type { ApplicationStage } from '@/types';
import { APPLICATION_STAGE_LABELS } from '@/types';

export interface StageColumn {
  key: string;
  label: string;
  visible: boolean;
  maps_to?: string; // underlying enum value for virtual stages
}

// Default stages derived from the hardcoded pipeline
const DEFAULT_STAGES: StageColumn[] = [
  { key: 'applied', label: 'Новый', visible: true },
  { key: 'screening', label: 'Отбор', visible: true },
  { key: 'phone_screen', label: 'Собеседование назначено', visible: true },
  { key: 'interview', label: 'Собеседование пройдено', visible: true },
  { key: 'assessment', label: 'Практика', visible: true },
  { key: 'offer', label: 'Оффер', visible: true },
  { key: 'hired', label: 'Вышел на работу', visible: true },
  { key: 'rejected', label: 'Отказ', visible: true },
];

// Real DB enum values that virtual stages can map to
const ENUM_VALUES: ApplicationStage[] = [
  'applied', 'screening', 'phone_screen', 'interview',
  'assessment', 'offer', 'hired', 'rejected', 'withdrawn'
];

interface StagesConfigModalProps {
  columns: StageColumn[] | null;
  onSave: (columns: StageColumn[]) => Promise<void>;
  onClose: () => void;
}

export default function StagesConfigModal({ columns, onSave, onClose }: StagesConfigModalProps) {
  const [stages, setStages] = useState<StageColumn[]>(
    columns && columns.length > 0 ? columns : DEFAULT_STAGES
  );
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleLabelChange = (index: number, label: string) => {
    setStages(prev => prev.map((s, i) => i === index ? { ...s, label } : s));
  };

  const toggleVisibility = (index: number) => {
    const visibleCount = stages.filter(s => s.visible).length;
    const stage = stages[index];
    if (stage.visible && visibleCount <= 2) {
      toast.error('Минимум 2 видимых этапа');
      return;
    }
    setStages(prev => prev.map((s, i) => i === index ? { ...s, visible: !s.visible } : s));
  };

  const addVirtualStage = () => {
    const key = `custom_${Date.now()}`;
    setStages(prev => [...prev, {
      key,
      label: 'Новый этап',
      visible: true,
      maps_to: 'screening', // default mapping
    }]);
  };

  const removeStage = (index: number) => {
    const stage = stages[index];
    // Only allow removing virtual stages (those with maps_to)
    if (!stage.maps_to) {
      toast.error('Нельзя удалить базовый этап — только скрыть');
      return;
    }
    setStages(prev => prev.filter((_, i) => i !== index));
  };

  const handleMapsToChange = (index: number, mapsTo: string) => {
    setStages(prev => prev.map((s, i) => i === index ? { ...s, maps_to: mapsTo } : s));
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setStages(prev => {
      const next = [...prev];
      const [removed] = next.splice(dragIndex, 1);
      next.splice(index, 0, removed);
      return next;
    });
    setDragIndex(index);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(stages);
      toast.success('Этапы воронки сохранены');
      onClose();
    } catch {
      toast.error('Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setStages(DEFAULT_STAGES);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-lg bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold">Настройка этапов воронки</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-white/60" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-2">
          <p className="text-xs text-white/40 mb-3">
            Переименовывайте этапы, скрывайте ненужные или добавьте виртуальные. Перетаскивайте для изменения порядка.
          </p>

          <AnimatePresence mode="popLayout">
            {stages.map((stage, index) => (
              <motion.div
                key={stage.key}
                layout
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e as unknown as React.DragEvent, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all ${
                  stage.visible
                    ? 'border-white/10 bg-white/5'
                    : 'border-white/5 bg-white/[0.02] opacity-60'
                } ${dragIndex === index ? 'border-blue-500/50 shadow-lg' : ''}`}
              >
                <GripVertical className="w-4 h-4 text-white/20 cursor-grab flex-shrink-0" />

                {/* Label input */}
                <input
                  type="text"
                  value={stage.label}
                  onChange={e => handleLabelChange(index, e.target.value)}
                  className="flex-1 bg-transparent border-none outline-none text-sm text-white/90 placeholder-white/30 min-w-0"
                  placeholder="Название этапа"
                />

                {/* Maps-to selector for virtual stages */}
                {stage.maps_to && (
                  <select
                    value={stage.maps_to}
                    onChange={e => handleMapsToChange(index, e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white/60 max-w-[120px]"
                    title="Маппинг на реальный этап"
                  >
                    {ENUM_VALUES.map(v => (
                      <option key={v} value={v}>{APPLICATION_STAGE_LABELS[v]}</option>
                    ))}
                  </select>
                )}

                {/* Visibility toggle */}
                <button
                  onClick={() => toggleVisibility(index)}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                  title={stage.visible ? 'Скрыть этап' : 'Показать этап'}
                >
                  {stage.visible
                    ? <Eye className="w-4 h-4 text-white/40" />
                    : <EyeOff className="w-4 h-4 text-white/20" />
                  }
                </button>

                {/* Delete (only virtual stages) */}
                {stage.maps_to && (
                  <button
                    onClick={() => removeStage(index)}
                    className="p-1.5 hover:bg-red-500/20 text-red-400/60 hover:text-red-400 rounded-lg transition-colors"
                    title="Удалить виртуальный этап"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Add virtual stage */}
          <button
            onClick={addVirtualStage}
            className="w-full flex items-center justify-center gap-2 p-2.5 border border-dashed border-white/10 rounded-xl text-white/40 hover:text-white/60 hover:border-white/20 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            Добавить виртуальный этап
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
          <button
            onClick={handleReset}
            className="text-sm text-white/40 hover:text-white/60 transition-colors"
          >
            Сбросить к умолчанию
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
