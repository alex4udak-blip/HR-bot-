import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "../sanitizeHtml";

/**
 * Комментарии кандидата рендерятся через dangerouslySetInnerHTML — и не только
 * внутри орга: публичная ссылка предпросмотра для заказчика (CandidatePreviewPage)
 * показывает те же notes без авторизации. Поэтому на санитайзер тут завязана
 * реальная граница безопасности, а не косметика.
 */
describe("sanitizeHtml", () => {
  describe("обход через неразрешённый тег-обёртку", () => {
    // Раньше поддерево неразрешённого тега поднималось НЕ почищенным: обход шёл
    // по снимку parent.children, снятому до мутации, и поднятые узлы в него не
    // попадали. Голый <img onerror> срезался, а завёрнутый — выживал.
    it("срезает onerror у <img>, завёрнутого в чужой тег", () => {
      const out = sanitizeHtml('<section><img src=x onerror="alert(1)"></section>');
      expect(out).not.toContain("onerror");
      expect(out).not.toContain("<img");
    });

    it("срезает onerror на любой глубине вложенности чужих тегов", () => {
      const out = sanitizeHtml(
        '<article><figure><svg><img src=x onerror="alert(1)"></svg></figure></article>',
      );
      expect(out).not.toContain("onerror");
    });

    it("удаляет <script>, завёрнутый в чужой тег", () => {
      const out = sanitizeHtml("<section><script>alert(1)</script></section>");
      expect(out).not.toContain("<script");
      expect(out).not.toContain("alert(1)");
    });

    it("срезает javascript:-ссылку внутри чужого тега", () => {
      const out = sanitizeHtml('<div><h1><a href="javascript:alert(1)">клик</a></h1></div>');
      expect(out).not.toContain("javascript:");
      expect(out).toContain("клик");
    });
  });

  describe("прямые попытки", () => {
    it("удаляет голый <img> с onerror", () => {
      expect(sanitizeHtml('<img src=x onerror="alert(1)">')).toBe("");
    });

    it("удаляет <script> вместе с содержимым", () => {
      expect(sanitizeHtml("<script>alert(1)</script>")).toBe("");
    });

    it("удаляет <iframe>", () => {
      expect(sanitizeHtml('<iframe src="//evil"></iframe>')).toBe("");
    });

    it("срезает обработчики с разрешённых тегов", () => {
      const out = sanitizeHtml('<b onclick="alert(1)">жирный</b>');
      expect(out).toBe("<b>жирный</b>");
    });

    it("срезает style с разрешённых тегов", () => {
      const out = sanitizeHtml('<div style="position:fixed;inset:0">текст</div>');
      expect(out).not.toContain("style");
      expect(out).toContain("текст");
    });
  });

  describe("полезное содержимое сохраняется", () => {
    it("оставляет форматирование", () => {
      expect(sanitizeHtml("<b>жирный</b> и <i>курсив</i>")).toBe(
        "<b>жирный</b> и <i>курсив</i>",
      );
    });

    it("оставляет http-ссылку и добавляет target/rel", () => {
      const out = sanitizeHtml('<a href="https://example.com">тут</a>');
      expect(out).toContain('href="https://example.com"');
      expect(out).toContain('target="_blank"');
      expect(out).toContain('rel="noopener noreferrer"');
    });

    it("оставляет чип @-упоминания", () => {
      const out = sanitizeHtml('<span class="hf-mention" data-uid="7">@Настя</span>');
      expect(out).toContain('class="hf-mention"');
      expect(out).not.toContain("data-uid");
      expect(out).toContain("@Настя");
    });

    it("разворачивает чужой тег, сохраняя текст внутри", () => {
      expect(sanitizeHtml("<section>просто текст</section>")).toBe("просто текст");
    });

    it("сохраняет списки", () => {
      expect(sanitizeHtml("<ul><li>раз</li><li>два</li></ul>")).toBe(
        "<ul><li>раз</li><li>два</li></ul>",
      );
    });
  });

  describe("краевые случаи", () => {
    it("пустой ввод", () => {
      expect(sanitizeHtml("")).toBe("");
      expect(sanitizeHtml(null)).toBe("");
      expect(sanitizeHtml(undefined)).toBe("");
    });

    it("обычный текст без тегов не трогается", () => {
      expect(sanitizeHtml("Кандидат отказался")).toBe("Кандидат отказался");
    });
  });
});
