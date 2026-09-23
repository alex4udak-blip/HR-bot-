/**
 * Окно «Сменить этап подбора» (23.09.2026, по видео Huntflow).
 *
 * Проверяем ровно то, что просил владелец:
 *  1) выбран текущий этап → серая плашка вместо поля комментария, «Сохранить» недоступно;
 *  2) при открытии помечен СЛЕДУЮЩИЙ этап;
 *  3) перевод не перезагружает карточку — onChangeStage зовётся с выбранным этапом,
 *     а комментарий уходит отдельным вызовом только если его написали;
 *  4) корзина у записи истории зовёт onDeleteHistory (откат этапа делает бэкенд).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CandidateVacancyCard from "../CandidateVacancyCard";
import type { KanbanCard } from "@/services/api/candidates";
import type { ActivityEvent } from "@/services/api/entities";

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ user: { id: 1, name: "Тестовый Рекрутёр", role: "hr" } }),
}));

vi.mock("@/services/api/entities", () => ({
  downloadEntityFile: vi.fn(),
}));

// Богатый редактор в jsdom не набирается — подменяем обычным textarea с тем же
// контрактом (value/onChange), чтобы проверять сам пикер, а не contenteditable.
vi.mock("@/components/hr/HuntflowRichInput", () => ({
  HuntflowRichInput: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const STAGES = [
  { status: "new", label: "Новый" },
  { status: "screening", label: "Выполняет ТЗ" },
  { status: "practice", label: "Интервью с HR" },
  { status: "rejected", label: "Отказ" },
];

const card = {
  id: 7,
  name: "Гилев Данила",
  created_at: "2026-09-01T10:00:00",
  extra_data: {},
} as unknown as KanbanCard;

const moveEvent: ActivityEvent = {
  id: 555,
  from_stage: "new",
  to_stage: "screening",
  comment: null,
  changed_by_name: "Тестовый Рекрутёр",
  created_at: "2026-09-23T16:00:00",
};

function renderCard(overrides: Record<string, unknown> = {}) {
  const props = {
    card,
    applicationId: 42,
    vacancyTitle: "User Acquisition Manager",
    currentStage: "screening",
    notes: [],
    events: [moveEvent],
    readonly: false,
    stageOptions: STAGES,
    getStageLabel: (s: string) =>
      STAGES.find((o) => o.status === s)?.label || s,
    onChangeStage: vi.fn().mockResolvedValue(true),
    onComment: vi.fn().mockResolvedValue(undefined),
    onDeleteHistory: vi.fn().mockResolvedValue(undefined),
    onUploadFile: vi.fn(),
    ...overrides,
  };
  render(<CandidateVacancyCard {...(props as never)} />);
  return props;
}

const openPicker = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Сменить этап подбора" }));
};

const pickerOption = (label: string) =>
  screen
    .getAllByRole("button", { name: label })
    .find((el) => el.className.includes("hf-stage-picker-option"))!;

describe("Пикер этапа: серая плашка на текущем этапе", () => {
  beforeEach(() => vi.clearAllMocks());

  it("выбран текущий этап — вместо комментария плашка, «Сохранить» недоступно", async () => {
    const user = userEvent.setup();
    renderCard();
    await openPicker(user);

    await user.click(pickerOption("Выполняет ТЗ")); // это и есть текущий этап

    expect(
      screen.getByText("Кандидат сейчас находится на этом этапе подбора"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Записать комментарий")).toBeNull();
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
  });

  it("клик по «Сохранить» на текущем этапе ничего не отправляет", async () => {
    const user = userEvent.setup();
    const props = renderCard();
    await openPicker(user);
    await user.click(pickerOption("Выполняет ТЗ"));
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(props.onChangeStage).not.toHaveBeenCalled();
    expect(props.onComment).not.toHaveBeenCalled();
  });
});

describe("Пикер этапа: помечен следующий этап", () => {
  beforeEach(() => vi.clearAllMocks());

  it("при открытии подсвечен следующий этап, а не текущий", async () => {
    const user = userEvent.setup();
    renderCard();
    await openPicker(user);

    expect(pickerOption("Интервью с HR").className).toContain(
      "hf-stage-picker-option-active",
    );
    expect(pickerOption("Выполняет ТЗ").className).toContain(
      "hf-stage-picker-option-idle",
    );
    // Комментарий доступен сразу — переводить есть куда.
    expect(screen.getByLabelText("Записать комментарий")).toBeInTheDocument();
  });

  it("кандидат на последнем рабочем этапе — «Отказ» сам не подставляется", async () => {
    const user = userEvent.setup();
    renderCard({ currentStage: "practice" });
    await openPicker(user);

    expect(pickerOption("Интервью с HR").className).toContain(
      "hf-stage-picker-option-active",
    );
    expect(
      screen.getByText("Кандидат сейчас находится на этом этапе подбора"),
    ).toBeInTheDocument();
  });
});

describe("Пикер этапа: сохранение перевода", () => {
  beforeEach(() => vi.clearAllMocks());

  it("переводит на выбранный этап и закрывает пикер, комментарий не пишет", async () => {
    const user = userEvent.setup();
    const props = renderCard();
    await openPicker(user);
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(props.onChangeStage).toHaveBeenCalledWith(42, "practice"),
    );
    expect(props.onComment).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByLabelText("Записать комментарий")).toBeNull(),
    );
  });

  it("написанный комментарий уходит вместе с переводом", async () => {
    const user = userEvent.setup();
    const props = renderCard();
    await openPicker(user);
    await user.type(screen.getByLabelText("Записать комментарий"), "ок");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(props.onComment).toHaveBeenCalledWith(
        42,
        "practice",
        "Интервью с HR",
        "ок",
      ),
    );
  });

  it("перевод не применился — комментарий не сохраняется, пикер остаётся открытым", async () => {
    const user = userEvent.setup();
    const props = renderCard({ onChangeStage: vi.fn().mockResolvedValue(false) });
    await openPicker(user);
    await user.type(screen.getByLabelText("Записать комментарий"), "ок");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(props.onChangeStage).toHaveBeenCalled());
    expect(props.onComment).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Записать комментарий")).toBeInTheDocument();
  });
});

describe("История этапов: корзина", () => {
  beforeEach(() => vi.clearAllMocks());

  it("зовёт onDeleteHistory с id записи (откат этапа делает бэкенд)", async () => {
    const user = userEvent.setup();
    const props = renderCard();

    await user.click(screen.getByTitle("Удалить запись"));
    expect(props.onDeleteHistory).toHaveBeenCalledWith(42, 555);
  });
});
