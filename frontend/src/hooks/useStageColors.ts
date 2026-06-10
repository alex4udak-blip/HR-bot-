import { useEffect, useState } from "react";
import { getOrgStages } from "@/services/api/auth";

type StageColorMap = Record<string, string>;

// Грузим цвета этапов один раз на уровне модуля и кэшируем — настройки воронки
// меняются редко, а карточка кандидата перемонтируется на каждый выбор.
let cache: StageColorMap | null = null;
let inflight: Promise<StageColorMap> | null = null;

function loadStageColors(): Promise<StageColorMap> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = getOrgStages()
    .then((r) => {
      const map: StageColorMap = {};
      for (const s of r.stages || []) {
        if (!s.color) continue;
        map[s.key.toLowerCase()] = s.color;
        if (s.label) map[s.label.trim().toLowerCase()] = s.color;
      }
      cache = map;
      return map;
    })
    .catch(() => ({} as StageColorMap)) // ошибку не кэшируем — повторим позже
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** #rrggbb → rgba(r,g,b,alpha). Возвращает исходную строку, если это не hex. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Цвета этапов воронки из настроек организации (/auth/org-stages).
 *
 * `getStageColor` ищет цвет сначала по ключу этапа, затем по лейблу — на случай
 * кастомных названий («Выполняет ТЗ» и т.п.). Если этап не найден или цвета нет,
 * возвращает undefined (вызывающий код оставляет нейтрально-серый вид).
 */
export function useStageColors() {
  const [map, setMap] = useState<StageColorMap>(() => cache || {});

  useEffect(() => {
    let active = true;
    loadStageColors().then((m) => {
      if (active) setMap(m);
    });
    return () => {
      active = false;
    };
  }, []);

  const getStageColor = (
    stageKey?: string | null,
    stageLabel?: string | null,
  ): string | undefined => {
    if (stageKey && map[stageKey.toLowerCase()]) {
      return map[stageKey.toLowerCase()];
    }
    if (stageLabel && map[stageLabel.trim().toLowerCase()]) {
      return map[stageLabel.trim().toLowerCase()];
    }
    return undefined;
  };

  return { getStageColor };
}

export default useStageColors;
