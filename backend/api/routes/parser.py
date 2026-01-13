"""
API routes for universal parser service.
Parses resumes and vacancies from PDFs and URLs.
"""
import logging
from fastapi import APIRouter, HTTPException, UploadFile, File, Body
from pydantic import BaseModel, HttpUrl
from typing import Optional

from ..services.parser import (
    ParsedResume,
    ParsedVacancy,
    parse_resume_from_pdf,
    parse_resume_from_url,
    parse_vacancy_from_url,
    detect_source,
)

logger = logging.getLogger(__name__)

router = APIRouter()


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
    error: Optional[str] = None


@router.post("/resume/url", response_model=ParseResumeResponse)
async def parse_resume_url(request: UrlRequest):
    """
    Parse resume from URL.

    Supported sources:
    - hh.ru (HeadHunter)
    - linkedin.com
    - superjob.ru
    - career.habr.com

    Returns structured resume data extracted using AI.
    """
    try:
        url = request.url.strip()
        if not url:
            raise HTTPException(status_code=400, detail="URL is required")

        # Validate URL format
        if not url.startswith(('http://', 'https://')):
            url = 'https://' + url

        source = detect_source(url)
        logger.info(f"Parsing resume from URL: {url} (source: {source})")

        resume = await parse_resume_from_url(url)

        return ParseResumeResponse(
            success=True,
            data=resume,
            source=source
        )

    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Resume parsing failed: {e}")
        return ParseResumeResponse(
            success=False,
            error=str(e)
        )
    except Exception as e:
        logger.error(f"Unexpected error parsing resume URL: {e}")
        return ParseResumeResponse(
            success=False,
            error=f"Failed to parse resume: {str(e)}"
        )


@router.post("/resume/file", response_model=ParseResumeResponse)
async def parse_resume_file(file: UploadFile = File(...)):
    """
    Parse resume from uploaded file.

    Supported formats:
    - PDF (.pdf)
    - Word documents (.docx, .doc)
    - Images (.jpg, .png) - OCR extraction
    - Text files (.txt, .rtf)

    Returns structured resume data extracted using AI.
    """
    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="File is required")

        # Check file extension
        allowed_extensions = {
            'pdf', 'docx', 'doc', 'txt', 'rtf',
            'jpg', 'jpeg', 'png', 'gif', 'webp'
        }
        ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''

        if ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file format: {ext}. Allowed: {', '.join(sorted(allowed_extensions))}"
            )

        # Read file content
        file_content = await file.read()

        if not file_content:
            raise HTTPException(status_code=400, detail="File is empty")

        # Check file size (max 20MB)
        max_size = 20 * 1024 * 1024
        if len(file_content) > max_size:
            raise HTTPException(
                status_code=400,
                detail=f"File too large: {len(file_content) / 1024 / 1024:.1f}MB (max 20MB)"
            )

        logger.info(f"Parsing resume from file: {file.filename} ({len(file_content)} bytes)")

        resume = await parse_resume_from_pdf(file_content, file.filename)

        return ParseResumeResponse(
            success=True,
            data=resume,
            source="file"
        )

    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Resume file parsing failed: {e}")
        return ParseResumeResponse(
            success=False,
            error=str(e)
        )
    except Exception as e:
        logger.error(f"Unexpected error parsing resume file: {e}")
        return ParseResumeResponse(
            success=False,
            error=f"Failed to parse resume: {str(e)}"
        )


@router.post("/vacancy/url", response_model=ParseVacancyResponse)
async def parse_vacancy_url(request: UrlRequest):
    """
    Parse vacancy from URL.

    Supported sources:
    - hh.ru (HeadHunter)
    - linkedin.com/jobs
    - superjob.ru
    - career.habr.com

    Returns structured vacancy data extracted using AI.
    """
    try:
        url = request.url.strip()
        if not url:
            raise HTTPException(status_code=400, detail="URL is required")

        # Validate URL format
        if not url.startswith(('http://', 'https://')):
            url = 'https://' + url

        source = detect_source(url)
        logger.info(f"Parsing vacancy from URL: {url} (source: {source})")

        vacancy = await parse_vacancy_from_url(url)

        return ParseVacancyResponse(
            success=True,
            data=vacancy,
            source=source
        )

    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Vacancy parsing failed: {e}")
        return ParseVacancyResponse(
            success=False,
            error=str(e)
        )
    except Exception as e:
        logger.error(f"Unexpected error parsing vacancy URL: {e}")
        return ParseVacancyResponse(
            success=False,
            error=f"Failed to parse vacancy: {str(e)}"
        )
