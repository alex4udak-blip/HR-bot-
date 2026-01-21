import type {
  Vacancy, VacancyStatus, VacancyApplication, ApplicationStage,
  KanbanBoard, VacancyStats, VacancyRecommendation, CandidateMatch, NotifyCandidatesResponse,
  CalculateScoreRequest, CalculateScoreResponse, EntityScoreResult,
  BestMatchesRequest, BestMatchesResponse, MatchingVacanciesRequest, MatchingVacanciesResponse
} from '@/types';
import { deduplicatedGet, debouncedMutation } from './client';

// ============================================================
// VACANCIES API
// ============================================================

export interface VacancyFilters {
  status?: VacancyStatus;
  department_id?: number;
  search?: string;
  skip?: number;
  limit?: number;
}

export interface VacancyCreate {
  title: string;
  description?: string;
  requirements?: string;
  responsibilities?: string;
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
  location?: string;
  employment_type?: string;
  experience_level?: string;
  status?: VacancyStatus;
  priority?: number;
  tags?: string[];
  extra_data?: Record<string, unknown>;
  department_id?: number;
  hiring_manager_id?: number;
  closes_at?: string;
}

export interface VacancyUpdate {
  title?: string;
  description?: string;
  requirements?: string;
  responsibilities?: string;
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
  location?: string;
  employment_type?: string;
  experience_level?: string;
  status?: VacancyStatus;
  priority?: number;
  tags?: string[];
  extra_data?: Record<string, unknown>;
  department_id?: number;
  hiring_manager_id?: number;
  closes_at?: string;
}

export interface ApplicationCreate {
  vacancy_id: number;
  entity_id: number;
  stage?: ApplicationStage;
  rating?: number;
  notes?: string;
  source?: string;
}

export interface ApplicationUpdate {
  stage?: ApplicationStage;
  stage_order?: number;
  rating?: number;
  notes?: string;
  rejection_reason?: string;
  next_interview_at?: string;
}

export const getVacancies = async (filters?: VacancyFilters): Promise<Vacancy[]> => {
  const params: Record<string, string> = {};
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) params[key] = String(value);
    });
  }
  const { data } = await deduplicatedGet<Vacancy[]>('/vacancies', { params });
  return data;
};

export const getVacancy = async (id: number): Promise<Vacancy> => {
  const { data } = await deduplicatedGet<Vacancy>(`/vacancies/${id}`);
  return data;
};

export const createVacancy = async (vacancyData: VacancyCreate): Promise<Vacancy> => {
  const { data } = await debouncedMutation<Vacancy>('post', '/vacancies', vacancyData);
  return data;
};

export const updateVacancy = async (id: number, updates: VacancyUpdate): Promise<Vacancy> => {
  const { data } = await debouncedMutation<Vacancy>('put', `/vacancies/${id}`, updates);
  return data;
};

export const deleteVacancy = async (id: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/vacancies/${id}`);
};

// ============================================================
// VACANCY APPLICATIONS API
// ============================================================

export const getApplications = async (vacancyId: number, stage?: ApplicationStage): Promise<VacancyApplication[]> => {
  const params = stage ? { stage } : undefined;
  const { data } = await deduplicatedGet<VacancyApplication[]>(`/vacancies/${vacancyId}/applications`, { params });
  return data;
};

export const createApplication = async (vacancyId: number, applicationData: ApplicationCreate): Promise<VacancyApplication> => {
  const { data } = await debouncedMutation<VacancyApplication>('post', `/vacancies/${vacancyId}/applications`, applicationData);
  return data;
};

export const updateApplication = async (applicationId: number, updates: ApplicationUpdate): Promise<VacancyApplication> => {
  const { data } = await debouncedMutation<VacancyApplication>('put', `/vacancies/applications/${applicationId}`, updates);
  return data;
};

export const deleteApplication = async (applicationId: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/vacancies/applications/${applicationId}`);
};

// ============================================================
// KANBAN BOARD API
// ============================================================

export const getKanbanBoard = async (vacancyId: number): Promise<KanbanBoard> => {
  const { data } = await deduplicatedGet<KanbanBoard>(`/vacancies/${vacancyId}/kanban`);
  return data;
};

export const bulkMoveApplications = async (applicationIds: number[], stage: ApplicationStage): Promise<VacancyApplication[]> => {
  const { data } = await debouncedMutation<VacancyApplication[]>('post', '/vacancies/applications/bulk-move', {
    application_ids: applicationIds,
    stage
  });
  return data;
};

// ============================================================
// VACANCY STATS API
// ============================================================

export const getVacancyStats = async (): Promise<VacancyStats> => {
  const { data } = await deduplicatedGet<VacancyStats>('/vacancies/stats/overview');
  return data;
};

// ============================================================
// ENTITY-VACANCY INTEGRATION
// ============================================================

export const getEntityVacancies = async (entityId: number): Promise<VacancyApplication[]> => {
  const { data } = await deduplicatedGet<VacancyApplication[]>(`/entities/${entityId}/vacancies`);
  return data;
};

export const applyEntityToVacancy = async (
  entityId: number,
  vacancyId: number,
  source?: string
): Promise<VacancyApplication> => {
  const { data } = await debouncedMutation<VacancyApplication>('post', `/entities/${entityId}/apply-to-vacancy`, {
    vacancy_id: vacancyId,
    source
  });
  return data;
};

// ============================================================
// VACANCY RECOMMENDATIONS API
// ============================================================

export const getRecommendedVacancies = async (
  entityId: number,
  limit: number = 5
): Promise<VacancyRecommendation[]> => {
  const { data } = await deduplicatedGet<VacancyRecommendation[]>(
    `/entities/${entityId}/recommended-vacancies`,
    { params: { limit } }
  );
  return data;
};

export const autoApplyToVacancy = async (
  entityId: number,
  vacancyId: number
): Promise<{ id: number; vacancy_id: number; entity_id: number; stage: string; message: string }> => {
  const { data } = await debouncedMutation<{ id: number; vacancy_id: number; entity_id: number; stage: string; message: string }>('post', `/entities/${entityId}/auto-apply/${vacancyId}`);
  return data;
};

export const getMatchingCandidates = async (
  vacancyId: number,
  options?: { limit?: number; minScore?: number; excludeApplied?: boolean }
): Promise<CandidateMatch[]> => {
  const params: Record<string, string | number | boolean> = {};
  if (options?.limit) params.limit = options.limit;
  if (options?.minScore !== undefined) params.min_score = options.minScore;
  if (options?.excludeApplied !== undefined) params.exclude_applied = options.excludeApplied;

  const { data } = await deduplicatedGet<CandidateMatch[]>(
    `/vacancies/${vacancyId}/matching-candidates`,
    { params }
  );
  return data;
};

export const notifyMatchingCandidates = async (
  vacancyId: number,
  options?: { minScore?: number; limit?: number }
): Promise<NotifyCandidatesResponse> => {
  const params: Record<string, string | number> = {};
  if (options?.minScore !== undefined) params.min_score = options.minScore;
  if (options?.limit) params.limit = options.limit;

  const { data } = await debouncedMutation<NotifyCandidatesResponse>(
    'post',
    `/vacancies/${vacancyId}/notify-candidates`,
    undefined,
    { params }
  );
  return data;
};

interface InviteCandidateResponse {
  id: number;
  vacancy_id: number;
  vacancy_title: string;
  entity_id: number;
  entity_name: string;
  stage: string;
  message: string;
}

export const inviteCandidateToVacancy = async (
  vacancyId: number,
  entityId: number,
  stage?: string,
  notes?: string
): Promise<InviteCandidateResponse> => {
  const params: Record<string, string> = {};
  if (stage) params.stage = stage;
  if (notes) params.notes = notes;

  const { data } = await debouncedMutation<InviteCandidateResponse>(
    'post',
    `/vacancies/${vacancyId}/invite-candidate/${entityId}`,
    undefined,
    { params }
  );
  return data;
};

// ============================================================
// AI SCORING API
// ============================================================

/**
 * Calculate AI compatibility score between a candidate and vacancy.
 * @param request - Entity ID and Vacancy ID
 * @returns Detailed compatibility score
 */
export const calculateCompatibilityScore = async (
  request: CalculateScoreRequest
): Promise<CalculateScoreResponse> => {
  const { data } = await debouncedMutation<CalculateScoreResponse>(
    'post',
    '/scoring/calculate',
    request
  );
  return data;
};

/**
 * Find best matching candidates for a vacancy.
 * @param vacancyId - Vacancy ID
 * @param request - Limit and filter options
 * @returns List of top matching candidates with scores
 */
export const findBestMatchesForVacancy = async (
  vacancyId: number,
  request: BestMatchesRequest = {}
): Promise<BestMatchesResponse> => {
  const { data } = await debouncedMutation<BestMatchesResponse>(
    'post',
    `/scoring/vacancy/${vacancyId}/matches`,
    request
  );
  return data;
};

/**
 * Find matching vacancies for a candidate.
 * @param entityId - Entity (candidate) ID
 * @param request - Limit and filter options
 * @returns List of matching vacancies with scores
 */
export const findMatchingVacanciesForEntity = async (
  entityId: number,
  request: MatchingVacanciesRequest = {}
): Promise<MatchingVacanciesResponse> => {
  const { data } = await debouncedMutation<MatchingVacanciesResponse>(
    'post',
    `/scoring/entity/${entityId}/vacancies`,
    request
  );
  return data;
};

/**
 * Get compatibility score for an application.
 * @param applicationId - Application ID
 * @param recalculate - Force recalculation
 * @returns Compatibility score
 */
export const getApplicationScore = async (
  applicationId: number,
  recalculate: boolean = false
): Promise<CalculateScoreResponse> => {
  const { data } = await deduplicatedGet<CalculateScoreResponse>(
    `/scoring/application/${applicationId}`,
    { params: { recalculate } }
  );
  return data;
};

/**
 * Recalculate compatibility score for an application.
 * @param applicationId - Application ID
 * @returns Updated compatibility score
 */
export const recalculateApplicationScore = async (
  applicationId: number
): Promise<CalculateScoreResponse> => {
  const { data } = await debouncedMutation<CalculateScoreResponse>(
    'post',
    `/scoring/application/${applicationId}/recalculate`,
    {}
  );
  return data;
};

/**
 * Bulk calculate compatibility scores for multiple candidates against a vacancy.
 * @param vacancyId - Vacancy ID
 * @param entityIds - List of entity IDs to score
 * @returns List of entity scores
 */
export const bulkCalculateScores = async (
  vacancyId: number,
  entityIds: number[]
): Promise<EntityScoreResult[]> => {
  const params = new URLSearchParams();
  params.append('vacancy_id', String(vacancyId));
  entityIds.forEach(id => params.append('entity_ids', String(id)));

  const { data } = await debouncedMutation<EntityScoreResult[]>(
    'post',
    `/scoring/bulk?${params.toString()}`,
    {}
  );
  return data;
};

// ============================================================
// VACANCY SHARING API
// ============================================================

export type AccessLevel = 'view' | 'edit' | 'full';

export interface VacancyShareRequest {
  shared_with_id: number;
  access_level?: AccessLevel;
  note?: string;
  expires_at?: string;
}

export interface VacancyShare {
  id: number;
  vacancy_id: number;
  vacancy_title: string;
  shared_by_id: number;
  shared_by_name: string;
  shared_with_id: number;
  shared_with_name: string;
  shared_with_email?: string;
  access_level: AccessLevel;
  note?: string;
  expires_at?: string;
  created_at: string;
}

export interface SharedVacancy {
  id: number;
  title: string;
  description?: string;
  status: VacancyStatus;
  department_id?: number;
  applications_count: number;
  share: {
    id: number;
    shared_by_id: number;
    shared_by_name: string;
    access_level: AccessLevel;
    note?: string;
    expires_at?: string;
    created_at: string;
  };
}

/**
 * Share a vacancy with another user.
 * @param vacancyId - Vacancy ID
 * @param request - Share request with user ID and access level
 * @returns Share details
 */
export const shareVacancy = async (
  vacancyId: number,
  request: VacancyShareRequest
): Promise<VacancyShare> => {
  const { data } = await debouncedMutation<VacancyShare>(
    'post',
    `/vacancies/${vacancyId}/share`,
    request
  );
  return data;
};

/**
 * Get all shares for a vacancy.
 * @param vacancyId - Vacancy ID
 * @returns List of shares
 */
export const getVacancyShares = async (
  vacancyId: number
): Promise<{ shares: VacancyShare[]; total: number }> => {
  const { data } = await deduplicatedGet<{ shares: VacancyShare[]; total: number }>(
    `/vacancies/${vacancyId}/shares`
  );
  return data;
};

/**
 * Revoke a share for a vacancy.
 * @param vacancyId - Vacancy ID
 * @param shareId - Share ID to revoke
 * @returns Success message
 */
export const revokeVacancyShare = async (
  vacancyId: number,
  shareId: number
): Promise<{ message: string; share_id: number }> => {
  const { data } = await debouncedMutation<{ message: string; share_id: number }>(
    'delete',
    `/vacancies/${vacancyId}/share/${shareId}`
  );
  return data;
};

/**
 * Get all vacancies shared with the current user.
 * @returns List of shared vacancies
 */
export const getVacanciesSharedWithMe = async (): Promise<{ vacancies: SharedVacancy[]; total: number }> => {
  const { data } = await deduplicatedGet<{ vacancies: SharedVacancy[]; total: number }>(
    '/vacancies/shared-with-me'
  );
  return data;
};
