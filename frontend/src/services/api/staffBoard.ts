/**
 * Доска «Статусы» — жизненный цикл сотрудника внутри направления.
 * Строки доски — карточки кандидатов; папки-направления хранятся в настройках организации.
 */
import api from './client';

export interface BoardFolder {
  id: string;
  name: string;
}

export interface BoardRow {
  entity_id: number;
  name: string;
  status: string;
  direction: string | null;
  position: string | null;
  department_id: number | null;
  department_name: string | null;
  telegram: string | null;
  practice_start_date: string | null;
  department_start_date: string | null;
  manager: string | null;
  w2: string | null;
  m1: string | null;
  m3: string | null;
  y1: string | null;
  /** true = дата посчитана автоматически от «выход в отдел»;
   *  false = факт (вбит руками или импортирован из ClickUp) */
  w2_auto: boolean;
  m1_auto: boolean;
  m3_auto: boolean;
  y1_auto: boolean;
  /** HR, ведущий сотрудника (колонка Assignee в ClickUp) */
  assignee_user_id: number | null;
  assignee_name: string | null;
  dismissal_date: string | null;
  /** отметки «веха пройдена» — парные колонки в скобках из ClickUp */
  dept_done: boolean;
  w2_done: boolean;
  m1_done: boolean;
  m3_done: boolean;
  y1_done: boolean;
  offer_file_id: number | null;
  offer_file_name: string | null;
}

export interface BoardRowUpdate {
  status?: string;
  direction?: string | null;
  position?: string | null;
  department_id?: number | null;
  telegram?: string | null;
  practice_start_date?: string | null;
  department_start_date?: string | null;
  manager?: string | null;
  w2?: string | null;
  m1?: string | null;
  m3?: string | null;
  y1?: string | null;
  assignee_user_id?: number | null;
  dismissal_date?: string | null;
  dept_done?: boolean;
  w2_done?: boolean;
  m1_done?: boolean;
  m3_done?: boolean;
  y1_done?: boolean;
}

// ─── Папки-направления ──────────────────────────────────────

export async function getBoardFolders(): Promise<BoardFolder[]> {
  const { data } = await api.get('/staff-board/folders');
  return data;
}

export async function createBoardFolder(name: string): Promise<BoardFolder> {
  const { data } = await api.post('/staff-board/folders', { name });
  return data;
}

export async function renameBoardFolder(id: string, name: string): Promise<BoardFolder> {
  const { data } = await api.patch(`/staff-board/folders/${id}`, { name });
  return data;
}

export async function deleteBoardFolder(id: string): Promise<void> {
  await api.delete(`/staff-board/folders/${id}`);
}

// ─── Строки ─────────────────────────────────────────────────

export async function getBoardRows(): Promise<BoardRow[]> {
  const { data } = await api.get('/staff-board/rows');
  return data;
}

export async function updateBoardRow(
  entityId: number,
  patch: BoardRowUpdate
): Promise<BoardRow> {
  const { data } = await api.patch(`/staff-board/rows/${entityId}`, patch);
  return data;
}

/** Справочник должностей организации (подсказки в «Взять в штат» и на доске). */
export async function getBoardPositions(): Promise<string[]> {
  const { data } = await api.get('/staff-board/positions');
  return data;
}

/** Справочник руководителей — уже встречающиеся значения, как и должности. */
export async function getBoardManagers(): Promise<string[]> {
  const { data } = await api.get('/staff-board/managers');
  return data || [];
}

/** Завести направления по отделам из ClickUp. Идемпотентно: повторный
 *  вызов не плодит дубликаты, уже существующие по названию пропускаются. */
export async function importClickUpFolders(): Promise<BoardFolder[]> {
  const { data } = await api.post('/staff-board/folders/import-clickup');
  return data || [];
}
