import { backdropClose } from '@/utils/backdropClose';
import { useState, useEffect, useRef, useCallback } from "react";
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
  type HiddenDuplicateMeta,
} from "@/services/api/entities";
import { clearCompareFilesCache } from "./CompareResumePreview";
import {
  CandidateCompareCard,
  sideFromCard,
  sideFromEntity,
  matchSide,
  matchKindOf,
  type FieldKey,
  type MatchKind,
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
  const meta = (card.extra_data?.hidden_duplicate_meta ?? null) as HiddenDuplicateMeta | null;
  const isSoft = meta?.strength === "soft";
  const isText = meta?.strength === "text";
  const bannerBg = isSoft || isText ? "bg-amber-500" : "bg-red-600";
  const bannerTitle = isSoft
    ? `Возможно тот же человек · ${Math.round(meta?.confidence ?? 0)}%`
    : isText
      ? `Текст резюме совпадает · ${Math.round(meta?.confidence ?? 0)}%`
      : "Точное совпадение — кандидат уже в базе";
  const bannerReasons = isSoft || isText ? (meta?.reasons ?? []) : [];
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
  // Трек карусели: нативный scroll-snap вместо transform. Даёт настоящий свайп
  // (тачпад, тач, drag) и «подглядывание» следующей анкеты краем — по прежнему
  // треку на translateX было не видно, что анкет несколько (жалоба Эльвиры:
  // пролистала, не поняв, что решение принимается по одной).
  const trackRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // Скролл, который мы вызвали сами, не должен тут же перевыбирать анкету.
  const scrollingTo = useRef<number | null>(null);
  // Решения ПО ПАРАМ (2026-09-15, Эльвира): кнопки действуют только на анкету,
  // открытую справа. Решённые помечаются и пропускаются, окно закрывается само,
  // только когда решены все — раньше решение по последней в карусели закрывало
  // окно, и непролистанные анкеты молча оставались непроверенными.
  const [decisions, setDecisions] = useState<Record<number, "merged" | "dismissed">>({});

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

  // Выбирает дубликат для сравнения + добирает его профиль в STATE/кэш, если
  // префетч ещё не доставил. Трек сам подменит плейсхолдер на карточку, как только
  // entities обновится — отдельный right-спиннер больше не нужен.
  // Объявлено ДО ранних return'ов: на неё ссылаются эффекты карусели ниже.
  const loadSelected = useCallback(async (id: number) => {
    setSelectedDupId(id);
    if (entityCache.current.has(id)) return;
    try {
      const e = await getEntity(id);
      entityCache.current.set(id, e);
      setEntities((prev) => (prev[id] ? prev : { ...prev, [id]: e }));
    } catch {
      toast.error("Не удалось загрузить профиль дубликата");
    }
  }, []);

  // Скролл трека к анкете (снап её отцентрирует).
  const scrollToId = useCallback((id: number, behavior: ScrollBehavior = "smooth") => {
    scrollingTo.current = id;
    slideRefs.current.get(id)?.scrollIntoView({ behavior, inline: "center", block: "nearest" });
  }, []);

  // Свайп/скролл трека выбирает анкету сам: решение всегда относится к той, что
  // стоит по центру. Иначе рекрутёр листает, а кнопки действуют на другую пару.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || !open) return;
    let timer: number | undefined;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Центры считаем по getBoundingClientRect: у слайдов свой offsetParent
        // (они position:relative), поэтому offsetLeft лежит в другой системе
        // координат и выбор «залипал» на первой анкете.
        const trackRect = el.getBoundingClientRect();
        const center = trackRect.left + trackRect.width / 2;
        let bestId: number | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
        slideRefs.current.forEach((node, id) => {
          const r = node.getBoundingClientRect();
          const dist = Math.abs(r.left + r.width / 2 - center);
          if (dist < bestDist) {
            bestDist = dist;
            bestId = id;
          }
        });
        if (bestId != null) {
          scrollingTo.current = null;
          setSelectedDupId((prev) => (prev === bestId ? prev : bestId));
          if (bestId != null && !entityCache.current.has(bestId)) void loadSelected(bestId);
        }
      }, 120);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
    // loading — обязательная зависимость: пока крутится спиннер, трека в DOM нет
    // и вешать слушатель не на что. Без неё эффект отрабатывал вхолостую один раз
    // при открытии, и свайп не переключал анкету.
  }, [open, loading, duplicates.length, loadSelected]);

  // Выбор поменялся не скроллом (открытие окна, переход к следующей непроверенной
  // после решения) — подводим трек к нужной анкете.
  useEffect(() => {
    if (!open || selectedDupId == null) return;
    const node = slideRefs.current.get(selectedDupId);
    if (node) scrollToId(selectedDupId, scrollingTo.current == null ? "auto" : "smooth");
  }, [open, loading, selectedDupId, duplicates.length, scrollToId]);

  // Стрелки клавиатуры — привычный способ листать карусель.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const pos = duplicates.findIndex((d) => d.entity_id === selectedDupId);
      const next = Math.max(0, Math.min(duplicates.length - 1, pos + (e.key === "ArrowRight" ? 1 : -1)));
      if (next === pos || !duplicates[next]) return;
      e.preventDefault();
      scrollToId(duplicates[next].entity_id);
      void loadSelected(duplicates[next].entity_id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, duplicates, selectedDupId, scrollToId, loadSelected]);

  if (!hiddenId || resolved) return null;

  // Профиль ВЫБРАННОГО в треке дубликата (центрированная правая карточка). Дерайвится
  // из entities-state по selectedDupId; до подгрузки — fallback на triggerEntity
  // (hiddenId), чтобы «Совпадение по»/right/matched работали с первого кадра.
  const archived: EntityWithRelations | null =
    (selectedDupId != null ? entities[selectedDupId] : undefined) ?? triggerEntity ?? null;

  const openModal = async () => {
    // Резюме могли догрузить с прошлой проверки — читаем файлы заново.
    clearCompareFilesCache();
    setDecisions({});
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

  // После решения по текущей паре — к следующей НЕрешённой (сначала вперёд по
  // карусели, потом назад). Нерешённых нет — всё проверено, закрываем окно.
  const afterDecision = (targetId: number, kind: "merged" | "dismissed") => {
    const next = { ...decisions, [targetId]: kind };
    setDecisions(next);
    const pos = duplicates.findIndex((d) => d.entity_id === targetId);
    const undecided = (d: DuplicateCandidateResult) => !next[d.entity_id];
    const forward = duplicates.slice(pos + 1).find(undecided);
    const backward = duplicates.slice(0, Math.max(pos, 0)).reverse().find(undecided);
    const nextDup = forward ?? backward;
    if (nextDup) {
      loadSelected(nextDup.entity_id);
    } else {
      setOpen(false);
      setResolved(true);
      onResolved?.();
    }
  };

  const handleMerge = async () => {
    const targetId = selectedDupId ?? hiddenId;
    if (targetId == null || decisions[targetId]) return;
    setBusy(true);
    try {
      await mergeShadowDuplicate(card.id, targetId);
      toast.success("Анкета объединена с новым кандидатом");
      afterDecision(targetId, "merged");
    } catch (err) {
      const detail = (err as { response?: { status?: number; data?: { detail?: string } } })?.response;
      toast.error(detail?.status === 409 && detail.data?.detail ? detail.data.detail : "Не удалось объединить профили");
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    const targetId = selectedDupId ?? hiddenId;
    if (targetId == null || decisions[targetId]) return;
    setBusy(true);
    try {
      await dismissDuplicate(card.id, targetId);
      toast.success("Отмечено: эта анкета — другой человек");
      afterDecision(targetId, "dismissed");
    } catch {
      toast.error("Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  // «Закрыть» при частично решённых: решения сохранены, остальные ждут —
  // говорим прямо, чтобы не казалось, что закрытие разделило всех.
  const closeModal = () => {
    const decidedCount = Object.keys(decisions).length;
    const left = duplicates.length - decidedCount;
    if (decidedCount > 0 && left > 0) {
      toast(`Решения сохранены. Ещё не проверено анкет: ${left}`);
    }
    setOpen(false);
  };

  const left = sideFromCard(card, status);
  const right = archived ? sideFromEntity(archived) : null;

  // Сигналы ВЫБРАННОЙ пары — общий источник подсветки для обеих карточек:
  // подсвечиваем ровно те поля, из-за которых бэк считает пару дублем, и отличаем
  // точное совпадение от частичного. matchSide остаётся фолбэком, пока список
  // дублей ещё не пришёл.
  const selectedSignals = duplicates.find((d) => d.entity_id === selectedDupId)?.signals;
  const matched = (key: FieldKey | "name"): MatchKind =>
    matchKindOf(selectedSignals, key, () => matchSide(left, right, key));

  // Баннер показываем только если есть triggerEntity (найден возможный дубликат)
  if (!triggerEntity) return null;

  // Индекс показанного справа дубликата — для нав-стрелок «перебираем карточки».
  const idx = Math.max(0, duplicates.findIndex((d) => d.entity_id === selectedDupId));
  const selectedDecision = selectedDupId != null ? decisions[selectedDupId] : undefined;
  const undecidedCount = duplicates.filter((d) => !decisions[d.entity_id]).length;
  const selectedName = duplicates[idx]?.entity_name || archived?.name || "";
  // Показать анкету по индексу: доскроллить трек и выбрать её для решения.
  const goToIndex = (target: number) => {
    if (target < 0 || target >= duplicates.length) return;
    const id = duplicates[target].entity_id;
    scrollToId(id);
    if (id !== selectedDupId) void loadSelected(id);
  };
  const goToDup = (delta: number) => goToIndex(idx + delta);

  return (
    <>
      {/* Баннер над action-баром карточки */}
      <div className={`flex flex-col gap-1.5 ${bannerBg} px-5 py-3 mb-4 shadow-sm`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-white">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span className="font-medium">{bannerTitle}</span>
          </div>
          <button
            onClick={openModal}
            className="shrink-0 rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
          >
            Проверить
          </button>
        </div>
        {bannerReasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pl-8">
            {bannerReasons.map((r) => (
              <span key={r} className="rounded-full bg-white/25 px-2 py-0.5 text-xs text-white">
                {r}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Модальное окно сравнения */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          {...backdropClose(() => !busy && closeModal())}
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
                    extraData={card.extra_data as Record<string, unknown> | undefined}
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
                          {" · "}
                          {undecidedCount > 0 ? `не проверено: ${undecidedCount}` : "все проверены"}
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

                  {/* Трек карусели: горизонтальный скролл со снапом */}
                  <div className="flex-1 overflow-hidden relative flex flex-col">
                    <div
                      ref={trackRef}
                      className="flex h-full gap-3 overflow-x-auto snap-x snap-mandatory overscroll-x-contain"
                      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                    >
                      {duplicates.length > 0 ? (
                        duplicates.map((d) => {
                          const ent = entities[d.entity_id];
                          const dupSide = ent ? sideFromEntity(ent) : null;
                          return (
                            /* Слайд - прозрачный */
                            <div
                              key={d.entity_id}
                              ref={(el) => {
                                if (el) slideRefs.current.set(d.entity_id, el);
                                else slideRefs.current.delete(d.entity_id);
                              }}
                              data-dup-id={d.entity_id}
                              // Чуть уже колонки, когда анкет несколько: справа
                              // выглядывает край следующей — видно, что она есть.
                              className={`h-full flex-shrink-0 flex flex-col overflow-y-auto pb-2 pr-2 relative snap-center transition-opacity ${
                                duplicates.length > 1 ? "w-[94%]" : "w-full"
                              } ${d.entity_id === selectedDupId ? "opacity-100" : "opacity-60"}`}
                              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                            >
                              <style>{`
                                div::-webkit-scrollbar { display: none; }
                              `}</style>
                              {/* Карточка дубля с собственными стилями: bg-white border border-gray-200 rounded-xl shadow-sm p-6 */}
                              {decisions[d.entity_id] && (
                                <div
                                  className={`mb-2 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                                    decisions[d.entity_id] === "merged"
                                      ? "bg-lime-100 text-lime-800"
                                      : "bg-red-50 text-red-700"
                                  }`}
                                >
                                  {decisions[d.entity_id] === "merged"
                                    ? "Объединена с новым кандидатом"
                                    : "Отмечено: другой человек"}
                                </div>
                              )}
                              {dupSide ? (
                                <CandidateCompareCard
                                  title=""
                                  side={dupSide}
                                  matched={(k) => matchKindOf(d.signals, k, () => matchSide(left, dupSide, k))}
                                  confidence={d.confidence}
                                  signals={d.signals}
                                  entityId={d.entity_id}
                                  vacancies={Array.isArray((ent?.extra_data as any)?.system_hr_tags) ? (ent?.extra_data as any).system_hr_tags : undefined}
                                  extraData={ent?.extra_data as Record<string, unknown> | undefined}
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

                  {/* Лента анкет: видно ВСЕ похожие сразу — кто уже решён, кто ждёт,
                      и на какой мы стоим. Клик листает трек к нужной. */}
                  {duplicates.length > 1 && (
                    <div className="shrink-0 flex gap-1.5 overflow-x-auto pt-2 pb-0.5" style={{ scrollbarWidth: "none" }}>
                      {duplicates.map((d, i) => {
                        const decided = decisions[d.entity_id];
                        const isCurrent = d.entity_id === selectedDupId;
                        return (
                          <button
                            key={d.entity_id}
                            onClick={() => goToIndex(i)}
                            title={d.entity_name}
                            className={`shrink-0 max-w-[150px] rounded-lg border px-2 py-1 text-left transition-colors ${
                              isCurrent
                                ? "border-gray-800 bg-white"
                                : "border-gray-200 bg-white/60 hover:bg-white"
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                  decided === "merged"
                                    ? "bg-lime-500"
                                    : decided === "dismissed"
                                      ? "bg-red-500"
                                      : "bg-amber-400"
                                }`}
                              />
                              <span className="truncate text-[11px] font-medium text-gray-700">
                                {d.entity_name || `Анкета ${i + 1}`}
                              </span>
                            </div>
                            <div className="pl-3 text-[10px] text-gray-400">
                              {decided ? (decided === "merged" ? "объединена" : "другой человек") : `${d.confidence}%`}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                </div>

              </div>

              {/* FOOTER - белый низ с кнопками */}
              <div className="shrink-0 p-4 bg-white border-t border-gray-200 flex flex-col items-center gap-3">
                {duplicates.length > 1 && (
                  <div className="text-sm text-gray-600 text-center">
                    {selectedDecision
                      ? "По этой анкете решение уже принято — пролистайте к непроверенной"
                      : <>Решение только по анкете {idx + 1} из {duplicates.length}{selectedName ? <>: <b>{selectedName}</b></> : null}</>}
                  </div>
                )}
                <div className="flex justify-center items-center gap-4">
                <button
                  disabled={busy || !!selectedDecision}
                  onClick={handleMerge}
                  className="inline-flex items-center justify-center gap-2 bg-lime-500 hover:bg-lime-600 text-white rounded-lg px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  {duplicates.length > 1 ? "Объединить с этой анкетой" : "Завершить объединение"}
                </button>
                <button
                  disabled={busy || !!selectedDecision}
                  onClick={handleDismiss}
                  className="inline-flex items-center justify-center gap-2 border-2 border-red-500 bg-white text-red-600 hover:bg-red-50 rounded-lg px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  {duplicates.length > 1 ? "Это другой человек" : "Нет, это разные люди"}
                </button>
                <button
                  disabled={busy}
                  onClick={closeModal}
                  className="inline-flex items-center justify-center gap-2 bg-white text-black hover:bg-gray-100 rounded-lg px-6 py-2.5 text-sm font-semibold border-2 border-black disabled:opacity-50"
                >
                  Закрыть
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
