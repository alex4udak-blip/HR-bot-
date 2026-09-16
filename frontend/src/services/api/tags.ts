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
  /** Скрыта из списка выбора, но остаётся на карточках, где уже проставлена. */
  archived_at?: string | null;
  /** 'sourcer' — тот, кто привёл кандидата; 'general' — обычный ярлык. */
  kind?: TagKind;
  /**
   * Показывать ли метку ЯРКИМ ЯРЛЫКОМ у ФИО (бывшие extra_data.headline_tags).
   * Признак живёт на СВЯЗИ кандидат↔метка, поэтому осмыслен только в выдаче
   * getEntityTags: одна и та же метка у одного человека ярлык у имени, у
   * другого обычная. В общем справочнике (getTags) всегда false.
   */
  show_at_name?: boolean;
}

export type TagKind = 'general' | 'sourcer';

export interface TagCreate {
  name: string;
  color: string;
  kind?: TagKind;
}

export const getTags = async (kind?: TagKind): Promise<Tag[]> => {
  const { data } = await api.get<Tag[]>('/tags', { params: kind ? { kind } : undefined });
  return data;
};

/** Поменять тип или цвет метки. Имя не меняем — по нему её узнают на карточках. */
export const updateTag = async (
  tagId: number,
  patch: { kind?: TagKind; color?: string },
): Promise<Tag> => {
  const { data } = await api.patch<Tag>(`/tags/${tagId}`, patch);
  return data;
};

export const createTag = async (payload: TagCreate): Promise<Tag> => {
  const { data } = await api.post<Tag>('/tags', payload);
  return data;
};

/**
 * ОСТОРОЖНО: настоящее удаление — срывает метку и со ВСЕХ карточек разом
 * (у связи стоит ondelete=CASCADE). Интерфейсу нужен archiveTag, а не это.
 */
export const deleteTag = async (tagId: number): Promise<void> => {
  await api.delete(`/tags/${tagId}`);
};

/**
 * «Удалить за ненадобностью»: метка пропадает из списка выбора, но у кандидатов,
 * которым уже проставлена, остаётся — снять её оттуда можно крестиком на карточке.
 */
export const archiveTag = async (tagId: number): Promise<Tag> => {
  const { data } = await api.post<Tag>(`/tags/${tagId}/archive`);
  return data;
};

/** Вернуть скрытую метку в список выбора. */
export const restoreTag = async (tagId: number): Promise<Tag> => {
  const { data } = await api.post<Tag>(`/tags/${tagId}/restore`);
  return data;
};

export const getEntityTags = async (entityId: number): Promise<Tag[]> => {
  const { data } = await api.get<Tag[]>(`/tags/entities/${entityId}/tags`);
  return data;
};

/**
 * Повесить метку на кандидата. showAtName=true — сразу ярким ярлыком у ФИО.
 * Если метка уже висит обычной, повторный вызов с true поднимает её к имени.
 */
export const addTagToEntity = async (
  entityId: number,
  tagId: number,
  showAtName = false,
): Promise<void> => {
  await api.post(`/tags/entities/${entityId}/tags/${tagId}`, { show_at_name: showAtName });
};

/** Поднять метку к ФИО или убрать оттуда, НЕ снимая её с кандидата. */
export const setTagShowAtName = async (
  entityId: number,
  tagId: number,
  showAtName: boolean,
): Promise<void> => {
  await api.patch(`/tags/entities/${entityId}/tags/${tagId}/show-at-name`, {
    show_at_name: showAtName,
  });
};

export const removeTagFromEntity = async (entityId: number, tagId: number): Promise<void> => {
  await api.delete(`/tags/entities/${entityId}/tags/${tagId}`);
};
