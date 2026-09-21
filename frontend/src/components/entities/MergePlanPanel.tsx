import type { MergeFieldKey, MergeSide } from "@/services/api/entities";
import type { MergeRow } from "./CandidateCompareCard";

/**
 * Шаг «Что оставить в объединённой анкете» перед слиянием дублей.
 *
 * Раньше «Объединить» сразу склеивал карточки и молча оставлял всё с левой:
 * имя, должность, компанию, основные почту и телефон — значения правой анкеты
 * пропадали. Слияние необратимо, поэтому решение принимает рекрутёр, по каждому
 * полю, где анкеты расходятся. Совпадающие поля не спрашиваем — только
 * перечисляем, чтобы было видно, что их тоже проверили.
 */
export function MergePlanPanel({
  plan,
  choices,
  onChoose,
  leftId,
  rightId,
}: {
  plan: MergeRow[];
  choices: Partial<Record<MergeFieldKey, MergeSide>>;
  onChoose: (key: MergeFieldKey, side: MergeSide) => void;
  leftId: number;
  rightId: number;
}) {
  const conflicts = plan.filter((r) => r.kind === "conflict");
  const fills = plan.filter((r) => r.kind === "fill");
  const kept = plan.filter((r) => r.kind === "keep");

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h3 className="text-base font-semibold text-gray-900">Что оставить в объединённой анкете</h3>
      <p className="mt-1 text-sm text-gray-500">
        Остаётся карточка слева (ID {leftId}), анкета ID {rightId} вливается в неё. Воронки,
        история этапов, резюме, анкеты и заметки обеих сохраняются полностью. Контакты, которые
        не стали основными, остаются в карточке дополнительными.
      </p>

      {conflicts.length > 0 && (
        <section className="mt-5">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">
            Анкеты расходятся — выберите значение ({conflicts.length})
          </div>
          <div className="space-y-2">
            {conflicts.map((row) => (
              <div key={row.key} className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="mb-2 text-xs font-medium text-gray-500">{row.label}</div>
                <div className="grid grid-cols-2 gap-2">
                  {(["target", "source"] as const).map((side) => {
                    const value = side === "target" ? row.left : row.right;
                    const active = (choices[row.key] ?? "target") === side;
                    return (
                      <button
                        key={side}
                        type="button"
                        onClick={() => onChoose(row.key, side)}
                        aria-pressed={active}
                        className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          active
                            ? "border-lime-500 bg-lime-50 text-gray-900 ring-1 ring-lime-500"
                            : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <span className="block text-[10px] uppercase tracking-wide text-gray-400">
                          {side === "target" ? "Слева" : "Справа"}
                        </span>
                        <span className="break-words">{value}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {fills.length > 0 && (
        <section className="mt-5">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">
            Слева пусто — заполнится из анкеты справа
          </div>
          <div className="space-y-1.5">
            {fills.map((row) => {
              const take = (choices[row.key] ?? "source") === "source";
              return (
                <label
                  key={row.key}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={take}
                    onChange={(e) => onChoose(row.key, e.target.checked ? "source" : "target")}
                    className="h-4 w-4 accent-lime-600"
                  />
                  <span className="w-40 shrink-0 text-gray-500">{row.label}</span>
                  <span className={take ? "text-gray-900" : "text-gray-400 line-through"}>{row.right}</span>
                </label>
              );
            })}
          </div>
        </section>
      )}

      {kept.length > 0 && (
        <p className="mt-5 text-xs text-gray-400">
          Без изменений (совпадает или справа пусто): {kept.map((r) => r.label).join(", ")}.
        </p>
      )}

      {conflicts.length === 0 && fills.length === 0 && (
        <p className="mt-5 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
          Выбирать нечего: анкеты не расходятся ни в одном поле. Можно объединять.
        </p>
      )}
    </div>
  );
}

export default MergePlanPanel;
