/**
 * Form Constructor API — CRUD for form templates and public submission
 */
import api from './client';

// ============================================================
// Types
// ============================================================

export interface FormField {
  id: string;
  type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'multiselect' | 'radio' | 'file' | 'url';
  label: string;
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface FormTemplate {
  id: number;
  title: string;
  description: string | null;
  slug: string;
  vacancy_id: number | null;
  vacancy_ids: number[];
  is_active: boolean;
  fields: FormField[];
  submissions_count: number;
  created_at: string | null;
  updated_at: string | null;
  created_by: number | null;
}

export interface FormSubmission {
  id: number;
  form_id: number;
  entity_id: number | null;
  entity: {
    id: number;
    name: string;
    email: string | null;
    status: string | null;
  } | null;
  data: Record<string, unknown>;
  submitted_at: string | null;
}

export interface PublicFormData {
  id: number;
  title: string;
  description: string | null;
  fields: FormField[];
  vacancy_title: string | null;
}

export interface FormCreateData {
  title: string;
  description?: string;
  vacancy_id?: number | null;
  vacancy_ids?: number[];
  fields: FormField[];
  is_active?: boolean;
}

export interface FormUpdateData {
  title?: string;
  description?: string;
  vacancy_id?: number | null;
  vacancy_ids?: number[];
  fields?: FormField[];
  is_active?: boolean;
}

// ============================================================
// Authenticated API (recruiter)
// ============================================================

export const getMyForms = async (): Promise<FormTemplate[]> => {
  const { data } = await api.get('/forms');
  return data;
};

export const createForm = async (body: FormCreateData): Promise<FormTemplate> => {
  const { data } = await api.post('/forms', body);
  return data;
};

export const getForm = async (id: number): Promise<FormTemplate> => {
  const { data } = await api.get(`/forms/${id}`);
  return data;
};

export const updateForm = async (id: number, body: FormUpdateData): Promise<FormTemplate> => {
  const { data } = await api.put(`/forms/${id}`, body);
  return data;
};

export const deleteForm = async (id: number): Promise<void> => {
  await api.delete(`/forms/${id}`);
};

export const getFormSubmissions = async (id: number): Promise<FormSubmission[]> => {
  const { data } = await api.get(`/forms/${id}/submissions`);
  return data;
};

// ============================================================
// Public API (no auth — candidate fills form)
// ============================================================

export const getPublicForm = async (slug: string): Promise<PublicFormData> => {
  const { data } = await api.get(`/forms/public/${slug}`);
  return data;
};

export const submitPublicForm = async (
  slug: string,
  formData: Record<string, unknown>
): Promise<{ message: string }> => {
  const { data } = await api.post(`/forms/public/${slug}/submit`, { data: formData });
  return data;
};

export const submitPublicFormWithFiles = async (
  slug: string,
  formData: Record<string, unknown>,
  files: File[]
): Promise<{ message: string; entity_id?: number; files_saved?: number }> => {
  const body = new FormData();
  body.append('data', JSON.stringify(formData));
  for (const file of files) {
    body.append('files', file);
  }
  const { data } = await api.post(`/forms/public/${slug}/submit-with-files`, body, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};
