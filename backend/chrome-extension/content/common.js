// Общий модуль для всех парсеров (инжектится ПЕРВЫМ в каждом content_scripts).
// Изолированный мир content-скрипта НЕ видит page-глобалы (window.X страницы),
// поэтому JSON ищем только в DOM (script-теги).
(function () {
  if (window.__ENC__) return;

  // Лимиты длины по полям — режем раздувшиеся значения.
  const FIELD_MAX = {
    full_name: 80, position: 120, city: 60, age: 20, salary: 60,
    company: 120, total_experience: 60, gender: 20, birthday: 40,
    email: 120, phone: 40, telegram: 64,
  };
  const ARR_MAX = { skills: 30, languages: 15, education: 5 };
  const ARR_ITEM_MAX = 200;

  // Маркеры нав-мусора: если строка их содержит — это не значение поля,
  // а кусок навигации/служебного текста (частая болезнь Habr).
  const NAV_MARKERS = [
    'Все сервисы', 'Сообщество IT', 'Создать вакансию', 'Кабинет компании',
    'Подключи Бустер', 'Подними свой профиль', 'Избранные вакансии',
    'Лента вакансий', 'Регистрация', 'Профиль содержит', 'Рассылает спам',
    'Ведёт себя оскорбительно', 'Выдаёт себя за другого',
  ];

  // Похоже ли на технический мусор (код / JSON / разметку).
  function isGarbage(s) {
    if (typeof s !== 'string') return true;
    if (/[{}<>]/.test(s)) return true;
    if (/function\s*\(|=>|\bvar\s|\bwindow\.|\bdocument\./.test(s)) return true;
    if (/"[\w-]+"\s*:/.test(s)) return true;             // JSON-пары "key":
    if (/\}\s*,\s*\{|\]\s*,\s*"/.test(s)) return true;    // JSON-массивы/объекты
    for (const m of NAV_MARKERS) if (s.includes(m)) return true;
    return false;
  }

  function cleanText(s, maxLen) {
    if (s == null) return '';
    let t = String(s).replace(/\s+/g, ' ').trim();
    if (maxLen && t.length > maxLen) t = t.slice(0, maxLen).trim();
    return t;
  }

  function sanitizeStr(s, maxLen) {
    const t = cleanText(s, maxLen);
    if (!t || isGarbage(t)) return '';
    return t;
  }

  const EMAIL_RE = /^[\w.+-]+@[\w-]+\.[a-z]{2,}$/i;
  function isEmail(s) { return typeof s === 'string' && EMAIL_RE.test(s.trim()); }
  function isPhone(s) {
    if (typeof s !== 'string') return false;
    const d = s.replace(/\D/g, '');
    return d.length >= 7 && d.length <= 15;
  }
  // Чистим телеграм: @user / t.me/user. Отсекаем служебные ники (habrcareer_bot).
  const TG_BLOCK = ['habrcareer_bot', 'share', 'joinchat', 'telegram'];
  function normalizeTelegram(s) {
    if (typeof s !== 'string') return '';
    let v = s.trim();
    const m = v.match(/t\.me\/([A-Za-z0-9_]{3,})/);
    if (m) v = m[1];
    v = v.replace(/^@/, '').trim();
    if (!/^[A-Za-z0-9_]{3,40}$/.test(v)) return '';
    if (TG_BLOCK.includes(v.toLowerCase())) return '';
    return '@' + v;
  }

  function dedupeClean(arr, maxItems) {
    const out = [], seen = new Set();
    for (const item of arr || []) {
      const t = sanitizeStr(item, ARR_ITEM_MAX);
      if (t && !seen.has(t)) { seen.add(t); out.push(t); }
      if (out.length >= maxItems) break;
    }
    return out;
  }

  // Финальная санитизация записи ПЕРЕД отправкой. Мусор не доходит до CRM.
  function sanitizeRecord(data) {
    const d = Object.assign({}, data);
    for (const f of Object.keys(FIELD_MAX)) {
      if (!(f in d)) continue;
      if (f === 'email') { const e = cleanText(d.email, FIELD_MAX.email); d.email = isEmail(e) ? e : ''; }
      else if (f === 'phone') { const p = cleanText(d.phone, FIELD_MAX.phone); d.phone = isPhone(p) ? p : ''; }
      else if (f === 'telegram') { d.telegram = normalizeTelegram(d.telegram); }
      else { d[f] = sanitizeStr(d[f], FIELD_MAX[f]); }
    }
    // experience_summary — построчно (одна грязная строка не убивает весь блок).
    if (d.experience_summary) {
      d.experience_summary = String(d.experience_summary).split('\n')
        .map(l => sanitizeStr(l, 300)).filter(Boolean).slice(0, 8).join('\n');
    }
    for (const f of Object.keys(ARR_MAX)) {
      if (Array.isArray(d[f])) d[f] = dedupeClean(d[f], ARR_MAX[f]);
    }
    return d;
  }

  // Поиск объекта с ВСЕМИ ключами needKeys (на любом уровне вложенности).
  function deepHasKeys(obj, keys) {
    const found = new Set();
    const stack = [obj]; let steps = 0;
    while (stack.length && steps < 20000) {
      steps++;
      const cur = stack.pop();
      if (cur && typeof cur === 'object') {
        for (const k of Object.keys(cur)) {
          if (keys.includes(k)) found.add(k);
          const v = cur[k];
          if (v && typeof v === 'object') stack.push(v);
        }
        if (found.size === keys.length) return true;
      }
    }
    return found.size === keys.length;
  }

  // Встроенный JSON-остров из DOM (typed script-теги). Возвращает первый объект,
  // содержащий все needKeys, либо null.
  function extractProfileJson(needKeys) {
    const sel = 'script[type="application/json"], script[type="application/ld+json"]';
    for (const sc of document.querySelectorAll(sel)) {
      const t = (sc.textContent || '').trim();
      if (!t || (t[0] !== '{' && t[0] !== '[')) continue;
      try {
        const o = JSON.parse(t);
        if (!needKeys || deepHasKeys(o, needKeys)) return o;
      } catch (_) {}
    }
    return null;
  }

  window.__ENC__ = {
    sanitizeRecord, sanitizeStr, cleanText, isGarbage,
    isEmail, isPhone, normalizeTelegram, extractProfileJson, deepHasKeys,
  };
})();
