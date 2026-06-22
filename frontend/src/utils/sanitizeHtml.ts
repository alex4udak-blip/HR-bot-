// Минимальный санитайзер для rich-text (WYSIWYG из contentEditable).
// Разрешаем только безопасные теги форматирования и ссылки (http/https).
// Без внешних зависимостей — DOMPurify в проекте нет.

const ALLOWED_TAGS = new Set([
  "B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "A", "BR", "P", "DIV", "SPAN",
]);

const DANGEROUS_TAGS = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "FORM", "INPUT",
]);

/**
 * Чистит HTML перед рендером через dangerouslySetInnerHTML:
 * - опасные теги (script/iframe/…) удаляются вместе с содержимым;
 * - прочие неразрешённые теги заменяются своим содержимым (текст сохраняется);
 * - у разрешённых тегов срезаются все атрибуты, кроме href (только http/https) у <a>.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return String(html).replace(/<[^>]*>/g, "");
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const clean = (parent: Element) => {
    Array.from(parent.children).forEach((el) => {
      const tag = el.tagName;
      if (DANGEROUS_TAGS.has(tag)) {
        el.remove();
        return;
      }
      if (!ALLOWED_TAGS.has(tag)) {
        el.replaceWith(...Array.from(el.childNodes));
        return;
      }
      Array.from(el.attributes).forEach((attr) => {
        const keepHref =
          tag === "A" && attr.name === "href" && /^https?:\/\//i.test(attr.value);
        if (!keepHref) el.removeAttribute(attr.name);
      });
      if (tag === "A") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
      clean(el);
    });
  };
  clean(doc.body);
  return doc.body.innerHTML;
}
