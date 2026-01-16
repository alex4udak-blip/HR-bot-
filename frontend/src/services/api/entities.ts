import type {
  Entity, EntityWithRelations, EntityType, EntityStatus, EntityCriteria
} from '@/types';
import api, { deduplicatedGet, debouncedMutation } from './client';

// ============================================================
// ENTITIES API
// ============================================================

export type OwnershipFilter = 'all' | 'mine' | 'shared';

export const getEntities = async (params?: {
  type?: EntityType;
  status?: EntityStatus;
  search?: string;
  tags?: string;
  ownership?: OwnershipFilter;
  department_id?: number;
  limit?: number;
  offset?: number;
}): Promise<Entity[]> => {
  const searchParams: Record<string, string> = {};
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) searchParams[key] = String(value);
    });
  }
  const { data } = await deduplicatedGet<Entity[]>('/entities', { params: searchParams });
  return data;
};

export const getEntity = async (id: number): Promise<EntityWithRelations> => {
  const { data } = await deduplicatedGet<EntityWithRelations>(`/entities/${id}`);
  return data;
};

export const createEntity = async (entityData: {
  type: EntityType;
  name: string;
  status?: EntityStatus;
  phone?: string;
  email?: string;
  telegram_user_id?: number;
  company?: string;
  position?: string;
  tags?: string[];
  extra_data?: Record<string, unknown>;
  department_id?: number;
}): Promise<Entity> => {
  const { data } = await debouncedMutation<Entity>('post', '/entities', entityData);
  return data;
};

export const updateEntity = async (id: number, updates: {
  name?: string;
  status?: EntityStatus;
  phone?: string;
  email?: string;
  company?: string;
  position?: string;
  tags?: string[];
  extra_data?: Record<string, unknown>;
  department_id?: number | null;
}): Promise<Entity> => {
  const { data } = await debouncedMutation<Entity>('put', `/entities/${id}`, updates);
  return data;
};

export const deleteEntity = async (id: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/entities/${id}`);
};

/**
 * Quick status update for Kanban drag & drop
 */
export const updateEntityStatus = async (id: number, status: EntityStatus): Promise<{
  id: number;
  status: EntityStatus;
  previous_status: EntityStatus;
}> => {
  const { data } = await debouncedMutation<{
    id: number;
    status: EntityStatus;
    previous_status: EntityStatus;
  }>('patch', `/entities/${id}/status`, { status });
  return data;
};

export const transferEntity = async (entityId: number, transferData: {
  to_user_id: number;
  to_department_id?: number;
  comment?: string;
}): Promise<{ success: boolean; transfer_id: number }> => {
  const { data } = await debouncedMutation<{ success: boolean; transfer_id: number }>('post', `/entities/${entityId}/transfer`, transferData);
  return data;
};

export const linkChatToEntity = async (entityId: number, chatId: number): Promise<void> => {
  await debouncedMutation<void>('post', `/entities/${entityId}/link-chat/${chatId}`);
};

export const unlinkChatFromEntity = async (entityId: number, chatId: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/entities/${entityId}/unlink-chat/${chatId}`);
};

// ============================================================
// RED FLAGS ANALYSIS
// ============================================================

export interface RedFlag {
  type: string;
  type_label: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggestion: string;
  evidence?: string;
}

export interface RedFlagsAnalysis {
  flags: RedFlag[];
  risk_score: number;
  summary: string;
  flags_count: number;
  high_severity_count: number;
  medium_severity_count: number;
  low_severity_count: number;
}

export interface RiskScoreResponse {
  entity_id: number;
  risk_score: number;
  risk_level: 'low' | 'medium' | 'high';
}

/**
 * Get full red flags analysis for an entity.
 * Includes AI analysis of communications.
 */
export const getEntityRedFlags = async (
  entityId: number,
  vacancyId?: number
): Promise<RedFlagsAnalysis> => {
  const params = vacancyId ? { vacancy_id: vacancyId } : undefined;
  const { data } = await deduplicatedGet<RedFlagsAnalysis>(`/entities/${entityId}/red-flags`, { params });
  return data;
};

/**
 * Get quick risk score for an entity (0-100).
 * Fast calculation without AI analysis.
 */
export const getEntityRiskScore = async (entityId: number): Promise<RiskScoreResponse> => {
  const { data } = await deduplicatedGet<RiskScoreResponse>(`/entities/${entityId}/risk-score`);
  return data;
};

export const getEntityStatsByType = async (): Promise<Record<string, number>> => {
  const { data } = await deduplicatedGet<Record<string, number>>('/entities/stats/by-type');
  return data;
};

export const getEntityStatsByStatus = async (type?: EntityType): Promise<Record<string, number>> => {
  const params = type ? { type } : undefined;
  const { data } = await deduplicatedGet<Record<string, number>>('/entities/stats/by-status', { params });
  return data;
};

// ============================================================
// SMART SEARCH
// ============================================================

export interface SmartSearchResult {
  id: number;
  type: EntityType;
  name: string;
  status: EntityStatus;
  phone?: string;
  email?: string;
  company?: string;
  position?: string;
  tags: string[];
  extra_data: Record<string, unknown>;
  department_id?: number;
  department_name?: string;
  created_at: string;
  updated_at: string;
  relevance_score: number;
  expected_salary_min?: number;
  expected_salary_max?: number;
  expected_salary_currency?: string;
  ai_summary?: string;
}

export interface SmartSearchResponse {
  results: SmartSearchResult[];
  total: number;
  parsed_query: Record<string, unknown>;
  offset: number;
  limit: number;
}

export interface SmartSearchParams {
  query: string;
  type?: EntityType;
  limit?: number;
  offset?: number;
}

/**
 * Smart search for entities with AI-powered natural language understanding.
 *
 * Examples:
 * - "Python developers with 3+ years experience"
 * - "Frontend React salary up to 200000"
 * - "Moscow Java senior"
 *
 * @param params Search parameters including query string and optional filters
 * @returns Search results with relevance scores and parsed query info
 */
export const smartSearch = async (params: SmartSearchParams): Promise<SmartSearchResponse> => {
  const searchParams: Record<string, string> = {
    query: params.query,
  };
  if (params.type) searchParams.type = params.type;
  if (params.limit !== undefined) searchParams.limit = String(params.limit);
  if (params.offset !== undefined) searchParams.offset = String(params.offset);

  const { data } = await deduplicatedGet<SmartSearchResponse>('/entities/search', { params: searchParams });
  return data;
};

// ============================================================
// ENTITY CRITERIA
// ============================================================

export const getEntityCriteria = async (entityId: number): Promise<EntityCriteria> => {
  const { data } = await deduplicatedGet<EntityCriteria>(`/criteria/entities/${entityId}`);
  return data;
};

export const updateEntityCriteria = async (entityId: number, criteria: { name: string; description: string; weight: number; category: string }[]): Promise<EntityCriteria> => {
  const { data } = await debouncedMutation<EntityCriteria>('put', `/criteria/entities/${entityId}`, { criteria });
  return data;
};

// Default criteria by entity type
export interface EntityDefaultCriteriaResponse {
  entity_type: string;
  criteria: { name: string; description: string; weight: number; category: string }[];
  is_custom: boolean;
  preset_id: number | null;
}

export const getEntityDefaultCriteria = async (entityType: string): Promise<EntityDefaultCriteriaResponse> => {
  const { data } = await deduplicatedGet<EntityDefaultCriteriaResponse>(`/criteria/entity-defaults/${entityType}`);
  return data;
};

export const setEntityDefaultCriteria = async (
  entityType: string,
  criteria: { name: string; description: string; weight: number; category: string }[]
): Promise<EntityDefaultCriteriaResponse> => {
  const { data } = await debouncedMutation<EntityDefaultCriteriaResponse>('put', `/criteria/entity-defaults/${entityType}`, { criteria });
  return data;
};

// Entity Report Download
export const downloadEntityReport = async (entityId: number, reportType: string, format: string): Promise<Blob> => {
  const response = await fetch(`/api/entities/${entityId}/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ report_type: reportType, format }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.blob();
};

// ============================================================
// SIMILAR CANDIDATES & DUPLICATES
// ============================================================

export interface SimilarCandidateResult {
  entity_id: number;
  entity_name: string;
  similarity_score: number;
  common_skills: string[];
  similar_experience: boolean;
  similar_salary: boolean;
  similar_location: boolean;
  match_reasons: string[];
}

export interface DuplicateCandidateResult {
  entity_id: number;
  entity_name: string;
  confidence: number;
  match_reasons: string[];
  matched_fields: Record<string, string[]>;
}

export interface MergeEntitiesResponse {
  success: boolean;
  message: string;
  merged_entity_id: number;
  deleted_entity_id: number;
}

/**
 * Get similar candidates for an entity.
 *
 * Searches by:
 * - Skills (50% weight)
 * - Work experience (20% weight)
 * - Salary expectations (15% weight)
 * - Location (15% weight)
 *
 * @param entityId ID of the source candidate
 * @param limit Maximum number of results (1-50)
 * @returns List of similar candidates sorted by similarity_score descending
 */
export const getSimilarCandidates = async (
  entityId: number,
  limit: number = 10
): Promise<SimilarCandidateResult[]> => {
  const { data } = await deduplicatedGet<SimilarCandidateResult[]>(
    `/entities/${entityId}/similar`,
    { params: { limit: String(limit) } }
  );
  return data;
};

/**
 * Get possible duplicates for an entity.
 *
 * Checks:
 * - Name (with transliteration support Rus<->Eng)
 * - Email
 * - Phone
 * - Skills + company combination
 *
 * @param entityId ID of the entity to check
 * @returns List of possible duplicates with confidence scores
 */
export const getDuplicateCandidates = async (
  entityId: number
): Promise<DuplicateCandidateResult[]> => {
  const { data } = await deduplicatedGet<DuplicateCandidateResult[]>(
    `/entities/${entityId}/duplicates`
  );
  return data;
};

/**
 * Merge two entities (duplicates).
 *
 * The target entity remains, source entity is deleted.
 * All related data (chats, calls, analyses) is transferred to target.
 *
 * @param targetEntityId ID of entity to keep
 * @param sourceEntityId ID of entity to merge and delete
 * @param keepSourceData If true, source data has priority on conflicts
 * @returns Merge operation result
 */
export const mergeEntities = async (
  targetEntityId: number,
  sourceEntityId: number,
  keepSourceData: boolean = false
): Promise<MergeEntitiesResponse> => {
  const { data } = await debouncedMutation<MergeEntitiesResponse>(
    'post',
    `/entities/${targetEntityId}/merge`,
    { source_entity_id: sourceEntityId, keep_source_data: keepSourceData }
  );
  return data;
};

/**
 * Compare two candidates.
 *
 * @param entityId ID of first candidate
 * @param otherEntityId ID of second candidate
 * @returns Comparison result with similarity score
 */
export const compareCandidates = async (
  entityId: number,
  otherEntityId: number
): Promise<SimilarCandidateResult> => {
  const { data } = await deduplicatedGet<SimilarCandidateResult>(
    `/entities/${entityId}/compare/${otherEntityId}`
  );
  return data;
};

// ============================================================
// ENTITY FILES
// ============================================================

export interface EntityFile {
  id: number;
  entity_id: number;
  file_type: 'resume' | 'cover_letter' | 'test_assignment' | 'certificate' | 'portfolio' | 'other';
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  description?: string;
  uploaded_by?: number;
  created_at: string;
}

export const getEntityFiles = async (entityId: number): Promise<EntityFile[]> => {
  const { data } = await deduplicatedGet<EntityFile[]>(`/entities/${entityId}/files`);
  return data;
};

export const uploadEntityFile = async (
  entityId: number,
  file: File,
  fileType: string,
  description?: string
): Promise<EntityFile> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('file_type', fileType);
  if (description) formData.append('description', description);

  const { data } = await api.post(`/entities/${entityId}/files`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
};

export const deleteEntityFile = async (entityId: number, fileId: number): Promise<void> => {
  await debouncedMutation<void>('delete', `/entities/${entityId}/files/${fileId}`);
};

export const downloadEntityFile = async (entityId: number, fileId: number): Promise<Blob> => {
  const response = await fetch(`/api/entities/${entityId}/files/${fileId}/download`, {
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.blob();
};

// ============================================================
// PARSER API
// ============================================================

export interface ParsedResume {
  name?: string;
  email?: string;
  phone?: string;
  telegram?: string;
  position?: string;
  company?: string;
  experience_years?: number;
  skills: string[];
  salary_min?: number;
  salary_max?: number;
  salary_currency: string;
  location?: string;
  summary?: string;
  source_url?: string;
}

export interface ParsedVacancy {
  title: string;
  description?: string;
  requirements?: string;
  responsibilities?: string;
  skills?: string[];
  salary_min?: number;
  salary_max?: number;
  salary_currency: string;
  location?: string;
  employment_type?: string;
  experience_level?: string;
  company_name?: string;
  source_url?: string;
}

// Response wrapper from parser API
interface ParseResponse<T> {
  success: boolean;
  data?: T;
  source?: string;
  error?: string;
}

export const parseResumeFromUrl = async (url: string): Promise<ParsedResume> => {
  const { data: response } = await debouncedMutation<ParseResponse<ParsedResume>>('post', '/parser/resume/url', { url });
  if (!response.success || !response.data) {
    throw new Error(response.error || 'Error parsing resume');
  }
  return response.data;
};

export const parseResumeFromFile = async (file: File): Promise<ParsedResume> => {
  const formData = new FormData();
  formData.append('file', file);
  const { data: response } = await api.post<ParseResponse<ParsedResume>>('/parser/resume/file', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  if (!response.success || !response.data) {
    throw new Error(response.error || 'Error parsing file');
  }
  return response.data;
};

export const parseVacancyFromUrl = async (url: string): Promise<ParsedVacancy> => {
  const { data: response } = await debouncedMutation<ParseResponse<ParsedVacancy>>('post', '/parser/vacancy/url', { url });
  if (!response.success || !response.data) {
    throw new Error(response.error || 'Error parsing vacancy');
  }
  return response.data;
};

export const parseVacancyFromFile = async (file: File): Promise<ParsedVacancy> => {
  const formData = new FormData();
  formData.append('file', file);
  const { data: response } = await api.post<ParseResponse<ParsedVacancy>>('/parser/vacancy/file', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  if (!response.success || !response.data) {
    throw new Error(response.error || 'Error parsing vacancy file');
  }
  return response.data;
};

/**
 * Result for a single resume in bulk import
 */
export interface BulkImportResult {
  filename: string;
  success: boolean;
  entity_id?: number;
  entity_name?: string;
  error?: string;
}

/**
 * Response from bulk resume import
 */
export interface BulkImportResponse {
  success: boolean;
  total_files: number;
  successful: number;
  failed: number;
  results: BulkImportResult[];
  error?: string;
}

/**
 * Bulk import resumes from a ZIP file.
 * Each resume will be parsed using AI and a candidate entity will be created.
 * @param file - ZIP file containing resume files (PDF, DOC, DOCX)
 * @returns Import results for each file
 */
export const bulkImportResumes = async (file: File): Promise<BulkImportResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<BulkImportResponse>('/parser/resume/bulk-import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
};

/**
 * Response from creating entity from resume
 */
export interface CreateEntityFromResumeResponse {
  entity_id: number;
  parsed_data: ParsedResume;
  message: string;
}

/**
 * Create a new candidate entity from uploaded resume file.
 * This will parse the resume and create an entity in one step.
 * @param file - Resume file (PDF, DOC, DOCX)
 * @returns Created entity ID and parsed data
 */
export const createEntityFromResume = async (file: File): Promise<CreateEntityFromResumeResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post('/parser/resume/create-entity', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
};

// ============================================================
// GLOBAL SEARCH (Command Palette)
// ============================================================

export interface GlobalSearchCandidate {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  position?: string;
  company?: string;
  status: string;
  relevance_score: number;
}

export interface GlobalSearchVacancy {
  id: number;
  title: string;
  status: string;
  location?: string;
  department_name?: string;
  relevance_score: number;
}

export interface GlobalSearchResult {
  type: 'candidate' | 'vacancy';
  id: number;
  title: string;
  subtitle?: string;
  relevance_score: number;
}

export interface GlobalSearchResponse {
  candidates: GlobalSearchCandidate[];
  vacancies: GlobalSearchVacancy[];
  total: number;
}

/**
 * Global search for Command Palette.
 * Searches across candidates and vacancies.
 *
 * @param query - Search query string
 * @param limit - Maximum number of results per category (default: 5)
 * @returns Search results grouped by type
 */
export const globalSearch = async (
  query: string,
  limit: number = 5
): Promise<GlobalSearchResponse> => {
  const { data } = await deduplicatedGet<GlobalSearchResponse>('/search/global', {
    params: { query, limit: String(limit) }
  });
  return data;
};
