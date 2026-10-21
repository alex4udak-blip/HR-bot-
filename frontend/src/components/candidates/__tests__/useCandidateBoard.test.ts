import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { KanbanBoardResponse } from "@/services/api/candidates";

// Ответ списка, запрошенный ДО перевода этапа, не должен возвращать строке
// старый этап (проверка прода 21.10.2026: чип «Новый» держался до 15 с).

const getCandidatesKanban = vi.fn();
vi.mock("@/services/api/candidates", () => ({
  getCandidatesKanban: (...args: unknown[]) => getCandidatesKanban(...args),
}));

import { useCandidateBoard } from "../useCandidateBoard";

const board = (status: string) =>
  ({ columns: [{ status, label: status, count: 1, cards: [{ id: 1, name: "К" }] }] }) as unknown as KanbanBoardResponse;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("useCandidateBoard — запоздавший ответ", () => {
  beforeEach(() => getCandidatesKanban.mockReset());

  it("ответ, запрошенный до правки на месте, не затирает её — берётся свежий", async () => {
    getCandidatesKanban.mockResolvedValueOnce(board("new"));
    const { result } = renderHook(() => useCandidateBoard(""));
    await waitFor(() => expect(result.current.board?.columns[0].status).toBe("new"));

    const slow = deferred<KanbanBoardResponse>();
    getCandidatesKanban.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(board("screening"));
    let polling!: Promise<void>;
    act(() => { polling = result.current.fetchBoard(true); });
    // Пока список в пути — рекрутёр перевёл кандидата.
    act(() => result.current.setBoard(board("screening")));
    await act(async () => { slow.resolve(board("new")); await polling; });

    expect(result.current.board?.columns[0].status).toBe("screening");
    expect(getCandidatesKanban).toHaveBeenCalledTimes(3);
  });

  it("без правок ответ применяется сразу", async () => {
    getCandidatesKanban.mockResolvedValueOnce(board("new")).mockResolvedValueOnce(board("offer"));
    const { result } = renderHook(() => useCandidateBoard(""));
    await waitFor(() => expect(result.current.board?.columns[0].status).toBe("new"));
    await act(async () => { await result.current.fetchBoard(true); });
    expect(result.current.board?.columns[0].status).toBe("offer");
    expect(getCandidatesKanban).toHaveBeenCalledTimes(2);
  });
});
