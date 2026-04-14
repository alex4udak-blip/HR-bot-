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
      city: '',
      company: '',
      salary: '',
      age: '',
      gender: '',
      experience_summary: '',
      skills: [],
      languages: [],
    };

    // --- Name ---
    const nameEl = document.querySelector('.page-title__title') || document.querySelector('h1');
    if (nameEl) data.full_name = nameEl.textContent.trim();

    // --- Position (specialty) ---
    const posEl = document.querySelector('.page-title__subtitle')
      || document.querySelector('.profile-speciality')
      || document.querySelector('[class*="profession"]');
    if (posEl) data.position = posEl.textContent.trim();

    // Try sidebar for more detail
    const sidebar = document.querySelector('.sidebar_left') || document.querySelector('[class*="sidebar"]');
    if (sidebar) {
      const sidebarText = sidebar.innerText;

      // Telegram
      const tgMatch = sidebarText.match(/телеграм\s+(\S+)/i) || sidebarText.match(/telegram\s+(\S+)/i);
      if (tgMatch) data.telegram = tgMatch[1].replace(/,/g, '');

      // Position fallback from sidebar
      if (!data.position) {
        const specMatch = sidebarText.match(/•\s*([^•\n]+)\s*•\s*([^•\n]+)/);
        if (specMatch) {
          data.position = (specMatch[1].trim() + ' — ' + specMatch[2].trim());
        }
      }
    }

    // --- City/location ---
    const cityEl = document.querySelector('.inline-list a[href*="/resumes?city"]')
      || document.querySelector('[class*="location"]')
      || document.querySelector('.basic-section__location');
    if (cityEl) {
      data.city = cityEl.textContent.trim();
    }
    // Fallback: look for city in page text
    if (!data.city) {
      const infoItems = document.querySelectorAll('.basic-section__info-item, .profile-info-item');
      infoItems.forEach(item => {
        const text = item.textContent.trim();
        // Usually cities in Habr are like "Москва", "Алматы"
        if (!data.city && !text.includes('@') && !text.startsWith('+') && text.length < 40) {
          const labelEl = item.querySelector('.basic-section__info-label, .profile-info-label');
          if (labelEl && /город|город|location|city/i.test(labelEl.textContent)) {
            data.city = text.replace(labelEl.textContent, '').trim();
          }
        }
      });
    }

    // --- Salary expectation ---
    const salaryEl = document.querySelector('.basic-section__salary')
      || document.querySelector('[class*="salary"]');
    if (salaryEl) data.salary = salaryEl.textContent.trim();
    // Fallback: look for "от X руб" pattern
    if (!data.salary) {
      const allText = document.body.innerText;
      const salaryMatch = allText.match(/(?:от|зп|зарплата|salary)[:\s]*([0-9\s]+(?:000|₽|руб|тенге|\$|€|USD|KZT)[\s\S]{0,20})/i);
      if (salaryMatch) data.salary = salaryMatch[0].trim().substring(0, 60);
    }

    // --- Age ---
    const ageEl = document.querySelector('.basic-section__age, [class*="age"]');
    if (ageEl) data.age = ageEl.textContent.trim();

    // --- Gender ---
    const genderEl = document.querySelector('.basic-section__gender, [class*="gender"]');
    if (genderEl) data.gender = genderEl.textContent.trim();

    // --- Current company ---
    const companyEl = document.querySelector('.experience-company a')
      || document.querySelector('.experience-section .company-name');
    if (companyEl) data.company = companyEl.textContent.trim();

    // --- Experience section ---
    const experiences = [];
    const expBlocks = document.querySelectorAll('.experience-section__item, .experience-item, .content-section[class*="experience"] li');
    expBlocks.forEach((block, i) => {
      if (i >= 5) return;
      const titleEl = block.querySelector('.experience-section__title, .experience-title, h3');
      const compEl = block.querySelector('.experience-section__company, .experience-company, .company-name');
      const periodEl = block.querySelector('.experience-section__period, .experience-period, .date-range');
      const parts = [];
      if (titleEl) parts.push(titleEl.textContent.trim());
      if (compEl) parts.push(compEl.textContent.trim());
      if (periodEl) parts.push(periodEl.textContent.trim());
      if (parts.length > 0) {
        experiences.push(parts.join(' | '));
        if (i === 0 && compEl && !data.company) data.company = compEl.textContent.trim();
      }
    });
    data.experience_summary = experiences.join('\n');

    // --- Skills ---
    const skillEls = document.querySelectorAll('.tags-item, .skill-tag, [class*="tag-item"], .content-section[class*="skill"] .inline-list a');
    if (skillEls.length > 0) {
      const skills = new Set();
      skillEls.forEach(el => {
        const text = el.textContent.trim();
        if (text && text.length >= 2 && text.length <= 60) skills.add(text);
      });
      data.skills = [...skills].slice(0, 30);
    }
    // Fallback: professional skills in sidebar
    if (data.skills.length === 0 && sidebar) {
      const skillLinks = sidebar.querySelectorAll('a[href*="/resumes?skills"]');
      skillLinks.forEach(link => {
        const text = link.textContent.trim();
        if (text && text.length >= 2) data.skills.push(text);
      });
    }

    // --- Languages ---
    const langEls = document.querySelectorAll('.content-section[class*="language"] li, .language-item');
    langEls.forEach(el => {
      const text = el.textContent.trim();
      if (text) data.languages.push(text);
    });

    // --- Contacts (links) ---
    const allLinks = document.querySelectorAll('a[href]');
    allLinks.forEach(link => {
      const href = link.href || '';
      const text = link.textContent.trim();
      if (href.includes('t.me/') && !data.telegram) {
        data.telegram = href.replace('https://t.me/', '').replace('http://t.me/', '');
      }
      if (href.startsWith('mailto:') && !data.email) {
        data.email = href.replace('mailto:', '');
      }
      if (href.startsWith('tel:') && !data.phone) {
        data.phone = href.replace('tel:', '');
      }
    });

    // Contact items
    const contactEls = document.querySelectorAll('.contact-item, .profile-contact, [class*="contact"]');
    contactEls.forEach(el => {
      const text = el.textContent.trim();
      if (text.includes('@') && text.includes('.') && !data.email) data.email = text;
      else if (text.startsWith('+') && !data.phone) data.phone = text;
      else if (text.includes('t.me') && !data.telegram) {
        const m = text.match(/t\.me\/(\S+)/);
        if (m) data.telegram = m[1];
      }
    });

    return data;
  }

  const parsed = parseHabrProfile();
  console.log('[HR-Bot Magic Button] Parsed Habr Career data:', parsed);
  chrome.runtime.sendMessage({ type: 'PARSE_RESULT', data: parsed });
})();
