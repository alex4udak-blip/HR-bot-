// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PARSE_RESULT') {
    // Store parsed data for popup to read
    chrome.storage.local.set({ parsedData: message.data });
  }
  if (message.type === 'GET_PARSED_DATA') {
    chrome.storage.local.get('parsedData', (result) => {
      sendResponse(result.parsedData || null);
    });
    return true; // async response
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
    .then(r => r.json())
    .then(data => sendResponse({ success: true, data }))
    .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
