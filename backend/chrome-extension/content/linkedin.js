(function () {
  if (window.__hr_bot_linkedin_loaded__) return;
  window.__hr_bot_linkedin_loaded__ = true;

  const E = window.__ENC__ || {};

  // Имя из document.title — самый устойчивый якорь LinkedIn (классы обфусцированы,
  // тега <h1> на странице профиля нет). Формат: "(N) Имя Фамилия | LinkedIn".
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

  // Видимый текст из span[aria-hidden="true"] — устойчивый паттерн LinkedIn
  // (видимый текст дублируется в aria-hidden span, без обфусцированных классов).
  function visibleSpans(root) {
    const out = [];
    root.querySelectorAll('span[aria-hidden="true"]').forEach(s => {
      const t = (s.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && t.length > 1 && t.length < 200) out.push(t);
    });
    return out;
  }

  // Классифицируем <section> по тексту её <h2> (структурный якорь, не классы).
  function classifySection(sec) {
    const h = sec.querySelector('h2');
    const t = ((h && h.textContent) || '').toLowerCase();
    if (/опыт работы|\bexperience\b|опыт/.test(t)) return 'experience';
    if (/образован|\beducation\b/.test(t)) return 'education';
    if (/навыки|\bskills\b/.test(t)) return 'skills';
    if (/язык|\blanguages?\b/.test(t)) return 'languages';
    return null;
  }

  function parseLinkedIn() {
    const data = {
      source: 'linkedin.com', source_url: window.location.href,
      full_name: '', email: '', phone: '', telegram: '', position: '',
      city: '', company: '', experience_summary: '', total_experience: '',
      skills: [], languages: [], education: [],
    };

    data.full_name = nameFromTitle();

    const experiences = [];
    document.querySelectorAll('section').forEach(sec => {
      const kind = classifySection(sec);
      if (!kind) return;
      const items = sec.querySelectorAll('li');
      if (kind === 'experience') {
        items.forEach((li, i) => {
          if (i >= 6) return;
          const sp = visibleSpans(li);
          if (sp.length) {
            experiences.push(sp.slice(0, 3).join(' | '));
            if (i === 0 && sp.length >= 2 && !data.company) data.company = sp[1];
          }
        });
      } else if (kind === 'skills') {
        const sk = new Set();
        sec.querySelectorAll('span[aria-hidden="true"]').forEach(s => {
          const t = (s.textContent || '').trim();
          if (t && t.length >= 2 && t.length <= 60 && !/показать|show all|endorse|·/i.test(t)) sk.add(t);
        });
        data.skills = [...sk].slice(0, 30);
      } else if (kind === 'languages') {
        items.forEach(li => { const sp = visibleSpans(li); if (sp.length) data.languages.push(sp.join(' — ')); });
      } else if (kind === 'education') {
        items.forEach((li, i) => { if (i < 3) { const sp = visibleSpans(li); if (sp.length) data.education.push(sp.slice(0, 2).join(' — ')); } });
      }
    });
    data.experience_summary = experiences.join('\n');

    // Должность: заголовок текущего места (надёжнее) → иначе хедлайн из og:description.
    const expTitle = experiences[0] ? experiences[0].split('|')[0].trim() : '';
    if (expTitle) data.position = expTitle;
    else {
      const og = metaContent('og:description');
      if (og) data.position = og.split(/[·|]| — | - /)[0].trim().slice(0, 120);
    }

    // Контакты: только из ссылок (на LinkedIn почти всегда отсутствуют —
    // тогда поля пустые, рекрутёр дозаполнит вручную).
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href || '';
      if (!data.email && href.startsWith('mailto:')) data.email = href.slice(7).split('?')[0];
      if (!data.phone && href.startsWith('tel:')) data.phone = href.slice(4);
      if (!data.telegram && href.includes('t.me/')) data.telegram = href;
    });

    // Имя не получили (очень редко) — плейсхолдер из URL, чтобы карточка была.
    if (!data.full_name) {
      const m = window.location.pathname.match(/\/in\/([^/?#]+)/);
      data.full_name = m ? 'LinkedIn: ' + decodeURIComponent(m[1]) : 'Кандидат LinkedIn';
      data.name_is_placeholder = true;
    }
    return data;
  }

  function runAndSend() {
    let data = parseLinkedIn();
    if (E.sanitizeRecord) data = E.sanitizeRecord(data);
    console.log('[HR-Bot Magic Button] LinkedIn parsed:', data);
    chrome.runtime.sendMessage({ type: 'PARSE_RESULT', data });
    return data;
  }
  // LinkedIn лениво рендерит секции «Опыт»/«Навыки»/«Образование» при скролле
  // (IntersectionObserver). Без прокрутки в DOM только верхняя карточка → парсер
  // видит лишь имя. Прокручиваем страницу, чтобы секции отрендерились, и парсим.
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function ensureHydrated() {
    const step = Math.max(400, Math.floor((window.innerHeight || 800) * 0.85));
    let y = 0;
    for (let i = 0; i < 40 && y < document.body.scrollHeight; i++) {
      window.scrollTo(0, y); await sleep(120); y += step;
    }
    window.scrollTo(0, document.body.scrollHeight); await sleep(250);
    window.scrollTo(0, 0); await sleep(150);
  }

  runAndSend(); // быстрый первый проход (хотя бы имя из title)

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg && msg.type === 'RE_PARSE') {
      (async function () {
        try { await ensureHydrated(); } catch (_) {}
        sendResponse({ success: true, data: runAndSend() });
      })();
      return true; // sendResponse асинхронный — держим порт открытым
    }
  });
})();
