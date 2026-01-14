"""
Universal parser service for extracting structured data from:
- PDF resumes
- URLs (hh.ru, LinkedIn, SuperJob, Habr Career)
- Job vacancy pages
"""
import httpx
import re
import json
import logging
from typing import Optional, Dict, Any, Literal, Tuple
from pydantic import BaseModel
from anthropic import AsyncAnthropic
from .documents import document_parser
from .hh_api import parse_vacancy_via_api, HHVacancy
from ..config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class ParsedResume(BaseModel):
    """Extracted resume data (расширенная версия для URL парсинга)"""
    # Основные данные
    name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None

    # Контакты
    email: Optional[str] = None
    emails: list[str] = []
    phone: Optional[str] = None
    phones: list[str] = []
    telegram: Optional[str] = None
    whatsapp: Optional[str] = None

    # Персональные данные
    birth_date: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    citizenship: Optional[str] = None
    relocation: Optional[str] = None

    # Профессиональные данные
    position: Optional[str] = None  # Desired position
    specialization: Optional[str] = None
    company: Optional[str] = None   # Current/last company
    experience_years: Optional[int] = None

    # Навыки
    skills: list[str] = []
    skills_detailed: list[dict] = []

    # Образование и опыт
    education: list[dict] = []
    experience: list[dict] = []
    languages: list[dict] = []
    courses: list[dict] = []

    # Зарплата
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str = "RUB"

    # Формат работы
    employment_type: Optional[str] = None
    schedule: Optional[str] = None

    # Локация
    location: Optional[str] = None
    metro: Optional[str] = None

    # Дополнительно
    summary: Optional[str] = None
    about: Optional[str] = None
    achievements: list[str] = []

    # Ссылки
    source_url: Optional[str] = None
    linkedin: Optional[str] = None
    github: Optional[str] = None
    portfolio: Optional[str] = None
    links: list[str] = []

    # Метаданные
    parse_confidence: float = 0.0
    parse_warnings: list[str] = []


class ParsedVacancy(BaseModel):
    """Extracted vacancy data"""
    title: str
    description: Optional[str] = None
    requirements: Optional[str] = None
    responsibilities: Optional[str] = None
    skills: list[str] = []  # Key skills/technologies required
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str = "RUB"
    location: Optional[str] = None
    employment_type: Optional[str] = None  # full-time, part-time, remote
    experience_level: Optional[str] = None  # junior, middle, senior
    company_name: Optional[str] = None
    source_url: Optional[str] = None


# AI prompts for parsing
RESUME_PROMPT = """Ты - HR-эксперт. Извлеки ВСЮ информацию из резюме кандидата.
Верни ТОЛЬКО валидный JSON без markdown форматирования:

{
  "name": "Полное ФИО",
  "first_name": "Имя",
  "last_name": "Фамилия",
  "email": "email@example.com",
  "emails": ["все найденные email"],
  "phone": "+7...",
  "phones": ["все найденные телефоны"],
  "telegram": "@username или t.me/...",
  "whatsapp": "номер WhatsApp",
  "birth_date": "дата рождения",
  "age": 30,
  "gender": "male/female",
  "citizenship": "гражданство",
  "relocation": "yes/no/possible",
  "position": "Желаемая должность",
  "specialization": "Специализация",
  "company": "Текущая компания",
  "experience_years": 5,
  "skills": ["Python", "FastAPI", ...],
  "skills_detailed": [{"name": "Python", "level": "expert", "years": 5}],
  "education": [{"institution": "ВУЗ", "degree": "Степень", "year": "2020"}],
  "experience": [{"company": "Компания", "position": "Должность", "period": "2020-2023", "description": "..."}],
  "languages": [{"language": "English", "level": "B2"}],
  "courses": [{"name": "Курс", "organization": "Организация", "year": "2022"}],
  "salary_min": 200000,
  "salary_max": 300000,
  "salary_currency": "RUB",
  "employment_type": "full-time/part-time/project",
  "schedule": "remote/office/hybrid",
  "location": "Город",
  "metro": "Станция метро",
  "about": "О себе",
  "achievements": ["достижение1", "достижение2"],
  "linkedin": "ссылка на LinkedIn",
  "github": "ссылка на GitHub",
  "portfolio": "ссылка на портфолио",
  "links": ["все найденные ссылки"],
  "parse_confidence": 0.9,
  "parse_warnings": []
}

ПРАВИЛА:
- Если поле отсутствует - null (не пустую строку)
- Зарплата - числа без символов валюты
- skills - массив ВСЕХ навыков и технологий
- experience - от последнего места к первому
- parse_confidence: 0.9+ если всё найдено, 0.5-0.8 если частично, <0.5 если мало данных
- parse_warnings - список проблем ("Не найден email", "Нет опыта работы" и т.д.)

Текст для анализа:
"""

VACANCY_PROMPT = """Извлеки информацию о вакансии. Верни ТОЛЬКО валидный JSON без markdown форматирования:
{
  "title": "Название вакансии",
  "description": "Общее описание вакансии",
  "requirements": "Требования к кандидату (образование, опыт, качества)",
  "responsibilities": "Обязанности на должности",
  "skills": ["Python", "FastAPI", "PostgreSQL"],
  "salary_min": 200000,
  "salary_max": 350000,
  "salary_currency": "RUB",
  "location": "Москва",
  "employment_type": "full-time",
  "experience_level": "senior",
  "company_name": "Компания"
}

ВАЖНО:
- skills - это список конкретных технологий и навыков (массив строк)
- requirements - это общие требования (образование, опыт работы, soft skills) в виде текста
- responsibilities - это обязанности и задачи на позиции
- Не путай skills с requirements!

Если какое-то поле отсутствует в тексте, установи его в null (для skills - пустой массив []).
Для employment_type используй: full-time, part-time, remote, hybrid.
Для experience_level используй: intern, junior, middle, senior, lead.
Для salary_min и salary_max укажи числа без валюты (только если указаны).

Текст для анализа:
"""


async def fetch_url_content(url: str) -> str:
    """Fetch and extract text content from URL"""
    async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
        response = await client.get(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        })
        response.raise_for_status()
        return response.text


def detect_source(url: str) -> str:
    """Detect source type from URL"""
    url_lower = url.lower()
    if 'hh.ru' in url_lower:
        return 'hh'
    elif 'linkedin.com' in url_lower:
        return 'linkedin'
    elif 'superjob.ru' in url_lower:
        return 'superjob'
    elif 'career.habr.com' in url_lower or 'habr.com/career' in url_lower:
        return 'habr'
    return 'unknown'


def extract_text_from_html(html: str) -> str:
    """Extract readable text from HTML content"""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, 'html.parser')

    # Remove script and style elements
    for element in soup(['script', 'style', 'nav', 'footer', 'header', 'aside']):
        element.decompose()

    # Get text
    text = soup.get_text(separator='\n')

    # Clean up whitespace
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    text = '\n'.join(lines)

    # Truncate if too long
    max_length = 15000
    if len(text) > max_length:
        text = text[:max_length] + "\n...[text truncated]"

    return text


def _get_ai_client() -> AsyncAnthropic:
    """Get AI client for parsing"""
    if not settings.anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY is not configured")
    return AsyncAnthropic(api_key=settings.anthropic_api_key)


def _clean_json_response(response_text: str) -> str:
    """Clean AI response to extract valid JSON"""
    # Remove markdown code blocks if present
    if '```json' in response_text:
        match = re.search(r'```json\s*(.*?)\s*```', response_text, re.DOTALL)
        if match:
            return match.group(1).strip()
    if '```' in response_text:
        match = re.search(r'```\s*(.*?)\s*```', response_text, re.DOTALL)
        if match:
            return match.group(1).strip()

    # Try to find JSON object in response
    # Find first { and last }
    start = response_text.find('{')
    end = response_text.rfind('}')
    if start != -1 and end != -1 and end > start:
        return response_text[start:end + 1]

    return response_text


async def parse_with_ai(
    content: str,
    parse_type: Literal["resume", "vacancy"],
    source: str = "unknown"
) -> Dict[str, Any]:
    """Use Claude AI to extract structured data from content"""
    client = _get_ai_client()

    # Select prompt based on type
    if parse_type == "resume":
        prompt = RESUME_PROMPT + content
    else:
        prompt = VACANCY_PROMPT + content

    # Add source context for better parsing
    source_context = ""
    if source != "unknown":
        source_hints = {
            "hh": "Это резюме/вакансия с сайта hh.ru (HeadHunter).",
            "linkedin": "Это профиль/вакансия с LinkedIn.",
            "superjob": "Это резюме/вакансия с сайта SuperJob.",
            "habr": "Это профиль/вакансия с Habr Career.",
        }
        source_context = source_hints.get(source, "")
        if source_context:
            prompt = source_context + "\n\n" + prompt

    try:
        response = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )

        response_text = response.content[0].text

        # Clean and parse JSON response
        json_str = _clean_json_response(response_text)
        result = json.loads(json_str)

        return result

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI response as JSON: {e}")
        logger.debug(f"Raw response: {response_text[:500] if response_text else 'empty'}")
        raise ValueError(f"AI returned invalid JSON: {str(e)}")
    except Exception as e:
        logger.error(f"AI parsing failed: {e}")
        raise


async def parse_resume_from_pdf(file_content: bytes, filename: str) -> ParsedResume:
    """Parse resume from PDF file using AI"""
    # Use existing DocumentParser to extract text
    parse_result = await document_parser.parse(file_content, filename)

    if parse_result.status == "failed":
        raise ValueError(f"Failed to parse document: {parse_result.error}")

    if not parse_result.content or not parse_result.content.strip():
        raise ValueError("Document appears to be empty or unreadable")

    # Use AI to extract structured data
    data = await parse_with_ai(parse_result.content, "resume")

    return ParsedResume(**data)


async def parse_resume_from_url(url: str) -> ParsedResume:
    """Parse resume from URL (hh.ru, linkedin, etc)"""
    # Detect source
    source = detect_source(url)

    # Fetch page content
    html_content = await fetch_url_content(url)

    # Extract text from HTML
    text_content = extract_text_from_html(html_content)

    if not text_content or not text_content.strip():
        raise ValueError("Could not extract text from URL")

    # Use AI to extract structured data
    data = await parse_with_ai(text_content, "resume", source)
    data["source_url"] = url

    return ParsedResume(**data)


async def parse_vacancy_from_url(url: str) -> Tuple[ParsedVacancy, str]:
    """Parse vacancy from URL - uses API when available, falls back to AI.

    Args:
        url: The vacancy URL to parse

    Returns:
        Tuple of (ParsedVacancy, method) where method is "api" or "ai"
    """
    # Detect source
    source = detect_source(url)

    # Try hh.ru API first (free and instant!)
    if source == "hh":
        logger.info(f"Trying hh.ru API for: {url}")
        api_result = await parse_vacancy_via_api(url)
        if api_result:
            logger.info(f"Successfully parsed via hh.ru API: {api_result.title}")
            vacancy = ParsedVacancy(
                title=api_result.title,
                description=api_result.description,
                # Note: hh.ru API doesn't provide separate requirements/responsibilities fields
                # The description contains all text; user can split manually if needed
                requirements=None,
                responsibilities=None,
                skills=api_result.skills,  # Keep skills as skills, not requirements
                salary_min=api_result.salary_min,
                salary_max=api_result.salary_max,
                salary_currency=api_result.salary_currency,
                location=api_result.location,
                employment_type=api_result.employment_type,
                experience_level=api_result.experience_level,
                company_name=api_result.company_name,
                source_url=url,
            )
            return vacancy, "api"
        logger.warning("hh.ru API failed, falling back to AI parsing")

    # Fallback to AI parsing
    # Fetch page content
    html_content = await fetch_url_content(url)

    # Extract text from HTML
    text_content = extract_text_from_html(html_content)

    if not text_content or not text_content.strip():
        raise ValueError("Could not extract text from URL")

    # Use AI to extract structured data
    data = await parse_with_ai(text_content, "vacancy", source)
    data["source_url"] = url

    # Ensure title is present (required field)
    if not data.get("title"):
        data["title"] = "Untitled Vacancy"

    return ParsedVacancy(**data), "ai"
