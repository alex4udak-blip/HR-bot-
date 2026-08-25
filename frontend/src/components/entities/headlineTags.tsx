import clsx from "clsx";
import { X } from "lucide-react";

// ---- Яркие теги-ярлыки у имени кандидата (запрос Марии) ----
// Отдельно от обычных «Меток»: HR вписывает слово + выбирает цвет, показываем крупно
// рядом с именем. Хранится в extra_data.headline_tags=[{text,color}]. Общий модуль —
// используется в «Все кандидаты» и в воронках.
export type HeadlineTag = { text: string; color: string };

export const HEADLINE_TAG_COLORS: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  pink: { bg: "#fbdced", text: "#be185d", border: "#f6b8d6" },
  purple: { bg: "#ede9fe", text: "#6d28d9", border: "#ddd6fe" },
  blue: { bg: "#dbeafe", text: "#1d4ed8", border: "#bfdbfe" },
  teal: { bg: "#ccfbf1", text: "#0f766e", border: "#99f6e4" },
  green: { bg: "#dcfce7", text: "#15803d", border: "#bbf7d0" },
  amber: { bg: "#fef3c7", text: "#b45309", border: "#fde68a" },
  red: { bg: "#fee2e2", text: "#b91c1c", border: "#fecaca" },
};
export const HEADLINE_TAG_COLOR_KEYS = Object.keys(HEADLINE_TAG_COLORS);

/** Достаёт валидные теги из extra_data (или из готового массива). */
export function readHeadlineTags(source: unknown): HeadlineTag[] {
  let raw: unknown = source;
  if (source && !Array.isArray(source)) {
    raw = (source as { headline_tags?: unknown }).headline_tags;
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is HeadlineTag =>
        !!t && typeof (t as HeadlineTag).text === "string",
    )
    .map((t) => ({ text: t.text, color: t.color || "pink" }));
}

export function HeadlineTagChip({
  tag,
  small,
  onRemove,
}: {
  tag: HeadlineTag;
  small?: boolean;
  onRemove?: () => void;
}) {
  const c = HEADLINE_TAG_COLORS[tag.color] || HEADLINE_TAG_COLORS.pink;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap",
        small ? "px-2 py-[1px] text-[11px]" : "px-2.5 py-[3px] text-[12px]",
      )}
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {tag.text}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Убрать тег"
          className="ml-0.5 inline-flex items-center opacity-60 hover:opacity-100"
          style={{ color: c.text }}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}
