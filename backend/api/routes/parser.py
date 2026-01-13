"""
API routes for universal parser service.
Parses resumes and vacancies from PDFs and URLs.

Security features:
- All endpoints require authentication
- Rate limiting: 5 requests per minute per user
- URL validation: Only allowed domains (hh.ru, linkedin.com, superjob.ru, habr career)
- URL sanitization: Prevents prompt injection attacks
- Comprehensive logging of all parsing requests
"""
import logging
import re
from urllib.parse import urlparse, urlunparse
from fastapi import APIRouter, HTTPException, UploadFile, File, Depends, Request
from pydantic import BaseModel
from typing import Optional

from ..services.parser import (
    ParsedResume,
    ParsedVacancy,
    parse_resume_from_pdf,
    parse_resume_from_url,
    parse_vacancy_from_url,
    detect_source,
)
from ..services.auth import get_current_user
from ..models.database import User
from ..limiter import limiter

logger = logging.getLogger(__name__)

router = APIRouter()

# Allowed domains for URL parsing (case-insensitive)
ALLOWED_DOMAINS = {
    'hh.ru',
    'linkedin.com',
    'superjob.ru',
    'career.habr.com',
    'habr.com',
}


def validate_and_sanitize_url(url: str) -> str:
    """
    Validate URL and check if it's from an allowed domain.
    Sanitizes URL to prevent prompt injection attacks.

    Args:
        url: The URL to validate and sanitize

    Returns:
        Sanitized URL string

    Raises:
        HTTPException: If URL is invalid or from a disallowed domain
    """
    if not url or not url.strip():
        raise HTTPException(status_code=400, detail="URL is required")

    url = url.strip()

    # Add https:// if no protocol specified
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url

    # Parse the URL to validate structure
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid URL format"
        )

    # Validate URL has required components
    if not parsed.scheme or not parsed.netloc:
        raise HTTPException(
            status_code=400,
            detail="Invalid URL format: missing scheme or host"
        )

    # Ensure scheme is http or https
    if parsed.scheme not in ('http', 'https'):
        raise HTTPException(
            status_code=400,
            detail="Invalid URL scheme: only HTTP and HTTPS are allowed"
        )

    # Extract the domain (handle subdomains)
    hostname = parsed.netloc.lower()

    # Remove port if present
    if ':' in hostname:
        hostname = hostname.split(':')[0]

    # Check if domain is in allowed list (including subdomains)
    is_allowed = False
    for allowed_domain in ALLOWED_DOMAINS:
        if hostname == allowed_domain or hostname.endswith('.' + allowed_domain):
            is_allowed = True
            break

    if not is_allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Domain not allowed. Supported domains: {', '.join(sorted(ALLOWED_DOMAINS))}"
        )

    # Sanitize URL by removing potentially dangerous characters
    # This prevents prompt injection via URL parameters
    sanitized_path = re.sub(r'[<>"\']', '', parsed.path)
    sanitized_query = re.sub(r'[<>"\']', '', parsed.query) if parsed.query else ''
    sanitized_fragment = re.sub(r'[<>"\']', '', parsed.fragment) if parsed.fragment else ''

    # Reconstruct URL with sanitized components
    sanitized_url = urlunparse((
        parsed.scheme,
        parsed.netloc,
        sanitized_path,
        parsed.params,
        sanitized_query,
        sanitized_fragment
    ))

    return sanitized_url


def _get_rate_limit_key(request: Request) -> str:
    """Get rate limit key based on authenticated user ID."""
    # The user is injected via Depends, we need to extract it from request state
    # For rate limiting, we use user_id if available, otherwise IP
    user = getattr(request.state, '_rate_limit_user', None)
    if user:
        return f"parser_user_{user.id}"
    return f"parser_ip_{request.client.host if request.client else 'unknown'}"


class UrlRequest(BaseModel):
    """Request body for URL parsing"""
    url: str


class ParseResumeResponse(BaseModel):
    """Response for resume parsing"""
    success: bool
    data: Optional[ParsedResume] = None
    source: Optional[str] = None
    error: Optional[str] = None


class ParseVacancyResponse(BaseModel):
    """Response for vacancy parsing"""
    success: bool
    data: Optional[ParsedVacancy] = None
    source: Optional[str] = None
    method: Optional[str] = None  # "api" or "ai"
    error: Optional[str] = None


@router.post("/resume/url", response_model=ParseResumeResponse)
@limiter.limit("5/minute", key_func=_get_rate_limit_key)
async def parse_resume_url(
    request: Request,
    body: UrlRequest,
    current_user: User = Depends(get_current_user)
):
    """
    Parse resume from URL.

    Supported sources:
    - hh.ru (HeadHunter)
    - linkedin.com
    - superjob.ru
    - career.habr.com

    Requires authentication and is rate-limited to 5 requests per minute.

    Returns structured resume data extracted using AI.
    """
    # Store user in request state for rate limiter
    request.state._rate_limit_user = current_user

    try:
        # Validate and sanitize URL
        url = validate_and_sanitize_url(body.url)

        source = detect_source(url)

        # Log parsing request with user info
        logger.info(
            f"Resume parsing requested | user_id={current_user.id} | "
            f"user_email={current_user.email} | url={url} | source={source}"
        )

        resume = await parse_resume_from_url(url)

        # Log successful parsing
        logger.info(
            f"Resume parsing SUCCESS | user_id={current_user.id} | "
            f"url={url} | source={source}"
        )

        return ParseResumeResponse(
            success=True,
            data=resume,
            source=source
        )

    except HTTPException:
        # Log authentication/validation failures
        logger.warning(
            f"Resume parsing FAILED (HTTP error) | user_id={current_user.id} | "
            f"url={body.url}"
        )
        raise
    except ValueError as e:
        logger.warning(
            f"Resume parsing FAILED | user_id={current_user.id} | "
            f"url={body.url} | error={e}"
        )
        return ParseResumeResponse(
            success=False,
            error=str(e)
        )
    except Exception as e:
        logger.error(
            f"Resume parsing ERROR | user_id={current_user.id} | "
            f"url={body.url} | error={e}"
        )
        return ParseResumeResponse(
            success=False,
            error=f"Failed to parse resume: {str(e)}"
        )


@router.post("/resume/file", response_model=ParseResumeResponse)
@limiter.limit("5/minute", key_func=_get_rate_limit_key)
async def parse_resume_file(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """
    Parse resume from uploaded file.

    Supported formats:
    - PDF (.pdf)
    - Word documents (.docx, .doc)
    - Images (.jpg, .png) - OCR extraction
    - Text files (.txt, .rtf)

    Requires authentication and is rate-limited to 5 requests per minute.

    Returns structured resume data extracted using AI.
    """
    # Store user in request state for rate limiter
    request.state._rate_limit_user = current_user

    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="File is required")

        # Sanitize filename to prevent path traversal
        safe_filename = re.sub(r'[<>:"/\\|?*]', '_', file.filename)

        # Check file extension
        allowed_extensions = {
            'pdf', 'docx', 'doc', 'txt', 'rtf',
            'jpg', 'jpeg', 'png', 'gif', 'webp'
        }
        ext = safe_filename.rsplit('.', 1)[-1].lower() if '.' in safe_filename else ''

        if ext not in allowed_extensions:
            logger.warning(
                f"Resume file REJECTED | user_id={current_user.id} | "
                f"filename={safe_filename} | reason=unsupported_format"
            )
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file format: {ext}. Allowed: {', '.join(sorted(allowed_extensions))}"
            )

        # Read file content
        file_content = await file.read()

        if not file_content:
            logger.warning(
                f"Resume file REJECTED | user_id={current_user.id} | "
                f"filename={safe_filename} | reason=empty_file"
            )
            raise HTTPException(status_code=400, detail="File is empty")

        # Check file size (max 20MB)
        max_size = 20 * 1024 * 1024
        if len(file_content) > max_size:
            logger.warning(
                f"Resume file REJECTED | user_id={current_user.id} | "
                f"filename={safe_filename} | reason=file_too_large | size={len(file_content)}"
            )
            raise HTTPException(
                status_code=400,
                detail=f"File too large: {len(file_content) / 1024 / 1024:.1f}MB (max 20MB)"
            )

        # Log parsing request
        logger.info(
            f"Resume file parsing requested | user_id={current_user.id} | "
            f"user_email={current_user.email} | filename={safe_filename} | "
            f"size={len(file_content)} bytes"
        )

        resume = await parse_resume_from_pdf(file_content, safe_filename)

        # Log successful parsing
        logger.info(
            f"Resume file parsing SUCCESS | user_id={current_user.id} | "
            f"filename={safe_filename}"
        )

        return ParseResumeResponse(
            success=True,
            data=resume,
            source="file"
        )

    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(
            f"Resume file parsing FAILED | user_id={current_user.id} | "
            f"filename={file.filename} | error={e}"
        )
        return ParseResumeResponse(
            success=False,
            error=str(e)
        )
    except Exception as e:
        logger.error(
            f"Resume file parsing ERROR | user_id={current_user.id} | "
            f"filename={file.filename} | error={e}"
        )
        return ParseResumeResponse(
            success=False,
            error=f"Failed to parse resume: {str(e)}"
        )


@router.post("/vacancy/url", response_model=ParseVacancyResponse)
@limiter.limit("5/minute", key_func=_get_rate_limit_key)
async def parse_vacancy_url(
    request: Request,
    body: UrlRequest,
    current_user: User = Depends(get_current_user)
):
    """
    Parse vacancy from URL.

    Supported sources:
    - hh.ru (HeadHunter) - uses official API when possible
    - linkedin.com/jobs
    - superjob.ru
    - career.habr.com

    Requires authentication and is rate-limited to 5 requests per minute.

    Returns structured vacancy data extracted using API or AI.
    The `method` field indicates whether "api" or "ai" was used for parsing.
    """
    # Store user in request state for rate limiter
    request.state._rate_limit_user = current_user

    try:
        # Validate and sanitize URL
        url = validate_and_sanitize_url(body.url)

        source = detect_source(url)

        # Log parsing request with user info
        logger.info(
            f"Vacancy parsing requested | user_id={current_user.id} | "
            f"user_email={current_user.email} | url={url} | source={source}"
        )

        vacancy, method = await parse_vacancy_from_url(url)

        # Log successful parsing
        logger.info(
            f"Vacancy parsing SUCCESS | user_id={current_user.id} | "
            f"url={url} | source={source} | method={method}"
        )

        return ParseVacancyResponse(
            success=True,
            data=vacancy,
            source=source,
            method=method
        )

    except HTTPException:
        # Log authentication/validation failures
        logger.warning(
            f"Vacancy parsing FAILED (HTTP error) | user_id={current_user.id} | "
            f"url={body.url}"
        )
        raise
    except ValueError as e:
        logger.warning(
            f"Vacancy parsing FAILED | user_id={current_user.id} | "
            f"url={body.url} | error={e}"
        )
        return ParseVacancyResponse(
            success=False,
            error=str(e)
        )
    except Exception as e:
        logger.error(
            f"Vacancy parsing ERROR | user_id={current_user.id} | "
            f"url={body.url} | error={e}"
        )
        return ParseVacancyResponse(
            success=False,
            error=f"Failed to parse vacancy: {str(e)}"
        )
