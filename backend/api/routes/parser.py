"""
API routes for universal parser service.
Parses resumes and vacancies from PDFs and URLs.

Security features:
- All endpoints require authentication
- Rate limiting: 5 requests per minute per user
- URL validation: Only allowed domains (hh.ru, linkedin.com, superjob.ru, habr career)
- URL sanitization: Prevents prompt injection attacks
- Magic bytes validation: Prevents file type spoofing
- Comprehensive logging of all parsing requests
"""
import logging
import re
import zipfile
import io
import magic
from urllib.parse import urlparse, urlunparse
from fastapi import APIRouter, HTTPException, UploadFile, File, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List

from ..services.parser import (
    ParsedResume,
    ParsedVacancy,
    parse_resume_from_pdf,
    parse_resume_from_url,
    parse_vacancy_from_url,
    parse_vacancy_from_file,
    detect_source,
)
from ..services.auth import get_current_user, get_user_org
from ..database import get_db
from ..models.database import User, Entity, EntityType, EntityStatus
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

# Allowed MIME types for file uploads (validated via magic bytes)
ALLOWED_MIME_TYPES = {
    # Documents
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  # .docx
    'application/msword',  # .doc
    'text/plain',
    'text/rtf',
    'application/rtf',
    # Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    # Archives (for bulk import and individual parsing)
    'application/zip',
    'application/x-zip-compressed',
    'application/x-zip',
    # HTML
    'text/html',
}

# Mapping of file extensions to expected MIME types
EXTENSION_MIME_MAP = {
    'pdf': {'application/pdf'},
    'docx': {'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'},
    'doc': {'application/msword', 'application/octet-stream'},
    'txt': {'text/plain'},
    'rtf': {'text/rtf', 'application/rtf'},
    'jpg': {'image/jpeg'},
    'jpeg': {'image/jpeg'},
    'png': {'image/png'},
    'gif': {'image/gif'},
    'webp': {'image/webp'},
    'zip': {'application/zip', 'application/x-zip-compressed', 'application/x-zip'},
    'html': {'text/html'},
    'htm': {'text/html'},
}


def validate_file_magic(file_content: bytes, filename: str) -> tuple[bool, str]:
    """
    Validates file content by checking magic bytes against expected MIME type.

    This prevents attacks where malicious files are uploaded with spoofed extensions
    (e.g., an executable renamed to .pdf).

    Args:
        file_content: The raw bytes of the uploaded file
        filename: The original filename (used to check extension consistency)

    Returns:
        Tuple of (is_valid, error_message). If valid, error_message is empty.
    """
    if not file_content:
        return False, "Empty file content"

    # Detect MIME type from file content using magic bytes
    try:
        detected_mime = magic.from_buffer(file_content, mime=True)
    except Exception as e:
        logger.error(f"Magic bytes detection failed: {e}")
        return False, f"Failed to detect file type: {str(e)}"

    # Check if detected MIME type is in allowed list
    if detected_mime not in ALLOWED_MIME_TYPES:
        return False, f"File type not allowed: {detected_mime}"

    # Get file extension
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''

    # Verify extension matches detected MIME type
    if ext in EXTENSION_MIME_MAP:
        expected_mimes = EXTENSION_MIME_MAP[ext]
        if detected_mime not in expected_mimes:
            # Special case: .docx files are detected as application/zip
            if ext == 'docx' and detected_mime == 'application/zip':
                return True, ""
            return False, f"File extension .{ext} does not match content type {detected_mime}"

    return True, ""


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
            'jpg', 'jpeg', 'png', 'gif', 'webp',
            'zip', 'html', 'htm'
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

        # Validate magic bytes to prevent file type spoofing
        is_valid, magic_error = validate_file_magic(file_content, safe_filename)
        if not is_valid:
            logger.warning(
                f"Resume file REJECTED | user_id={current_user.id} | "
                f"filename={safe_filename} | reason=magic_bytes_mismatch | error={magic_error}"
            )
            raise HTTPException(
                status_code=400,
                detail=f"File validation failed: {magic_error}"
            )

        # Log parsing request
        logger.info(
            f"Resume file parsing requested | user_id={current_user.id} | "
            f"user_email={current_user.email} | filename={safe_filename} | "
            f"size={len(file_content)} bytes"
        )

        resume = await parse_resume_from_file(file_content, safe_filename)

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


@router.post("/vacancy/file", response_model=ParseVacancyResponse)
@limiter.limit("5/minute", key_func=_get_rate_limit_key)
async def parse_vacancy_file(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """
    Parse vacancy from uploaded file.

    Supported formats:
    - PDF (.pdf)
    - Word documents (.docx, .doc)
    - Text files (.txt, .rtf)

    Requires authentication and is rate-limited to 5 requests per minute.

    Returns structured vacancy data extracted using AI.
    """
    # Store user in request state for rate limiter
    request.state._rate_limit_user = current_user

    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="File is required")

        # Sanitize filename to prevent path traversal
        safe_filename = re.sub(r'[<>:"/\\|?*]', '_', file.filename)

        # Check file extension
        allowed_extensions = {'pdf', 'docx', 'doc', 'txt', 'rtf', 'html', 'htm', 'zip'}
        ext = safe_filename.rsplit('.', 1)[-1].lower() if '.' in safe_filename else ''

        if ext not in allowed_extensions:
            logger.warning(
                f"Vacancy file REJECTED | user_id={current_user.id} | "
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
                f"Vacancy file REJECTED | user_id={current_user.id} | "
                f"filename={safe_filename} | reason=empty_file"
            )
            raise HTTPException(status_code=400, detail="File is empty")

        # Check file size (max 20MB)
        max_size = 20 * 1024 * 1024
        if len(file_content) > max_size:
            logger.warning(
                f"Vacancy file REJECTED | user_id={current_user.id} | "
                f"filename={safe_filename} | reason=file_too_large | size={len(file_content)}"
            )
            raise HTTPException(
                status_code=400,
                detail=f"File too large: {len(file_content) / 1024 / 1024:.1f}MB (max 20MB)"
            )

        # Validate magic bytes to prevent file type spoofing
        is_valid, magic_error = validate_file_magic(file_content, safe_filename)
        if not is_valid:
            logger.warning(
                f"Vacancy file REJECTED | user_id={current_user.id} | "
                f"filename={safe_filename} | reason=magic_bytes_mismatch | error={magic_error}"
            )
            raise HTTPException(
                status_code=400,
                detail=f"File validation failed: {magic_error}"
            )

        # Log parsing request
        logger.info(
            f"Vacancy file parsing requested | user_id={current_user.id} | "
            f"user_email={current_user.email} | filename={safe_filename} | "
            f"size={len(file_content)} bytes"
        )

        vacancy = await parse_vacancy_from_file(file_content, safe_filename)

        # Log successful parsing
        logger.info(
            f"Vacancy file parsing SUCCESS | user_id={current_user.id} | "
            f"filename={safe_filename}"
        )

        return ParseVacancyResponse(
            success=True,
            data=vacancy,
            source="file",
            method="ai"
        )

    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(
            f"Vacancy file parsing FAILED | user_id={current_user.id} | "
            f"filename={file.filename} | error={e}"
        )
        return ParseVacancyResponse(
            success=False,
            error=str(e)
        )
    except Exception as e:
        logger.error(
            f"Vacancy file parsing ERROR | user_id={current_user.id} | "
            f"filename={file.filename} | error={e}"
        )
        return ParseVacancyResponse(
            success=False,
            error=f"Failed to parse vacancy: {str(e)}"
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


class BulkImportResult(BaseModel):
    """Result for a single resume in bulk import"""
    filename: str
    success: bool
    entity_id: Optional[int] = None
    entity_name: Optional[str] = None
    error: Optional[str] = None


class BulkImportResponse(BaseModel):
    """Response for bulk resume import"""
    success: bool
    total_files: int
    successful: int
    failed: int
    results: List[BulkImportResult]
    error: Optional[str] = None


@router.post("/resume/bulk-import", response_model=BulkImportResponse)
@limiter.limit("2/minute", key_func=_get_rate_limit_key)
async def bulk_import_resumes(
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Bulk import resumes from a ZIP file.

    The ZIP file should contain resume files in supported formats:
    - PDF (.pdf)
    - Word documents (.docx, .doc)
    - Text files (.txt, .rtf)

    Each resume will be parsed using AI and a candidate entity will be created.
    Maximum 50 files per ZIP, maximum 100MB total size.

    Returns a list of results for each file processed.
    """
    request.state._rate_limit_user = current_user

    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="File is required")

        # Check file extension
        if not file.filename.lower().endswith('.zip'):
            raise HTTPException(
                status_code=400,
                detail="Only ZIP files are allowed for bulk import"
            )

        # Read ZIP content
        zip_content = await file.read()

        # Check size (max 100MB)
        max_size = 100 * 1024 * 1024
        if len(zip_content) > max_size:
            raise HTTPException(
                status_code=400,
                detail=f"ZIP file too large: {len(zip_content) / 1024 / 1024:.1f}MB (max 100MB)"
            )

        # Validate ZIP file magic bytes
        is_valid, magic_error = validate_file_magic(zip_content, file.filename)
        if not is_valid:
            logger.warning(
                f"Bulk import REJECTED | user_id={current_user.id} | "
                f"filename={file.filename} | reason=magic_bytes_mismatch | error={magic_error}"
            )
            raise HTTPException(
                status_code=400,
                detail=f"ZIP file validation failed: {magic_error}"
            )

        # Get user's organization
        org = await get_user_org(current_user, db)
        if not org:
            raise HTTPException(status_code=403, detail="No organization access")

        logger.info(
            f"Bulk import started | user_id={current_user.id} | "
            f"org_id={org.id} | zip_size={len(zip_content)} bytes"
        )

        results = []
        successful = 0
        failed = 0
        allowed_extensions = {'pdf', 'docx', 'doc', 'txt', 'rtf'}

        try:
            with zipfile.ZipFile(io.BytesIO(zip_content), 'r') as zip_file:
                # Get list of files (excluding directories and hidden files)
                file_list = [
                    f for f in zip_file.namelist()
                    if not f.endswith('/') and not f.startswith('__MACOSX') and not f.startswith('.')
                ]

                # Check file count limit
                if len(file_list) > 50:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Too many files in ZIP: {len(file_list)} (max 50)"
                    )

                if len(file_list) == 0:
                    return BulkImportResponse(
                        success=True,
                        total_files=0,
                        successful=0,
                        failed=0,
                        results=[],
                        error="ZIP file contains no valid resume files"
                    )

                for filename in file_list:
                    # Get file extension
                    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''

                    if ext not in allowed_extensions:
                        results.append(BulkImportResult(
                            filename=filename,
                            success=False,
                            error=f"Unsupported format: {ext}"
                        ))
                        failed += 1
                        continue

                    try:
                        # Extract and read file
                        file_data = zip_file.read(filename)

                        if not file_data or len(file_data) == 0:
                            results.append(BulkImportResult(
                                filename=filename,
                                success=False,
                                error="Empty file"
                            ))
                            failed += 1
                            continue

                        # Check individual file size (max 20MB)
                        if len(file_data) > 20 * 1024 * 1024:
                            results.append(BulkImportResult(
                                filename=filename,
                                success=False,
                                error="File too large (max 20MB)"
                            ))
                            failed += 1
                            continue

                        # Validate magic bytes for each file in ZIP
                        is_valid, magic_error = validate_file_magic(file_data, filename)
                        if not is_valid:
                            logger.warning(
                                f"Bulk import: file rejected due to magic bytes | "
                                f"filename={filename} | error={magic_error}"
                            )
                            results.append(BulkImportResult(
                                filename=filename,
                                success=False,
                                error=f"File validation failed: {magic_error}"
                            ))
                            failed += 1
                            continue

                        # Parse resume
                        safe_filename = re.sub(r'[<>:"/\\|?*]', '_', filename.split('/')[-1])
                        resume = await parse_resume_from_pdf(file_data, safe_filename)

                        # Create candidate entity
                        entity_name = resume.name or f"Candidate from {safe_filename}"

                        # Check for existing entity with same email
                        existing = None
                        if resume.email:
                            result = await db.execute(
                                select(Entity).where(
                                    Entity.email == resume.email,
                                    Entity.org_id == org.id
                                )
                            )
                            existing = result.scalar_one_or_none()

                        if existing:
                            results.append(BulkImportResult(
                                filename=filename,
                                success=False,
                                entity_id=existing.id,
                                entity_name=existing.name,
                                error=f"Candidate with email {resume.email} already exists"
                            ))
                            failed += 1
                            continue

                        # Build extra_data from parsed resume
                        extra_data = {}
                        if resume.skills:
                            extra_data["skills"] = resume.skills
                        if resume.experience:
                            extra_data["experience"] = [
                                {
                                    "company": exp.company,
                                    "position": exp.position,
                                    "start_date": exp.start_date,
                                    "end_date": exp.end_date,
                                    "description": exp.description
                                }
                                for exp in resume.experience
                            ]
                        if resume.education:
                            extra_data["education"] = [
                                {
                                    "institution": edu.institution,
                                    "degree": edu.degree,
                                    "field": edu.field,
                                    "year": edu.year
                                }
                                for edu in resume.education
                            ]
                        if resume.languages:
                            extra_data["languages"] = resume.languages
                        if resume.summary:
                            extra_data["summary"] = resume.summary

                        # Create entity
                        entity = Entity(
                            name=entity_name,
                            type=EntityType.candidate,
                            status=EntityStatus.new,
                            email=resume.email,
                            phone=resume.phone,
                            company=resume.experience[0].company if resume.experience else None,
                            position=resume.experience[0].position if resume.experience else None,
                            tags=resume.skills[:10] if resume.skills else [],
                            extra_data=extra_data,
                            org_id=org.id,
                            created_by=current_user.id
                        )

                        db.add(entity)
                        await db.flush()

                        results.append(BulkImportResult(
                            filename=filename,
                            success=True,
                            entity_id=entity.id,
                            entity_name=entity.name
                        ))
                        successful += 1

                        logger.info(
                            f"Bulk import: created entity {entity.id} from {safe_filename}"
                        )

                    except Exception as e:
                        logger.error(f"Bulk import: failed to process {filename}: {e}")
                        results.append(BulkImportResult(
                            filename=filename,
                            success=False,
                            error=str(e)
                        ))
                        failed += 1

                # Commit all entities
                await db.commit()

        except zipfile.BadZipFile:
            raise HTTPException(
                status_code=400,
                detail="Invalid ZIP file format"
            )

        logger.info(
            f"Bulk import completed | user_id={current_user.id} | "
            f"total={len(results)} | successful={successful} | failed={failed}"
        )

        return BulkImportResponse(
            success=True,
            total_files=len(results),
            successful=successful,
            failed=failed,
            results=results
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Bulk import error | user_id={current_user.id} | error={e}")
        return BulkImportResponse(
            success=False,
            total_files=0,
            successful=0,
            failed=0,
            results=[],
            error=f"Bulk import failed: {str(e)}"
        )
