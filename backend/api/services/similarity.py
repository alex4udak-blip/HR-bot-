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

from ..models.database import Entity, EntityType, Organization

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
        org_id: Optional[int] = None
    ) -> List[SimilarCandidate]:
        """
        Поиск похожих кандидатов.

        Args:
            db: Сессия БД
            entity: Исходный кандидат
            limit: Максимальное количество результатов
            org_id: ID организации (если None, ищем в той же организации)

        Returns:
            Список похожих кандидатов с оценкой сходства
        """
        if org_id is None:
            org_id = entity.org_id

        # Извлекаем данные исходного кандидата
        source_skills = extract_skills(entity.extra_data or {})
        source_experience = extract_experience_years(entity.extra_data or {})
        source_location = extract_location(entity.extra_data or {})

        # Загружаем всех кандидатов той же организации (кроме исходного)
        query = select(Entity).where(
            and_(
                Entity.org_id == org_id,
                Entity.id != entity.id,
                Entity.type == EntityType.candidate
            )
        )
        result = await db.execute(query)
        candidates = result.scalars().all()

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
            match_reasons=match_reasons
        )

    async def detect_duplicates(
        self,
        db: AsyncSession,
        entity: Entity,
        org_id: Optional[int] = None
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

        Returns:
            Список возможных дубликатов с вероятностью
        """
        if org_id is None:
            org_id = entity.org_id

        duplicates: List[DuplicateCandidate] = []
        seen_ids: Set[int] = {entity.id}

        # Генерируем варианты имени с транслитерацией
        name_variants = generate_name_variants(entity.name)

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

        # Загружаем всех кандидатов организации
        query = select(Entity).where(
            and_(
                Entity.org_id == org_id,
                Entity.id != entity.id
            )
        )
        result = await db.execute(query)
        candidates = result.scalars().all()

        for candidate in candidates:
            if candidate.id in seen_ids:
                continue

            confidence = 0
            match_reasons = []
            matched_fields: Dict[str, Tuple[str, str]] = {}

            # 1. Проверка имени (40 баллов)
            candidate_name_variants = generate_name_variants(candidate.name)
            name_match = bool(name_variants & candidate_name_variants)
            if name_match:
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
        keep_source_data: bool = False
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
        from ..models.database import Chat, CallRecording, AnalysisHistory

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

        # Удаляем исходную сущность
        await db.delete(source_entity)

        # Сохраняем изменения
        await db.commit()
        await db.refresh(target_entity)

        logger.info(f"Merged entity {source_entity.id} into {target_entity.id}")

        return target_entity


# Singleton instance
similarity_service = SimilarityService()
