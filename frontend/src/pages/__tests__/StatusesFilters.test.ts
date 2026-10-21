/**
 * Фильтры доски «Штат»: у каждого условия своя пометка — обязательное или «или».
 *
 * История. 07.10.2026 владелец просил складывать условия по «ИЛИ» («чтобы
 * массово выгружать кандидатов под определённые условия»), и это сделали одним
 * режимом на всю панель. 21.10.2026 Мария отметила четыре отдела И октябрь,
 * увидела людей с датами июля-сентября и решила, что фильтр сломан: общий
 * режим «любое» так и работает, но кнопку никто не находил и не понимал.
 * Теперь выбор у КАЖДОГО условия, по умолчанию — обязательное, а панель
 * пишет словами, кого покажет (describeFilters).
 */
import { describe, it, expect } from "vitest";
import { rowMatchesFilters, describeFilters, activeFilterKeys } from "../StatusesPage";
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

  it("по умолчанию условия обязательны — случай Марии 21.10.2026", () => {
    const filters = {
      values: { department: ["SEO"] },
      dates: { department_start_date: { from: "2026-01-01", to: "2026-03-01" } },
    } as any;
    // SEO подходит по отделу, но вышел в сентябре; Push — наоборот.
    expect(rowMatchesFilters(seo, filters)).toBe(false);
    expect(rowMatchesFilters(push, filters)).toBe(false);
    expect(
      rowMatchesFilters(row({ department_name: "SEO", department_start_date: "2026-02-10" }), filters)
    ).toBe(true);
  });

  it("условие с пометкой «или» достаточно одного — массовая выгрузка", () => {
    const filters = {
      values: { department: ["SEO"] },
      dates: { department_start_date: { from: "2026-01-01", to: "2026-03-01" } },
      orKeys: ["department", "department_start_date"],
    } as any;
    expect(rowMatchesFilters(seo, filters)).toBe(true);
    expect(rowMatchesFilters(push, filters)).toBe(true);
    expect(rowMatchesFilters(row({ department_name: "BizDev" }), filters)).toBe(false);
  });

  it("смешанный случай: (отдел ИЛИ уволенные) И вышел в окно дат", () => {
    const filters = {
      values: { department: ["SEO"], status: ["Уволен / уволился"] },
      dates: { department_start_date: { from: "2026-09-01", to: "2026-09-30" } },
      orKeys: ["department", "status"],
    } as any;
    // сентябрь + SEO — подходит
    expect(rowMatchesFilters(seo, filters)).toBe(true);
    // сентябрь, но ни SEO, ни уволенный — мимо
    expect(
      rowMatchesFilters(row({ department_name: "BizDev", department_start_date: "2026-09-05" }), filters)
    ).toBe(false);
    // SEO, но вышел в феврале — обязательное условие по дате не выполнено
    expect(
      rowMatchesFilters(row({ department_name: "SEO", department_start_date: "2026-02-05" }), filters)
    ).toBe(false);
  });

  it("значения внутри одной колонки всегда складываются по «или»", () => {
    const filters = { values: { department: ["SEO", "Push"] }, dates: {} } as any;
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

describe("describeFilters — панель объясняет словами", () => {
  it("без условий говорит, что показывает всех", () => {
    expect(describeFilters({ values: {}, dates: {} })).toBe(
      "Ничего не отмечено — показываем всех.",
    );
  });

  it("обязательные условия связывает словом «и»", () => {
    const text = describeFilters({
      values: { department: ["SEO", "Push"] },
      dates: { department_start_date: { from: "2026-10-01", to: "2026-10-31" } },
    } as any);
    expect(text).toContain("SEO или Push");
    expect(text).toContain(" и ");
    expect(text).toContain("01.10.2026");
  });

  it("условия «или» собирает в скобки", () => {
    const text = describeFilters({
      values: { department: ["SEO"], status: ["Уволен / уволился"] },
      dates: { department_start_date: { from: "2026-10-01", to: "" } },
      orKeys: ["department", "status"],
    } as any);
    expect(text).toMatch(/\(.* или .*\)/);
  });
});

describe("activeFilterKeys", () => {
  it("перечисляет колонки, по которым что-то отобрано", () => {
    expect(
      activeFilterKeys({
        values: { department: ["SEO"], position: [] },
        dates: { department_start_date: { from: "2026-10-01", to: "" }, w2: { from: "", to: "" } },
      } as any),
    ).toEqual(["department", "department_start_date"]);
  });
});
