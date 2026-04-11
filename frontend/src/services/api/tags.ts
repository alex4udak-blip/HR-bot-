import api from './client';

// ============================================================
// TAGS API
// ============================================================

export interface Tag {
  id: number;
  org_id: number;
  name: string;
  color: string;
  created_by: number | null;
  created_at: string | null;
}

export interface TagCreate {
  name: string;
  color: string;
}

export const getTags = async (): Promise<Tag[]> => {
  const { data } = await api.get<Tag[]>('/tags');
  return data;
};

export const createTag = async (payload: TagCreate): Promise<Tag> => {
  const { data } = await api.post<Tag>('/tags', payload);
  return data;
};

export const deleteTag = async (tagId: number): Promise<void> => {
  await api.delete(`/tags/${tagId}`);
};

export const getEntityTags = async (entityId: number): Promise<Tag[]> => {
  const { data } = await api.get<Tag[]>(`/tags/entities/${entityId}/tags`);
  return data;
};

export const addTagToEntity = async (entityId: number, tagId: number): Promise<void> => {
  await api.post(`/tags/entities/${entityId}/tags/${tagId}`);
};

export const removeTagFromEntity = async (entityId: number, tagId: number): Promise<void> => {
  await api.delete(`/tags/entities/${entityId}/tags/${tagId}`);
};
