import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Save, Trash2, Plus, Layers } from "lucide-react";
import toast from "react-hot-toast";
import {
  getStatusTemplates,
  updateStatusTemplates,
  type OrgStage,
  type StatusTemplate,
} from "@/services/api/auth";

const CANONICAL_STAGES: OrgStage[] = [
  { key: "new", label: "Новый", color: "#3b82f6" },
  { key: "screening", label: "Скрининг", color: "#06b6d4" },
  { key: "practice", label: "Практика", color: "#a855f7" },
  { key: "tech_practice", label: "Тех-практика", color: "#6366f1" },
  { key: "is_interview", label: "ИС", color: "#f97316" },
  { key: "offer", label: "Оффер", color: "#eab308" },
  { key: "hired", label: "Принят", color: "#22c55e" },
  { key: "rejected", label: "Отклонён", color: "#ef4444" },
];

/** A template stage row: a canonical stage with an `included` flag for editing. */
interface EditableStage extends OrgStage {
  included: boolean;
}

interface EditableTemplate {
  id: string;
  name: string;
  stages: EditableStage[];
}

function makeDefaultStages(): EditableStage[] {
  return CANONICAL_STAGES.map((s) => ({ ...s, included: true }));
}

/** Map a saved template to an editable one (all 8 canonical rows, in canonical order). */
function toEditable(tpl: StatusTemplate): EditableTemplate {
  return {
    id: tpl.id,
    name: tpl.name,
    stages: CANONICAL_STAGES.map((canonical) => {
      const saved = tpl.stages.find((s) => s.key === canonical.key);
      return {
        key: canonical.key,
        label: saved?.label ?? canonical.label,
        color: saved?.color ?? canonical.color,
        included: !!saved,
      };
    }),
  };
}

function makeNewTemplate(): EditableTemplate {
  return {
    id: crypto.randomUUID(),
    name: "Новый шаблон",
    stages: makeDefaultStages(),
  };
}

function StatusTemplatesModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [templates, setTemplates] = useState<EditableTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getStatusTemplates()
      .then((r) => setTemplates(r.templates.map(toEditable)))
      .catch(() => toast.error("Не удалось загрузить шаблоны"))
      .finally(() => setLoading(false));
  }, []);

  const updateTemplate = (
    id: string,
    patch: (tpl: EditableTemplate) => EditableTemplate,
  ) => {
    setTemplates((p) => p.map((t) => (t.id === id ? patch(t) : t)));
  };

  const updateStage = (
    templateId: string,
    stageKey: string,
    patch: Partial<EditableStage>,
  ) => {
    updateTemplate(templateId, (t) => ({
      ...t,
      stages: t.stages.map((s) =>
        s.key === stageKey ? { ...s, ...patch } : s,
      ),
    }));
  };

  const handleAddTemplate = () => {
    setTemplates((p) => [...p, makeNewTemplate()]);
  };

  const handleDeleteTemplate = (id: string) => {
    setTemplates((p) => p.filter((t) => t.id !== id));
  };

  const handleSave = async () => {
    for (const t of templates) {
      if (!t.name.trim()) {
        toast.error("Название шаблона не может быть пустым");
        return;
      }
      if (!t.stages.some((s) => s.included)) {
        toast.error(
          `Шаблон «${t.name.trim()}» должен содержать хотя бы один этап`,
        );
        return;
      }
    }

    const payload: StatusTemplate[] = templates.map((t) => ({
      id: t.id,
      name: t.name.trim(),
      stages: t.stages
        .filter((s) => s.included)
        .map((s) => ({
          key: s.key,
          label: s.label.trim(),
          color: s.color,
        })),
    }));

    setSaving(true);
    try {
      await updateStatusTemplates(payload);
      toast.success("Шаблоны сохранены");
      onSaved?.();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Не удалось сохранить";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--hf-black-alpha-30)]"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[672px] flex-col overflow-hidden rounded-[var(--hf-radius-s)] border border-[var(--hf-ui-border)] bg-[var(--hf-bg-muted)] shadow-[0_18px_60px_var(--hf-black-alpha-30)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:bg-[var(--hf-bg-dark)]"
      >
        <div className="flex h-[68px] flex-shrink-0 items-center justify-between border-b border-[var(--hf-ui-border)] px-[var(--hf-space-xxl)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)]">
          <div className="flex items-center gap-[12px]">
            <span className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-[var(--hf-radius-s)] bg-[var(--hf-white)] text-[var(--hf-cyan-500)] shadow-[0_1px_2px_var(--hf-alpha-100)] hf-dark-disabled:bg-[var(--hf-white-alpha-10)]">
              <Layers className="h-[20px] w-[20px]" />
            </span>
            <h3 className="text-[20px] font-semibold leading-[var(--hf-lh-h2)] text-[var(--hf-ui-text-strong)] hf-dark-disabled:text-[var(--hf-white)]">
              Шаблоны статусов
            </h3>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-[var(--hf-radius-s)] text-[var(--hf-ui-text-strong)] transition-colors hover:bg-[var(--hf-black-alpha-04)] hf-dark-disabled:text-[color:var(--hf-white-alpha-70)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-06)]"
            aria-label="Закрыть"
          >
            <X className="h-[22px] w-[22px]" />
          </button>
        </div>
        <div className="overflow-y-auto px-[var(--hf-space-xxl)] py-[var(--hf-space-l)]">
          <p className="mb-[16px] text-[length:var(--hf-fs-2xs)] leading-[18px] text-[var(--hf-ui-text-muted)] hf-dark-disabled:text-[color:var(--hf-white-alpha-50)]">
            Создавайте именованные наборы этапов. Каждый шаблон — выбранные
            этапы воронки с собственными названиями и цветами.
          </p>
          {loading ? (
            <div className="space-y-[8px] py-[var(--hf-space-s)]">
              {Array.from({ length: 3 }).map((_, index) => (
                <HfSkeletonBlock
                  key={index}
                  className="h-[160px] w-full rounded-[var(--hf-radius-s)]"
                />
              ))}
            </div>
          ) : (
            <div className="space-y-[16px]">
              {templates.length === 0 ? (
                <p className="py-[var(--hf-space-l)] text-center text-[length:var(--hf-fs-2xs)] text-[var(--hf-ui-text-muted)] hf-dark-disabled:text-[color:var(--hf-white-alpha-50)]">
                  Пока нет шаблонов. Добавьте первый.
                </p>
              ) : (
                templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="rounded-[var(--hf-radius-s)] border border-[var(--hf-ui-border)] bg-transparent p-[12px] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)]"
                  >
                    <div className="mb-[10px] flex items-center gap-[10px]">
                      <input
                        type="text"
                        value={tpl.name}
                        disabled={saving}
                        placeholder="Название шаблона"
                        onChange={(e) =>
                          updateTemplate(tpl.id, (t) => ({
                            ...t,
                            name: e.target.value,
                          }))
                        }
                        className="h-[40px] flex-1 rounded-[var(--hf-radius-s)] border border-[var(--hf-ui-border)] bg-transparent px-[10px] text-[length:var(--hf-fs-s)] font-medium leading-[var(--hf-lh-primary)] text-[var(--hf-ui-text-strong)] transition-colors hover:border-[var(--hf-ui-border-hover)] focus:border-[var(--hf-ui-border-hover)] focus:outline-none disabled:opacity-50 hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:text-[var(--hf-white)]"
                      />
                      <button
                        onClick={() => handleDeleteTemplate(tpl.id)}
                        disabled={saving}
                        className="inline-flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-[var(--hf-radius-s)] text-[var(--hf-ui-text-soft)] transition-colors hover:bg-[var(--hf-black-alpha-04)] hover:text-[var(--hf-red-500)] disabled:opacity-50 hf-dark-disabled:text-[color:var(--hf-white-alpha-55)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-06)]"
                        title="Удалить шаблон"
                        aria-label="Удалить шаблон"
                      >
                        <Trash2 className="h-[18px] w-[18px]" />
                      </button>
                    </div>
                    <div className="space-y-[8px]">
                      {tpl.stages.map((s) => (
                        <div
                          key={s.key}
                          className="flex h-[44px] items-center gap-[10px] rounded-[var(--hf-radius-s)] border border-[var(--hf-ui-border)] bg-transparent px-[10px] transition-colors hover:border-[var(--hf-ui-border-hover)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:hover:border-[color:var(--hf-white-alpha-20)]"
                        >
                          <input
                            type="checkbox"
                            checked={s.included}
                            disabled={saving}
                            onChange={(e) =>
                              updateStage(tpl.id, s.key, {
                                included: e.target.checked,
                              })
                            }
                            className="h-[16px] w-[16px] cursor-pointer accent-[var(--hf-main-900)] disabled:opacity-50"
                            aria-label={`Включить этап ${s.label}`}
                          />
                          <input
                            type="color"
                            value={s.color}
                            disabled={saving || !s.included}
                            onChange={(e) =>
                              updateStage(tpl.id, s.key, {
                                color: e.target.value,
                              })
                            }
                            className="h-[28px] w-[28px] cursor-pointer rounded border-0 bg-transparent disabled:opacity-50"
                          />
                          <input
                            type="text"
                            value={s.label}
                            disabled={saving || !s.included}
                            onChange={(e) =>
                              updateStage(tpl.id, s.key, {
                                label: e.target.value,
                              })
                            }
                            className="h-full flex-1 bg-transparent text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-primary)] text-[var(--hf-ui-text-strong)] focus:outline-none disabled:opacity-50 hf-dark-disabled:text-[var(--hf-white)]"
                          />
                          <span className="font-mono text-[length:var(--hf-fs-4xs)] text-[var(--hf-main-600)]">
                            {s.key}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
              <button
                onClick={handleAddTemplate}
                disabled={saving}
                className="inline-flex h-[40px] items-center gap-[var(--hf-space-s)] rounded-[var(--hf-radius-s)] border border-dashed border-[var(--hf-ui-border)] px-[14px] text-[length:var(--hf-fs-xs)] font-medium text-[var(--hf-ui-text-soft)] transition-colors hover:border-[var(--hf-ui-border-hover)] hover:text-[var(--hf-main-900)] disabled:opacity-50 hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] hf-dark-disabled:text-[color:var(--hf-white-alpha-55)] hf-dark-disabled:hover:text-[var(--hf-white)]"
              >
                <Plus className="h-4 w-4" />
                Добавить шаблон
              </button>
            </div>
          )}
        </div>
        <div className="flex h-[72px] flex-shrink-0 items-center justify-end gap-[12px] border-t border-[var(--hf-ui-border)] px-[var(--hf-space-xxl)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)]">
          <button
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-[40px] items-center rounded-[var(--hf-radius-s)] px-[var(--hf-space-xxl)] text-[length:var(--hf-fs-xs)] font-medium text-[var(--hf-ui-text-soft)] transition-colors hover:bg-[var(--hf-black-alpha-04)] hover:text-[var(--hf-main-900)] disabled:opacity-50 hf-dark-disabled:text-[color:var(--hf-white-alpha-55)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-06)] hf-dark-disabled:hover:text-[var(--hf-white)]"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="inline-flex h-[40px] items-center gap-[var(--hf-space-s)] rounded-[var(--hf-radius-s)] bg-[var(--hf-main-900)] px-[18px] text-[length:var(--hf-fs-xs)] font-semibold text-[var(--hf-white)] transition-colors duration-[100ms] hover:bg-[var(--hf-main-800)] disabled:cursor-not-allowed disabled:bg-[var(--hf-btn-disabled-bg)] disabled:text-[var(--hf-main-600)] disabled:opacity-100 disabled:hover:bg-[var(--hf-btn-disabled-bg)] hf-dark-disabled:bg-[var(--hf-white)] hf-dark-disabled:text-[var(--hf-main-900)] hf-dark-disabled:hover:bg-[var(--hf-white-alpha-90)] hf-dark-disabled:disabled:bg-[var(--hf-white-alpha-08)] hf-dark-disabled:disabled:text-[color:var(--hf-white-alpha-35)]"
          >
            <Save className="w-4 h-4" />
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function HfSkeletonBlock({ className }: { className: string }) {
  return <div className={`hf-loading-skeleton ${className}`} />;
}

export default StatusTemplatesModal;
