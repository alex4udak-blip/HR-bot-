// State
let serverUrl = '';
let authToken = '';
let refreshToken = '';
let parsedData = null;
let vacancies = [];

// Elements
const loginForm = document.getElementById('loginForm');
const parseForm = document.getElementById('parseForm');
const noData = document.getElementById('noData');
const resultView = document.getElementById('resultView');

// Password toggle
document.getElementById('togglePassword')?.addEventListener('click', () => {
  const input = document.getElementById('loginPassword');
  const btn = document.getElementById('togglePassword');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁';
  }
});

// Init
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings
  const stored = await chrome.storage.local.get(['serverUrl', 'authToken', 'refreshToken']);
  // Актуальный прод-сервер один и тот же для всех. У старых пользователей в
  // chrome.storage мог остаться прежний адрес и «залипал» в поле входа —
  // поэтому всегда подставляем канонический сервер, кроме локальной разработки.
  const DEFAULT_SERVER_URL = 'https://enceladus-7oylzk.saturn.ac';
  const storedServer = stored.serverUrl || '';
  const isLocalDev = /localhost|127\.0\.0\.1/.test(storedServer);
  serverUrl = isLocalDev ? storedServer : DEFAULT_SERVER_URL;
  if (serverUrl !== storedServer) {
    await chrome.storage.local.set({ serverUrl });
  }
  authToken = stored.authToken || '';
  refreshToken = stored.refreshToken || '';

  document.getElementById('serverUrl').value = serverUrl;

  // Try to use existing browser session (cookie sync)
  if (!authToken) {
    try {
      const resp = await fetch(serverUrl + '/api/auth/me', { credentials: 'include' });
      if (resp.ok) {
        const user = await resp.json();
        authToken = 'session-sync';
        await chrome.storage.local.set({ serverUrl, authToken, userName: user.name });
        console.log('Session synced from browser:', user.name);
      }
    } catch (e) {
      // No active session, show login
    }
  }

  if (!authToken) {
    showView('login');
    return;
  }

  // Главное правило: кэш не доверяем. На каждом открытии попапа просим
  // content-скрипт перепарсить активную вкладку. Кэш используем только как
  // запасной вариант, если content-скрипт не отвечает (например, страница
  // ещё грузится или сайт не из списка).
  loadFromActiveTab();
});

function detectTabState(tabUrl) {
  // 'wrong-site' | 'wrong-page' | 'resume-page'
  const isHh = tabUrl.includes('hh.ru');
  const isHabr = tabUrl.includes('career.habr.com');
  const isLinkedIn = tabUrl.includes('linkedin.com');
  if (!isHh && !isHabr && !isLinkedIn) return 'wrong-site';

  // Эвристика «это похоже на страницу конкретного резюме»:
  // hh.ru — /resume/ ИЛИ есть resumeId в query
  // habr — /<username>/ или /<username>/profile
  // linkedin — /in/<username>
  if (isHh) {
    if (/\/resume\//.test(tabUrl) || /[?&]resumeId=/.test(tabUrl)) return 'resume-page';
    return 'wrong-page';
  }
  if (isHabr) {
    if (/career\.habr\.com\/[^?#/]+/.test(tabUrl)) return 'resume-page';
    return 'wrong-page';
  }
  if (isLinkedIn) {
    if (/\/in\//.test(tabUrl)) return 'resume-page';
    return 'wrong-page';
  }
  return 'wrong-site';
}

function showNodata(state, tabUrl) {
  const wrong = document.getElementById('nodataWrongSite');
  const page = document.getElementById('nodataWrongPage');
  const noParse = document.getElementById('nodataNoParse');
  const example = document.getElementById('nodataExample');
  const urlEl = document.getElementById('nodataCurrentUrl');
  if (wrong) wrong.style.display = 'none';
  if (page) page.style.display = 'none';
  if (noParse) noParse.style.display = 'none';

  if (state === 'wrong-site' && wrong) wrong.style.display = 'block';
  if (state === 'wrong-page' && page) {
    page.style.display = 'block';
    // Подстраиваем пример URL под сайт
    if (example) {
      let host = 'hh.ru'; let path = '/resume/&lt;id&gt;';
      if (tabUrl.includes('career.habr.com')) { host = 'career.habr.com'; path = '/&lt;username&gt;'; }
      else if (tabUrl.includes('linkedin.com')) { host = 'linkedin.com'; path = '/in/&lt;username&gt;'; }
      example.innerHTML = `<b>Пример URL для ${host}:</b><br>` +
        `<span style="font-family:ui-monospace,monospace;">${host}${path}</span>`;
    }
  }
  if (state === 'no-parse' && noParse) noParse.style.display = 'block';

  if (urlEl) urlEl.textContent = tabUrl || 'нет вкладки';
  showView('nodata');
}

async function loadFromActiveTab() {
  const tabs = await new Promise((r) => chrome.tabs.query({ active: true, currentWindow: true }, r));
  const tabUrl = (tabs[0] && tabs[0].url) || '';
  const tabState = detectTabState(tabUrl);

  // Если вкладка не на сайте резюме — сразу контекстный nodata, без RE_PARSE.
  if (tabState === 'wrong-site') {
    // Кэш всё-таки попробуем — вдруг есть свежий парс с предыдущей вкладки
    chrome.runtime.sendMessage({ type: 'GET_PARSED_DATA' }, (data) => {
      if (data && data.full_name) {
        parsedData = data;
        showParsedData();
        loadVacancies();
        showView('parse');
      } else {
        showNodata('wrong-site', tabUrl);
      }
    });
    return;
  }

  if (tabState === 'wrong-page') {
    // На правильном сайте, но не на карточке резюме — конкретный месседж.
    showNodata('wrong-page', tabUrl);
    return;
  }

  // На резюме-странице: чистим кэш и заставляем content-скрипт перепарсить.
  await new Promise((r) => chrome.runtime.sendMessage({ type: 'CLEAR_PARSED_DATA' }, r));
  const reparseResp = await new Promise((r) =>
    chrome.runtime.sendMessage({ type: 'RE_PARSE_ACTIVE_TAB' }, r)
  );

  // Пробуем получить свежие данные с ретраями — content-скрипт мог только
  // что зарегистрироваться и ещё не успеть положить данные в storage.
  const tryFetch = (delay) => new Promise((res) => {
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'GET_PARSED_DATA' }, (data) => res(data || null));
    }, delay);
  });

  let data = null;
  for (const delay of [200, 400, 800]) {
    data = await tryFetch(delay);
    if (data && data.full_name) break;
  }

  if (data && data.full_name) {
    parsedData = data;
    showParsedData();
    loadVacancies();
    showView('parse');
    return;
  }

  // На правильной странице, но парсер ничего не нашёл (DOM не такой,
  // контакты под подпиской, и т.п.) — третий вариант nodata.
  if (reparseResp && reparseResp.success === false) {
    console.warn('[HR-Bot] RE_PARSE failed:', reparseResp.error);
  }
  showNodata('no-parse', tabUrl);
}


function showView(view) {
  loginForm.classList.remove('active');
  parseForm.classList.remove('active');
  noData.style.display = 'none';
  resultView.classList.remove('active');

  if (view === 'login') loginForm.classList.add('active');
  if (view === 'parse') parseForm.classList.add('active');
  if (view === 'nodata') noData.style.display = 'block';
  if (view === 'result') resultView.classList.add('active');
}

const STATUS_MAP = {
  new: { label: 'Новый', badge: 'badge-new' },
  in_progress: { label: 'В работе', badge: 'badge-interview' },
  interview: { label: 'Интервью', badge: 'badge-interview' },
  practice: { label: 'Практика', badge: 'badge-interview' },
  probation: { label: 'Испытательный', badge: 'badge-interview' },
  hired: { label: 'Принят', badge: 'badge-hired' },
  active: { label: 'Работает', badge: 'badge-hired' },
  rejected: { label: 'Отклонён', badge: 'badge-rejected' },
  fired: { label: 'Уволен', badge: 'badge-rejected' },
  archived: { label: 'Архив', badge: 'badge-default' },
};

// Stage labels for pipeline history (VacancyApplication.stage values)
const STAGE_LABELS = {
  applied: 'Заявка',
  screening: 'Скрининг',
  phone_screen: 'Интервью назначено',
  interview: 'Интервью пройдено',
  assessment: 'Практика',
  offer: 'Оффер',
  hired: 'Принят',
  rejected: 'Отказ',
  withdrawn: 'Отозван',
};

function formatDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: '2-digit' });
}

function showParsedData() {
  document.getElementById('parsedName').textContent = parsedData.full_name || '\u2014';

  // If name is a placeholder (hh.ru closed contacts), prompt user to type it
  const nameField = document.getElementById('nameField');
  if (nameField) {
    if (parsedData.name_is_placeholder) {
      nameField.style.display = 'block';
      const nameInput = document.getElementById('manualName');
      if (nameInput && !nameInput.value) {
        nameInput.placeholder = 'Например: Иванов Иван';
        nameInput.focus();
      }
    } else {
      nameField.style.display = 'none';
    }
  }

  // Show photo if available
  const photoContainer = document.getElementById('parsedPhoto');
  if (photoContainer && parsedData.photo_url) {
    photoContainer.innerHTML = `<img src="${parsedData.photo_url}" alt="Photo" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.1);">`;
    photoContainer.style.display = 'block';
  } else if (photoContainer) {
    photoContainer.style.display = 'none';
  }

  const details = [];
  if (parsedData.position) details.push(parsedData.position);
  if (parsedData.email) details.push('Email: ' + parsedData.email);
  if (parsedData.phone) details.push('Tel: ' + parsedData.phone);
  if (parsedData.telegram) details.push('TG: ' + parsedData.telegram);
  if (parsedData.city) details.push('Город: ' + parsedData.city);
  if (parsedData.age) details.push('Возраст: ' + parsedData.age);
  if (parsedData.salary) details.push('ЗП: ' + parsedData.salary);
  if (parsedData.total_experience) details.push('Опыт: ' + parsedData.total_experience);
  if (parsedData.experience_summary) {
    const lines = parsedData.experience_summary.split('\n').slice(0, 3);
    details.push('Последние места: ' + lines.join('; '));
  }
  if (parsedData.company) details.push('Компания: ' + parsedData.company);
  if (parsedData.skills && parsedData.skills.length > 0) {
    details.push('Навыки: ' + parsedData.skills.slice(0, 5).join(', ') +
      (parsedData.skills.length > 5 ? ` (+${parsedData.skills.length - 5})` : ''));
  }
  if (parsedData.languages && parsedData.languages.length > 0) {
    details.push('Языки: ' + parsedData.languages.join(', '));
  }
  if (parsedData.education && parsedData.education.length > 0) {
    details.push('Образование: ' + parsedData.education.slice(0, 2).join('; '));
  }
  document.getElementById('parsedDetails').innerHTML = details.join('<br>');
  document.getElementById('parsedSource').textContent = parsedData.source;

  // Show manual fields if соответствующий контакт не распознан автоматически
  const setFieldVisible = (id, show) => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? 'block' : 'none';
  };
  setFieldVisible('emailField', !parsedData.email);
  setFieldVisible('phoneField', !parsedData.phone);
  setFieldVisible('telegramField', !parsedData.telegram);

  // Show contacts-hidden note if no contacts at all
  const contactsNote = document.getElementById('contactsNote');
  if (contactsNote && !parsedData.email && !parsedData.phone && !parsedData.telegram) {
    contactsNote.style.display = 'block';
  } else if (contactsNote) {
    contactsNote.style.display = 'none';
  }

  // Auto-check duplicates
  checkDuplicatesOnLoad();
}

async function checkDuplicatesOnLoad() {
  const dupStatus = document.getElementById('dupStatus');
  dupStatus.style.display = 'block';
  dupStatus.className = 'dup-status checking';
  dupStatus.innerHTML = '🔍 Проверяем базу...';

  try {
    const manualEmail = document.getElementById('manualEmail')?.value;
    const manualNameForCheck = document.getElementById('manualName')?.value?.trim();
    const checkResp = await apiRequest('POST', '/api/magic-button/check-duplicate', {
      full_name: (parsedData.name_is_placeholder && manualNameForCheck) ? manualNameForCheck : parsedData.full_name,
      email: parsedData.email || manualEmail || null,
      phone: parsedData.phone || null,
      telegram: parsedData.telegram || null,
      source_url: parsedData.source_url || null,
    });

    if (!checkResp.success) {
      // Проверка упала (авторизация/сеть) — НЕ выдаём ложное «дубликатов нет».
      // Если это был 401, apiRequest уже увёл на экран входа.
      dupStatus.className = 'dup-status checking';
      dupStatus.innerHTML = '⚠️ Не удалось проверить дубликаты';
      return;
    }
    if (checkResp.data.is_duplicate) {
      const dups = checkResp.data.duplicates;
      dupStatus.className = 'dup-status found';
      dupStatus.innerHTML = `⚠️ <b>Уже в базе (${dups.length}):</b>` +
        dups.map(d => {
          const st = STATUS_MAP[d.status] || { label: d.status, badge: 'badge-default' };
          // Correct URL: open candidate in Kanban board via entity query param
          const url = `${serverUrl}/all-candidates?entity=${d.entity_id}`;
          const info = [];
          if (d.email) info.push(d.email);
          if (d.phone) info.push(d.phone);
          const infoStr = info.length ? ` <span class="dup-details">${info.join(' · ')}</span>` : '';

          // Build pipeline history block: list of vacancies + stages
          const apps = d.applications || [];
          let historyHtml = '';
          if (apps.length > 0) {
            historyHtml = '<div class="dup-history"><div class="dup-history-title">📋 История:</div>' +
              apps.map(a => {
                const stageLabel = STAGE_LABELS[a.stage] || a.stage;
                const when = formatDateShort(a.last_stage_change_at || a.applied_at);
                return `<div class="dup-history-row">
                  <span class="dup-history-vacancy">${a.vacancy_title}</span>
                  <span class="dup-history-stage">${stageLabel}</span>
                  ${when ? `<span class="dup-history-date">${when}</span>` : ''}
                </div>`;
              }).join('') +
              '</div>';
          } else {
            historyHtml = '<div class="dup-history dup-history-empty">Пока нет откликов на вакансии</div>';
          }

          return `<div class="dup-item">
            <div class="dup-head">
              <a href="#" class="dup-name" data-url="${url}">👤 ${d.name}</a>
              <span class="dup-badge ${st.badge}">${st.label}</span>
            </div>
            ${infoStr ? `<div class="dup-info">${infoStr}</div>` : ''}
            ${historyHtml}
          </div>`;
        }).join('');

      // Click handlers
      setTimeout(() => {
        dupStatus.querySelectorAll('.dup-name').forEach(link => {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: link.dataset.url });
          });
        });
      }, 0);
    } else {
      dupStatus.className = 'dup-status clean';
      dupStatus.innerHTML = '✅ Новый кандидат — дубликатов нет';
    }
  } catch (e) {
    console.error('Duplicate check failed:', e);
    dupStatus.style.display = 'none';
  }
}

async function loadVacancies() {
  // Маша: иногда воронки пропадали и появлялись через 5 минут — это
  // совпадало с redeploy Railway / временным таймаутом сети. Раньше
  // молчаливо ловили catch и оставляли пустой селект. Теперь:
  //  • до 3 попыток с задержкой 1.5с / 3с
  //  • показываем явный disabled-option «не удалось загрузить» если все упали
  //  • показываем «нет открытых воронок» если API вернул пустой массив
  const select = document.getElementById('funnelSelect');
  select.innerHTML = '<option value="">Загружаем воронки…</option>';
  select.disabled = true;

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await apiRequest('GET', '/api/magic-button/vacancies');
      if (resp.success && Array.isArray(resp.data)) {
        vacancies = resp.data;
        select.disabled = false;
        if (vacancies.length === 0) {
          select.innerHTML =
            '<option value="">Без воронки</option>' +
            '<option value="" disabled>— у вас нет открытых воронок —</option>';
        } else {
          select.innerHTML = '<option value="">Без воронки</option>';
          vacancies.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.title;
            select.appendChild(opt);
          });
        }
        return;
      }
      lastError = resp && resp.error ? resp.error : 'unknown error';
      console.warn(`[HR-Bot] loadVacancies attempt ${attempt} failed:`, lastError);
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
      console.warn(`[HR-Bot] loadVacancies attempt ${attempt} threw:`, lastError);
    }
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, attempt * 1500));
    }
  }

  // Все попытки упали — показываем явную ошибку, не пустой дропдаун.
  console.error('Failed to load vacancies after retries:', lastError);
  select.innerHTML =
    '<option value="">Без воронки</option>' +
    '<option value="" disabled>⚠ не удалось загрузить — нажмите «Перезагрузить»</option>';
  select.disabled = false;
}

// Низкоуровневый запрос через фоновый процесс (CORS bypass).
// Возвращает { success, data?, error?, status? }.
async function rawApiRequest(method, path, body, timeoutMs = 30000) {
  const url = (serverUrl || document.getElementById('serverUrl').value) + path;

  // MV3 service worker может заснуть посреди запроса и sendResponse теряется
  // → попап будет ждать вечно. Прикрываем явным таймаутом.
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      console.warn('[HR-Bot] API_REQUEST timeout', { method, url });
      resolve({ success: false, error: 'Таймаут запроса (30 сек). Попробуйте ещё раз.' });
    }, timeoutMs);

    chrome.runtime.sendMessage({
      type: 'API_REQUEST',
      url,
      method,
      body,
      token: authToken,
    }, (response) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        console.warn('[HR-Bot] sendMessage error:', chrome.runtime.lastError);
        resolve({ success: false, error: chrome.runtime.lastError.message || 'Соединение с фоновым процессом потеряно' });
        return;
      }
      resolve(response || { success: false, error: 'Пустой ответ от фонового процесса' });
    });
  });
}

// Похоже ли на ошибку авторизации (истёк access-токен и т.п.).
function isAuthError(resp) {
  if (!resp || resp.success) return false;
  if (resp.status === 401) return true;
  const e = String(resp.error || '').toLowerCase();
  return e.includes('not authenticated') || e.includes('invalid token') ||
    e.includes('token has been invalidated') || e.includes('refresh token');
}

// Молчаливое обновление access-токена по refresh-токену (как в вебе).
// Single-flight: параллельные 401-ы не должны рефрешить наперегонки.
let _refreshing = null;
async function tryRefresh() {
  if (!refreshToken) return false;
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    const resp = await rawApiRequest('POST', '/api/auth/refresh', { refresh_token: refreshToken });
    if (resp.success && resp.data && resp.data.access_token) {
      authToken = resp.data.access_token;
      if (resp.data.refresh_token) refreshToken = resp.data.refresh_token;
      await chrome.storage.local.set({ authToken, refreshToken });
      return true;
    }
    return false;
  })();
  try {
    return await _refreshing;
  } finally {
    _refreshing = null;
  }
}

// Сессия окончательно истекла (нет/протух refresh) — чистим и на экран входа.
async function handleAuthExpired() {
  authToken = '';
  refreshToken = '';
  await chrome.storage.local.remove(['authToken', 'refreshToken']);
  const le = document.getElementById('loginError');
  if (le) le.textContent = 'Сессия истекла — войдите снова';
  showView('login');
}

// Высокоуровневый запрос: при 401 один раз молча рефрешит токен и повторяет.
// Не вышло обновить — чистый возврат на экран входа.
async function apiRequest(method, path, body, timeoutMs = 30000) {
  let resp = await rawApiRequest(method, path, body, timeoutMs);
  if (isAuthError(resp)) {
    const refreshed = refreshToken ? await tryRefresh() : false;
    if (refreshed) {
      resp = await rawApiRequest(method, path, body, timeoutMs);
    }
    if (isAuthError(resp)) {
      await handleAuthExpired();
    }
  }
  return resp;
}

// Login
document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  serverUrl = document.getElementById('serverUrl').value.replace(/\/$/, '');

  if (!email || !password || !serverUrl) {
    document.getElementById('loginError').textContent = 'Заполните все поля';
    return;
  }

  document.getElementById('loginBtn').disabled = true;
  document.getElementById('loginBtn').textContent = 'Входим...';

  try {
    const resp = await fetch(serverUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // include_refresh: расширению нужен refresh-токен в теле (silent-refresh) —
      // куки SameSite=Lax на кросс-сайтовый POST из расширения не уходят.
      body: JSON.stringify({ email, password, include_refresh: true }),
      credentials: 'include',
    });

    if (resp.ok) {
      const data = await resp.json();
      // Backend returns { access_token, refresh_token, token_type, user } in body
      authToken = data.access_token;
      refreshToken = data.refresh_token || '';
      await chrome.storage.local.set({ serverUrl, authToken, refreshToken, userName: data.user?.name || '' });

      document.getElementById('loginError').textContent = '';

      // Reload to check for parsed data
      chrome.runtime.sendMessage({ type: 'GET_PARSED_DATA' }, (pd) => {
        if (pd && pd.full_name) {
          parsedData = pd;
          showParsedData();
          loadVacancies();
          showView('parse');
        } else {
          showView('nodata');
        }
      });
    } else {
      document.getElementById('loginError').textContent = 'Неверный email или пароль';
    }
  } catch (e) {
    document.getElementById('loginError').textContent = 'Ошибка соединения: ' + e.message;
  }

  document.getElementById('loginBtn').disabled = false;
  document.getElementById('loginBtn').textContent = 'Войти';
});

// Add candidate
document.getElementById('addBtn').addEventListener('click', async () => {
  if (!parsedData) return;

  const manualEmail = document.getElementById('manualEmail').value.trim();
  const manualPhone = document.getElementById('manualPhone')?.value.trim() || '';
  const manualTelegramRaw = document.getElementById('manualTelegram')?.value.trim() || '';
  const manualTelegram = manualTelegramRaw
    ? (manualTelegramRaw.startsWith('@') ? manualTelegramRaw : '@' + manualTelegramRaw.replace(/.*t\.me\//, ''))
    : '';
  const vacancyId = document.getElementById('funnelSelect').value;
  const comment = document.getElementById('commentField').value;
  const dupStatus = document.getElementById('dupStatus');
  const hasDuplicates = dupStatus && dupStatus.classList.contains('found');

  const btn = document.getElementById('addBtn');

  // If duplicates were found and user hasn't confirmed yet — ask first
  if (hasDuplicates && !btn.classList.contains('confirmed')) {
    btn.textContent = '⚠️ Всё равно добавить?';
    btn.classList.add('warning', 'confirmed');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Добавляем...';

  try {
    const manualName = document.getElementById('manualName')?.value?.trim();
    const finalName = (parsedData.name_is_placeholder && manualName) ? manualName : parsedData.full_name;
    const resp = await apiRequest('POST', '/api/magic-button/parse', {
      full_name: finalName,
      email: parsedData.email || manualEmail || null,
      phone: parsedData.phone || manualPhone || null,
      telegram: parsedData.telegram || manualTelegram || null,
      photo_url: parsedData.photo_url || null,
      position: parsedData.position || null,
      source_url: parsedData.source_url,
      source: parsedData.source,
      vacancy_id: vacancyId ? parseInt(vacancyId) : null,
      comment: comment || null,
      city: parsedData.city || null,
      age: parsedData.age || null,
      birthday: parsedData.birthday || null,
      gender: parsedData.gender || null,
      salary: parsedData.salary || null,
      experience_summary: parsedData.experience_summary || null,
      total_experience: parsedData.total_experience || null,
      experience_descriptions: parsedData.experience_descriptions || null,
      skills: parsedData.skills || null,
      languages: parsedData.languages || null,
      company: parsedData.company || null,
      education: parsedData.education || null,
    });

    if (resp.success) {
      try {
        const result = resp.data;
        document.getElementById('resultIcon').textContent = result.is_duplicate ? '!' : 'OK';
        document.getElementById('resultTitle').textContent = result.is_duplicate
          ? 'Кандидат добавлен (дубликат)'
          : 'Кандидат добавлен!';
        document.getElementById('resultMessage').textContent = result.message;
        const linkEl = document.getElementById('resultLink');
        if (linkEl && result.entity_id) {
          const candidateUrl = `${serverUrl}/all-candidates?entity=${result.entity_id}`;
          linkEl.innerHTML = `<a href="#" class="candidate-link" data-url="${candidateUrl}">Открыть карточку кандидата</a>`;
          linkEl.style.display = 'block';
          linkEl.querySelector('.candidate-link').addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: candidateUrl });
          });
        }
        showView('result');
      } catch (renderErr) {
        // Сервер ответил OK, но что-то сломалось при рендере экрана успеха —
        // не оставляем юзера с залипшим 'Добавляем...'.
        console.error('[HR-Bot] Result render failed:', renderErr);
        document.getElementById('addError').textContent =
          'Кандидат сохранён, но не удалось показать экран. Обнови страницу.';
      }
    } else {
      document.getElementById('addError').textContent = resp.error || 'Ошибка добавления';
    }
  } catch (e) {
    console.error('[HR-Bot] Add failed:', e);
    document.getElementById('addError').textContent = 'Ошибка: ' + (e && e.message ? e.message : 'неизвестная');
  } finally {
    // Кнопка должна вернуться в исходное состояние ВСЕГДА — даже если
    // что-то упало в success-ветке или таймаут не сработал.
    btn.disabled = false;
    btn.textContent = 'Добавить кандидата';
    btn.classList.remove('warning', 'confirmed');
  }
});

// Copy form link
document.getElementById('copyFormLink').addEventListener('click', async () => {
  const stored = await chrome.storage.local.get(['serverUrl']);
  const link = (stored.serverUrl || '') + '/form/default';
  navigator.clipboard.writeText(link).then(() => {
    const btn = document.getElementById('copyFormLink');
    btn.textContent = 'Ссылка скопирована!';
    setTimeout(() => { btn.textContent = 'Копировать ссылку на форму'; }, 2000);
  });
});

// Add another — сбрасываем форму и подтягиваем активную вкладку через единый
// загрузчик loadFromActiveTab (он уже умеет re-parse + ретраи).
document.getElementById('addAnotherBtn').addEventListener('click', async () => {
  parsedData = null;
  document.getElementById('duplicateWarning').style.display = 'none';
  document.getElementById('addError').textContent = '';
  document.getElementById('addBtn').textContent = 'Добавить кандидата';
  document.getElementById('addBtn').classList.remove('warning', 'confirmed');
  ['manualName', 'manualEmail', 'manualPhone', 'manualTelegram', 'commentField']
    .forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
  await loadFromActiveTab();
});

// Manual refresh — пользователь жмёт когда хочет принудительно перечитать
// текущую вкладку (страховка если auto-load промахнулся).
const refreshBtn = document.getElementById('refreshBtn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    parsedData = null;
    await loadFromActiveTab();
    refreshBtn.disabled = false;
  });
}

// Logout
document.getElementById('logoutLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.storage.local.clear();
  authToken = '';
  showView('login');
});
