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
      city: '',
      company: '',
      experience_summary: '',
      total_experience: '',
      skills: [],
      languages: [],
    };

    // --- Name ---
    const nameEl = document.querySelector('.text-heading-xlarge') || document.querySelector('h1');
    if (nameEl) data.full_name = nameEl.textContent.trim();

    // --- Position/headline ---
    const posEl = document.querySelector('.text-body-medium.break-words') || document.querySelector('.text-body-medium');
    if (posEl) data.position = posEl.textContent.trim();

    // --- Location/city ---
    const locEl = document.querySelector('.text-body-small.inline.t-black--light.break-words')
      || document.querySelector('span.text-body-small[class*="t-black--light"]');
    if (locEl) data.city = locEl.textContent.trim();

    // --- Current company from "Experience" section or top card ---
    // Top card often shows "Company Name" as a link
    const topCompanyEl = document.querySelector('.pv-text-details__right-panel-item-text')
      || document.querySelector('div[class*="inline-show-more-text"] span[aria-hidden="true"]');
    if (topCompanyEl) {
      const companyText = topCompanyEl.textContent.trim();
      if (companyText && !companyText.includes('connection') && !companyText.includes('follower')) {
        data.company = companyText;
      }
    }

    // --- Experience section ---
    const experiences = [];
    // New LinkedIn layout: experience items in section#experience
    const expSection = document.getElementById('experience')
      || document.querySelector('section[id="experience"]');
    if (expSection) {
      // The section element is followed by a div with the list
      const expContainer = expSection.closest('section')
        || expSection.parentElement?.closest('section')
        || expSection.parentElement;
      if (expContainer) {
        const expItems = expContainer.querySelectorAll('li.artdeco-list__item');
        expItems.forEach((item, i) => {
          if (i >= 5) return;
          const spans = item.querySelectorAll('span[aria-hidden="true"]');
          const texts = [];
          spans.forEach(s => {
            const t = s.textContent.trim();
            if (t && t.length > 1 && t.length < 200) texts.push(t);
          });
          if (texts.length >= 1) {
            experiences.push(texts.slice(0, 3).join(' | '));
            // First experience company
            if (i === 0 && !data.company && texts.length >= 2) {
              data.company = texts[1]; // Usually position | company | period
            }
          }
        });
      }
    }

    // Fallback: old layout experience
    if (experiences.length === 0) {
      const expListItems = document.querySelectorAll('.pv-entity__position-group-role-item, .pv-profile-section__list-item');
      expListItems.forEach((item, i) => {
        if (i >= 5) return;
        const title = item.querySelector('.t-bold span[aria-hidden="true"]');
        const company = item.querySelector('.t-normal span[aria-hidden="true"]');
        const period = item.querySelector('.pv-entity__date-range span:nth-child(2)');
        const parts = [];
        if (title) parts.push(title.textContent.trim());
        if (company) parts.push(company.textContent.trim());
        if (period) parts.push(period.textContent.trim());
        if (parts.length > 0) experiences.push(parts.join(' | '));
        if (i === 0 && company && !data.company) data.company = company.textContent.trim();
      });
    }

    data.experience_summary = experiences.join('\n');

    // --- Skills section ---
    const skillsSection = document.getElementById('skills')
      || document.querySelector('section[id="skills"]');
    if (skillsSection) {
      const skillContainer = skillsSection.closest('section')
        || skillsSection.parentElement?.closest('section')
        || skillsSection.parentElement;
      if (skillContainer) {
        const skillSpans = skillContainer.querySelectorAll('span[aria-hidden="true"]');
        const skills = new Set();
        skillSpans.forEach(span => {
          const text = span.textContent.trim();
          // Filter: real skills — short text, not UI labels
          if (text && text.length >= 2 && text.length <= 60
              && !text.includes('Show all')
              && !text.includes('Показать все')
              && !text.includes('endorsement')) {
            skills.add(text);
          }
        });
        data.skills = [...skills].slice(0, 30);
      }
    }

    // --- Languages section ---
    const langSection = document.getElementById('languages')
      || document.querySelector('section[id="languages"]');
    if (langSection) {
      const langContainer = langSection.closest('section')
        || langSection.parentElement?.closest('section')
        || langSection.parentElement;
      if (langContainer) {
        const langItems = langContainer.querySelectorAll('li');
        langItems.forEach(item => {
          const spans = item.querySelectorAll('span[aria-hidden="true"]');
          const parts = [];
          spans.forEach(s => {
            const t = s.textContent.trim();
            if (t && t.length > 1 && t.length < 60) parts.push(t);
          });
          if (parts.length > 0) data.languages.push(parts.join(' — '));
        });
      }
    }

    // --- Education section (for extra context) ---
    const eduSection = document.getElementById('education')
      || document.querySelector('section[id="education"]');
    if (eduSection) {
      const eduContainer = eduSection.closest('section')
        || eduSection.parentElement?.closest('section')
        || eduSection.parentElement;
      if (eduContainer) {
        const eduItems = eduContainer.querySelectorAll('li');
        const education = [];
        eduItems.forEach((item, i) => {
          if (i >= 3) return;
          const spans = item.querySelectorAll('span[aria-hidden="true"]');
          const parts = [];
          spans.forEach(s => {
            const t = s.textContent.trim();
            if (t && t.length > 1 && t.length < 150) parts.push(t);
          });
          if (parts.length > 0) education.push(parts.join(' | '));
        });
        data.education = education;
      }
    }

    // --- Contact info (try to get from page, limited availability) ---
    const contactSection = document.querySelector('.pv-contact-info');
    if (contactSection) {
      const emailEl = contactSection.querySelector('a[href^="mailto:"]');
      if (emailEl) data.email = emailEl.textContent.trim();

      const phoneEl = contactSection.querySelector('.t-14.t-black.t-normal');
      if (phoneEl) {
        const phoneText = phoneEl.textContent.trim();
        if (phoneText.match(/^\+?\d/)) data.phone = phoneText;
      }
    }

    // Also scan for visible contact links on profile
    const allLinks = document.querySelectorAll('a[href]');
    allLinks.forEach(link => {
      const href = link.href || '';
      if (!data.email && href.startsWith('mailto:')) {
        data.email = href.replace('mailto:', '').split('?')[0];
      }
      if (!data.telegram && href.includes('t.me/')) {
        const match = href.match(/t\.me\/([^\/?]+)/);
        if (match) data.telegram = '@' + match[1];
      }
    });

    return data;
  }

  const parsed = parseLinkedIn();
  console.log('[HR-Bot Magic Button] Parsed LinkedIn data:', parsed);
  chrome.runtime.sendMessage({ type: 'PARSE_RESULT', data: parsed });
})();
