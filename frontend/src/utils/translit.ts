/**
 * Транслитерация RU↔EN для клиентского поиска (например, чтобы «Simonberg»
 * находил «Симонберг»). Схема упрощённая — покрывает типовые ФИО без строгого
 * следования ISO/BGN. Всё в нижнем регистре — вызывающая сторона нормализует.
 */

const RU_TO_EN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
  з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

// Многосимвольные последовательности идут первыми, чтобы «sch» не разбирался как «s+ch».
const EN_MULTI: Array<[string, string]> = [
  ['sch', 'щ'], ['sh', 'ш'], ['ch', 'ч'], ['zh', 'ж'],
  ['ts', 'ц'], ['yu', 'ю'], ['ya', 'я'], ['yo', 'ё'],
  ['kh', 'х'],
];
const EN_SINGLE: Record<string, string> = {
  a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з', i: 'и',
  y: 'й', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р',
  s: 'с', t: 'т', u: 'у', f: 'ф', h: 'х',
};

export function toLatin(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) {
    out += RU_TO_EN[ch] ?? ch;
  }
  return out;
}

export function toCyrillic(s: string): string {
  let i = 0;
  let out = '';
  const lower = s.toLowerCase();
  while (i < lower.length) {
    let matched = false;
    for (const [en, ru] of EN_MULTI) {
      if (lower.startsWith(en, i)) {
        out += ru;
        i += en.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const ch = lower[i];
      out += EN_SINGLE[ch] ?? ch;
      i += 1;
    }
  }
  return out;
}

/** Одновременно проверяет haystack на подстроку needle с учётом обеих транслитераций. */
export function matchesTranslit(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return true;
  const hLat = toLatin(h);
  const nLat = toLatin(n);
  if (hLat.includes(nLat)) return true;
  const hCyr = toCyrillic(h);
  const nCyr = toCyrillic(n);
  if (hCyr.includes(nCyr)) return true;
  return false;
}
