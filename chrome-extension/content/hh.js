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
      photo_url: '',
      position: '',
      city: '',
      age: '',
      birthday: '',
      gender: '',
      salary: '',
      company: '',
      experience_summary: '',
      education: [],
    };

    // --- Name ---
    data.full_name = getTextMulti([
      '[data-qa="resume-personal-name"]',
      '.resume-header-name',
      'h1[class*="bloko-header"]',
      'h1[data-qa*="personal"]',
      'h2[data-qa="resume-personal-name"]',
    ]);
    // Detect closed-contact placeholder: hh.ru renders heading as "Кандидат"
    // when contacts require paid unlock. Mark this so we build a better
    // placeholder AFTER we've parsed position/city/age below.
    const rawNameIsPlaceholder = !data.full_name || /^\s*кандидат\s*$/i.test(data.full_name);
    if (!data.full_name) {
      const headings = document.querySelectorAll('h1, h2');
      for (const h of headings) {
        const txt = h.textContent.trim();
        if (txt && txt.length < 80 && /кандидат|candidate/i.test(txt)) {
          data.full_name = txt;
          break;
        }
      }
    }
    // Final placeholder will be rebuilt after fields are parsed (see end of function)

    // --- Photo ---
    // hh.ru photo URLs are hosted on *.hhcdn.ru; a real photo URL contains
    // "/photo/" or a numeric filename (e.g. /12345.jpeg). We reject generic
    // placeholders (silhouettes, icons, logos).
    const isRealPhotoUrl = (src) => {
      if (!src || typeof src !== 'string') return false;
      if (!src.startsWith('http') && !src.startsWith('//')) return false;
      const lower = src.toLowerCase();
      // Reject obvious placeholders / icons / ui chrome
      if (lower.includes('placeholder') || lower.includes('empty-avatar') ||
          lower.includes('default-avatar') || lower.includes('silhouette') ||
          lower.includes('no-photo') || lower.includes('noavatar') ||
          lower.endsWith('.svg') ||
          lower.includes('/icons/') || lower.includes('/logo/') ||
          lower.includes('sprite')) return false;
      // Must look like a real image file (jpg/jpeg/png/webp anywhere in the URL,
      // including before a query string)
      return /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(lower);
    };

    const photoSelectors = [
      '[data-qa="resume-photo"] img',
      '[data-qa="resume-photo-image"]',
      '[data-qa="resume-personal-photo"] img',
      '.resume-photo img',
      '.resume-header-photo img',
      '[data-qa="resume-avatar"] img',
      '.resume-avatar img',
      // Magritte-based layout (current hh.ru 2025+)
      '[class*="resume-photo"] img',
      '[class*="resume-header"] img',
      '[class*="avatar"] img',
      'img[data-qa="bloko-image"]',
      // Fallback: any <img> whose src looks like an hh photo CDN path
      'img[src*="hhcdn"]',
    ];
    for (const sel of photoSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const src = el.src || el.getAttribute('src') || '';
        const normalized = src.startsWith('//') ? 'https:' + src : src;
        if (isRealPhotoUrl(normalized)) {
          data.photo_url = normalized;
          break;
        }
      }
      if (data.photo_url) break;
    }
    // Last-resort: scan every img on the page
    if (!data.photo_url) {
      const allImgs = document.querySelectorAll('img');
      for (const img of allImgs) {
        const src = (img.src || '').trim();
        const normalized = src.startsWith('//') ? 'https:' + src : src;
        if (isRealPhotoUrl(normalized)) {
          data.photo_url = normalized;
          break;
        }
      }
    }
    // Also check background-image on div containers (hh sometimes uses CSS backgrounds)
    if (!data.photo_url) {
      const candidates = document.querySelectorAll(
        '[class*="photo"], [class*="avatar"], [data-qa*="photo"], [data-qa*="avatar"]'
      );
      for (const el of candidates) {
        const bg = getComputedStyle(el).backgroundImage || '';
        const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (match) {
          const normalized = match[1].startsWith('//') ? 'https:' + match[1] : match[1];
          if (isRealPhotoUrl(normalized)) {
            data.photo_url = normalized;
            break;
          }
        }
      }
    }
    console.log('[HR-Bot Magic Button] photo_url:', data.photo_url || '(not found)');

    // --- Position/title ---
    data.position = getTextMulti([
      '[data-qa="resume-position"] [data-qa="title"]',
      '[data-qa="resume-position"]',
      '[data-qa="resume-block-title-position"]',
      '.resume-block__title-text_sub',
    ]);

    // --- Contact info ---
    // Note: HH.ru contacts may be hidden behind a "show contacts" button that requires
    // employer access. If contacts are not visible, fields will remain empty - the extension
    // still allows adding the candidate without contacts.

    // Email - try multiple selectors and nested structures
    const emailSelectors = [
      '[data-qa="resume-contact-email"]',
      '[data-qa="resume-contact-email"] a',
      '[data-qa="resume-contact-email"] span',
      '[data-qa="resume-serp__resume-contact-email"]',
    ];
    for (const sel of emailSelectors) {
      if (data.email) break;
      const els = document.querySelectorAll(sel);
      els.forEach(el => {
        const text = el.textContent.trim();
        const href = (el.href || el.getAttribute('href') || '');
        // Extract from mailto: link
        if (!data.email && href.includes('mailto:')) {
          data.email = href.replace('mailto:', '').split('?')[0].trim();
        }
        // Or from text containing @
        else if (!data.email && text.includes('@') && text.includes('.')) {
          // Clean up: take only the email part if there's extra text
          const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
          if (emailMatch) data.email = emailMatch[0];
        }
      });
    }

    // Phone - try multiple selectors, handle formatted numbers
    const phoneSelectors = [
      '[data-qa="resume-contact-phone"]',
      '[data-qa="resume-contact-phone"] a',
      '[data-qa="resume-serp__resume-contact-phone"]',
      '[data-qa="resume-contact-phone-value"]',
    ];
    for (const sel of phoneSelectors) {
      if (data.phone) break;
      const els = document.querySelectorAll(sel);
      els.forEach(el => {
        if (data.phone) return;
        const text = el.textContent.trim();
        const href = (el.href || el.getAttribute('href') || '');
        // Extract from tel: link
        if (href.includes('tel:')) {
          data.phone = href.replace('tel:', '').trim();
        }
        // Or from text that looks like a phone number
        else if (text.match(/[\+\d][\d\s\-\(\)]{6,}/)) {
          // Normalize: remove extra spaces but keep formatting
          data.phone = text.replace(/\s+/g, ' ').trim();
        }
      });
    }

    // Telegram - try multiple selectors
    const tgSelectors = [
      '[data-qa="resume-phone-deep-link-telegram-text"]',
      '[data-qa="resume-phone-deep-link-telegram"]',
      '[data-qa="resume-contact-preferred"][href*="t.me"]',
    ];
    for (const sel of tgSelectors) {
      if (data.telegram) break;
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        const href = (el.href || el.getAttribute('href') || '');
        if (href.includes('t.me/')) {
          const match = href.match(/t\.me\/([^\/?]+)/);
          if (match) data.telegram = '@' + match[1];
        } else if (text.startsWith('@') || text.includes('t.me')) {
          data.telegram = text.startsWith('@') ? text : '@' + text.replace(/.*t\.me\//, '');
        } else if (text && !text.includes(' ')) {
          // Plain username text in a telegram-specific element
          data.telegram = text.startsWith('@') ? text : '@' + text;
        }
      }
    }

    // Fallback: old preferred contact selectors
    if (!data.email || !data.phone || !data.telegram) {
      const contactEls = document.querySelectorAll('[data-qa="resume-contact-preferred"]');
      contactEls.forEach(el => {
        const text = el.textContent.trim();
        const href = el.href || '';
        if (!data.email && (href.includes('mailto:') || text.includes('@'))) {
          const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
          data.email = emailMatch ? emailMatch[0] : text;
        }
        else if (!data.phone && (href.includes('tel:') || text.match(/^\+?\d/))) data.phone = text;
        else if (!data.telegram && (text.includes('t.me') || text.startsWith('@'))) data.telegram = text;
      });
    }

    // Fallback: generic contact value selectors (older hh.ru layout)
    if (!data.email || !data.phone || !data.telegram) {
      const allContacts = document.querySelectorAll('.resume-contact-value');
      allContacts.forEach(el => {
        const text = el.textContent.trim();
        const link = el.querySelector('a');
        const href = link ? link.href : '';
        if (!data.email && href.includes('mailto:')) {
          const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
          data.email = emailMatch ? emailMatch[0] : text;
        }
        else if (!data.phone && href.includes('tel:')) data.phone = text;
        else if (!data.telegram && (text.includes('t.me') || text.startsWith('@'))) {
          data.telegram = text.replace(/.*t\.me\//, '@');
        }
      });
    }

    // Fallback: scan all links on page for contact info (newest hh.ru layouts)
    if (!data.email || !data.phone || !data.telegram) {
      const allLinks = document.querySelectorAll('a[href]');
      allLinks.forEach(link => {
        const href = link.href || '';
        const text = link.textContent.trim();
        if (!data.email && href.includes('mailto:')) {
          data.email = href.replace('mailto:', '').split('?')[0].trim();
        }
        if (!data.phone && href.includes('tel:') && text.match(/[\+\d]/)) {
          data.phone = text.replace(/\s+/g, ' ').trim();
        }
        if (!data.telegram && href.includes('t.me/') && !href.includes('t.me/share')) {
          const match = href.match(/t\.me\/([^\/?]+)/);
          if (match) data.telegram = '@' + match[1];
        }
      });
    }

    // --- Personal info ---
    // Age - take only the first <span> inside (contains "34 года"), not the whole block
    const ageEl = document.querySelector('[data-qa="resume-personal-age"] > span');
    if (ageEl) data.age = ageEl.textContent.trim();

    // Birthday - direct child span
    const bdEl = document.querySelector('[data-qa="resume-personal-birthday"] > span');
    if (bdEl) data.birthday = bdEl.textContent.trim();
    else data.birthday = getText('[data-qa="resume-personal-birthday"]');

    // Gender - take only own text, not nested children
    const genderEl = document.querySelector('[data-qa="resume-personal-gender"]');
    if (genderEl) {
      // Get only the direct text node (e.g. "Мужчина"), not nested age/birthday
      const firstText = genderEl.childNodes[0];
      data.gender = firstText ? firstText.textContent.trim().replace(/,\s*$/, '') : '';
    }

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
      // Extract current/last company
      if (i === 0 && company) {
        data.company = company;
      }
    }
    data.experience_summary = experiences.join('\n');

    // --- Total experience ---
    const expTitle = getText('[data-qa="resume-experience-block-title"] [data-qa="title"]');
    if (expTitle) {
      // e.g. "Опыт работы 12 лет 5 месяцев" or "Опыт работы: 14 лет 1 месяц"
      data.total_experience = expTitle.replace(/Опыт работы:?\s*/, '').trim();
    }

    // --- Experience descriptions (achievements at each job) ---
    const expDescEls = document.querySelectorAll('[data-qa="resume-block-experience-description"]');
    const expDescriptions = [];
    expDescEls.forEach((el, i) => {
      if (i < 3) { // first 3 jobs
        const text = el.textContent.trim();
        if (text) expDescriptions.push(text.substring(0, 500));
      }
    });
    data.experience_descriptions = expDescriptions;

    // --- Skills ---
    const skillsSection = document.querySelector('[data-qa="skills-table"]');
    if (skillsSection) {
      // Skills are in <span> tags inside magritte-card within skills-table
      const card = skillsSection.querySelector('[class*="magritte-card"]');
      if (card) {
        const skillSpans = card.querySelectorAll('span');
        const skills = [];
        skillSpans.forEach(span => {
          const text = span.textContent.trim();
          // Filter: real skills are short-ish text, not UI labels
          if (text && text.length >= 2 && text.length <= 80
              && !span.querySelector('span') // leaf nodes only
              && !text.includes('Свернуть') && !text.includes('Развернуть')) {
            skills.push(text);
          }
        });
        data.skills = [...new Set(skills)]; // deduplicate
      }
    }

    // --- Languages ---
    const langEls = document.querySelectorAll('[data-qa="resume-block-language-item"]');
    const languages = [];
    langEls.forEach(el => {
      const text = el.textContent.trim();
      if (text) languages.push(text);
    });
    data.languages = languages;

    // --- Education ---
    const eduNames = document.querySelectorAll('[data-qa="resume-block-education-name"]');
    const eduOrgs = document.querySelectorAll('[data-qa="resume-block-education-organization"]');
    const education = [];
    for (let i = 0; i < eduOrgs.length && i < 3; i++) {
      const org = eduOrgs[i]?.textContent?.trim() || '';
      const name = eduNames[i]?.textContent?.trim() || '';
      if (org || name) education.push([org, name].filter(Boolean).join(' — '));
    }
    data.education = education;

    // ----- Build a more useful placeholder name when contacts are hidden -----
    // Real name is unknown; build one from what IS visible so each candidate
    // is distinguishable in the kanban and dedup can work by source_url.
    if (rawNameIsPlaceholder) {
      const parts = [];
      if (data.position) parts.push(data.position);
      if (data.city) parts.push(data.city);
      if (data.age) parts.push(data.age);
      if (parts.length > 0) {
        data.full_name = parts.join(', ');
      } else {
        const match = window.location.pathname.match(/\/resume\/([a-f0-9]+)/i);
        const shortId = match ? match[1].slice(0, 8) : '';
        data.full_name = shortId ? `Кандидат hh.ru/${shortId}` : 'Кандидат hh.ru';
      }
      data.name_is_placeholder = true;
    }

    return data;
  }

  // Parse and send to background
  const parsed = parseHHResume();
  console.log('[HR-Bot Magic Button] Parsed resume data:', parsed);
  chrome.runtime.sendMessage({ type: 'PARSE_RESULT', data: parsed });
})();
