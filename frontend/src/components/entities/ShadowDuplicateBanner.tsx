import { useState, useEffect } from "react";
import { AlertTriangle, X, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import toast from "react-hot-toast";
import type { KanbanCard } from "@/services/api/candidates";
import type { EntityWithRelations } from "@/types";
import {
  getEntity,
  mergeShadowDuplicate,
  dismissDuplicate,
  getDuplicateCandidates,
  type DuplicateCandidateResult,
} from "@/services/api/entities";
import {
  CandidateCompareCard,
  sideFromCard,
  sideFromEntity,
  matchSide,
  type FieldKey,
} from "./CandidateCompareCard";

/**
 * Баннер «Похожий кандидат есть в базе» + БЕЛЫЙ экран сравнения двух анкет
 * целиком: шапка, блок статуса (этап + причина/дата отказа + история этапов),
 * поля профиля и резюме. Совпадения подсвечены. Объединить / Разные / Закрыть.
 *
 * Презентационная карточка сравнения вынесена в CandidateCompareCard — ОДИН
 * компонент рендерит и левую «Новый кандидат», и каждую правую «Старую анкету».
 */

interface ShadowDuplicateBannerProps {
  card: KanbanCard;
  status?: string; // текущий этап открытой карточки (ключ EntityStatus)
  onResolved?: () => void;
}

// Только реальные идентификаторы — по ним и матчит дедуп. Источник (hh.ru), город,
// возраст, зарплата, опыт, метки совпадают у РАЗНЫХ людей и не являются причиной
// слияния — не показываем их как «совпадение», иначе «Совпадение по: Источник» врёт.
const IDENTITY_KEYS: (FieldKey | "name")[] = ["name", "phone", "email", "telegram"];
const IDENTITY_LABEL: Record<string, string> = {
  name: "Имя",
  phone: "Телефон",
  email: "Эл. почта",
  telegram: "Telegram",
};

export default function ShadowDuplicateBanner({ card, status, onResolved }: ShadowDuplicateBannerProps) {
  const hiddenId = (card.extra_data?.hidden_duplicate_id as number | undefined) ?? null;
  const [resolved, setResolved] = useState(false);
  const [open, setOpen] = useState(false);
  // triggerEntity — профиль hiddenId, по которому решается ПОКАЗ баннера (стабилен,
  // не зависит от выбора в карусели). archived — профиль ВЫБРАННОГО в модалке дубликата
  // (правая колонка сравнения), он меняется при клике по миниатюре.
  const [triggerEntity, setTriggerEntity] = useState<EntityWithRelations | null>(null);
  const [archived, setArchived] = useState<EntityWithRelations | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // Полный список похожих кандидатов (карусель) + выбранный для сравнения справа.
  const [duplicates, setDuplicates] = useState<DuplicateCandidateResult[]>([]);
  const [selectedDupId, setSelectedDupId] = useState<number | null>(hiddenId);
  const [rightLoading, setRightLoading] = useState(false);

  // Подгружаем профиль дубля сразу (не только по клику «Проверить»), чтобы заранее
  // понять — это реальное совпадение или мусорный/устаревший флаг. Баннер по-прежнему
  // триггерится по hiddenId, поэтому грузим именно его для предпросмотра.
  useEffect(() => {
    if (hiddenId && !triggerEntity) {
      getEntity(hiddenId)
        .then((e) => {
          setTriggerEntity(e);
          // Изначально правая колонка = hiddenId (до открытия модалки/карусели).
          setArchived((prev) => prev ?? e);
        })
        .catch(() => {});
    }
  }, [hiddenId, triggerEntity]);

  if (!hiddenId || resolved) return null;

  // Загружает полный профиль выбранного дубликата в правую колонку сравнения.
  const loadSelected = async (id: number) => {
    setSelectedDupId(id);
    // Уже загруженный hiddenId переиспользуем без повторного запроса.
    if (archived && archived.id === id) return;
    setRightLoading(true);
    try {
      setArchived(await getEntity(id));
    } catch {
      toast.error("Не удалось загрузить профиль дубликата");
    } finally {
      setRightLoading(false);
    }
  };

  const openModal = async () => {
    setOpen(true);
    setLoading(true);
    try {
      // Тянем ВСЕХ похожих кандидатов (включая архив) для карусели.
      const list = await getDuplicateCandidates(card.id, true);
      setDuplicates(list);
      // Предвыбор: существующий hiddenId, если он в списке; иначе — самый
      // вероятный (список отсортирован по убыванию confidence на бэке).
      const preset =
        list.find((d) => d.entity_id === hiddenId)?.entity_id ?? list[0]?.entity_id ?? hiddenId;
      if (preset != null) {
        await loadSelected(preset);
      } else if (!archived) {
        // Список пуст — fallback на одиночное поведение по hiddenId.
        setArchived(triggerEntity ?? (await getEntity(hiddenId)));
      }
    } catch {
      // Если список не получили — не регрессируем: показываем одиночный hiddenId.
      if (!archived) {
        try {
          setArchived(triggerEntity ?? (await getEntity(hiddenId)));
        } catch {
          toast.error("Не удалось загрузить профиль дубликата");
        }
      }
      setSelectedDupId(hiddenId);
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async () => {
    const targetId = selectedDupId ?? hiddenId;
    if (targetId == null) return;
    setBusy(true);
    try {
      await mergeShadowDuplicate(card.id, targetId);
      toast.success("Профили объединены");
      setOpen(false);
      setResolved(true);
      onResolved?.();
    } catch {
      toast.error("Не удалось объединить профили");
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    const targetId = selectedDupId ?? hiddenId;
    if (targetId == null) return;
    setBusy(true);
    try {
      await dismissDuplicate(card.id, targetId);
      toast.success("Отмечено: это разные люди");
      setOpen(false);
      setResolved(true);
      onResolved?.();
    } catch {
      toast.error("Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const left = sideFromCard(card, status);
  const right = archived ? sideFromEntity(archived) : null;
  const cardArchived = !!(card.extra_data?.is_archived as boolean | undefined);

  const matched = (key: FieldKey | "name"): boolean => matchSide(left, right, key);

  const matchedKeys = right ? IDENTITY_KEYS.filter((k) => matched(k)) : [];

  // Триггер баннера — отдельный матчинг ИМЕННО против hiddenId (triggerEntity),
  // не против выбранного в карусели дубликата. Иначе выбор «непохожего» кандидата
  // в открытой модалке обнулил бы matchedKeys и схлопнул бы весь баннер+модалку.
  const triggerSide = triggerEntity ? sideFromEntity(triggerEntity) : null;
  const triggerMatchedKeys = triggerSide
    ? IDENTITY_KEYS.filter((k) => matchSide(left, triggerSide, k))
    : [];

  // Баннер показываем ТОЛЬКО при реальном совпадении по контактам
  // (имя/телефон/почта/telegram) С hiddenId. Дубль не загрузился или совпадений нет —
  // это ложный/устаревший флаг, баннер не мозолит глаза.
  if (!triggerEntity || triggerMatchedKeys.length === 0) return null;

  // Индекс показанного справа дубликата — для нав-стрелок «перебираем карточки».
  const idx = duplicates.findIndex((d) => d.entity_id === selectedDupId);
  // Уверенность + совпавшие поля ВЫБРАННОГО дубликата — для бейджа/чипов правой карточки.
  const selectedDup = idx >= 0 ? duplicates[idx] : null;
  const rightConfidence = selectedDup ? selectedDup.confidence : undefined;
  const rightMatchedFields = selectedDup ? Object.keys(selectedDup.matched_fields) : undefined;

  return (
    <>
      {/* Баннер над action-баром карточки */}
      <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-500 px-5 py-3 mb-4 shadow-sm">
        <div className="flex items-center gap-3 text-white">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="font-medium">Похожий кандидат есть в базе</span>
        </div>
        <button
          onClick={openModal}
          className="shrink-0 rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-amber-700 hover:bg-amber-50 transition-colors"
        >
          Проверить
        </button>
      </div>

      {/* Белый экран сравнения */}
      {open && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
              <h2 className="text-base font-semibold text-slate-900">Проверка похожих кандидатов</h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Закрыть">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-5">
              {loading ? (
                <div className="flex items-center justify-center py-16 text-slate-400">
                  <Loader2 className="w-7 h-7 animate-spin" />
                </div>
              ) : (
                <>
                  {matchedKeys.length > 0 ? (
                    <div className="mb-4 text-sm text-amber-700">
                      Совпадение по:{" "}
                      <span className="font-semibold text-amber-800">
                        {matchedKeys.map((k) => IDENTITY_LABEL[k]).join(", ")}
                      </span>
                    </div>
                  ) : (
                    <div className="mb-4 text-sm text-rose-600">
                      Нет совпадений по контактам (имя / телефон / почта / telegram) — вероятно, это разные люди.
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <CandidateCompareCard title={cardArchived ? "Эта анкета (в архиве)" : "Новый кандидат"} side={left} matched={matched} />
                    <div className="min-w-0">
                      {/* Нав по похожим анкетам — перебираем дубликаты в правой колонке */}
                      {duplicates.length > 1 && (
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[11px] uppercase tracking-wide text-slate-400">Похожие анкеты</span>
                          <div className="ml-auto flex items-center gap-2">
                            <button
                              onClick={() => idx > 0 && loadSelected(duplicates[idx - 1].entity_id)}
                              disabled={idx <= 0}
                              className="p-1 rounded-md bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              aria-label="Предыдущая анкета"
                            >
                              <ChevronLeft size={14} className="text-slate-500" />
                            </button>
                            <span className="text-xs font-medium text-slate-500 tabular-nums">
                              {idx + 1} / {duplicates.length}
                            </span>
                            <button
                              onClick={() => idx < duplicates.length - 1 && loadSelected(duplicates[idx + 1].entity_id)}
                              disabled={idx >= duplicates.length - 1}
                              className="p-1 rounded-md bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              aria-label="Следующая анкета"
                            >
                              <ChevronRight size={14} className="text-slate-500" />
                            </button>
                          </div>
                        </div>
                      )}
                      {rightLoading ? (
                        <div className="rounded-xl border border-slate-200 p-4 flex items-center justify-center text-slate-400">
                          <Loader2 className="w-6 h-6 animate-spin" />
                        </div>
                      ) : (
                        <CandidateCompareCard
                          title="Старая анкета (дубликат)"
                          side={right}
                          matched={matched}
                          confidence={rightConfidence}
                          matchedFields={rightMatchedFields}
                        />
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="border-t border-slate-200 px-5 py-4 shrink-0 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">
                После объединения у кандидата сохранятся оба резюме и история статусов.
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  disabled={busy}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                >
                  Закрыть
                </button>
                <button
                  disabled={busy}
                  onClick={handleDismiss}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Нет, это разные люди
                </button>
                <button
                  disabled={busy}
                  onClick={handleMerge}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Завершить объединение
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
