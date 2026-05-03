// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PARSE_RESULT') {
    // Store parsed data for popup to read; включаем URL-тег и timestamp,
    // чтобы popup мог отличить свежий парс от устаревшего после нав-ии.
    const tagged = Object.assign({}, message.data, {
      _captured_url: (sender && sender.tab && sender.tab.url) || message.data.source_url || '',
      _captured_at: Date.now(),
    });
    chrome.storage.local.set({ parsedData: tagged });
  }
  if (message.type === 'GET_PARSED_DATA') {
    chrome.storage.local.get('parsedData', (result) => {
      sendResponse(result.parsedData || null);
    });
    return true; // async response
  }
  if (message.type === 'CLEAR_PARSED_DATA') {
    chrome.storage.local.remove('parsedData', () => sendResponse({ success: true }));
    return true;
  }
  if (message.type === 'RE_PARSE_ACTIVE_TAB') {
    // Просим content-скрипт активной вкладки перепарсить DOM повторно.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) { sendResponse({ success: false, error: 'no active tab' }); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'RE_PARSE' }, (resp) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, data: resp });
        }
      });
    });
    return true;
  }
  if (message.type === 'API_REQUEST') {
    // Make API request (background script has CORS bypass)
    const { url, method, body, token } = message;
    fetch(url, {
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    .then(r => {
      if (!r.ok) {
        return r.text().then(text => {
          let detail = `HTTP ${r.status}`;
          try {
            const json = JSON.parse(text);
            detail = json.detail || detail;
          } catch (_) {}
          sendResponse({ success: false, error: detail });
        });
      }
      const contentType = r.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return r.json().then(data => sendResponse({ success: true, data }));
      }
      return r.text().then(text => sendResponse({ success: false, error: 'Non-JSON response: ' + text.substring(0, 200) }));
    })
    .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
