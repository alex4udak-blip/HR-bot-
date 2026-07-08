const URL_RE = /https?:\/\/[^\s<>"']+/gi;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(s);
}

/**
 * Старые анкеты хранят description как обычный текст со вставленными
 * ссылками (просто https://... в строке) — рендерились нераспознанными,
 * не кликабельными. Новые анкеты после DescriptionRichText приходят уже
 * HTML-строкой (с настоящими <a>) — трогать её не нужно, только санитайзить
 * при рендере (см. sanitizeHtml).
 */
export function autoLinkify(text: string | null | undefined): string {
  if (!text) return '';
  if (looksLikeHtml(text)) return text;
  return escapeHtml(text).replace(URL_RE, (url) => `<a href="${url}">${url}</a>`);
}
