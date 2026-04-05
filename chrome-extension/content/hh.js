(function() {
  // Detect if we're on a resume page
  const isResumePage = window.location.href.includes('/resume/');
  if (!isResumePage) return;

  // Parse resume data from DOM
  function parseHHResume() {
    const data = {
      source: 'hh.ru',
      source_url: window.location.href,
      full_name: '',
      email: '',
      phone: '',
      telegram: '',
      position: '',
    };

    // Name
    const nameEl = document.querySelector('[data-qa="resume-personal-name"]')
      || document.querySelector('.resume-header-name');
    if (nameEl) data.full_name = nameEl.textContent.trim();

    // Position/title
    const posEl = document.querySelector('[data-qa="resume-block-title-position"]')
      || document.querySelector('.resume-block__title-text_sub');
    if (posEl) data.position = posEl.textContent.trim();

    // Contact info (may be hidden behind "Show contacts" button)
    const contactEls = document.querySelectorAll('[data-qa="resume-contact-preferred"]');
    contactEls.forEach(el => {
      const text = el.textContent.trim();
      if (text.includes('@')) data.email = text;
      else if (text.startsWith('+') || text.match(/^\d/)) data.phone = text;
      else if (text.startsWith('@') || text.includes('t.me')) data.telegram = text;
    });

    // Alternative contact parsing
    const allContacts = document.querySelectorAll('.resume-contact-value');
    allContacts.forEach(el => {
      const text = el.textContent.trim();
      const link = el.querySelector('a');
      const href = link ? link.href : '';
      if (href.includes('mailto:')) data.email = text;
      else if (href.includes('tel:')) data.phone = text;
      else if (text.includes('t.me') || text.startsWith('@')) data.telegram = text.replace('t.me/', '@');
    });

    return data;
  }

  // Parse and send to background
  const parsed = parseHHResume();
  chrome.runtime.sendMessage({ type: 'PARSE_RESULT', data: parsed });
})();
