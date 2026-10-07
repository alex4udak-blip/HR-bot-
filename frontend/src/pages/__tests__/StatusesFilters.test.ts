/**
 * Фильтры доски «Статусы»: условия складываются по «или» или по «и».
 *
 * Владелец 07.10.2026: «фильтры сейчас работают через подбор &&, а надо ||,
 * чтобы мы могли выгружать массово кандидатов под определённые условия».
 * Поэтому по умолчанию достаточно ОДНОГО совпадения, а прежнее сужение
 * осталось отдельным режимом.
 */
import { describe, it, expect } from "vitest";
import { rowMatchesFilters } from "../StatusesPage";
import type { BoardRow } from "@/services/api/staffBoard";

const row = (over: Partial<BoardRow>): BoardRow =>
  ({
    entity_id: 1,
    name: "Кандидат",
    status: "transferred",
    position: null,
    department_name: null,
    department_start_date: null,
    telegram: null,
    manager: null,
    sourcers: [],
    ...over,
  } as unknown as BoardRow);

const seo = row({ name: "Сеошник", department_name: "SEO", department_start_date: "2026-09-10" });
const push = row({ name: "Пушер", department_name: "Push", department_start_date: "2026-02-01" });

describe("rowMatchesFilters", () => {
  it("без условий проходит всё", () => {
    expect(rowMatchesFilters(seo, { values: {}, dates: {} })).toBe(true);
  });

  it("по умолчанию хватает ОДНОГО совпадения — для массовой выгрузки", () => {
    const filters = {
      values: { department: ["SEO"] },
      dates: { department_start_date: { from: "2026-01-01", to: "2026-03-01" } },
    } as any;
    // SEO подходит по отделу, но не по дате; Push — наоборот. Нужны оба.
    expect(rowMatchesFilters(seo, filters)).toBe(true);
    expect(rowMatchesFilters(push, filters)).toBe(true);
    // Кто не подошёл ни по одному условию — мимо.
    expect(rowMatchesFilters(row({ department_name: "BizDev" }), filters)).toBe(false);
  });

  it("режим «все условия» сужает, как раньше", () => {
    const filters = {
      values: { department: ["SEO"] },
      dates: { department_start_date: { from: "2026-01-01", to: "2026-03-01" } },
      mode: "all",
    } as any;
    expect(rowMatchesFilters(seo, filters)).toBe(false);   // дата не та
    expect(rowMatchesFilters(push, filters)).toBe(false);  // отдел не тот
    expect(
      rowMatchesFilters(
        row({ department_name: "SEO", department_start_date: "2026-02-10" }),
        filters,
      )
    ).toBe(true);
  });

  it("значения внутри одной колонки всегда складываются по «или»", () => {
    const filters = { values: { department: ["SEO", "Push"] }, dates: {}, mode: "all" } as any;
    expect(rowMatchesFilters(seo, filters)).toBe(true);
    expect(rowMatchesFilters(push, filters)).toBe(true);
    expect(rowMatchesFilters(row({ department_name: "BizDev" }), filters)).toBe(false);
  });

  it("пустая колонка ловится вариантом «Пусто»", () => {
    const filters = { values: { department: ["\u0000blank"] }, dates: {} } as any;
    expect(rowMatchesFilters(row({ department_name: null }), filters)).toBe(true);
    expect(rowMatchesFilters(seo, filters)).toBe(false);
  });
});
