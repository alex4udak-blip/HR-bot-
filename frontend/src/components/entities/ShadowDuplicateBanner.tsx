import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, X, Loader2 } from "lucide-react";
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

      {/* Плавающий экран сравнения — без белой коробки: карточки парят на затемнённом фоне */}
      {open && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/55 backdrop-blur-sm p-6"
          onClick={() => !busy && setOpen(false)}
        >
          {/* X в правом верхнем углу экрана */}
          <button
            onClick={() => setOpen(false)}
            className="absolute top-5 right-5 text-white/60 hover:text-white"
            aria-label="Закрыть"
          >
            <X className="w-6 h-6" />
          </button>

          {loading ? (
            <div className="flex items-center justify-center text-white/70" onClick={(e) => e.stopPropagation()}>
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : (
            <div
              className="flex items-center gap-6 w-full max-w-7xl max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* ЛЕВО — карточка нового кандидата */}
              <div className="flex-1 min-w-0 max-h-[88vh] overflow-auto">
                <CandidateCompareCard
                  title={cardArchived ? "Эта анкета (в архиве)" : "Новый кандидат"}
                  side={left}
                  matched={matched}
                />
              </div>

              {/* ЦЕНТР — совпадение + действия */}
              <div className="shrink-0 w-[220px] flex flex-col items-center gap-2.5 text-center">
                {matchedKeys.length > 0 ? (
                  <div className="text-sm text-amber-300">
                    Совпадение по:{" "}
                    <span className="font-semibold text-amber-200">
                      {matchedKeys.map((k) => IDENTITY_LABEL[k]).join(", ")}
                    </span>
                  </div>
                ) : (
                  <div className="text-sm text-rose-300">
                    Нет совпадений по контактам (имя / телефон / почта / telegram) — вероятно, это разные люди.
                  </div>
                )}

                <button
                  disabled={busy}
                  onClick={handleMerge}
                  className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Завершить объединение
                </button>
                <button
                  disabled={busy}
                  onClick={handleDismiss}
                  className="w-full border border-red-300/70 bg-white/95 text-red-600 hover:bg-red-50 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50"
                >
                  Нет, это разные люди
                </button>
                <button
                  disabled={busy}
                  onClick={() => setOpen(false)}
                  className="w-full text-white/70 hover:text-white hover:bg-white/10 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  Закрыть
                </button>

                <p className="text-xs text-white/55 mt-1">
                  После объединения у кандидата сохранятся оба резюме и история статусов.
                </p>
              </div>

              {/* ПРАВО — карусель похожих анкет (карточки парят, без slate-панели) */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[11px] uppercase tracking-wide font-medium text-white/60">Похожие анкеты</span>
                  {duplicates.length > 1 && (
                    <span className="text-xs font-medium text-white/50 tabular-nums">
                      {idx + 1} из {duplicates.length}
                    </span>
                  )}
                </div>
                {/* Перебираем анкеты СВАЙПОМ, как колоду карт: ВСЕ дубли лежат в
                    ряд (трек шириной N×85%), трек смещается на -idx*85%, тянешь
                    карточку → след./пред. дубль въезжает справа без пустоты. */}
                {duplicates.length === 0 ? (
                  // Список не загрузился — не регрессируем в пустоту: одиночная
                  // карточка по derived right (triggerEntity/hiddenId), без трека.
                  right ? (
                    <CandidateCompareCard title="Старая анкета (дубликат)" side={right} matched={matched} />
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-white p-6 flex items-center justify-center text-slate-400 min-h-[220px]">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  )
                ) : (
                  <div className="overflow-hidden">
                    <motion.div
                      className="flex cursor-grab active:cursor-grabbing"
                      animate={{ x: `-${Math.max(idx, 0) * 85}%` }}
                      transition={{ type: "tween", duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
                      drag={duplicates.length > 1 ? "x" : false}
                      dragConstraints={{ left: 0, right: 0 }}
                      dragElastic={0.12}
                      onDragEnd={(_e, info) => {
                        if (info.offset.x < -64) goToDup(1);
                        else if (info.offset.x > 64) goToDup(-1);
                      }}
                    >
                      {duplicates.map((d) => {
                        const ent = entities[d.entity_id];
                        const dupSide = ent ? sideFromEntity(ent) : null;
                        return (
                          <div key={d.entity_id} className="w-[85%] shrink-0 pr-3">
                            {dupSide ? (
                              <CandidateCompareCard
                                title="Старая анкета (дубликат)"
                                side={dupSide}
                                matched={(k) => matchSide(left, dupSide, k)}
                                confidence={d.confidence}
                                matchedFields={Object.keys(d.matched_fields)}
                              />
                            ) : (
                              <div className="rounded-xl border border-slate-200 bg-white p-6 flex items-center justify-center text-slate-400 min-h-[220px]">
                                <Loader2 className="w-6 h-6 animate-spin" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </motion.div>
                  </div>
                )}
                {duplicates.length > 1 && (
                  <div className="pt-3 flex items-center justify-center gap-1.5">
                    {duplicates.map((d, i) => (
                      <button
                        key={d.entity_id}
                        onClick={() => goToDup(i - idx)}
                        aria-label={`Анкета ${i + 1} из ${duplicates.length}`}
                        className={`h-1.5 rounded-full transition-all ${i === idx ? "w-5 bg-emerald-400" : "w-1.5 bg-white/30 hover:bg-white/50"}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
