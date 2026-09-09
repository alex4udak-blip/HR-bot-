import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X, Loader2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getTags,
  createTag,
  archiveTag,
  getEntityTags,
  addTagToEntity,
  removeTagFromEntity,
  type Tag,
} from '@/services/api/tags';

/**
 * Метки кандидата: чипы + выпадашка «добавить».
 *
 * Общий для воронки и «Все кандидаты» — раньше этот блок жил только в
 * RecruiterFunnelsPage, и в общей базе метку поставить было нельзя. Копировать
 * сотню строк во второй экран значило обречь их разъехаться, поэтому вынесено
 * сюда.
 *
 * Три действия и их разный смысл — главное, что тут легко перепутать:
 *   • крестик на ЧИПЕ      — снять метку с этого кандидата, в справочнике остаётся;
 *   • корзина в СПИСКЕ     — «удалить за ненадобностью»: убрать из списка выбора,
 *                            но у кандидатов, кому уже проставлена, оставить;
 *   • DELETE /tags/{id}    — НЕ используется: сносит метку со всех карточек разом.
 *
 * Авто-метки «HR: Имя» сюда не входят: они вычисляются из воронок и живут
 * отдельно (readSystemHrTags), их нельзя ни поставить, ни снять.
 */

export const TAG_PALETTE = [
  { color: 'var(--hf-red-500)', label: 'Красный' },
  { color: 'var(--hf-status-blue)', label: 'Синий' },
  { color: 'var(--hf-green-500)', label: 'Зелёный' },
  { color: 'var(--hf-status-yellow)', label: 'Жёлтый' },
  { color: 'var(--hf-status-purple)', label: 'Фиолетовый' },
  { color: 'var(--hf-status-orange)', label: 'Оранжевый' },
  { color: 'var(--hf-status-pink)', label: 'Розовый' },
  { color: 'var(--hf-status-cyan)', label: 'Голубой' },
];

export default function TagPicker({
  entityId,
  disabled = false,
  onChange,
}: {
  entityId: number | null | undefined;
  disabled?: boolean;
  /** Дёргается после любой правки — чтобы родитель обновил свои производные данные. */
  onChange?: (tags: Tag[]) => void;
}) {
  const [orgTags, setOrgTags] = useState<Tag[]>([]);
  const [entityTags, setEntityTags] = useState<Tag[]>([]);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(TAG_PALETTE[0].color);
  const [creating, setCreating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getTags().then(setOrgTags).catch(() => setOrgTags([]));
  }, []);

  useEffect(() => {
    if (!entityId) {
      setEntityTags([]);
      return;
    }
    getEntityTags(entityId).then(setEntityTags).catch(() => setEntityTags([]));
  }, [entityId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const publish = useCallback((next: Tag[]) => {
    setEntityTags(next);
    onChange?.(next);
  }, [onChange]);

  const handleAdd = async (tag: Tag) => {
    if (!entityId) return;
    setOpen(false);
    try {
      await addTagToEntity(entityId, tag.id);
      publish([...entityTags, tag]);
    } catch {
      toast.error('Не удалось добавить метку');
    }
  };

  const handleRemoveFromCandidate = async (tagId: number) => {
    if (!entityId) return;
    try {
      await removeTagFromEntity(entityId, tagId);
      publish(entityTags.filter((t) => t.id !== tagId));
    } catch {
      toast.error('Не удалось снять метку');
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !entityId) return;
    setCreating(true);
    try {
      const tag = await createTag({ name, color: newColor });
      // Имя могло существовать в скрытых — бэкенд вернёт ту же запись, поэтому
      // не плодим дубль в списке, а обновляем по id.
      setOrgTags((prev) => [...prev.filter((t) => t.id !== tag.id), tag]);
      setNewName('');
      if (!entityTags.some((t) => t.id === tag.id)) {
        await addTagToEntity(entityId, tag.id);
        publish([...entityTags, tag]);
      }
    } catch {
      toast.error('Не удалось создать метку');
    } finally {
      setCreating(false);
    }
  };

  /** «Удалить за ненадобностью» — убрать из списка выбора у всей организации. */
  const handleArchive = async (tag: Tag) => {
    if (!window.confirm(
      `Убрать метку «${tag.name}» из списка?\n\n` +
      'У кандидатов, которым она уже проставлена, метка останется — ' +
      'снять её можно крестиком на карточке.',
    )) return;
    try {
      await archiveTag(tag.id);
      setOrgTags((prev) => prev.filter((t) => t.id !== tag.id));
      toast.success(`«${tag.name}» убрана из списка`);
    } catch {
      toast.error('Не удалось убрать метку');
    }
  };

  const available = orgTags.filter((t) => !entityTags.some((et) => et.id === t.id));

  return (
    <>
      {entityTags.map((tag) => (
        <span
          key={tag.id}
          className="group inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
          style={{
            backgroundColor: `color-mix(in srgb, ${tag.color} 12%, transparent)`,
            color: tag.color,
            border: `1px solid color-mix(in srgb, ${tag.color} 25%, transparent)`,
          }}
        >
          {tag.name}
          {!disabled && (
            <button
              type="button"
              onClick={() => handleRemoveFromCandidate(tag.id)}
              title="Снять метку с этого кандидата"
              className="ml-0.5 hover:opacity-70 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}

      {!disabled && entityId && (
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            title="Добавить метку"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-[var(--hf-dark-400)] border border-dashed border-[color:var(--hf-ui-border)] hover:text-[var(--hf-dark-300)] transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>

          {open && (
            <div className="absolute left-0 top-full mt-1 z-50 w-64 bg-[var(--hf-white)] border border-[var(--hf-ui-border)] rounded-lg shadow-[var(--hf-shadow-xl)] overflow-hidden">
              <div className="max-h-48 overflow-y-auto">
                {available.map((tag) => (
                  <div
                    key={tag.id}
                    className="group/row w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--hf-main-800)] hover:bg-[var(--hf-ui-hover)] transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => handleAdd(tag)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="truncate">{tag.name}</span>
                    </button>
                    {/* Убрать из списка у всей организации. На карточках остаётся. */}
                    <button
                      type="button"
                      onClick={() => handleArchive(tag)}
                      title="Убрать метку из списка (у кандидатов останется)"
                      className="opacity-0 group-hover/row:opacity-100 transition-opacity text-[var(--hf-main-500)] hover:text-[var(--hf-status-red)]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {available.length === 0 && (
                  <div className="px-3 py-2 text-xs text-[var(--hf-main-500)]">
                    Нет доступных меток
                  </div>
                )}
              </div>

              <div className="border-t border-[var(--hf-ui-divider)] p-2">
                <div className="flex items-center gap-1.5 mb-1.5">
                  {TAG_PALETTE.map((p) => (
                    <button
                      key={p.color}
                      type="button"
                      title={p.label}
                      onClick={() => setNewColor(p.color)}
                      className="w-4 h-4 rounded-full transition-transform"
                      style={{
                        backgroundColor: p.color,
                        transform: newColor === p.color ? 'scale(1.3)' : 'scale(1)',
                        boxShadow: newColor === p.color
                          ? `0 0 0 2px color-mix(in srgb, ${p.color} 38%, transparent)`
                          : 'none',
                      }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                    placeholder="Новая метка..."
                    className="flex-1 px-2 py-1 text-xs bg-[var(--hf-white)] border border-[var(--hf-ui-border)] rounded text-[var(--hf-main-900)] placeholder:text-[var(--hf-main-500)] focus:outline-none focus:border-[var(--hf-cyan-500)]"
                  />
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating || !newName.trim()}
                    className="px-2 py-1 text-xs rounded bg-[var(--hf-ui-hover)] text-[var(--hf-main-800)] hover:bg-[var(--hf-main-200)] disabled:opacity-40 transition-colors"
                  >
                    {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : '+'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
