// State
let serverUrl = '';
let authToken = '';
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
  const stored = await chrome.storage.local.get(['serverUrl', 'authToken']);
  serverUrl = stored.serverUrl || 'https://hr-bot-production-c613.up.railway.app';
  authToken = stored.authToken || '';

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

  // Get parsed data from content script
  chrome.runtime.sendMessage({ type: 'GET_PARSED_DATA' }, (data) => {
    if (data && data.full_name) {
      parsedData = data;
      showParsedData();
      loadVacancies();
      showView('parse');
    } else {
      // Try to parse current tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const url = tabs[0]?.url || '';
        if (url.includes('hh.ru') || url.includes('habr.com') || url.includes('linkedin.com')) {
          // Content script should have run, wait a bit
          setTimeout(() => {
            chrome.runtime.sendMessage({ type: 'GET_PARSED_DATA' }, (data2) => {
              if (data2 && data2.full_name) {
                parsedData = data2;
                showParsedData();
                loadVacancies();
                showView('parse');
              } else {
                showView('nodata');
              }
            });
          }, 500);
        } else {
          showView('nodata');
        }
      });
    }
  });
});

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

function showParsedData() {
  document.getElementById('parsedName').textContent = parsedData.full_name || '\u2014';

  const details = [];
  if (parsedData.position) details.push(parsedData.position);
  if (parsedData.email) details.push('Email: ' + parsedData.email);
  if (parsedData.phone) details.push('Tel: ' + parsedData.phone);
  if (parsedData.telegram) details.push('TG: ' + parsedData.telegram);
  document.getElementById('parsedDetails').innerHTML = details.join('<br>');
  document.getElementById('parsedSource').textContent = parsedData.source;

  // Show manual email field if not parsed
  if (!parsedData.email) {
    document.getElementById('emailField').style.display = 'block';
  }
}

async function loadVacancies() {
  try {
    const resp = await apiRequest('GET', '/api/magic-button/vacancies');
    if (resp.success) {
      vacancies = resp.data;
      const select = document.getElementById('funnelSelect');
      select.innerHTML = '<option value="">Без воронки</option>';
      vacancies.forEach(v => {
        select.innerHTML += `<option value="${v.id}">${v.title}</option>`;
      });
    }
  } catch (e) {
    console.error('Failed to load vacancies:', e);
  }
}

async function apiRequest(method, path, body) {
  const url = (serverUrl || document.getElementById('serverUrl').value) + path;

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'API_REQUEST',
      url,
      method,
      body,
      token: authToken,
    }, (response) => {
      resolve(response || { success: false, error: 'No response' });
    });
  });
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
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });

    if (resp.ok) {
      const data = await resp.json();
      // Backend returns { access_token, token_type, user } in response body
      authToken = data.access_token;
      await chrome.storage.local.set({ serverUrl, authToken, userName: data.user?.name || '' });

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

  const manualEmail = document.getElementById('manualEmail').value;
  const vacancyId = document.getElementById('funnelSelect').value;
  const comment = document.getElementById('commentField').value;

  const btn = document.getElementById('addBtn');
  btn.disabled = true;
  btn.textContent = 'Добавляем...';

  try {
    const resp = await apiRequest('POST', '/api/magic-button/parse', {
      full_name: parsedData.full_name,
      email: parsedData.email || manualEmail || null,
      phone: parsedData.phone || null,
      telegram: parsedData.telegram || null,
      position: parsedData.position || null,
      source_url: parsedData.source_url,
      source: parsedData.source,
      vacancy_id: vacancyId ? parseInt(vacancyId) : null,
      comment: comment || null,
    });

    if (resp.success) {
      const result = resp.data;

      if (result.is_duplicate && result.duplicate_info) {
        document.getElementById('duplicateWarning').style.display = 'block';
        document.getElementById('duplicateText').textContent =
          `Кандидат уже в базе! Статус: ${result.duplicate_info.status}. Добавлен повторно.`;
      }

      document.getElementById('resultTitle').textContent = result.is_duplicate
        ? 'Кандидат добавлен (дубликат)'
        : 'Кандидат добавлен!';
      document.getElementById('resultMessage').textContent = result.message;
      showView('result');
    } else {
      document.getElementById('addError').textContent = resp.error || 'Ошибка добавления';
    }
  } catch (e) {
    document.getElementById('addError').textContent = 'Ошибка: ' + e.message;
  }

  btn.disabled = false;
  btn.textContent = 'Добавить кандидата';
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

// Add another
document.getElementById('addAnotherBtn').addEventListener('click', () => {
  showView('parse');
  document.getElementById('duplicateWarning').style.display = 'none';
  document.getElementById('addError').textContent = '';
});

// Logout
document.getElementById('logoutLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.storage.local.clear();
  authToken = '';
  showView('login');
});
