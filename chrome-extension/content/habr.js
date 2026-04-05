(function() {
  function parseHabrProfile() {
    const data = {
      source: 'career.habr.com',
      source_url: window.location.href,
      full_name: '',
      email: '',
      phone: '',
      telegram: '',
      position: '',
    };

    // Name
    const nameEl = document.querySelector('.page-title__title') || document.querySelector('h1');
    if (nameEl) data.full_name = nameEl.textContent.trim();

    // Position
    const posEl = document.querySelector('.page-title__subtitle') || document.querySelector('.profile-speciality');
    if (posEl) data.position = posEl.textContent.trim();

    // Contacts
    const contactEls = document.querySelectorAll('.contact-item, .profile-contact');
    contactEls.forEach(el => {
      const text = el.textContent.trim();
      if (text.includes('@') && text.includes('.')) data.email = text;
      else if (text.startsWith('+')) data.phone = text;
      else if (text.includes('t.me')) data.telegram = text;
    });

    return data;
  }

  const parsed = parseHabrProfile();
  chrome.runtime.sendMessage({ type: 'PARSE_RESULT', data: parsed });
})();
