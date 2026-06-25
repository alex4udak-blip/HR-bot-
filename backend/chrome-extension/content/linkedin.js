(function () {
  if (window.__hr_bot_linkedin_loaded__) return;
  window.__hr_bot_linkedin_loaded__ = true;

  const E = window.__ENC__ || {};

  // ─────────────────────────────────────────────────────────────────────────
  // КОНТЕКСТ (проверено по живому DOM, 2026): залогиненный LinkedIn полностью
  // сменил вёрстку — НЕТ ld+json, НЕТ <code>-JSON, НЕТ <li>/<ul>/aria-hidden,
  // классы обфусцированы. Старый парсер (section→h2→li→aria-hidden) находил
  // только имя из title. Новая надёжная схема:
  //   1) ИНТРО-КАРТОЧКА на главной → имя/должность/компания/вуз/город/фото.
  //   2) ОПЫТ/образование/навыки → грузим /details/<section>/ в скрытый iframe
  //      (same-origin, читается; fetch не годится — отдаёт пустую оболочку) и
  //      берём записи по СТАБИЛЬНОМУ якорю [componentkey^="entity-collection-item"].
  // ─────────────────────────────────────────────────────────────────────────

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Имя из document.title — самый устойчивый якорь. Формат "(N) Имя | LinkedIn".
  function nameFromTitle() {
    let t = (document.title || '').trim();
    t = t.replace(/^\(\d+\)\s*/, '');                 // счётчик уведомлений
    t = t.replace(/\s*[|·\-–]\s*LinkedIn.*$/i, '');   // суффикс "| LinkedIn"
    return t.replace(/\s*\|\s*$/, '').trim();
  }

  function metaContent(prop) {
    const el = document.querySelector('meta[property="' + prop + '"], meta[name="' + prop + '"]');
    return el ? (el.getAttribute('content') || '').trim() : '';
  }

  function currentSlug() {
    const m = location.pathname.match(/\/in\/([^/?#]+)/);
    return m ? m[1] : '';
  }

  // Упорядоченные «строки-листья» элемента: текст листовых узлов по порядку, без
  // повторов подряд. Замена span[aria-hidden] (его в новой вёрстке нет). На записи
  // опыта даёт ровно ["Должность", "Компания · тип", "даты …"].
  function leafLines(root) {
    if (!root) return [];
    const out = [];
    (function walk(el) {
      const kids = el.children;
      if (!kids || kids.length === 0) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) out.push(t);
        return;
      }
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
    })(root);
    const dd = [];
    for (const l of out) if (l !== dd[dd.length - 1]) dd.push(l);
    return dd;
  }

  // ── ld+json (Person) ──────────────────────────────────────────────────────
  // На залогиненном LinkedIn ОТСУТСТВУЕТ, но на публичном (разлогиненном) виде
  // есть — оставляем как безвредный фолбэк.
  function firstStr(v) {
    if (typeof v === 'string') return v.trim();
    if (Array.isArray(v)) { for (const x of v) { const s = firstStr(x); if (s) return s; } return ''; }
    if (v && typeof v === 'object') return firstStr(v.name || v.contentUrl || v.url || '');
    return '';
  }
  function allStr(v) {
    const out = [];
    const push = (x) => { const s = firstStr(x); if (s) out.push(s); };
    if (Array.isArray(v)) v.forEach(push); else if (v != null) push(v);
    return out;
  }
  function applyJsonLd(data) {
    let person = null;
    for (const sc of document.querySelectorAll('script[type="application/ld+json"]')) {
      const t = (sc.textContent || '').trim();
      if (!t) continue;
      let obj; try { obj = JSON.parse(t); } catch (_) { continue; }
      const graph = Array.isArray(obj['@graph']) ? obj['@graph'] : [obj];
      for (const node of graph) {
        const ty = node && node['@type'];
        if (ty === 'Person' || (Array.isArray(ty) && ty.includes('Person'))) { person = node; break; }
      }
      if (person) break;
    }
    if (!person) return false;
    const nm = firstStr(person.name); if (nm) data.full_name = nm;
    if (!data.position) { const j = firstStr(person.jobTitle); if (j) data.position = j; }
    if (!data.company) { const c = firstStr(person.worksFor); if (c) data.company = c; }
    if (!data.city && person.address) {
      data.city = firstStr(person.address.addressLocality) || firstStr(person.address.addressRegion) || '';
    }
    if (!data.education.length) data.education = allStr(person.alumniOf).slice(0, 5);
    if (!data.languages.length) data.languages = allStr(person.knowsLanguage).slice(0, 15);
    if (!data.photo_url) { const img = firstStr(person.image); if (/^https?:/i.test(img)) data.photo_url = img; }
    return true;
  }

  // Похоже ли на строку локации («Ереван, Армения», «Москва», «London, UK»).
  // Нужно для извлечения города из интро-карточки: на залогиненном LinkedIn города
  // нет в ld+json, а отдельного стабильного селектора нет — опознаём по виду.
  function looksLikeLocation(s) {
    if (!s || s.length > 60) return false;
    if (s.includes('@') || s.includes('·') || /https?:/i.test(s)) return false;
    // Служебные строки интро-карточки — не локация.
    if (/контакт|contact info|connection|подписчик|follower|связ|profile|профил|сообщени|message|подписат|follow/i.test(s)) return false;
    if (/\d{3,}/.test(s)) return false; // «500+ связей», «1 234 подписчика»
    // Локация: 1–3 части через запятую, каждая 1–3 слова с заглавной.
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 1 || parts.length > 3) return false;
    return parts.every((p) => /^[A-ZА-ЯЁ][\wа-яё .'’-]{1,34}$/u.test(p));
  }

  // ── Интро-карточка (главная страница) ─────────────────────────────────────
  // Находим контейнер с именем → строки-листья: [Имя, Хедлайн, Город,
  // "Компания · Вуз", …]. Возвращаем хедлайн (для fallback должности). Классы
  // обфусцированы, поэтому якоримся на текст имени и структуру.
  function parseIntroCard(data) {
    const nameTxt = data.full_name;
    let headline = '';
    let card = null;

    // Имя на LinkedIn — это <h1> в интро-секции. Берём его и поднимаемся вверх,
    // пока контейнер не начнёт содержать полезные строки (локация/«компания·вуз»).
    if (nameTxt) {
      for (const h of document.querySelectorAll('h1')) {
        if ((h.textContent || '').replace(/\s+/g, ' ').trim() !== nameTxt) continue;
        card = h.closest('section') || h.parentElement;
        for (let i = 0; i < 8 && card && card.parentElement; i++) {
          const ll = leafLines(card);
          if (ll.some((x) => x.includes('·')) || ll.some(looksLikeLocation)) break;
          card = card.parentElement;
        }
        break;
      }
    }
    // Фолбэк: любой лист с текстом имени → 6 родителей вверх (старая схема).
    if (!card && nameTxt) {
      for (const el of document.querySelectorAll('h1, h2, span, div, a')) {
        if (el.children.length) continue;
        if ((el.textContent || '').replace(/\s+/g, ' ').trim() === nameTxt) {
          card = el;
          for (let i = 0; i < 6 && card.parentElement; i++) card = card.parentElement;
          break;
        }
      }
    }

    if (card) {
      const lines = leafLines(card);
      const idx = lines.indexOf(nameTxt);
      if (idx >= 0 && lines[idx + 1]) headline = lines[idx + 1];

      // Строки с middle-dot: либо «Город, Страна · Контактная информация»,
      // либо «Компания · Вуз». Различаем по наличию слова «контакт/contact».
      for (const l of lines) {
        if (!l.includes('·')) continue;
        const parts = l.split('·').map((s) => s.trim()).filter(Boolean);
        const isContactLine = parts.some((p) => /контакт|contact info/i.test(p));
        if (isContactLine) {
          if (!data.city) {
            const loc = parts.find((p) => !/контакт|contact info/i.test(p));
            if (loc && looksLikeLocation(loc)) data.city = loc;
          }
          continue;
        }
        if (!data.company) {
          if (parts[0]) data.company = parts[0];
          if (parts[1] && !data.education.length) data.education = [parts[1]];
        }
      }

      // Отдельная строка локации (без middle-dot), между хедлайном и блоком
      // «контакты/связи». Берём первую, что похожа на «Город, Страна».
      if (!data.city) {
        const start = idx >= 0 ? idx + 1 : 0;
        for (let i = start; i < lines.length; i++) {
          const l = lines[i];
          if (l === headline || l === nameTxt || l.includes('·')) continue;
          if (/контакт|connection|связ|follower|подписчик/i.test(l)) break;
          if (looksLikeLocation(l)) { data.city = l; break; }
        }
      }
    }

    if (!data.photo_url) {
      for (const img of document.querySelectorAll('img')) {
        if (/licdn\.com\/dms\/image/.test(img.src || '')) { data.photo_url = img.src; break; }
      }
    }
    return headline;
  }

  // ── Детальная страница в скрытом iframe ───────────────────────────────────
  // Грузим /in/<slug>/details/<section>/, ждём SDUI-рендер, читаем записи по
  // [componentkey^="entity-collection-item"]. Возвращает массив строк-листьев на
  // запись. На ошибке/таймауте — []. iframe всегда удаляем.
  function loadDetailItems(slug, section) {
    return new Promise((resolve) => {
      let done = false;
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText =
        'position:fixed;left:-99999px;top:0;width:1024px;height:3000px;border:0;opacity:0;pointer-events:none;';
      const finish = () => {
        if (done) return;
        done = true;
        let items = [];
        try {
          const doc = frame.contentDocument;
          if (doc) {
            const main = doc.querySelector('main') || doc.body;
            const nodes = main ? main.querySelectorAll('[componentkey^="entity-collection-item"]') : [];
            nodes.forEach((n) => { const ln = leafLines(n); if (ln.length) items.push(ln); });
          }
        } catch (_) { /* cross-origin/гонка — отдаём пусто */ }
        try { frame.remove(); } catch (_) {}
        resolve(items);
      };
      frame.addEventListener('load', () => setTimeout(finish, 4500)); // SDUI рендерит ПОСЛЕ load
      frame.src = 'https://www.linkedin.com/in/' + slug + '/details/' + section + '/';
      document.body.appendChild(frame);
      setTimeout(finish, 13000); // жёсткий таймаут
    });
  }

  function makeData() {
    return {
      source: 'linkedin.com', source_url: window.location.href,
      full_name: '', email: '', phone: '', telegram: '', position: '',
      city: '', company: '', photo_url: '', experience_summary: '', total_experience: '',
      skills: [], languages: [], education: [],
    };
  }

  // Синхронная часть (без iframe): имя + интро-карточка + ld+json-фолбэк +
  // контакты. Используется и быстрым первым проходом, и полным.
  function parseBase(data) {
    data.full_name = nameFromTitle();
    const headline = parseIntroCard(data);
    applyJsonLd(data);
    // Контакты — только из ссылок (на LinkedIn почти всегда отсутствуют).
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.href || '';
      if (!data.email && href.startsWith('mailto:')) data.email = href.slice(7).split('?')[0];
      if (!data.phone && href.startsWith('tel:')) data.phone = href.slice(4);
      if (!data.telegram && href.includes('t.me/')) data.telegram = href;
    });
    return headline;
  }

  function finalize(data, headline) {
    // Должность: текущее место из опыта (выставляется в parseFull) → иначе хедлайн
    // → иначе og:description. Хедлайн на LinkedIn часто «Looking for …», поэтому он
    // только запасной вариант, а не первичный.
    if (!data.position) {
      if (headline) data.position = headline.split(/[|/]/)[0].trim().slice(0, 120);
      else {
        const og = metaContent('og:description');
        if (og) data.position = og.split(/[·|]| — | - /)[0].trim().slice(0, 120);
      }
    }
    if (!data.experience_summary && (data.position || data.company)) {
      data.experience_summary = [data.position, data.company].filter(Boolean).join(' | ');
    }
    if (!data.full_name) {
      const m = location.pathname.match(/\/in\/([^/?#]+)/);
      data.full_name = m ? 'LinkedIn: ' + decodeURIComponent(m[1]) : 'Кандидат LinkedIn';
      data.name_is_placeholder = true;
    }
    return data;
  }

  // Быстрый синхронный парс (первый проход / нет slug): только интро-карточка.
  function parseQuick() {
    const data = makeData();
    const headline = parseBase(data);
    return finalize(data, headline);
  }

  // Полный парс: интро-карточка + детальные страницы через iframe.
  async function parseFull() {
    const data = makeData();
    const headline = parseBase(data);
    const slug = currentSlug();
    if (slug) {
      // ТОЛЬКО опыт. Грузим ОДНУ детальную страницу, а не три: LinkedIn агрессивно
      // ловит ботов (быстрые подгрузки → CAPTCHA/«Ограничение» на аккаунте). Опыт —
      // самое ценное; образование берём из интро-карточки, навыки на детальной
      // странице всё равно отдавались пусто (другой componentkey) — не рискуем
      // аккаунтом рекрутёра ради них.
      const expItems = await loadDetailItems(slug, 'experience');

      // Опыт: запись = ["Должность", "Компания · тип", "даты", …описание].
      const experiences = expItems
        .map((ln) => {
          const title = ln[0] || '';
          const company = (ln[1] || '').split('·')[0].trim();
          const dates = ln.find((l) => /(19|20)\d{2}/.test(l)) || '';
          return { title, company, dates };
        })
        .filter((e) => e.title || e.company);
      if (experiences.length) {
        data.experience_summary = experiences
          .map((e) => [e.title, e.company, e.dates].filter(Boolean).join(' | '))
          .slice(0, 8)
          .join('\n');
        if (experiences[0].title) data.position = experiences[0].title;     // реальная текущая роль
        if (experiences[0].company) data.company = experiences[0].company;
      }
    }
    return finalize(data, headline);
  }

  function send(data) {
    if (E.sanitizeRecord) data = E.sanitizeRecord(data);
    console.log('[HR-Bot Magic Button] LinkedIn parsed:', data);
    chrome.runtime.sendMessage({ type: 'PARSE_RESULT', data });
    return data;
  }

  send(parseQuick()); // быстрый первый проход (имя + интро-карточка)

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg && msg.type === 'RE_PARSE') {
      (async function () {
        let data;
        try { data = await parseFull(); } catch (_) { data = parseQuick(); }
        sendResponse({ success: true, data: send(data) });
      })();
      return true; // sendResponse асинхронный — держим порт открытым
    }
  });
})();
