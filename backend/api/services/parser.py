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
from typing import Optional, Dict, Any, Literal
from pydantic import BaseModel
from anthropic import AsyncAnthropic
from .documents import document_parser
from ..config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class ParsedResume(BaseModel):
    """Extracted resume data"""
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    telegram: Optional[str] = None
    position: Optional[str] = None  # Desired position
    company: Optional[str] = None   # Current/last company
    experience_years: Optional[int] = None
    skills: list[str] = []
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str = "RUB"
    location: Optional[str] = None
    summary: Optional[str] = None
    source_url: Optional[str] = None


class ParsedVacancy(BaseModel):
    """Extracted vacancy data"""
    title: str
    description: Optional[str] = None
    requirements: Optional[str] = None
    responsibilities: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str = "RUB"
    location: Optional[str] = None
    employment_type: Optional[str] = None  # full-time, part-time, remote
    experience_level: Optional[str] = None  # junior, middle, senior
    company_name: Optional[str] = None
    source_url: Optional[str] = None


# AI prompts for parsing
RESUME_PROMPT = """Извлеки информацию из резюме кандидата. Верни ТОЛЬКО валидный JSON без markdown форматирования:
{
  "name": "ФИО",
  "email": "email@example.com",
  "phone": "+7...",
  "telegram": "@username",
  "position": "Желаемая должность",
  "company": "Текущая компания",
  "experience_years": 5,
  "skills": ["Python", "FastAPI"],
  "salary_min": 200000,
  "salary_max": 300000,
  "salary_currency": "RUB",
  "location": "Москва",
  "summary": "Краткое описание опыта"
}

Если какое-то поле отсутствует в тексте, установи его в null.
Для experience_years укажи примерное количество лет опыта работы (целое число).
Для skills извлеки все упомянутые навыки и технологии.
Для salary_min и salary_max укажи числа без валюты (только если указаны).

Текст для анализа:
"""

VACANCY_PROMPT = """Извлеки информацию о вакансии. Верни ТОЛЬКО валидный JSON без markdown форматирования:
{
  "title": "Название вакансии",
  "description": "Описание",
  "requirements": "Требования",
  "responsibilities": "Обязанности",
  "salary_min": 200000,
  "salary_max": 350000,
  "salary_currency": "RUB",
  "location": "Москва",
  "employment_type": "full-time",
  "experience_level": "senior",
  "company_name": "Компания"
}

Если какое-то поле отсутствует в тексте, установи его в null.
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
        text = text[:max_length] + "\n...[текст обрезан]"

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


async def parse_vacancy_from_url(url: str) -> ParsedVacancy:
    """Parse vacancy from URL"""
    # Detect source
    source = detect_source(url)

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

    return ParsedVacancy(**data)
