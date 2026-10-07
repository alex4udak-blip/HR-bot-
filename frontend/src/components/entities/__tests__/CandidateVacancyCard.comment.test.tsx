/**
 * Комментарий не должен пропадать вместе с неудачным сохранением (07.10.2026).
 *
 * Жалоба Влады: «Написала коммент по собесу, сохранила. Поменяла статус на
 * практика и он исчез». Разбор показал: сервер заметки при смене этапа не
 * теряет, зато карточка чистила поле ВСЕГДА — даже когда сохранение упало.
 * Обработчики ошибку ловили сами (тост) и наружу её не отдавали, поэтому
 * неудача выглядела как удача: текст исчезал из поля, в ленте его не было, а
 * восстановить набранное было уже неоткуда.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import CandidateVacancyCard from "../CandidateVacancyCard";
import type { KanbanCard } from "@/services/api/candidates";

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ user: { id: 1, name: "Рекрутёр", role: "hr" } }),
}));

vi.mock("@/services/api/entities", () => ({
  downloadEntityFile: vi.fn(),
}));

const STAGES = [
  { status: "new", label: "Новый" },
  { status: "screening", label: "Выполняет ТЗ" },
];

const card = {
  id: 7,
  name: "Гилев Данила",
  created_at: "2026-09-01T10:00:00",
  extra_data: {},
} as unknown as KanbanCard;

function renderCard(onComment: ReturnType<typeof vi.fn>) {
  render(
    <CandidateVacancyCard
      {...({
        card,
        applicationId: 42,
        vacancyTitle: "Трафик",
        currentStage: "screening",
        notes: [],
        events: [],
        stageOptions: STAGES,
        getStageLabel: (s: string) =>
          STAGES.find((o) => o.status === s)?.label || s,
        onChangeStage: vi.fn(),
        onComment,
        onDeleteHistory: vi.fn(),
        onUploadFile: vi.fn(),
        onAnketa: vi.fn(),
      } as never)}
    />,
  );
}

/** Открыть композер и набрать текст (поле — contentEditable, не input). */
async function typeComment(text: string) {
  fireEvent.focus(screen.getByPlaceholderText("Написать комментарий"));
  const editor = await screen.findByRole("textbox", { name: "" }).catch(() => null);
  const box =
    editor ||
    (document.querySelector(
      '[role="textbox"][contenteditable="true"]',
    ) as HTMLElement);
  box.innerHTML = text;
  fireEvent.input(box);
  return box;
}

describe("Комментарий в карточке воронки", () => {
  it("сохранение упало — текст остаётся в поле, человек может повторить", async () => {
    const onComment = vi.fn().mockResolvedValue(false); // сервер не принял
    renderCard(onComment);
    const box = await typeComment("Собес прошёл хорошо, берём на практику");

    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(onComment).toHaveBeenCalled());
    expect(box.innerHTML).toContain("Собес прошёл хорошо");
  });

  it("сохранилось — поле очищается, как и раньше", async () => {
    const onComment = vi.fn().mockResolvedValue(true);
    renderCard(onComment);
    const box = await typeComment("Обычный комментарий");

    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(box.innerHTML).toBe(""));
  });

  it("обработчик ничего не вернул — считаем, что сохранилось", async () => {
    // Старые вызывающие (и те, что просто не возвращают значение) не должны
    // внезапно начать «залипать» с текстом в поле.
    const onComment = vi.fn().mockResolvedValue(undefined);
    renderCard(onComment);
    const box = await typeComment("Без возврата");

    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(box.innerHTML).toBe(""));
  });
});
