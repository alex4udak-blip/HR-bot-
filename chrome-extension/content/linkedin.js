(function() {
  function parseLinkedIn() {
    const data = {
      source: 'linkedin.com',
      source_url: window.location.href,
      full_name: '',
      email: '',
      phone: '',
      telegram: '',
      position: '',
    };

    // Name
    const nameEl = document.querySelector('.text-heading-xlarge') || document.querySelector('h1');
    if (nameEl) data.full_name = nameEl.textContent.trim();

    // Position/headline
    const posEl = document.querySelector('.text-body-medium') || document.querySelector('.pv-top-card--list li');
    if (posEl) data.position = posEl.textContent.trim();

    // LinkedIn rarely shows email/phone on profile page
    // Contact info is behind "Contact info" modal

    return data;
  }

  const parsed = parseLinkedIn();
  chrome.runtime.sendMessage({ type: 'PARSE_RESULT', data: parsed });
})();
