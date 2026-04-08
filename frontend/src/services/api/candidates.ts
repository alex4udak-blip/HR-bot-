import api, { deduplicatedGet, debouncedMutation } from './client';

// ============================================================
// CANDIDATE SEARCH CRM API
// ============================================================

export interface CandidateSearchParams {
  q?: string;
  status?: string;
  source?: string;
  recruiter_id?: number;
  date_from?: string;
  date_to?: string;
  tags?: string;
  page?: number;
  per_page?: number;
  sort_by?: string;
  sort_order?: string;
}

export interface CandidateItem {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  telegram_username?: string;
  status: string;
  source?: string;
  recruiter_id?: number;
  recruiter_name?: string;
  created_at: string;
  tags: string[];
  position?: string;
  company?: string;
  vacancy_count: number;
  is_duplicate: boolean;
}

export interface CandidateStats {
  total: number;
  new: number;
  screening: number;
  practice: number;
  hired: number;
  rejected: number;
}

export interface CandidateSearchResult {
  items: CandidateItem[];
  total: number;
  page: number;
  per_page: number;
  stats: CandidateStats;
}

export interface RecruiterOption {
  id: number;
  name: string;
}

export interface BulkActionPayload {
  entity_ids: number[];
  action: string;
  vacancy_id?: number;
  status?: string;
  tag?: string;
}

export interface BulkActionResult {
  success: boolean;
  action: string;
  affected: number;
  skipped?: number;
}

/**
 * Search candidates with filters, pagination, stats.
 */
export const searchCandidates = async (
  params: CandidateSearchParams,
): Promise<CandidateSearchResult> => {
  const searchParams: Record<string, string> = {};
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams[key] = String(value);
    }
  });
  const { data } = await deduplicatedGet<CandidateSearchResult>('/candidates/search', {
    params: searchParams,
  });
  return data;
};

/**
 * Perform bulk action on selected candidates.
 * For export_csv the response is a blob.
 */
export const bulkCandidateAction = async (
  payload: BulkActionPayload,
): Promise<BulkActionResult | Blob> => {
  if (payload.action === 'export_csv') {
    const response = await api.post('/candidates/bulk-action', payload, {
      responseType: 'blob',
    });
    return response.data as Blob;
  }
  const { data } = await debouncedMutation<BulkActionResult>(
    'post',
    '/candidates/bulk-action',
    payload,
  );
  return data;
};

/**
 * Get list of recruiters for the filter dropdown.
 */
export const getCandidateRecruiters = async (): Promise<RecruiterOption[]> => {
  const { data } = await deduplicatedGet<RecruiterOption[]>('/candidates/recruiters');
  return data;
};

/**
 * Get all existing tags for autocomplete.
 */
export const getCandidateTags = async (): Promise<string[]> => {
  const { data } = await deduplicatedGet<string[]>('/candidates/tags');
  return data;
};


// ============================================================
// KANBAN BOARD API
// ============================================================

export interface KanbanCard {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  telegram_username?: string;
  position?: string;
  source?: string;
  recruiter_name?: string;
  created_at: string;
  tags: string[];
  photo_url?: string;
}

export interface KanbanColumn {
  status: string;
  label: string;
  cards: KanbanCard[];
  count: number;
}

export interface KanbanBoardResponse {
  columns: KanbanColumn[];
  total: number;
}

/**
 * Get candidates kanban board grouped by status.
 */
export const getCandidatesKanban = async (params?: {
  q?: string;
  recruiter_id?: number;
  date_from?: string;
  date_to?: string;
}): Promise<KanbanBoardResponse> => {
  const searchParams: Record<string, string> = {};
  if (params?.q) searchParams.q = params.q;
  if (params?.recruiter_id) searchParams.recruiter_id = String(params.recruiter_id);
  if (params?.date_from) searchParams.date_from = params.date_from;
  if (params?.date_to) searchParams.date_to = params.date_to;
  const { data } = await deduplicatedGet<KanbanBoardResponse>('/candidates/kanban', {
    params: searchParams,
  });
  return data;
};

/**
 * Quick status change for kanban drag-n-drop.
 */
export const changeCandidateStatus = async (
  entityId: number,
  status: string,
): Promise<{ success: boolean }> => {
  const { data } = await debouncedMutation<{ success: boolean }>(
    'patch',
    `/candidates/${entityId}/status`,
    { status },
  );
  return data;
};
