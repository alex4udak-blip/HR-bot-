import api, { deduplicatedGet } from './client';

// --- Types ---

export interface WorkspaceSummary {
  recruiter_id: number;
  name: string;
  email: string;
  vacancy_count: number;
  candidate_count: number;
  active_count: number;
}

export interface WorkspaceVacancy {
  id: number;
  title: string;
  status: string;
  candidate_count: number;
  department_name?: string;
  created_at?: string;
}

export interface WorkspaceDetail {
  recruiter_id: number;
  name: string;
  email: string;
  vacancies: WorkspaceVacancy[];
  total_candidates: number;
  active_candidates: number;
}

export interface WorkspaceCandidate {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  telegram?: string;
  vacancy_title: string;
  vacancy_id: number;
  stage: string;
  stage_label: string;
  applied_at?: string;
  source?: string;
}

export interface WorkspaceCandidatesResponse {
  items: WorkspaceCandidate[];
  total: number;
  skip: number;
  limit: number;
}

// --- API functions ---

export async function getWorkspaces(): Promise<WorkspaceSummary[]> {
  return deduplicatedGet('/api/workspaces');
}

export async function getWorkspace(recruiterId: number): Promise<WorkspaceDetail> {
  return deduplicatedGet(`/api/workspaces/${recruiterId}`);
}

export async function getWorkspaceCandidates(
  recruiterId: number,
  params?: {
    search?: string;
    vacancy_id?: number;
    stage?: string;
    skip?: number;
    limit?: number;
  }
): Promise<WorkspaceCandidatesResponse> {
  return deduplicatedGet(`/api/workspaces/${recruiterId}/candidates`, { params });
}
