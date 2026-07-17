"""
Сервис поиска похожих кандидатов и детекции дубликатов.

Предоставляет:
- find_similar() - поиск похожих кандидатов по навыкам, опыту, зарплате
- calculate_similarity() - расчет сходства между двумя кандидатами
- detect_duplicates() - детекция возможных дубликатов
- merge_entities() - объединение дубликатов
"""
from typing import List, Optional, Set, Dict, Any, Tuple
from dataclasses import dataclass, field
from sqlalchemy import select, or_, and_, func
from sqlalchemy.ext.asyncio import AsyncSession
import re
import logging

from ..models.database import Entity, EntityType, Organization, User

logger = logging.getLogger("hr-analyzer.similarity")

# Таблица транслитерации русский -> английский
TRANSLIT_RU_EN = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
}

# Альтернативные варианты транслитерации
TRANSLIT_ALTERNATIVES = {
    'а': ['a'],
    'б': ['b'],
    'в': ['v', 'w'],
    'г': ['g', 'h'],
    'д': ['d'],
    'е': ['e', 'ye'],
    'ё': ['yo', 'e', 'io'],
    'ж': ['zh', 'j'],
    'з': ['z'],
    'и': ['i', 'y', 'ee'],
    'й': ['y', 'i', 'j'],
    'к': ['k', 'c'],
    'л': ['l'],
    'м': ['m'],
    'н': ['n'],
    'о': ['o'],
    'п': ['p'],
    'р': ['r'],
    'с': ['s', 'c'],
    'т': ['t'],
    'у': ['u', 'ou'],
    'ф': ['f', 'ph'],
    'х': ['kh', 'h', 'x'],
    'ц': ['ts', 'c', 'tz'],
    'ч': ['ch', 'tch'],
    'ш': ['sh'],
    'щ': ['shch', 'sch'],
    'ъ': ['', 'ie'],
    'ы': ['y', 'i'],
    'ь': ['', "'"],
    'э': ['e'],
    'ю': ['yu', 'iu', 'u'],
    'я': ['ya', 'ia', 'a']
}

# Таблица транслитерации английский -> русский (обратная)
TRANSLIT_EN_RU = {
    'a': 'а', 'b': 'б', 'c': 'к', 'd': 'д', 'e': 'е', 'f': 'ф', 'g': 'г',
    'h': 'х', 'i': 'и', 'j': 'дж', 'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н',
    'o': 'о', 'p': 'п', 'q': 'к', 'r': 'р', 's': 'с', 't': 'т', 'u': 'у',
    'v': 'в', 'w': 'в', 'x': 'кс', 'y': 'й', 'z': 'з',
    # Диграфы
    'ch': 'ч', 'sh': 'ш', 'zh': 'ж', 'ts': 'ц', 'ya': 'я', 'yu': 'ю',
    'yo': 'ё', 'kh': 'х', 'shch': 'щ'
}


@dataclass
class SimilarCandidate:
    """Результат поиска похожего кандидата."""
    entity_id: int
    entity_name: str
    similarity_score: int  # 0-100
    common_skills: List[str] = field(default_factory=list)
    similar_experience: bool = False
    similar_salary: bool = False
    similar_location: bool = False
    match_reasons: List[str] = field(default_factory=list)
    # Detailed comparison data
    entity1_skills: List[str] = field(default_factory=list)
    entity2_skills: List[str] = field(default_factory=list)
    entity1_experience: Optional[int] = None
    entity2_experience: Optional[int] = None
    entity1_salary_min: Optional[int] = None
    entity1_salary_max: Optional[int] = None
    entity2_salary_min: Optional[int] = None
    entity2_salary_max: Optional[int] = None
    entity1_location: Optional[str] = None
    entity2_location: Optional[str] = None
    entity1_position: Optional[str] = None
    entity2_position: Optional[str] = None


@dataclass
class DuplicateCandidate:
    """Результат детекции дубликата."""
    entity_id: int
    entity_name: str
    confidence: int  # 0-100 (вероятность дубликата)
    match_reasons: List[str] = field(default_factory=list)
    matched_fields: Dict[str, Tuple[str, str]] = field(default_factory=dict)  # field: (value1, value2)


def transliterate_ru_to_en(text: str) -> str:
    """Транслитерация русского текста в английский."""
    result = []
    text_lower = text.lower()
    for char in text_lower:
        if char in TRANSLIT_RU_EN:
            result.append(TRANSLIT_RU_EN[char])
        else:
            result.append(char)
    return ''.join(result)


def transliterate_en_to_ru(text: str) -> str:
    """Транслитерация английского текста в русский."""
    result = []
    text_lower = text.lower()
    i = 0
    while i < len(text_lower):
        # Проверяем диграфы (от длинных к коротким)
        matched = False
        for length in [4, 3, 2]:  # shch, ya, ch
            if i + length <= len(text_lower):
                substr = text_lower[i:i+length]
                if substr in TRANSLIT_EN_RU:
                    result.append(TRANSLIT_EN_RU[substr])
                    i += length
                    matched = True
                    break
        if not matched:
            char = text_lower[i]
            if char in TRANSLIT_EN_RU:
                result.append(TRANSLIT_EN_RU[char])
            else:
                result.append(char)
            i += 1
    return ''.join(result)


def generate_name_variants(name: str) -> Set[str]:
    """
    Генерация вариантов написания имени для поиска дубликатов.

    Возвращает набор возможных написаний с учетом:
    - Регистра
    - Транслитерации rus<->eng
    - Альтернативных транслитераций
    """
    variants = set()
    name_lower = name.lower().strip()
    variants.add(name_lower)

    # Определяем язык имени
    has_cyrillic = bool(re.search(r'[а-яё]', name_lower))
    has_latin = bool(re.search(r'[a-z]', name_lower))

    if has_cyrillic:
        # Русское имя -> генерируем английские варианты
        en_variant = transliterate_ru_to_en(name_lower)
        variants.add(en_variant)

        # Генерируем альтернативные транслитерации для каждой части имени
        parts = name_lower.split()
        for part in parts:
            # Стандартная транслитерация части
            en_part = transliterate_ru_to_en(part)
            variants.add(en_part)

    if has_latin:
        # Английское имя -> генерируем русские варианты
        ru_variant = transliterate_en_to_ru(name_lower)
        variants.add(ru_variant)

        # Отдельные части имени
        parts = name_lower.split()
        for part in parts:
            ru_part = transliterate_en_to_ru(part)
            variants.add(ru_part)

    # Добавляем варианты без пробелов и с разделителями
    for v in list(variants):
        variants.add(v.replace(' ', ''))
        variants.add(v.replace(' ', '-'))
        variants.add(v.replace(' ', '_'))

    return variants


def _name_word_variants(word: str) -> Set[str]:
    """Варианты ОДНОГО слова имени (само + транслитерации rus<->eng)."""
    w = (word or "").strip("-_.,").lower()
    out = {w}
    if re.search(r'[а-яё]', w):
        out.add(transliterate_ru_to_en(w))
    if re.search(r'[a-z]', w):
        out.add(transliterate_en_to_ru(w))
    out.discard("")
    return out


def count_shared_name_words(name1: str, name2: str) -> int:
    """Сколько РАЗНЫХ слов ФИО совпадают (каждое — по raw/транслит).

    Считаем именно СЛОВА, а не варианты: общее одно имя «Семён» = 1 слово, а не 2
    из-за пары «семён»+«semyon». Это режет ложные матчи разных людей с общим
    именем («Титов Семён» vs «Кондратьев Семён») — у них совпадает 1 слово."""
    words1 = [_name_word_variants(w) for w in (name1 or "").split()
              if len(w.strip("-_.,")) >= 2]
    words2 = [_name_word_variants(w) for w in (name2 or "").split()
              if len(w.strip("-_.,")) >= 2]
    used: Set[int] = set()
    count = 0
    for v1 in words1:
        for j, v2 in enumerate(words2):
            if j in used:
                continue
            if v1 & v2:
                count += 1
                used.add(j)
                break
    return count


# Уменьшительные <-> полные (минимальный практичный набор; расширяется по мере
# калибровки). Ключи и значения — в нижнем регистре, без транслита (транслит
# добавляется через _name_word_variants на этапе сравнения).
_DIMINUTIVES = {
    "александр": {"саша", "шура", "саня"},
    "алексей": {"лёша", "леша", "алёша", "алеша"},
    "дмитрий": {"дима", "митя"},
    "евгений": {"женя"},
    "екатерина": {"катя"},
    "мария": {"маша"},
    "михаил": {"миша"},
    "владимир": {"вова", "володя"},
    "анатолий": {"толя"},
    "николай": {"коля"},
    "сергей": {"серёжа", "сережа"},
}


def _levenshtein_le1(a: str, b: str) -> bool:
    """Расстояние Левенштейна между a и b не больше 1 (равны / 1 замена / 1
    вставка-удаление / соседняя перестановка двух букв — частая опечатка).
    Дешёвая проверка без построения полной матрицы."""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:  # одна замена или одна соседняя перестановка?
        diff_idx = [i for i in range(la) if a[i] != b[i]]
        if len(diff_idx) == 1:
            return True
        if len(diff_idx) == 2:
            i, j = diff_idx
            if j == i + 1 and a[i] == b[j] and a[j] == b[i]:
                return True
        return False
    # разница длины 1 — одна вставка/удаление
    short, long = (a, b) if la < lb else (b, a)
    i = j = 0
    edited = False
    while i < len(short) and j < len(long):
        if short[i] == long[j]:
            i += 1
            j += 1
        elif edited:
            return False
        else:
            edited = True
            j += 1
    return True


def _diminutive_group(word: str) -> Set[str]:
    """Все эквивалентные формы имени: полное + все уменьшительные обеих сторон.
    Словарь хранит только кириллицу, поэтому ищем совпадение не только по
    исходному слову, но и по его транслит-варианту (иначе 'Aleksandr' не
    находит уменьшительные для 'Александр')."""
    w = (word or "").strip("-_.,").lower()
    candidates = _name_word_variants(w) | {w}
    forms = {w}
    for full, dims in _DIMINUTIVES.items():
        if candidates & ({full} | dims):
            forms.add(full)
            forms.update(dims)
    return forms


def name_part_match(a: str, b: str) -> bool:
    """Совпадает ли ОДНА часть имени (имя ИЛИ фамилия) с учётом: транслита RU<->EN,
    опечатки <=1 символа, уменьшительных форм и инициала ('А.' == 'Александр').
    Пустые -> False."""
    wa = (a or "").strip("-_.,").lower()
    wb = (b or "").strip("-_.,").lower()
    if not wa or not wb:
        return False

    # Инициал: одна буква одной стороны == первая буква другой (с учётом транслита).
    def _first_letters(w: str) -> Set[str]:
        return {v[:1] for v in _name_word_variants(w) if v}
    if len(wa) == 1 or len(wb) == 1:
        return bool(_first_letters(wa) & _first_letters(wb))

    # Полный набор вариантов каждой стороны: транслит (через _name_word_variants)
    # для каждой уменьшительно-эквивалентной формы.
    def _all_variants(w: str) -> Set[str]:
        out: Set[str] = set()
        for form in _diminutive_group(w):
            out |= _name_word_variants(form)
        return out
    va, vb = _all_variants(wa), _all_variants(wb)
    if va & vb:
        return True
    # Опечатка <=1 между любыми вариантами (ловит осознанную ошибку в написании).
    return any(_levenshtein_le1(x, y) for x in va for y in vb)


def names_match_surname_firstname(name1: str, name2: str) -> bool:
    """Совпадают ли ФИО по «Фамилия + Имя» (первые два слова, порядок МОЖЕТ быть
    обратным, каждое слово — с учётом транслитерации). Ловит «Векленко Кирилл»
    ↔ «Векленко Кирилл Дмитриевич» (с отчеством и без) И «Vlada Vertinskaya» ↔
    «Vertinskaya Vlada» (имя/фамилия в разном порядке — типично для источников
    вроде LinkedIn vs hh.ru, 2026-07-14). НЕ матчит разных однофамильцев-тёзок
    по одному лишь имени/отчеству («Борисов Кирилл Евгеньевич» ↔ «Сапрыкин
    Кирилл Евгеньевич» — фамилии разные → НЕ дубль), т.к. требуем совпадения
    ОБОИХ слов по чёткому паросочетанию (каждое слово одного имени должно
    совпасть с РАЗНЫМ словом другого — прямая ИЛИ обратная пара, не одно и то
    же слово дважды). Полное совпадение ФИО — частный случай (тоже совпадёт)."""
    w1 = [_name_word_variants(w) for w in (name1 or "").split()
          if len(w.strip("-_.,")) >= 2]
    w2 = [_name_word_variants(w) for w in (name2 or "").split()
          if len(w.strip("-_.,")) >= 2]
    if len(w1) < 2 or len(w2) < 2:
        return False
    straight = bool(w1[0] & w2[0]) and bool(w1[1] & w2[1])
    swapped = bool(w1[0] & w2[1]) and bool(w1[1] & w2[0])
    return straight or swapped


def normalize_phone(phone: str) -> str:
    """Нормализация телефонного номера."""
    if not phone:
        return ""
    # Убираем все кроме цифр
    digits = re.sub(r'\D', '', phone)
    # Убираем ведущие 8 или +7 для российских номеров
    if digits.startswith('8') and len(digits) == 11:
        digits = '7' + digits[1:]
    elif digits.startswith('7') and len(digits) == 11:
        pass  # Уже нормализовано
    return digits


def normalize_email(email: str) -> str:
    """Нормализация email."""
    if not email:
        return ""
    return email.lower().strip()


def normalize_telegram(value: str) -> str:
    """Нормализация telegram-username: без @, нижний регистр, без пробелов."""
    return str(value or "").strip().lstrip("@").lower()


def normalize_birth_date(value) -> Optional[str]:
    """Канонизировать дату рождения в 'YYYY-MM-DD'. Принимает ISO, '14.05.1990',
    '14/05/1990'. Возвращает None для неполных/мусорных значений (год-месяц без дня,
    текст) — такие НЕ годятся как точный DOB-ключ."""
    if not value:
        return None
    s = str(value).strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
    if m:
        y, mo, d = m.groups()
    else:
        m = re.match(r"^(\d{1,2})[./](\d{1,2})[./](\d{4})$", s)
        if not m:
            return None
        d, mo, y = m.groups()
    try:
        from datetime import date
        dt = date(int(y), int(mo), int(d))
    except ValueError:
        return None
    return dt.isoformat()


def age_from_birth(value, *, today: Optional[str] = None) -> Optional[int]:
    """Возраст в полных годах из даты рождения. today (ISO) — для детерминизма в тестах;
    по умолчанию сегодняшняя дата."""
    norm = normalize_birth_date(value)
    if not norm:
        return None
    from datetime import date
    y, mo, d = (int(x) for x in norm.split("-"))
    ref = date.fromisoformat(today) if today else date.today()
    age = ref.year - y - ((ref.month, ref.day) < (mo, d))
    return age


# Значения, попадающие в telegram_usernames при импорте (HH/CSV), но НЕ являющиеся
# личными хэндлами — это ярлыки источника/площадки. Матчить дубли по ним нельзя:
# десятки разных людей с одним «telegram»/«hh_b2b» слипаются в один ложный кластер.
JUNK_TELEGRAM_USERNAMES = {
    "telegram", "tg", "telega", "hh", "hh_b2b", "hh_news", "hh_news_hr", "hhnews",
    "headhunter", "hhru", "vk", "vkontakte", "avito", "superjob", "habr", "linkedin",
    "email", "mail", "phone", "tel", "resume", "cv", "source", "none", "no",
    "n/a", "na", "null", "-", "—",
}

# Если одно и то же telegram-значение встречается у стольких кандидатов и более —
# это заведомо не личный хэндл (мусор/ярлык), а массовое совпадение. Не матчим.
TG_COMMON_THRESHOLD = 3

# --- Level-2 soft-identity scoring (anti-evasion) ------------------------------
# Веса — СТАРТОВЫЕ значения-заглушки. Калибруются dryrun_duplicate_detection.py
# на реальной активной+теневой базе ДО включения флага в проде. Меняются здесь,
# в одном месте, без правки логики скоринга.
SOFT_WEIGHTS = {
    "last_name": 45,    # фамилия совпала (транслит + опечатка<=1)
    "first_name": 25,   # имя совпало (транслит + опечатка<=1 + уменьшительные)
    "dob_exact": 40,    # точная дата рождения YYYY-MM-DD
    "age_pm1": 12,      # возраст +-1 год (когда точного ДР нет)
    "phone7": 35,       # последние 7 цифр телефона совпали
    "email_local": 35,  # локальная часть email (до @) совпала
    "city": 8,          # город совпал (слабый — города меняют нарочно)
}
# Флаг мягкого совпадения ставим при score >= порога И >=2 независимых компонентах.
SOFT_THRESHOLD = 60
SOFT_MIN_COMPONENTS = 2


def is_matchable_telegram(value: str, freq: Optional[dict] = None) -> bool:
    """Годен ли telegram-username как идентификатор для дедупа: не пустой,
    не из денилиста источников и (если передана частота) не «общий» (≥ порога)."""
    k = normalize_telegram(value)
    if not k or k in JUNK_TELEGRAM_USERNAMES:
        return False
    if freq is not None and freq.get(k, 0) >= TG_COMMON_THRESHOLD:
        return False
    return True


# Слова-маркеры должностей. Расширение иногда кладёт в поле «имя» должность
# («Flutter Developer, Минск, 25 лет») — по таким «именам» матчить дубли нельзя:
# все «Flutter Developer» слипаются между собой.
_POSITION_HINT_WORDS = {
    "developer", "разработчик", "разработчица", "manager", "менеджер",
    "designer", "дизайнер", "analyst", "аналитик", "engineer", "инженер",
    "specialist", "специалист", "lead", "директор", "director", "маркетолог",
    "marketer", "тестировщик", "qa", "devops", "frontend", "backend", "fullstack",
    "копирайтер", "рекрутер", "recruiter", "бухгалтер", "оператор", "sales",
    "продаж", "продажник", "smm", "программист", "администратор", "admin",
    "support", "поддержка", "продавец", "консультант", "ассистент",
}


def looks_like_person_name(name: str) -> bool:
    """Похоже ли значение на ФИО человека, а не на должность/мусор. Расширение
    иногда кладёт в имя должность («Flutter Developer, Минск, 25 лет»), а импорт —
    placeholder'ы. По таким «именам» матчить дубли нельзя. Критерии: нет цифр
    (возраст), нет запятой («Должность, Город, …»), ≥2 слов, и ни одно слово не
    является явным маркером должности."""
    n = (name or "").strip()
    if not n or any(ch.isdigit() for ch in n) or "," in n:
        return False
    nl = n.lower()
    # Плейсхолдеры импорта/расширения («Кандидат …», «Candidate …») — не ФИО:
    # по ним матчить нельзя, иначе все безымянные слипаются. Раньше этот гард
    # жил отдельной копией в magic_button.check_duplicate — теперь единый.
    if nl.startswith("кандидат") or nl.startswith("candidate"):
        return False
    words = nl.replace("-", " ").split()
    if len(words) < 2:
        return False
    if any(w.strip("().") in _POSITION_HINT_WORDS for w in words):
        return False
    return True


def normalize_source_url(url: str) -> str:
    """Стабильный ключ резюме из URL источника — БЕЗ волатильных query-параметров.

    hh.ru отдаёт ссылки вида /resume/<hash>?hhtmFrom=chat&vacancyId=..&t=<timestamp>,
    где query МЕНЯЕТСЯ при каждом открытии. Сравнение полного href ломало дедуп:
    одно и то же резюме, открытое дважды, выглядело как два разных source_url —
    и кандидат добавлялся повторно. Возвращаем канонический ключ: для hh —
    hh:resume:<hash> (стабилен), иначе host+path без query/fragment.
    """
    if not url:
        return ""
    s = str(url).strip()
    if not s:
        return ""
    m = re.search(r"/resume/([0-9a-f]{16,})", s, re.IGNORECASE)
    if m:
        return f"hh:resume:{m.group(1).lower()}"
    m = re.search(r"[?&]resumeId=(\d+)", s, re.IGNORECASE)
    if m:
        return f"hh:resumeId:{m.group(1)}"
    s = re.sub(r"#.*$", "", s)
    s = re.sub(r"\?.*$", "", s)
    s = re.sub(r"^https?://", "", s, flags=re.IGNORECASE)
    return s.rstrip("/").lower()


def extract_skills(extra_data: dict) -> Set[str]:
    """Извлечение навыков из extra_data."""
    skills = set()
    if not extra_data:
        return skills

    # Поиск skills в разных форматах
    if 'skills' in extra_data:
        if isinstance(extra_data['skills'], list):
            skills.update(s.lower().strip() for s in extra_data['skills'] if s)
        elif isinstance(extra_data['skills'], str):
            # Разделители: запятая, точка с запятой, новая строка
            for skill in re.split(r'[,;\n]', extra_data['skills']):
                skill = skill.strip().lower()
                if skill:
                    skills.add(skill)

    # Поиск в других возможных полях
    for key in ['technologies', 'tech_stack', 'stack', 'competencies']:
        if key in extra_data:
            if isinstance(extra_data[key], list):
                skills.update(s.lower().strip() for s in extra_data[key] if s)
            elif isinstance(extra_data[key], str):
                for skill in re.split(r'[,;\n]', extra_data[key]):
                    skill = skill.strip().lower()
                    if skill:
                        skills.add(skill)

    return skills


def extract_experience_years(extra_data: dict) -> Optional[int]:
    """Извлечение опыта работы в годах."""
    if not extra_data:
        return None

    for key in ['experience', 'experience_years', 'years_of_experience', 'work_experience']:
        if key in extra_data:
            value = extra_data[key]
            if isinstance(value, (int, float)):
                return int(value)
            elif isinstance(value, str):
                # Попытка извлечь число из строки
                match = re.search(r'(\d+)', value)
                if match:
                    return int(match.group(1))
    return None


def extract_location(extra_data: dict) -> Optional[str]:
    """Извлечение локации."""
    if not extra_data:
        return None

    for key in ['location', 'city', 'region', 'country', 'address']:
        if key in extra_data:
            value = extra_data[key]
            if isinstance(value, str) and value.strip():
                return value.lower().strip()
    return None


def calculate_skills_similarity(skills1: Set[str], skills2: Set[str]) -> Tuple[float, List[str]]:
    """
    Расчет сходства по навыкам с использованием коэффициента Жаккара.

    Returns:
        (similarity_score 0-1, list of common skills)
    """
    if not skills1 or not skills2:
        return 0.0, []

    # Нормализация навыков для сравнения
    normalized1 = {s.lower().strip() for s in skills1}
    normalized2 = {s.lower().strip() for s in skills2}

    common = normalized1 & normalized2
    union = normalized1 | normalized2

    if not union:
        return 0.0, []

    jaccard = len(common) / len(union)
    return jaccard, list(common)


def calculate_salary_overlap(
    min1: Optional[int], max1: Optional[int],
    min2: Optional[int], max2: Optional[int]
) -> bool:
    """Проверка пересечения зарплатных ожиданий."""
    if None in (min1, max1, min2, max2):
        # Если нет полных данных, считаем что пересечение возможно
        return True

    # Проверка пересечения диапазонов
    return max1 >= min2 and max2 >= min1


def calculate_experience_similarity(exp1: Optional[int], exp2: Optional[int]) -> bool:
    """Проверка схожести опыта (разница не более 2 лет)."""
    if exp1 is None or exp2 is None:
        return False
    return abs(exp1 - exp2) <= 2


def calculate_location_similarity(loc1: Optional[str], loc2: Optional[str]) -> bool:
    """Проверка схожести локации."""
    if not loc1 or not loc2:
        return False

    loc1_lower = loc1.lower()
    loc2_lower = loc2.lower()

    # Точное совпадение
    if loc1_lower == loc2_lower:
        return True

    # Одна локация содержит другую
    if loc1_lower in loc2_lower or loc2_lower in loc1_lower:
        return True

    return False


class SimilarityService:
    """Сервис поиска похожих кандидатов и детекции дубликатов."""

    async def find_similar(
        self,
        db: AsyncSession,
        entity: Entity,
        limit: int = 10,
        org_id: Optional[int] = None,
        user: Optional[User] = None
    ) -> List[SimilarCandidate]:
        """
        Поиск похожих кандидатов.

        Использует embeddings если доступны (быстрый поиск <100ms),
        иначе fallback на JSON-based сравнение.

        Args:
            db: Сессия БД
            entity: Исходный кандидат
            limit: Максимальное количество результатов
            org_id: ID организации (если None, ищем в той же организации)
            user: Текущий пользователь (для фильтрации по правам доступа)

        Returns:
            Список похожих кандидатов с оценкой сходства
        """
        if org_id is None:
            org_id = entity.org_id

        # Try embeddings-based search first (much faster)
        embedding_results = await self._find_similar_via_embeddings(db, entity, limit * 2, org_id)

        if embedding_results:
            logger.debug(f"Using embeddings for similarity search, found {len(embedding_results)} candidates")
            # Filter by user access if needed
            if user:
                from .permissions import PermissionService
                permissions = PermissionService(db)
                accessible_ids = await permissions.get_accessible_ids(user, "entity", org_id)
                embedding_results = [r for r in embedding_results if r.entity_id in accessible_ids]

            return embedding_results[:limit]

        # Fallback to JSON-based search
        logger.debug("Embeddings not available, using JSON-based similarity search")

        # Извлекаем данные исходного кандидата
        source_skills = extract_skills(entity.extra_data or {})
        source_experience = extract_experience_years(entity.extra_data or {})
        source_location = extract_location(entity.extra_data or {})

        # Get accessible entity IDs for security filtering
        accessible_ids: Optional[Set[int]] = None
        if user:
            from .permissions import PermissionService
            permissions = PermissionService(db)
            accessible_ids = await permissions.get_accessible_ids(user, "entity", org_id)

        # Загружаем кандидатов (фильтруем по доступу если есть user)
        query = select(Entity).where(
            and_(
                Entity.org_id == org_id,
                Entity.id != entity.id,
                Entity.type == EntityType.candidate,
                Entity.is_archived.is_not(True),  # архив не показываем в «похожих»
            )
        )
        result = await db.execute(query)
        all_candidates = result.scalars().all()

        # Filter by accessible IDs if user is provided
        if accessible_ids is not None:
            candidates = [c for c in all_candidates if c.id in accessible_ids]
        else:
            candidates = all_candidates

        similar_results: List[SimilarCandidate] = []

        for candidate in candidates:
            # Извлекаем данные кандидата для сравнения
            candidate_skills = extract_skills(candidate.extra_data or {})
            candidate_experience = extract_experience_years(candidate.extra_data or {})
            candidate_location = extract_location(candidate.extra_data or {})

            # Рассчитываем сходство по разным критериям
            skill_score, common_skills = calculate_skills_similarity(source_skills, candidate_skills)
            similar_experience = calculate_experience_similarity(source_experience, candidate_experience)
            similar_salary = calculate_salary_overlap(
                entity.expected_salary_min, entity.expected_salary_max,
                candidate.expected_salary_min, candidate.expected_salary_max
            )
            similar_location = calculate_location_similarity(source_location, candidate_location)

            # Расчет итогового балла сходства
            score = 0
            match_reasons = []

            # Навыки - 50% веса
            if skill_score > 0:
                score += int(skill_score * 50)
                if common_skills:
                    match_reasons.append(f"Общие навыки: {', '.join(common_skills[:5])}")

            # Опыт - 20% веса
            if similar_experience:
                score += 20
                match_reasons.append(f"Похожий опыт работы")

            # Зарплата - 15% веса
            if similar_salary and (entity.expected_salary_min or entity.expected_salary_max):
                score += 15
                match_reasons.append("Пересекающиеся зарплатные ожидания")

            # Локация - 15% веса
            if similar_location:
                score += 15
                match_reasons.append(f"Похожая локация")

            # Добавляем в результат если есть хоть какое-то сходство
            if score > 0:
                similar_results.append(SimilarCandidate(
                    entity_id=candidate.id,
                    entity_name=candidate.name,
                    similarity_score=min(score, 100),
                    common_skills=common_skills,
                    similar_experience=similar_experience,
                    similar_salary=similar_salary,
                    similar_location=similar_location,
                    match_reasons=match_reasons
                ))

        # Сортируем по убыванию сходства и возвращаем топ
        similar_results.sort(key=lambda x: x.similarity_score, reverse=True)
        return similar_results[:limit]

    async def _find_similar_via_embeddings(
        self,
        db: AsyncSession,
        entity: Entity,
        limit: int,
        org_id: int
    ) -> List[SimilarCandidate]:
        """
        Fast similarity search using embeddings (pgvector).

        Returns empty list if embeddings are not available.
        """
        try:
            from .similarity_search import similarity_search

            # Check if entity has embedding
            if not hasattr(entity, 'embedding') or entity.embedding is None:
                return []

            # Find similar via embeddings
            results = await similarity_search.find_similar_entities(
                db=db,
                entity_id=entity.id,
                org_id=org_id,
                limit=limit,
                min_score=0.2  # Lower threshold to get more candidates
            )

            if not results:
                return []

            # Convert to SimilarCandidate format
            similar_candidates = []
            for r in results:
                # Extract skills for match reasons
                common_skills = r.tags[:5] if r.tags else []
                match_reasons = []

                if common_skills:
                    match_reasons.append(f"Общие навыки: {', '.join(common_skills)}")
                if r.score >= 0.7:
                    match_reasons.append("Высокое AI-сходство профиля")
                elif r.score >= 0.5:
                    match_reasons.append("Среднее AI-сходство профиля")

                similar_candidates.append(SimilarCandidate(
                    entity_id=r.id,
                    entity_name=r.name,
                    similarity_score=int(r.score * 100),
                    common_skills=common_skills,
                    similar_experience=r.score >= 0.5,  # Approximate
                    similar_salary=False,  # Not calculated in embeddings
                    similar_location=False,  # Not calculated in embeddings
                    match_reasons=match_reasons
                ))

            return similar_candidates

        except ImportError:
            logger.debug("similarity_search module not available")
            return []
        except Exception as e:
            logger.warning(f"Embeddings search failed, falling back to JSON: {e}")
            return []

    def calculate_similarity(
        self,
        entity1: Entity,
        entity2: Entity
    ) -> SimilarCandidate:
        """
        Расчет сходства между двумя кандидатами.

        Args:
            entity1: Первый кандидат
            entity2: Второй кандидат

        Returns:
            Результат с оценкой сходства
        """
        # Извлекаем данные
        skills1 = extract_skills(entity1.extra_data or {})
        skills2 = extract_skills(entity2.extra_data or {})
        exp1 = extract_experience_years(entity1.extra_data or {})
        exp2 = extract_experience_years(entity2.extra_data or {})
        loc1 = extract_location(entity1.extra_data or {})
        loc2 = extract_location(entity2.extra_data or {})

        # Рассчитываем сходство
        skill_score, common_skills = calculate_skills_similarity(skills1, skills2)
        similar_experience = calculate_experience_similarity(exp1, exp2)
        similar_salary = calculate_salary_overlap(
            entity1.expected_salary_min, entity1.expected_salary_max,
            entity2.expected_salary_min, entity2.expected_salary_max
        )
        similar_location = calculate_location_similarity(loc1, loc2)

        # Расчет итогового балла
        score = 0
        match_reasons = []

        if skill_score > 0:
            score += int(skill_score * 50)
            if common_skills:
                match_reasons.append(f"Общие навыки: {', '.join(common_skills[:5])}")

        if similar_experience:
            score += 20
            match_reasons.append("Похожий опыт работы")

        if similar_salary and (entity1.expected_salary_min or entity1.expected_salary_max):
            score += 15
            match_reasons.append("Пересекающиеся зарплатные ожидания")

        if similar_location:
            score += 15
            match_reasons.append("Похожая локация")

        return SimilarCandidate(
            entity_id=entity2.id,
            entity_name=entity2.name,
            similarity_score=min(score, 100),
            common_skills=common_skills,
            similar_experience=similar_experience,
            similar_salary=similar_salary,
            similar_location=similar_location,
            match_reasons=match_reasons,
            # Detailed comparison data
            entity1_skills=skills1,
            entity2_skills=skills2,
            entity1_experience=exp1,
            entity2_experience=exp2,
            entity1_salary_min=entity1.expected_salary_min,
            entity1_salary_max=entity1.expected_salary_max,
            entity2_salary_min=entity2.expected_salary_min,
            entity2_salary_max=entity2.expected_salary_max,
            entity1_location=loc1,
            entity2_location=loc2,
            entity1_position=entity1.position,
            entity2_position=entity2.position
        )

    async def detect_duplicates(
        self,
        db: AsyncSession,
        entity: Entity,
        org_id: Optional[int] = None,
        user: Optional[User] = None,
        include_archived: bool = False
    ) -> List[DuplicateCandidate]:
        """
        Детекция возможных дубликатов.

        Проверяет:
        - Имя (с учетом транслитерации)
        - Email
        - Телефон
        - Комбинация навыки + компания

        Args:
            db: Сессия БД
            entity: Исходный кандидат
            org_id: ID организации
            user: Текущий пользователь (для фильтрации по правам доступа)
            include_archived: Включать ли архивных кандидатов в детекцию
                (по умолчанию False — архив исключается)

        Returns:
            Список возможных дубликатов с вероятностью
        """
        if org_id is None:
            org_id = entity.org_id

        duplicates: List[DuplicateCandidate] = []
        seen_ids: Set[int] = {entity.id}
        # Пары, отмеченные «Нет, это разные люди», больше НЕ предлагаем к матчу.
        for _d in (entity.extra_data or {}).get("dismissed_duplicate_ids") or []:
            try:
                seen_ids.add(int(_d))
            except (TypeError, ValueError):
                pass

        # Get accessible entity IDs for security filtering
        accessible_ids: Optional[Set[int]] = None
        if user:
            from .permissions import PermissionService
            permissions = PermissionService(db)
            accessible_ids = await permissions.get_accessible_ids(user, "entity", org_id)

        entity_name_norm = (entity.name or "").strip().lower()

        # Нормализуем контактные данные
        normalized_phone = normalize_phone(entity.phone or "")
        normalized_email = normalize_email(entity.email or "")

        # Дополнительные телефоны и email
        additional_phones = [normalize_phone(p) for p in (entity.phones or []) if p]
        additional_emails = [normalize_email(e) for e in (entity.emails or []) if e]

        all_phones = {normalized_phone} | set(additional_phones)
        all_phones.discard("")

        all_emails = {normalized_email} | set(additional_emails)
        all_emails.discard("")

        # Telegram сущности — сильный личный идентификатор (не слабее телефона).
        all_telegrams = {normalize_telegram(t) for t in (entity.telegram_usernames or []) if t}
        all_telegrams.discard("")

        # Загружаем всех кандидатов организации
        conditions = [
            Entity.org_id == org_id,
            Entity.id != entity.id,
        ]
        if not include_archived:
            # архив исключаем из детекции дубликатов (по умолчанию)
            conditions.append(Entity.is_archived.is_not(True))
        query = select(Entity).where(and_(*conditions))
        result = await db.execute(query)
        all_candidates = result.scalars().all()

        # Filter by accessible IDs if user is provided (SECURITY: prevent data leak)
        if accessible_ids is not None:
            candidates = [c for c in all_candidates if c.id in accessible_ids]
        else:
            candidates = all_candidates

        # Частота telegram-хэндлов по РАЗНЫМ ИМЕНАМ: один хэндл у многих разных
        # людей = мусорный тег (не матчим по нему). Одно имя на неск. карточек —
        # это тот же человек, матчим.
        tg_name_freq: Dict[str, Set[str]] = {}
        for _c in list(candidates) + [entity]:
            _nm = (_c.name or "").strip().lower()
            for _t in (_c.telegram_usernames or []):
                _k = normalize_telegram(_t)
                if _k:
                    tg_name_freq.setdefault(_k, set()).add(_nm)

        for candidate in candidates:
            if candidate.id in seen_ids:
                continue

            confidence = 0
            match_reasons = []
            matched_fields: Dict[str, Tuple[str, str]] = {}

            # 1. Проверка имени (40 баллов) — только если ОБА значения похожи на
            # ФИО, а не на должность/мусор («Flutter Developer, Минск, 25 лет»).
            # Совпадение по «Фамилия + Имя» (первые два слова позиционно): ловит
            # варианты с отчеством/без, но НЕ матчит однофамильцев-тёзок по одному
            # имени+отчеству («Борисов Кирилл Евгеньевич» ↔ «Сапрыкин Кирилл
            # Евгеньевич»). Раньше был «≥2 общих слова» — и имя+отчество при разных
            # фамилиях давало ложный +40.
            name_match = names_match_surname_firstname(entity.name, candidate.name)
            if name_match and looks_like_person_name(entity.name) and looks_like_person_name(candidate.name):
                confidence += 40
                match_reasons.append("Совпадение имени (с учетом транслитерации)")
                matched_fields['name'] = (entity.name, candidate.name)

            # 2. Проверка email (30 баллов)
            candidate_email = normalize_email(candidate.email or "")
            candidate_emails = {normalize_email(e) for e in (candidate.emails or []) if e}
            candidate_emails.add(candidate_email)
            candidate_emails.discard("")

            email_match = bool(all_emails & candidate_emails)
            if email_match:
                confidence += 30
                match_reasons.append("Совпадение email")
                common_email = list(all_emails & candidate_emails)[0]
                matched_fields['email'] = (normalized_email or list(all_emails)[0], common_email)

            # 3. Проверка телефона (30 баллов)
            candidate_phone = normalize_phone(candidate.phone or "")
            candidate_phones = {normalize_phone(p) for p in (candidate.phones or []) if p}
            candidate_phones.add(candidate_phone)
            candidate_phones.discard("")

            phone_match = bool(all_phones & candidate_phones)
            if phone_match:
                confidence += 30
                match_reasons.append("Совпадение телефона")
                common_phone = list(all_phones & candidate_phones)[0]
                matched_fields['phone'] = (normalized_phone or list(all_phones)[0], common_phone)

            # 3b. Проверка telegram (30 баллов) — сильный личный идентификатор.
            # Раньше telegram не участвовал: два профиля с одним @хэндлом, но без
            # общего телефона/почты, давали лишь +40 за имя (те самые «40%»).
            candidate_telegrams = {normalize_telegram(t) for t in (candidate.telegram_usernames or []) if t}
            candidate_telegrams.discard("")
            tg_common = {
                k for k in (all_telegrams & candidate_telegrams)
                if is_matchable_telegram(k) and len(tg_name_freq.get(k, ())) < TG_COMMON_THRESHOLD
            }
            if tg_common:
                confidence += 30
                match_reasons.append("Совпадение Telegram")
                _k = list(tg_common)[0]
                matched_fields['telegram'] = ((entity.telegram_usernames or [_k])[0], _k)

            # 4. Проверка навыки + компания (20 баллов)
            if entity.company and candidate.company:
                company_match = entity.company.lower().strip() == candidate.company.lower().strip()
                if company_match:
                    source_skills = extract_skills(entity.extra_data or {})
                    candidate_skills = extract_skills(candidate.extra_data or {})
                    skill_similarity, common_skills = calculate_skills_similarity(source_skills, candidate_skills)

                    if skill_similarity > 0.5:  # Более 50% совпадения навыков
                        confidence += 20
                        match_reasons.append(f"Та же компания + похожие навыки")
                        matched_fields['company'] = (entity.company, candidate.company)

            # Добавляем только если есть признаки дубликата
            if confidence >= 30:  # Минимальный порог
                seen_ids.add(candidate.id)
                duplicates.append(DuplicateCandidate(
                    entity_id=candidate.id,
                    entity_name=candidate.name,
                    confidence=min(confidence, 100),
                    match_reasons=match_reasons,
                    matched_fields=matched_fields
                ))

        # Сортируем по убыванию вероятности
        duplicates.sort(key=lambda x: x.confidence, reverse=True)
        return duplicates

    async def merge_entities(
        self,
        db: AsyncSession,
        source_entity: Entity,
        target_entity: Entity,
        keep_source_data: bool = False,
        merged_by_name=None,
    ) -> Entity:
        """
        Объединение двух сущностей (дубликатов).

        Объединяет:
        - Контактные данные (телефоны, email, telegram)
        - Теги
        - extra_data
        - Связанные чаты и звонки переносятся на target

        Args:
            db: Сессия БД
            source_entity: Исходная сущность (будет удалена)
            target_entity: Целевая сущность (останется)
            keep_source_data: Приоритет данных source при конфликтах

        Returns:
            Обновленная целевая сущность
        """
        # Объединяем телефоны
        all_phones = set(target_entity.phones or [])
        all_phones.update(source_entity.phones or [])
        if source_entity.phone:
            all_phones.add(source_entity.phone)
        if target_entity.phone:
            all_phones.add(target_entity.phone)
        target_entity.phones = list(all_phones)

        # Объединяем email
        all_emails = set(target_entity.emails or [])
        all_emails.update(source_entity.emails or [])
        if source_entity.email:
            all_emails.add(source_entity.email)
        if target_entity.email:
            all_emails.add(target_entity.email)
        target_entity.emails = list(all_emails)

        # Объединяем telegram usernames
        all_usernames = set(target_entity.telegram_usernames or [])
        all_usernames.update(source_entity.telegram_usernames or [])
        target_entity.telegram_usernames = list(all_usernames)

        # Объединяем теги
        all_tags = set(target_entity.tags or [])
        all_tags.update(source_entity.tags or [])
        target_entity.tags = list(all_tags)

        # Объединяем extra_data
        target_extra = dict(target_entity.extra_data or {})
        source_extra = dict(source_entity.extra_data or {})

        if keep_source_data:
            # Source имеет приоритет
            merged_extra = {**target_extra, **source_extra}
        else:
            # Target имеет приоритет
            merged_extra = {**source_extra, **target_extra}

        # Специальная обработка для навыков - всегда объединяем
        target_skills = extract_skills(target_extra)
        source_skills = extract_skills(source_extra)
        merged_extra['skills'] = list(target_skills | source_skills)

        # Заметки — объединяем массивы, не теряем заметки источника (дедуп по id).
        def _notes(extra):
            n = extra.get("notes")
            return n if isinstance(n, list) else []
        _t_notes = _notes(target_extra)
        _seen_ids = {n.get("id") for n in _t_notes if isinstance(n, dict) and n.get("id")}
        merged_notes = _t_notes + [
            n for n in _notes(source_extra)
            if not (isinstance(n, dict) and n.get("id") in _seen_ids) and n not in _t_notes
        ]
        if merged_notes:
            merged_extra["notes"] = merged_notes

        target_entity.extra_data = merged_extra

        # Обновляем зарплатные ожидания (берем более широкий диапазон)
        if source_entity.expected_salary_min and target_entity.expected_salary_min:
            target_entity.expected_salary_min = min(
                source_entity.expected_salary_min,
                target_entity.expected_salary_min
            )
        elif source_entity.expected_salary_min:
            target_entity.expected_salary_min = source_entity.expected_salary_min

        if source_entity.expected_salary_max and target_entity.expected_salary_max:
            target_entity.expected_salary_max = max(
                source_entity.expected_salary_max,
                target_entity.expected_salary_max
            )
        elif source_entity.expected_salary_max:
            target_entity.expected_salary_max = source_entity.expected_salary_max

        # Переносим связанные записи
        # Чаты
        from ..models.database import (
            Chat, CallRecording, AnalysisHistory,
            VacancyApplication, Vacancy, StageTransition, EntityAnalysis,
            EntityAIConversation, EntityFile, EntityTransfer,
            FormSubmission, FormDispatch, RecruiterBonus,
            EntityCriteria, PrometheusReviewCache,
            Employee, ParseJob, SharedAccess,
        )
        from sqlalchemy import text as _sql_text

        await db.execute(
            Chat.__table__.update()
            .where(Chat.entity_id == source_entity.id)
            .values(entity_id=target_entity.id)
        )

        # Звонки
        await db.execute(
            CallRecording.__table__.update()
            .where(CallRecording.entity_id == source_entity.id)
            .values(entity_id=target_entity.id)
        )

        # Анализы
        await db.execute(
            AnalysisHistory.__table__.update()
            .where(AnalysisHistory.entity_id == source_entity.id)
            .values(entity_id=target_entity.id)
        )

        # --- Заявки на вакансии: сливаем БЕЗ потери истории ---
        # UNIQUE(vacancy_id, entity_id): две заявки на одну вакансию нельзя.
        # Карта vacancy_id -> ORM-объект выжившего (target).
        target_app_objs = (await db.execute(
            select(VacancyApplication)
            .where(VacancyApplication.entity_id == target_entity.id)
        )).scalars().all()
        target_app_by_vacancy = {a.vacancy_id: a for a in target_app_objs}

        source_apps = (await db.execute(
            select(VacancyApplication)
            .where(VacancyApplication.entity_id == source_entity.id)
        )).scalars().all()

        # Honest vacancy-маппинг контейнера источника: берём самую свежую заявку
        # источника (если есть). Нет заявок → vacancy остаётся null.
        _src_vacancy_id = None
        _src_vacancy_title = None
        if source_apps:
            _primary_app = sorted(source_apps, key=lambda a: a.id, reverse=True)[0]
            _src_vacancy_id = _primary_app.vacancy_id
            _vac_row = (await db.execute(
                select(Vacancy.title).where(Vacancy.id == _src_vacancy_id)
            )).first()
            _src_vacancy_title = _vac_row[0] if _vac_row else None

        for s_app in source_apps:
            t_app = target_app_by_vacancy.get(s_app.vacancy_id)
            if t_app is None:
                # Нет коллизии — переносим заявку на target отдельным блоком.
                s_app.entity_id = target_entity.id
                # Явно перепривязываем переходы этой заявки на target.
                await db.execute(
                    StageTransition.__table__.update()
                    .where(StageTransition.application_id == s_app.id)
                    .values(entity_id=target_entity.id)
                )
                continue
            # Коллизия по вакансии: историю источника перепривязываем к заявке
            # target ДО удаления заявки (иначе FK CASCADE снесёт StageTransition).
            await db.execute(
                StageTransition.__table__.update()
                .where(StageTransition.application_id == s_app.id)
                .values(application_id=t_app.id, entity_id=target_entity.id)
            )
            # Скалярные поля переносим только если у target пусто (не затираем).
            for _field in ("notes", "rating", "interview_summary", "rejection_reason", "source"):
                if getattr(t_app, _field, None) is None and getattr(s_app, _field, None) is not None:
                    setattr(t_app, _field, getattr(s_app, _field))
            await db.delete(s_app)

        # Файлы источника фиксируем ДО перепривязки — чтобы исторический контейнер
        # (merged_from) знал СВОИ файлы/резюме: после merge все EntityFile висят на
        # target, и без этого списка не отличить, чьё это резюме/файл.
        _src_file_ids = [
            r[0] for r in (await db.execute(
                select(EntityFile.id).where(EntityFile.entity_id == source_entity.id)
            )).all()
        ]
        # То же для анкет (FormDispatch): фиксируем id ДО перепривязки, чтобы
        # исторический контейнер знал СВОИ диспатчи. Без этого: FormDispatch.entity_id
        # имеет FK ondelete=CASCADE → при удалении source его анкеты УДАЛЯЛИСЬ из БД
        # (после слияния показывалась только анкета survivor'а). Перепривязываем на
        # target (переживают удаление), а различаем по id (а не entity_id, который
        # у всех станет target).
        _src_dispatch_ids = [
            r[0] for r in (await db.execute(
                select(FormDispatch.id).where(FormDispatch.entity_id == source_entity.id)
            )).all()
        ]

        # Остальную историю переносим на target. VacancyApplication уже обработан
        # выше — здесь его НЕ трогаем. StageTransition тоже обработан явно в цикле
        # source_apps (каждый переход принадлежит конкретной заявке, application_id
        # NOT NULL), поэтому здесь его НЕ включаем.
        for _hist_model in (
            EntityAnalysis,
            EntityAIConversation, EntityFile, EntityTransfer,
            FormSubmission, FormDispatch, RecruiterBonus,
            # SET NULL FK на entities.id — без перепривязки осиротеют после удаления source.
            Employee, ParseJob,
        ):
            await db.execute(
                _hist_model.__table__.update()
                .where(_hist_model.entity_id == source_entity.id)
                .values(entity_id=target_entity.id)
            )

        # One-to-one записи (unique entity_id): приоритет у target, копии source удаляем
        for _uniq_model in (EntityCriteria, PrometheusReviewCache):
            await db.execute(
                _uniq_model.__table__.delete().where(
                    _uniq_model.entity_id == source_entity.id
                )
            )

        # M2M-теги: связи source удаляем (теги уже слиты в target.tags выше)
        await db.execute(
            _sql_text("DELETE FROM entity_tags WHERE entity_id = :sid"),
            {"sid": source_entity.id},
        )

        # SharedAccess (доступ коллег к кандидату) на source: FK ondelete=CASCADE —
        # при удалении source эти строки ПРОПАДУТ, и кандидат «исчезнет» из воронок
        # тех, кому он был расшарен. Перевешиваем доступы на target (entity_id+resource_id),
        # но уникальный ключ (resource_type, resource_id, shared_with, shared_by) столкнётся,
        # если у target уже есть доступ той же пары — такой дубль удаляем, не перевешиваем.
        _src_shares = (await db.execute(
            select(SharedAccess).where(SharedAccess.entity_id == source_entity.id)
        )).scalars().all()
        if _src_shares:
            _tgt_share_pairs = {
                (sa.shared_with_id, sa.shared_by_id)
                for sa in (await db.execute(
                    select(SharedAccess).where(SharedAccess.entity_id == target_entity.id)
                )).scalars().all()
            }
            for _sa in _src_shares:
                if (_sa.shared_with_id, _sa.shared_by_id) in _tgt_share_pairs:
                    await db.delete(_sa)  # у target уже есть такой доступ — дубль убираем
                else:
                    _sa.entity_id = target_entity.id
                    _sa.resource_id = target_entity.id
                    _tgt_share_pairs.add((_sa.shared_with_id, _sa.shared_by_id))

        # Survivor: сохраняем ОБА резюме (своё + источника) — после объединения
        # рядом со старым резюме появляется новое. Плюс снимаем флаг теневого дубля.
        _te = dict(target_entity.extra_data) if isinstance(target_entity.extra_data, dict) else {}
        _se = source_entity.extra_data if isinstance(source_entity.extra_data, dict) else {}

        def _resumes(extra):
            rs = extra.get("resume_demos")
            if isinstance(rs, list) and rs:
                return [r for r in rs if r]
            r = extra.get("resume_demo")
            return [r] if r else []

        combined = _resumes(_te) + _resumes(_se)
        if combined:
            seen = set()
            uniq = []
            for r in combined:
                key = (
                    (r.get("title"), r.get("saved_at")) if isinstance(r, dict) else (str(r), None)
                )
                if key in seen:
                    continue
                seen.add(key)
                uniq.append(r)
            _te["resume_demos"] = uniq

        # Сохраняем резюме/анкету источника отдельным блоком (merged_from), чтобы
        # показать его «вторым резюме» рядом с основным — особенно импортированную
        # анкету (cf:*), которую плоское объединение extra_data затирает.
        # Исторический контейнер источника (плашка): статус-снапшот (read-only),
        # дата добавления, лог+резюме (extra_data БЕЗ своего merged_from), файлы,
        # honest vacancy. FLATTEN: если источник сам был результатом слияния — его
        # контейнеры поднимаем в КОРЕНЬ массива (без матрёшки), чтобы фронт ходил
        # .map() по одномерному списку.
        from datetime import datetime as _dt
        _src_mf = _se.get("merged_from") if isinstance(_se.get("merged_from"), list) else []
        _se_clean = {k: v for k, v in _se.items() if k != "merged_from"}
        _b_container = {
            "entity_id": source_entity.id,
            "name": source_entity.name,
            "status": source_entity.status.value if source_entity.status else None,
            "added_at": source_entity.created_at.isoformat() if source_entity.created_at else None,
            "vacancy_id": _src_vacancy_id,
            "vacancy_title": _src_vacancy_title,
            "merged_at": _dt.utcnow().isoformat(),
            "merged_by_name": merged_by_name,
            "extra_data": _se_clean,
            "file_ids": _src_file_ids,
            "form_dispatch_ids": _src_dispatch_ids,
        }
        _target_mf = target_extra.get("merged_from") if isinstance(target_extra.get("merged_from"), list) else []
        _te["merged_from"] = list(_target_mf) + [_b_container] + list(_src_mf)

        # Импортные прохождения (ClickUp-архив) ОБЪЕДИНЯЕМ в корень (а не только
        # прячем в merged_from-контейнер) — иначе survivor показал бы лишь свои
        # анкеты, а прохождения источника пропали бы с виду. Дедуп по
        # (воронка+рекрутёр+статус). Так склейка разъехавшихся карточек одного
        # человека даёт одну карточку со ВСЕМИ его анкетами.
        _t_parts = _te.get("participations") if isinstance(_te.get("participations"), list) else []
        _s_parts = _se.get("participations") if isinstance(_se.get("participations"), list) else []
        if _s_parts or _t_parts:
            from .clickup_import import merge_participations as _merge_parts
            _te["participations"] = _merge_parts(_t_parts, _s_parts)
        _t_tids = _te.get("clickup_task_ids") if isinstance(_te.get("clickup_task_ids"), list) else []
        _s_tids = _se.get("clickup_task_ids") if isinstance(_se.get("clickup_task_ids"), list) else []
        if _s_tids or _t_tids:
            _te["clickup_task_ids"] = sorted(set(_t_tids) | set(_s_tids))

        _te.pop("hidden_duplicate_id", None)
        target_entity.extra_data = _te

        # Удаляем исходную сущность
        await db.delete(source_entity)

        # Сохраняем изменения
        await db.commit()
        await db.refresh(target_entity)

        logger.info(f"Merged entity {source_entity.id} into {target_entity.id}")

        return target_entity


# Singleton instance
similarity_service = SimilarityService()


@dataclass
class DupMatch:
    """Одно совпадение единого матчера дублей."""
    entity_id: int
    is_archived: bool
    strength: str  # 'source' | 'email' | 'telegram' | 'name' | 'phone'


def build_dup_keys(
    *,
    name: Optional[str] = None,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    telegram: Optional[str] = None,
    source_url: Optional[str] = None,
    emails: Optional[list] = None,
    phones: Optional[list] = None,
    telegram_usernames: Optional[list] = None,
    extra_data: Optional[dict] = None,
) -> dict:
    """Нормализованные ключи дедупа из полей кандидата ИЛИ запроса расширения.
    Единый вход для find_duplicate_matches — чтобы веб/парсер и расширение
    сравнивали дубли по ОДНИМ правилам (email/телефон-10/telegram/ФИО/URL)."""
    ek: Set[str] = set()
    pe = normalize_email(email or "")
    if pe:
        ek.add(pe)
    for e in (emails or []):
        ne = normalize_email(e or "")
        if ne:
            ek.add(ne)

    ph: Set[str] = set()
    pd = normalize_phone(phone or "")
    if len(pd) >= 10:
        ph.add(pd[-10:])
    for p in (phones or []):
        d = normalize_phone(p or "")
        if len(d) >= 10:
            ph.add(d[-10:])

    tg: Set[str] = set()
    nt = normalize_telegram(telegram or "")
    if nt:
        tg.add(nt)
    for t in (telegram_usernames or []):
        n2 = normalize_telegram(t)
        if n2:
            tg.add(n2)

    ed = extra_data if isinstance(extra_data, dict) else {}
    skey = normalize_source_url(source_url or ed.get("source_url") or ed.get("source_key") or "")

    return {
        "emails": ek,
        "phones10": ph,
        "tg_names": tg,
        "name": " ".join((name or "").strip().lower().split()),
        "name_ok": looks_like_person_name(name or ""),
        "source_key": skey,
    }


async def find_duplicate_matches(
    db: AsyncSession,
    org_id: Optional[int],
    keys: dict,
    *,
    exclude_id: Optional[int] = None,
    dismissed: Optional[Set[int]] = None,
) -> List[DupMatch]:
    """ЕДИНЫЙ матчер дублей для всей платформы: активные + архив, нормализованное
    сравнение в Python (портируемо Postgres+SQLite). Возвращает ВСЕ совпадения в
    порядке id-desc с флагом is_archived и типом (strength). Общий источник для
    расширения (check-duplicate, до добавления) и detect_archived_duplicate
    (веб/парсер, флаг после добавления) — раньше это были 3 разошедшихся копии."""
    emails: Set[str] = keys.get("emails") or set()
    phones10: Set[str] = keys.get("phones10") or set()
    tg_names: Set[str] = set(keys.get("tg_names") or set())
    my_name: str = keys.get("name") or ""
    name_ok: bool = bool(keys.get("name_ok"))
    source_key: str = keys.get("source_key") or ""
    dismissed = dismissed or set()

    if not emails and not phones10 and not tg_names and not name_ok and not source_key:
        return []

    # extra_data (полное резюме JSON) грузим ТОЛЬКО когда матчим по source_url —
    # иначе на больших оргах тянули бы килобайты JSON на каждого кандидата зря.
    cols = [
        Entity.id, Entity.name, Entity.email, Entity.phone,
        Entity.telegram_usernames, Entity.is_archived,
    ]
    if source_key:
        cols.append(Entity.extra_data)
    q = select(*cols).where(Entity.type == EntityType.candidate)
    if exclude_id is not None:
        q = q.where(Entity.id != exclude_id)
    if org_id is not None:
        q = q.where(Entity.org_id == org_id)
    q = q.order_by(Entity.id.desc())
    rows = (await db.execute(q)).all()

    # Годность telegram-хэндла — по РАЗНЫМ ИМЕНАМ, а не карточкам. Один человек,
    # разъехавшийся на неск. карточек с одним @хэндлом → одно имя → матчим (иначе
    # 3 карточки давали бы частоту 3 и хэндл отсекался). Мусорный ярлык источника
    # («telegram», «hh_b2b») сидит у МНОГИХ РАЗНЫХ имён → не идентификатор.
    tg_name_freq: dict = {}
    for r in rows:
        _nm = (r[1] or "").strip().lower()
        for t in (r[4] or []):
            k = normalize_telegram(t)
            if k:
                tg_name_freq.setdefault(k, set()).add(_nm)
    for k in tg_names:
        tg_name_freq.setdefault(k, set()).add((my_name or "").strip().lower())
    tg_names = {
        t for t in tg_names
        if is_matchable_telegram(t) and len(tg_name_freq.get(t, ())) < TG_COMMON_THRESHOLD
    }

    out: List[DupMatch] = []
    for r in rows:
        # r: id, name, email, phone, telegram_usernames, is_archived [, extra_data]
        cand_id, cand_name, cand_email, cand_phone, cand_tg, cand_arch = r[0], r[1], r[2], r[3], r[4], r[5]
        cand_extra = r[6] if source_key and len(r) > 6 else None
        if cand_id in dismissed:
            continue
        strength: Optional[str] = None
        if source_key:
            ce = cand_extra if isinstance(cand_extra, dict) else {}
            if normalize_source_url(ce.get("source_url") or ce.get("source_key") or "") == source_key:
                strength = "source"
        if strength is None and emails and normalize_email(cand_email or "") in emails:
            strength = "email"
        if strength is None and tg_names and any(
            normalize_telegram(t) in tg_names for t in (cand_tg or [])
        ):
            strength = "telegram"
        if (
            strength is None and name_ok
            and looks_like_person_name(cand_name or "")
            and names_match_surname_firstname(my_name, cand_name or "")
        ):
            strength = "name"
        if strength is None and phones10:
            d = normalize_phone(cand_phone or "")
            if len(d) >= 10 and d[-10:] in phones10:
                strength = "phone"
        if strength is not None:
            out.append(DupMatch(entity_id=cand_id, is_archived=bool(cand_arch), strength=strength))
    return out


async def detect_archived_duplicate(db: AsyncSession, entity: Entity) -> Optional[int]:
    """Найти дубликат среди кандидатов организации — активные И архив (кроме self),
    совпадение по нормализованному email, телефону (последние 10 цифр) или
    telegram-username. (Раньше сверял только с архивом — теперь и активных между собой.)

    Вызывается на путях создания АКТИВНОГО кандидата (ручное добавление,
    расширение, загрузка резюме), чтобы пометить новый профиль флагом
    extra_data.hidden_duplicate_id. Возвращает id архивного совпадения или None.
    Исключает self и id из extra_data.dismissed_duplicate_ids.
    """
    # Единый матчер (build_dup_keys + find_duplicate_matches) — те же правила,
    # что теперь использует расширение (check-duplicate). Приоритет: сильное
    # совпадение (source/email/telegram/name) в порядке id-desc, иначе первое по
    # телефону — как было в прежней прямой реализации.
    keys = build_dup_keys(
        name=entity.name,
        email=entity.email,
        phone=entity.phone,
        emails=entity.emails,
        phones=entity.phones,
        telegram_usernames=entity.telegram_usernames,
        extra_data=entity.extra_data,
    )
    dismissed: Set[int] = set()
    if isinstance(entity.extra_data, dict):
        for x in (entity.extra_data.get("dismissed_duplicate_ids") or []):
            try:
                dismissed.add(int(x))
            except (TypeError, ValueError):
                continue

    matches = await find_duplicate_matches(
        db, entity.org_id, keys, exclude_id=entity.id, dismissed=dismissed
    )
    match_id = next((m.entity_id for m in matches if m.strength != "phone"), None)
    if match_id is None:
        match_id = next((m.entity_id for m in matches if m.strength == "phone"), None)

    # Помечаем найденного дубля ОБРАТНОЙ ссылкой (его hidden_duplicate_id → наш id),
    # чтобы баннер «Похожий кандидат» появлялся у ОБОИХ профилей пары.
    if match_id is not None and getattr(entity, "id", None):
        dup = (await db.execute(select(Entity).where(Entity.id == match_id))).scalar_one_or_none()
        if dup is not None:
            de = dup.extra_data if isinstance(dup.extra_data, dict) else {}
            ddis = set()
            for x in (de.get("dismissed_duplicate_ids") or []):
                try:
                    ddis.add(int(x))
                except (TypeError, ValueError):
                    pass
            if entity.id not in ddis and de.get("hidden_duplicate_id") != entity.id:
                nde = dict(de)
                nde["hidden_duplicate_id"] = entity.id
                dup.extra_data = nde
    return match_id
