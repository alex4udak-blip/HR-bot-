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

// ============================================================
// ANALYTICS API (Prometheus proxy)
// ============================================================

export interface ChurnRiskStudent {
  id: string;
  name: string;
  email: string;
  telegramUsername: string | null;
  lastActive: string;
  daysSinceActive: number;
  modulesCompleted: number;
  xp: number;
}

export interface ChurnRisk {
  high: ChurnRiskStudent[];
  highCount: number;
  medium: ChurnRiskStudent[];
  mediumCount: number;
  low: ChurnRiskStudent[];
  lowCount: number;
}

export interface FunnelStage {
  stage: string;
  count: number;
  percent: number;
}

export interface TrendPoint {
  date: string;
  activeUsers: number;
  totalActions: number;
}

export interface ModuleDifficulty {
  id: string;
  title: string;
  slug: string;
  type: 'THEORY' | 'PRACTICE' | 'PROJECT';
  trailId: string;
  trailTitle: string;
  trailSlug: string;
  completedCount: number;
  submissionCount: number;
  avgScore: number | null;
  difficulty: 'hard' | 'medium' | 'easy' | 'unknown';
}

export interface AnalyticsSummary {
  totalStudents: number;
  atRiskStudents: number;
  conversionRate: number;
  avgDailyActiveUsers: number;
}

export interface TrailProgressItem {
  id: string;
  title: string;
  slug: string;
  enrollments: number;
  certificates: number;
  totalModules: number;
  completedModules: number;
  submissionsCount: number;
  approvedSubmissions: number;
  completionRate: number;
  approvalRate: number;
}

export interface AnalyticsTopStudent {
  id: string;
  name: string;
  totalXP: number;
  modulesCompleted: number;
  approvedWorks: number;
  certificates: number;
}

export interface ScoreDistribution {
  excellent: number;
  good: number;
  average: number;
  poor: number;
  total: number;
  avgScore: number;
  filteredByTrail: boolean;
}

export interface DropoffModule {
  id: string;
  title: string;
  slug: string;
  order: number;
  type: 'THEORY' | 'PRACTICE' | 'PROJECT';
  totalEnrolled: number;
  startedCount: number;
  inProgressCount: number;
  completedCount: number;
  completionRate: number;
  dropRate: number;
  avgTimeDays: number;
  isBottleneck: boolean;
}

export interface DropoffTrail {
  trailId: string;
  trailTitle: string;
  trailSlug: string;
  totalEnrolled: number;
  modules: DropoffModule[];
}

export interface StudentModuleStatus {
  id: string;
  title: string;
  order: number;
  type: 'THEORY' | 'PRACTICE' | 'PROJECT';
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  submissionId: string | null;
}

export interface StudentByTrail {
  id: string;
  name: string;
  telegramUsername: string | null;
  totalXP: number;
  modulesCompleted: number;
  totalModules: number;
  completionPercent: number;
  submissions: {
    approved: number;
    pending: number;
    revision: number;
    total: number;
  };
  avgScore: number | null;
  dateStart: string;
  dateEnd: string | null;
  modules: StudentModuleStatus[];
  trailStatus: 'LEARNING' | 'GRADUATED' | 'DROPPED';
}

export interface StudentsByTrailItem {
  trailId: string;
  trailTitle: string;
  trailSlug: string;
  students: StudentByTrail[];
}

export interface AnalyticsTrailFilter {
  id: string;
  title: string;
  slug: string;
}

export interface AnalyticsFilters {
  trails: AnalyticsTrailFilter[];
  currentTrail: string;
  currentPeriod: string;
}

export interface PrometheusAnalyticsResponse {
  churnRisk: ChurnRisk;
  funnel: FunnelStage[];
  trends: TrendPoint[];
  difficultyAnalysis: ModuleDifficulty[];
  summary: AnalyticsSummary;
  trailProgress: TrailProgressItem[];
  topStudents: AnalyticsTopStudent[];
  scoreDistribution: ScoreDistribution;
  dropoffAnalysis: DropoffTrail[];
  studentsByTrail: StudentsByTrailItem[];
  filters: AnalyticsFilters;
}

/**
 * Fetch platform analytics from Prometheus via backend proxy.
 */
export const getPrometheusAnalytics = async (
  trail: string = 'all',
  period: string = '30',
): Promise<PrometheusAnalyticsResponse> => {
  const { data } = await deduplicatedGet<PrometheusAnalyticsResponse>(
    '/interns/analytics',
    { params: { trail, period } },
  );
  return data;
};

// ============================================================
// STUDENT ACHIEVEMENTS API (Prometheus proxy)
// ============================================================

export interface StudentInfo {
  id: string;
  name: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'HR' | 'CO_ADMIN' | 'ADMIN';
  totalXP: number;
  currentStreak: number;
  registeredAt: string;
  lastActiveAt: string;
  daysSinceActive: number;
  leaderboardRank: number;
  modulesCompleted: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  earned: boolean;
  earnedAt: string | null;
}

export interface AchievementsData {
  stats: {
    earned: number;
    total: number;
    percentage: number;
  };
  earned: Achievement[];
  all: Achievement[];
}

export interface SubmissionStats {
  approved: number;
  pending: number;
  revision: number;
  failed: number;
  total: number;
}

export interface StudentTrailProgress {
  trailId: string;
  trailTitle: string;
  trailSlug: string;
  enrolledAt: string;
  totalModules: number;
  completedModules: number;
  completionPercent: number;
}

export interface Certificate {
  id: string;
  code: string;
  issuedAt: string;
  totalXP: number;
  level: 'Junior' | 'Middle' | 'Senior';
  trail: {
    id: string;
    title: string;
    slug: string;
    color: string;
  };
}

export interface StudentAchievementsResponse {
  student: StudentInfo;
  achievements: AchievementsData;
  submissionStats: SubmissionStats;
  trailProgress: StudentTrailProgress[];
  certificates: Certificate[];
}

/**
 * Fetch achievements for a specific student from Prometheus via backend proxy.
 */
export const getStudentAchievements = async (
  studentId: string,
): Promise<StudentAchievementsResponse> => {
  const { data } = await deduplicatedGet<StudentAchievementsResponse>(
    `/interns/student-achievements/${studentId}`,
  );
  return data;
};
