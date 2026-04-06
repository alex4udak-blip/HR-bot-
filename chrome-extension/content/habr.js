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

    // Position — try sidebar text which contains "specialty • Grade (Level)"
    const sidebar = document.querySelector('.sidebar_left') || document.querySelector('[class*="sidebar"]');
    if (sidebar) {
      const sidebarText = sidebar.innerText;
      // Pattern: "... • Нейронные сети • Ведущий (Lead)"
      const specMatch = sidebarText.match(/•\s*([^•\n]+)\s*•\s*([^•\n]+)/);
      if (specMatch) {
        data.position = (specMatch[1].trim() + ' — ' + specMatch[2].trim());
      }
      // Telegram: "телеграм username" pattern
      const tgMatch = sidebarText.match(/телеграм\s+(\S+)/i);
      if (tgMatch) data.telegram = tgMatch[1].replace(/,/g, '');
    }

    // Fallback position from subtitle
    if (!data.position) {
      const posEl = document.querySelector('.page-title__subtitle') || document.querySelector('.profile-speciality');
      if (posEl) data.position = posEl.textContent.trim();
    }

    // Contacts section — look for links and text
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

    // Also scan contact-item elements (old and new structure)
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
  chrome.runtime.sendMessage({ type: 'PARSE_RESULT', data: parsed });
})();
