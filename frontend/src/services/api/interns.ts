import { deduplicatedGet } from './client';

// ============================================================
// INTERNS API (Prometheus proxy)
// ============================================================

/** Trail summary from Prometheus */
export interface PrometheusTrailSummary {
  trailId: string;
  trailName: string;
  completedModules: number;
  totalModules: number;
  earnedXP: number;
}

/** Intern DTO from Prometheus */
export interface PrometheusIntern {
  id: string;
  name: string;
  email: string | null;
  telegramUsername: string | null;
  totalXP: number;
  currentStreak: number;
  lastActiveAt: string | null;
  daysSinceActive: number | null;
  trails: PrometheusTrailSummary[];
  createdAt: string;
}

/** Response from /api/interns (backend proxy to Prometheus) */
export interface PrometheusInternsResponse {
  interns: PrometheusIntern[];
}

/**
 * Fetch interns data from backend proxy (which fetches from Prometheus).
 * The API key stays server-side — the frontend never touches it.
 */
export const getPrometheusInterns = async (): Promise<PrometheusIntern[]> => {
  const { data } = await deduplicatedGet<PrometheusInternsResponse>('/interns');
  return data.interns;
};
