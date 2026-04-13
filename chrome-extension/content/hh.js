(function() {
  // Detect if we're on a resume page
  const isResumePage = window.location.href.includes('/resume/');
  if (!isResumePage) return;

  // Helper: get text content from selector
  function getText(selector) {
    const el = document.querySelector(selector);
    return el ? el.textContent.trim() : '';
  }

  // Helper: get text from multiple selectors (first match wins)
  function getTextMulti(selectors) {
    for (const sel of selectors) {
      const text = getText(sel);
      if (text) return text;
    }
    return '';
  }

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
      city: '',
      age: '',
      birthday: '',
      gender: '',
      salary: '',
      experience_summary: '',
    };

    // --- Name ---
    data.full_name = getTextMulti([
      '[data-qa="resume-personal-name"]',
      '.resume-header-name',
    ]);

    // --- Position/title ---
    data.position = getTextMulti([
      '[data-qa="resume-position"] [data-qa="title"]',
      '[data-qa="resume-position"]',
      '[data-qa="resume-block-title-position"]',
      '.resume-block__title-text_sub',
    ]);

    // --- Contact info (new hh.ru selectors) ---
    // Email - direct selector
    const emailEl = document.querySelector('[data-qa="resume-contact-email"] span');
    if (emailEl) data.email = emailEl.textContent.trim();

    // Phone - direct selector
    const phoneEl = document.querySelector('[data-qa="resume-contact-phone"]');
    if (phoneEl) data.phone = phoneEl.textContent.trim();

    // Telegram - deep link
    const tgEl = document.querySelector('[data-qa="resume-phone-deep-link-telegram-text"]');
    if (tgEl) {
      data.telegram = tgEl.textContent.trim();
    } else {
      const tgLink = document.querySelector('[data-qa="resume-phone-deep-link-telegram"]');
      if (tgLink) {
        const href = tgLink.href || '';
        const match = href.match(/t\.me\/([^\/?]+)/);
        if (match) data.telegram = '@' + match[1];
      }
    }

    // Fallback: old preferred contact selectors
    if (!data.email || !data.phone || !data.telegram) {
      const contactEls = document.querySelectorAll('[data-qa="resume-contact-preferred"]');
      contactEls.forEach(el => {
        const text = el.textContent.trim();
        const href = el.href || '';
        if (!data.email && (href.includes('mailto:') || text.includes('@'))) data.email = text;
        else if (!data.phone && (href.includes('tel:') || text.match(/^\+?\d/))) data.phone = text;
        else if (!data.telegram && (text.includes('t.me') || text.startsWith('@'))) data.telegram = text;
      });
    }

    // Fallback: generic contact value selectors
    if (!data.email || !data.phone || !data.telegram) {
      const allContacts = document.querySelectorAll('.resume-contact-value');
      allContacts.forEach(el => {
        const text = el.textContent.trim();
        const link = el.querySelector('a');
        const href = link ? link.href : '';
        if (!data.email && href.includes('mailto:')) data.email = text;
        else if (!data.phone && href.includes('tel:')) data.phone = text;
        else if (!data.telegram && (text.includes('t.me') || text.startsWith('@'))) {
          data.telegram = text.replace('t.me/', '@');
        }
      });
    }

    // --- Personal info ---
    // Age
    data.age = getText('[data-qa="resume-personal-age"]');

    // Birthday
    data.birthday = getText('[data-qa="resume-personal-birthday"]');

    // Gender
    data.gender = getText('[data-qa="resume-personal-gender"]');

    // City / Address
    data.city = getText('[data-qa="resume-personal-address"]');

    // --- Salary ---
    const salaryEl = document.querySelector('[data-qa="resume-salary-expectation"] [data-qa="title"]');
    if (salaryEl) {
      data.salary = salaryEl.textContent.trim();
    }

    // --- Experience summary (collect companies + positions) ---
    const experiences = [];
    const expPositions = document.querySelectorAll('[data-qa="resume-block-experience-position"]');
    const expCompanies = document.querySelectorAll('[data-qa="resume-experience-company-title"]');
    const expPeriods = document.querySelectorAll('[data-qa="resume-experience-period"]');

    for (let i = 0; i < expPositions.length && i < 5; i++) {
      const pos = expPositions[i]?.textContent?.trim() || '';
      const company = expCompanies[i]?.textContent?.trim() || '';
      const period = expPeriods[i]?.textContent?.trim() || '';
      if (pos || company) {
        experiences.push([pos, company, period].filter(Boolean).join(' | '));
      }
    }
    data.experience_summary = experiences.join('\n');

    // --- Total experience ---
    const expTitle = getText('[data-qa="resume-experience-block-title"] [data-qa="title"]');
    if (expTitle) {
      // e.g. "Опыт работы 12 лет 5 месяцев"
      data.total_experience = expTitle.replace('Опыт работы', '').trim();
    }

    return data;
  }

  // Parse and send to background
  const parsed = parseHHResume();
  console.log('[HR-Bot Magic Button] Parsed resume data:', parsed);
  chrome.runtime.sendMessage({ type: 'PARSE_RESULT', data: parsed });
})();
