"""
Сервис парсинга резюме с использованием AI.

Извлекает структурированные данные из резюме в форматах PDF, DOC, DOCX.
Использует Anthropic Claude API для интеллектуального парсинга.
"""

import logging
import json
import re
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, asdict
from anthropic import AsyncAnthropic

from ..config import get_settings
from .documents import document_parser

logger = logging.getLogger("hr-analyzer.resume-parser")
settings = get_settings()


@dataclass
class ParsedResume:
    """Структурированные данные из резюме."""
    # Основные данные
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    telegram: Optional[str] = None

    # Профессиональные данные
    position: Optional[str] = None  # Желаемая должность
    company: Optional[str] = None  # Текущая/последняя компания
    experience_years: Optional[int] = None  # Общий опыт в годах

    # Зарплатные ожидания
    expected_salary_min: Optional[int] = None
    expected_salary_max: Optional[int] = None
    expected_salary_currency: str = "RUB"

    # Навыки и образование
    skills: List[str] = None
    education: List[Dict[str, str]] = None  # [{institution, degree, year}]
    experience: List[Dict[str, str]] = None  # [{company, position, period, description}]
    languages: List[Dict[str, str]] = None  # [{language, level}]

    # Дополнительные данные
    location: Optional[str] = None
    about: Optional[str] = None  # Краткое описание / о себе
    links: List[str] = None  # LinkedIn, GitHub, портфолио

    # Метаданные парсинга
    raw_text: Optional[str] = None
    parse_confidence: float = 0.0  # Уверенность парсинга 0-1
    parse_warnings: List[str] = None

    def __post_init__(self):
        """Инициализация списков по умолчанию."""
        if self.skills is None:
            self.skills = []
        if self.education is None:
            self.education = []
        if self.experience is None:
            self.experience = []
        if self.languages is None:
            self.languages = []
        if self.links is None:
            self.links = []
        if self.parse_warnings is None:
            self.parse_warnings = []

    def to_dict(self) -> Dict[str, Any]:
        """Конвертация в словарь для API."""
        return asdict(self)

    def to_entity_data(self) -> Dict[str, Any]:
        """
        Конвертация в формат данных для создания Entity.
        Возвращает поля, совместимые с EntityCreate.
        """
        # Формируем extra_data с дополнительной информацией
        extra_data = {}

        if self.skills:
            extra_data["skills"] = self.skills
        if self.education:
            extra_data["education"] = self.education
        if self.experience:
            extra_data["experience"] = self.experience
        if self.languages:
            extra_data["languages"] = self.languages
        if self.location:
            extra_data["location"] = self.location
        if self.about:
            extra_data["about"] = self.about
        if self.links:
            extra_data["links"] = self.links
        if self.experience_years:
            extra_data["experience_years"] = self.experience_years

        # Собираем telegram usernames
        telegram_usernames = []
        if self.telegram:
            # Нормализуем telegram username (убираем @ и t.me/)
            tg = self.telegram.lower().strip()
            tg = tg.replace("@", "").replace("https://t.me/", "").replace("t.me/", "")
            if tg:
                telegram_usernames.append(tg)

        # Собираем emails
        emails = []
        if self.email:
            emails.append(self.email.lower().strip())

        # Собираем phones
        phones = []
        if self.phone:
            phones.append(self.phone.strip())

        return {
            "name": self.name or "Неизвестный кандидат",
            "phone": self.phone,
            "email": self.email,
            "telegram_usernames": telegram_usernames,
            "emails": emails,
            "phones": phones,
            "position": self.position,
            "company": self.company,
            "expected_salary_min": self.expected_salary_min,
            "expected_salary_max": self.expected_salary_max,
            "expected_salary_currency": self.expected_salary_currency,
            "extra_data": extra_data,
            "tags": ["resume_parsed"] + (self.skills[:5] if self.skills else [])
        }


# Промпт для AI парсинга резюме
RESUME_PARSE_PROMPT = """Ты - эксперт по анализу резюме. Проанализируй следующий текст резюме и извлеки структурированные данные.

ТЕКСТ РЕЗЮМЕ:
---
{resume_text}
---

Извлеки следующую информацию в формате JSON:

{{
    "name": "ФИО кандидата",
    "phone": "Телефон в исходном формате",
    "email": "Email адрес",
    "telegram": "Telegram username или ссылка (если есть)",
    "position": "Желаемая должность",
    "company": "Текущая или последняя компания",
    "experience_years": число лет опыта (целое число или null),
    "expected_salary_min": минимальная ожидаемая зарплата (число или null),
    "expected_salary_max": максимальная ожидаемая зарплата (число или null),
    "expected_salary_currency": "RUB" или "USD" или "EUR",
    "skills": ["навык1", "навык2", ...],
    "education": [
        {{"institution": "ВУЗ", "degree": "Степень/специальность", "year": "Год окончания"}}
    ],
    "experience": [
        {{"company": "Компания", "position": "Должность", "period": "Период работы", "description": "Краткое описание"}}
    ],
    "languages": [
        {{"language": "Язык", "level": "Уровень"}}
    ],
    "location": "Город/страна проживания",
    "about": "Краткое описание о себе (до 300 символов)",
    "links": ["ссылка на LinkedIn", "ссылка на GitHub", ...],
    "parse_confidence": число от 0 до 1 (насколько уверенно удалось распарсить),
    "parse_warnings": ["предупреждение1", ...]
}}

ПРАВИЛА:
1. Если информация отсутствует, укажи null (не пустую строку)
2. Для зарплаты конвертируй в числа без валютных символов (100000, не "100 000 руб")
3. Если указан диапазон зарплаты "от X до Y", заполни оба поля min и max
4. Если указано только "от X", заполни только min
5. skills - массив ключевых навыков (технологии, инструменты, языки программирования)
6. experience - отсортируй от последнего к первому месту работы
7. parse_confidence: 1.0 если всё чётко, 0.5 если есть сомнения, ниже если данных мало
8. parse_warnings - укажи проблемы (например: "Не найден телефон", "Неоднозначный формат даты")

Верни ТОЛЬКО валидный JSON без дополнительного текста."""


class ResumeParserService:
    """Сервис парсинга резюме."""

    def __init__(self):
        self._client = None
        self.model = "claude-sonnet-4-20250514"

    @property
    def client(self) -> AsyncAnthropic:
        """Ленивая инициализация клиента Anthropic."""
        if self._client is None:
            if not settings.anthropic_api_key:
                raise ValueError("ANTHROPIC_API_KEY не настроен!")
            self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        return self._client

    async def extract_text_from_file(
        self,
        file_bytes: bytes,
        filename: str
    ) -> str:
        """
        Извлечение текста из файла резюме.

        Поддерживает форматы: PDF, DOC, DOCX, TXT, RTF.
        Использует существующий DocumentParser.

        Args:
            file_bytes: Содержимое файла в байтах
            filename: Имя файла с расширением

        Returns:
            Извлечённый текст

        Raises:
            ValueError: Если формат файла не поддерживается или парсинг не удался
        """
        # Проверяем расширение
        ext = filename.lower().split('.')[-1] if '.' in filename else ''
        supported_extensions = {'pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'}

        if ext not in supported_extensions:
            raise ValueError(
                f"Неподдерживаемый формат файла: .{ext}. "
                f"Поддерживаются: {', '.join(supported_extensions)}"
            )

        # Используем существующий DocumentParser
        result = await document_parser.parse(file_bytes, filename)

        if result.status == "failed":
            raise ValueError(f"Ошибка парсинга файла: {result.error}")

        if not result.content or not result.content.strip():
            raise ValueError("Не удалось извлечь текст из файла. Файл пуст или защищён.")

        logger.info(f"Извлечён текст из {filename}: {len(result.content)} символов")
        return result.content

    async def parse_resume_with_ai(self, text: str) -> ParsedResume:
        """
        AI-парсинг структуры резюме.

        Использует Claude API для извлечения структурированных данных.

        Args:
            text: Текст резюме

        Returns:
            ParsedResume с извлечёнными данными
        """
        if not text or len(text.strip()) < 50:
            return ParsedResume(
                parse_confidence=0.0,
                parse_warnings=["Текст резюме слишком короткий для анализа"]
            )

        # Ограничиваем длину текста для API
        max_text_length = 50000
        if len(text) > max_text_length:
            text = text[:max_text_length]
            logger.warning(f"Текст резюме обрезан до {max_text_length} символов")

        prompt = RESUME_PARSE_PROMPT.format(resume_text=text)

        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}]
            )

            response_text = response.content[0].text.strip()

            # Извлекаем JSON из ответа
            parsed_data = self._extract_json(response_text)

            if not parsed_data:
                logger.warning("AI не вернул валидный JSON")
                return ParsedResume(
                    raw_text=text[:1000],
                    parse_confidence=0.0,
                    parse_warnings=["AI не смог распарсить резюме"]
                )

            # Создаём ParsedResume из данных
            resume = self._dict_to_parsed_resume(parsed_data)
            resume.raw_text = text[:2000]  # Сохраняем часть текста для отладки

            return resume

        except Exception as e:
            logger.error(f"Ошибка AI парсинга: {e}")
            return ParsedResume(
                raw_text=text[:1000],
                parse_confidence=0.0,
                parse_warnings=[f"Ошибка AI парсинга: {str(e)}"]
            )

    def _extract_json(self, text: str) -> Optional[Dict[str, Any]]:
        """Извлечение JSON из текста ответа AI."""
        # Пробуем напрямую
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Ищем JSON в markdown блоке
        json_match = re.search(r'```(?:json)?\s*\n?([\s\S]*?)\n?```', text)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        # Ищем JSON по фигурным скобкам
        brace_match = re.search(r'\{[\s\S]*\}', text)
        if brace_match:
            try:
                return json.loads(brace_match.group(0))
            except json.JSONDecodeError:
                pass

        return None

    def _dict_to_parsed_resume(self, data: Dict[str, Any]) -> ParsedResume:
        """Конвертация словаря в ParsedResume с валидацией."""

        def safe_int(value: Any) -> Optional[int]:
            """Безопасная конвертация в int."""
            if value is None:
                return None
            if isinstance(value, int):
                return value
            if isinstance(value, float):
                return int(value)
            if isinstance(value, str):
                # Удаляем всё кроме цифр
                cleaned = re.sub(r'[^\d]', '', value)
                return int(cleaned) if cleaned else None
            return None

        def safe_float(value: Any, default: float = 0.0) -> float:
            """Безопасная конвертация в float."""
            if value is None:
                return default
            try:
                return float(value)
            except (ValueError, TypeError):
                return default

        def safe_list(value: Any) -> List:
            """Безопасная конвертация в список."""
            if value is None:
                return []
            if isinstance(value, list):
                return value
            return []

        def safe_str(value: Any) -> Optional[str]:
            """Безопасная конвертация в строку."""
            if value is None:
                return None
            if isinstance(value, str):
                return value.strip() if value.strip() else None
            return str(value).strip() or None

        return ParsedResume(
            name=safe_str(data.get("name")),
            phone=safe_str(data.get("phone")),
            email=safe_str(data.get("email")),
            telegram=safe_str(data.get("telegram")),
            position=safe_str(data.get("position")),
            company=safe_str(data.get("company")),
            experience_years=safe_int(data.get("experience_years")),
            expected_salary_min=safe_int(data.get("expected_salary_min")),
            expected_salary_max=safe_int(data.get("expected_salary_max")),
            expected_salary_currency=safe_str(data.get("expected_salary_currency")) or "RUB",
            skills=safe_list(data.get("skills")),
            education=safe_list(data.get("education")),
            experience=safe_list(data.get("experience")),
            languages=safe_list(data.get("languages")),
            location=safe_str(data.get("location")),
            about=safe_str(data.get("about")),
            links=safe_list(data.get("links")),
            parse_confidence=safe_float(data.get("parse_confidence"), 0.5),
            parse_warnings=safe_list(data.get("parse_warnings"))
        )

    async def parse_resume(
        self,
        file_bytes: bytes,
        filename: str
    ) -> ParsedResume:
        """
        Полный парсинг резюме: извлечение текста + AI-анализ.

        Args:
            file_bytes: Содержимое файла
            filename: Имя файла

        Returns:
            ParsedResume со всеми извлечёнными данными
        """
        # Шаг 1: Извлечение текста
        text = await self.extract_text_from_file(file_bytes, filename)

        # Шаг 2: AI парсинг
        resume = await self.parse_resume_with_ai(text)

        return resume


# Глобальный экземпляр сервиса
resume_parser_service = ResumeParserService()
