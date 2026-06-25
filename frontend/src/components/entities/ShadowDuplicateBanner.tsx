import { useState, useEffect, useRef } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
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

export default function ShadowDuplicateBanner({ card, status, onResolved }: ShadowDuplicateBannerProps) {
  const hiddenId = (card.extra_data?.hidden_duplicate_id as number | undefined) ?? null;
  const [resolved, setResolved] = useState(false);
  const [open, setOpen] = useState(false);
  // triggerEntity — профиль hiddenId, по которому решается ПОКАЗ баннера (стабилен,
  // не зависит от выбора в карусели).
  const [triggerEntity, setTriggerEntity] = useState<EntityWithRelations | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // Полный список похожих кандидатов (трек-карусель) + выбранный для сравнения справа.
  const [duplicates, setDuplicates] = useState<DuplicateCandidateResult[]>([]);
  const [selectedDupId, setSelectedDupId] = useState<number | null>(hiddenId);
  // Полные профили ВСЕХ дубликатов в STATE — именно они рендерят трек (карточки
  // въезжают, как только соответствующий профиль подгрузился префетчем).
  const [entities, setEntities] = useState<Record<number, EntityWithRelations>>({});
  // Кэш тех же профилей в ref — для СИНХРОННого сидинга (предвыбор/triggerEntity),
  // чтобы трек не моргал спиннером там, где профиль уже под рукой.
  const entityCache = useRef<Map<number, EntityWithRelations>>(new Map());

  // Подгружаем профиль дубля сразу (не только по клику «Проверить»), чтобы заранее
  // понять — это реальное совпадение или мусорный/устаревший флаг. Баннер по-прежнему
  // триггерится по hiddenId, поэтому грузим именно его для предпросмотра.
  useEffect(() => {
    if (hiddenId && !triggerEntity) {
      getEntity(hiddenId)
        .then((e) => {
          setTriggerEntity(e);
          // Предзаполняем кэш + STATE загруженным hiddenId, чтобы трек сразу имел
          // профиль предвыбранного дубликата и не перезапрашивал его.
          entityCache.current.set(e.id, e);
          setEntities((prev) => (prev[e.id] ? prev : { ...prev, [e.id]: e }));
        })
        .catch(() => {});
    }
  }, [hiddenId, triggerEntity]);

  if (!hiddenId || resolved) return null;

  // Профиль ВЫБРАННОГО в треке дубликата (центрированная правая карточка). Дерайвится
  // из entities-state по selectedDupId; до подгрузки — fallback на triggerEntity
  // (hiddenId), чтобы «Совпадение по»/right/matched работали с первого кадра.
  const archived: EntityWithRelations | null =
    (selectedDupId != null ? entities[selectedDupId] : undefined) ?? triggerEntity ?? null;

  // Выбирает дубликат для центрирования + добирает его профиль в STATE/кэш, если
  // префетч ещё не доставил. Трек сам подменит плейсхолдер на карточку, как только
  // entities обновится — отдельный right-спиннер больше не нужен.
  const loadSelected = async (id: number) => {
    setSelectedDupId(id);
    if (entityCache.current.has(id)) return;
    try {
      const e = await getEntity(id);
      entityCache.current.set(id, e);
      setEntities((prev) => (prev[id] ? prev : { ...prev, [id]: e }));
    } catch {
      toast.error("Не удалось загрузить профиль дубликата");
    }
  };

  const openModal = async () => {
    setOpen(true);
    setLoading(true);
    try {
      // Тянем ВСЕХ похожих кандидатов (включая архив) для карусели.
      const list = await getDuplicateCandidates(card.id, true);
      setDuplicates(list);
      // Префетч полных профилей ВСЕХ дубликатов в фоне (не ждём перед показом
      // модалки) — каждый въезжает в трек, как только entities-state обновится.
      try {
        void Promise.allSettled(
          list.map((d) =>
            entityCache.current.has(d.entity_id)
              ? Promise.resolve()
              : getEntity(d.entity_id)
                  .then((e) => {
                    entityCache.current.set(d.entity_id, e);
                    setEntities((prev) => (prev[d.entity_id] ? prev : { ...prev, [d.entity_id]: e }));
                  })
                  .catch(() => {}),
          ),
        );
      } catch {
        /* префетч best-effort — не блокирует и не ломает открытие модалки */
      }
      // Предвыбор: существующий hiddenId, если он в списке; иначе — самый
      // вероятный (список отсортирован по убыванию confidence на бэке).
      const preset =
        list.find((d) => d.entity_id === hiddenId)?.entity_id ?? list[0]?.entity_id ?? hiddenId;
      if (preset != null) {
        await loadSelected(preset);
      }
    } catch {
      // Если список не получили — не регрессируем: центрируем одиночный hiddenId
      // (archived дерайвится из triggerEntity/entities, поэтому достаточно выбрать id).
      setSelectedDupId(hiddenId);
      if (!entityCache.current.has(hiddenId)) {
        try {
          const e = triggerEntity ?? (await getEntity(hiddenId));
          entityCache.current.set(hiddenId, e);
          setEntities((prev) => (prev[hiddenId] ? prev : { ...prev, [hiddenId]: e }));
        } catch {
          toast.error("Не удалось загрузить профиль дубликата");
        }
      }
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
      if (idx >= duplicates.length - 1) {
        setOpen(false);
        setResolved(true);
        onResolved?.();
      } else {
        goToDup(1);
      }
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
      if (idx >= duplicates.length - 1) {
        setOpen(false);
        setResolved(true);
        onResolved?.();
      } else {
        goToDup(1);
      }
    } catch {
      toast.error("Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const left = sideFromCard(card, status);
  const right = archived ? sideFromEntity(archived) : null;

  const matched = (key: FieldKey | "name"): boolean => matchSide(left, right, key);

  // Баннер показываем только если есть triggerEntity (найден возможный дубликат)
  if (!triggerEntity) return null;

  // Индекс показанного справа дубликата — для нав-стрелок «перебираем карточки».
  const idx = duplicates.findIndex((d) => d.entity_id === selectedDupId);
  // Перелистывание дублей (свайп карточки / клик по точке) — на delta шагов.
  // Трек спружинит к idx*100%, новая карточка въедет справа без пустоты.
  const goToDup = (delta: number) => {
    const target = idx + delta;
    if (target < 0 || target >= duplicates.length || target === idx) return;
    loadSelected(duplicates[target].entity_id);
  };

  return (
    <>
      {/* Баннер над action-баром карточки */}
      <div className="flex items-center justify-between gap-3  bg-amber-500 px-5 py-3 mb-4 shadow-sm">
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

      {/* Модальное окно сравнения */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          {loading ? (
            <div className="text-white flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : (
            <div
              className="bg-gray-50 rounded-2xl shadow-2xl flex flex-col w-full max-w-6xl max-h-[90vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* BODY: Прозрачные колонки */}
              <div className="flex-1 flex gap-6 p-6 overflow-hidden">

                {/* ЛЕВАЯ КОЛОНКА - полностью прозрачная обертка */}
                <div className="w-1/2 flex flex-col overflow-y-auto relative" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                  <style>{`
                    div::-webkit-scrollbar { display: none; }
                  `}</style>
                  {/* Заголовок слева, симметрично справа */}
                  <h3 className="text-sm font-semibold text-gray-800 mb-3 px-1 shrink-0">Новый кандидат</h3>
                  {/* Компонент имеет собственные: bg-white border border-gray-200 rounded-xl shadow-sm p-6 */}
                  <CandidateCompareCard
                    title=""
                    side={left}
                    matched={matched}
                    entityId={card.id}
                    vacancies={Array.isArray((card.extra_data as any)?.system_hr_tags) ? (card.extra_data as any).system_hr_tags : undefined}
                  />
                </div>

                {/* ПРАВАЯ КОЛОНКА - полностью прозрачная обертка */}
                <div className="w-1/2 flex flex-col overflow-hidden">

                  {/* Шапка просто висит в воздухе над карточкой (без рамок и фонов) */}
                  <div className="flex justify-between items-center mb-3 px-1 shrink-0">
                    <h3 className="text-sm font-semibold text-gray-800">Похожие анкеты</h3>
                    {duplicates.length > 1 && (
                      <div className="text-sm text-gray-500 font-medium flex items-center gap-2">
                        <button
                          onClick={() => goToDup(-1)}
                          disabled={idx <= 0}
                          className="disabled:opacity-30 cursor-pointer"
                          aria-label="Предыдущая"
                        >
                          &lt;
                        </button>
                        <span className="tabular-nums min-w-[50px] text-center">
                          {idx + 1} из {duplicates.length}
                        </span>
                        <button
                          onClick={() => goToDup(1)}
                          disabled={idx >= duplicates.length - 1}
                          className="disabled:opacity-30 cursor-pointer"
                          aria-label="Следующая"
                        >
                          &gt;
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Трек карусели */}
                  <div className="flex-1 overflow-hidden relative flex flex-col">
                    <div
                      className="flex h-full transition-transform duration-300 ease-in-out"
                      style={{ transform: `translateX(-${idx * 100}%)` }}
                    >
                      {duplicates.length > 0 ? (
                        duplicates.map((d) => {
                          const ent = entities[d.entity_id];
                          const dupSide = ent ? sideFromEntity(ent) : null;
                          return (
                            /* Слайд - прозрачный */
                            <div
                              key={d.entity_id}
                              className="w-full h-full flex-shrink-0 flex flex-col overflow-y-auto pb-2 pr-2 relative"
                              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                            >
                              <style>{`
                                div::-webkit-scrollbar { display: none; }
                              `}</style>
                              {/* Карточка дубля с собственными стилями: bg-white border border-gray-200 rounded-xl shadow-sm p-6 */}
                              {dupSide ? (
                                <CandidateCompareCard
                                  title=""
                                  side={dupSide}
                                  matched={(k) => matchSide(left, dupSide, k)}
                                  confidence={d.confidence}
                                  matchedFields={Object.keys(d.matched_fields)}
                                  entityId={d.entity_id}
                                  vacancies={Array.isArray((ent?.extra_data as any)?.system_hr_tags) ? (ent?.extra_data as any).system_hr_tags : undefined}
                                />
                              ) : (
                                <div className="flex items-center justify-center text-gray-400 h-full">
                                  <Loader2 className="w-6 h-6 animate-spin" />
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                          <Loader2 className="w-6 h-6 animate-spin" />
                        </div>
                      )}
                    </div>
                  </div>

                </div>

              </div>

              {/* FOOTER - белый низ с кнопками */}
              <div className="shrink-0 p-4 bg-white border-t border-gray-200 flex justify-center items-center gap-4">
                <button
                  disabled={busy}
                  onClick={handleMerge}
                  className="inline-flex items-center justify-center gap-2 bg-lime-500 hover:bg-lime-600 text-white rounded-lg px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Завершить объединение
                </button>
                <button
                  disabled={busy}
                  onClick={handleDismiss}
                  className="inline-flex items-center justify-center gap-2 border-2 border-red-500 bg-white text-red-600 hover:bg-red-50 rounded-lg px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  Нет, это разные люди
                </button>
                <button
                  disabled={busy}
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center justify-center gap-2 bg-white text-black hover:bg-gray-100 rounded-lg px-6 py-2.5 text-sm font-semibold border-2 border-black disabled:opacity-50"
                >
                  Закрыть
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
