(function () {
  if (window.__hr_bot_habr_loaded__) return;
  window.__hr_bot_habr_loaded__ = true;

  const E = window.__ENC__ || {};

  function txt(sel) {
    const el = document.querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  // --- Маппинг встроенного JSON-профиля Habr (структура: skills[], age,
  // experience, location, salary, contacts.items[]). Узел ищем эвристикой. ---
  function findProfileNode(j) {
    const stack = [j]; let steps = 0;
    while (stack.length && steps < 20000) {
      steps++;
      const cur = stack.pop();
      if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
        const k = Object.keys(cur);
        if ((k.includes('skills') && k.includes('experience')) ||
            (k.includes('age') && k.includes('location'))) return cur;
        for (const key of k) { const v = cur[key]; if (v && typeof v === 'object') stack.push(v); }
      } else if (Array.isArray(cur)) {
        for (const v of cur) if (v && typeof v === 'object') stack.push(v);
      }
    }
    return null;
  }

  // Узел с местами работы — он НЕ внутри профильного /user, а под /resume.
  function findCompanies(j) {
    const stack = [j]; let steps = 0;
    while (stack.length && steps < 20000) {
      steps++;
      const cur = stack.pop();
      if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
        if (cur.companies && cur.companies.items) return cur.companies;
        for (const key of Object.keys(cur)) { const v = cur[key]; if (v && typeof v === 'object') stack.push(v); }
      } else if (Array.isArray(cur)) {
        for (const v of cur) if (v && typeof v === 'object') stack.push(v);
      }
    }
    return null;
  }

  function mapJson(j, data) {
    const n = findProfileNode(j);
    if (n) {
      if (!data.full_name && typeof n.title === 'string') data.full_name = n.title;
      // Должность: специализация (+ грейд/квалификация). specialization — объект {title}.
      const spec = n.specialization && (typeof n.specialization === 'string' ? n.specialization : (n.specialization.title || ''));
      const qual = typeof n.qualification === 'string' ? n.qualification : (n.qualification && n.qualification.title || '');
      const pos = [spec, qual].filter(Boolean).join(' · ');
      if (pos && !data.position) data.position = pos;
      if (n.age != null) data.age = typeof n.age === 'string' ? n.age : String(n.age);
      if (n.location) data.city = typeof n.location === 'string' ? n.location : (n.location.title || '');
      if (n.experience != null) data.total_experience = typeof n.experience === 'string' ? n.experience : String(n.experience);
      if (Array.isArray(n.skills)) data.skills = n.skills.map(s => (s && (s.title || s.name)) || s).filter(v => typeof v === 'string');
      if (n.salary) data.salary = typeof n.salary === 'string' ? n.salary : (n.salary.amount ? (n.salary.amount + ' ' + (n.salary.currency || '')) : '');
      const items = n.contacts && n.contacts.items;
      if (Array.isArray(items)) items.forEach(c => {
        const kind = String(c.kind || c.type || '').toLowerCase();
        const val = c.value && (typeof c.value === 'string' ? c.value : (c.value.title || c.value.href)) || '';
        if (!val || typeof val !== 'string') return;
        if (/phone/.test(kind) && !data.phone) data.phone = val;
        else if (/telegram/.test(kind) && !data.telegram) data.telegram = val;
        else if (/mail/.test(kind) && !data.email) data.email = val;
      });
    }
    // Опыт работы: companies.items[].positions[] (title компании + должность + период).
    const companies = findCompanies(j);
    if (companies && Array.isArray(companies.items)) {
      const exp = [];
      companies.items.slice(0, 6).forEach(co => {
        const comp = (co && co.title) || '';
        ((co && co.positions) || []).forEach(p => {
          const parts = [p && p.title, comp, p && p.duration].filter(Boolean);
          if (parts.length) exp.push(parts.join(' | '));
        });
      });
      if (exp.length) {
        if (!data.experience_summary) data.experience_summary = exp.join('\n');
        if (!data.company && companies.items[0]) data.company = companies.items[0].title || '';
      }
    }
  }

  function parseHabr() {
    const data = {
      source: 'career.habr.com', source_url: window.location.href,
      full_name: '', email: '', phone: '', telegram: '', position: '',
      city: '', company: '', salary: '', age: '', gender: '',
      experience_summary: '', total_experience: '', skills: [], languages: [], education: [],
    };

    // 1) JSON-остров (если есть) — чистые структурированные данные.
    if (E.extractProfileJson) {
      const pj = E.extractProfileJson(['skills', 'experience']) || E.extractProfileJson(['age', 'location']);
      if (pj) { try { mapJson(pj, data); } catch (e) { console.warn('[HR-Bot] Habr JSON map failed', e); } }
    }

    // 2) DOM — ТОЛЬКО точечные селекторы (никаких широких [class*=...]).
    if (!data.full_name) data.full_name = txt('.page-title__title') || txt('h1');
    if (!data.position) data.position = txt('.page-title__subtitle') || txt('.user-spec__title');
    if (!data.city) data.city = txt('.basic-section__location');
    if (!data.salary) data.salary = txt('.basic-section__salary');
    if (!data.age) data.age = txt('.basic-section__age');

    if (!data.experience_summary) {
      const exp = [];
      document.querySelectorAll('.experience-section__item, .resume-experience__item').forEach((b, i) => {
        if (i >= 6) return;
        const pos = b.querySelector('.experience-section__title, .resume-experience__title, h3');
        const comp = b.querySelector('.experience-section__company, .company-name, a[href*="/companies/"]');
        const per = b.querySelector('.experience-section__period, .resume-experience__period');
        const parts = [pos, comp, per].map(x => (x ? x.textContent.replace(/\s+/g, ' ').trim() : '')).filter(Boolean);
        if (parts.length) {
          exp.push(parts.join(' | '));
          if (i === 0 && comp && !data.company) data.company = comp.textContent.trim();
        }
      });
      if (exp.length) data.experience_summary = exp.join('\n');
    }

    if (!data.skills.length) {
      const sk = new Set();
      document.querySelectorAll('a[href*="/resumes?skills"], .user-skills__item').forEach(el => {
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        if (t && t.length >= 2 && t.length <= 60) sk.add(t);
      });
      data.skills = [...sk].slice(0, 30);
    }

    // Контакты — только из ссылок mailto/tel/t.me (никаких текстовых эвристик).
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href || '';
      if (!data.email && href.startsWith('mailto:')) data.email = href.slice(7).split('?')[0];
      if (!data.phone && href.startsWith('tel:')) data.phone = href.slice(4);
      if (!data.telegram && href.includes('t.me/')) data.telegram = href;
    });

    if (!data.full_name) {
      const m = window.location.pathname.match(/career\.habr\.com\/([^/?#]+)/) || window.location.pathname.match(/\/([^/?#]+)$/);
      data.full_name = m ? 'Habr: ' + decodeURIComponent(m[1]) : 'Кандидат Habr';
      data.name_is_placeholder = true;
    }
    return data;
  }

  function runAndSend() {
    let data = parseHabr();
    if (E.sanitizeRecord) data = E.sanitizeRecord(data);
    console.log('[HR-Bot Magic Button] Habr parsed:', data);
    chrome.runtime.sendMessage({ type: 'PARSE_RESULT', data });
    return data;
  }
  runAndSend();

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg && msg.type === 'RE_PARSE') { sendResponse({ success: true, data: runAndSend() }); }
  });
})();
