"""
Tests for universal parser service - Resume and Vacancy parsing.
"""
import pytest
import pytest_asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient

from api.services.parser import (
    ParsedResume,
    ParsedVacancy,
    detect_source,
    extract_text_from_html,
    _clean_json_response,
    parse_with_ai,
    parse_resume_from_url,
    parse_vacancy_from_url,
    parse_resume_from_pdf,
)


# ============================================================================
# UNIT TESTS - Source Detection
# ============================================================================

class TestSourceDetection:
    """Tests for URL source detection."""

    def test_detect_hh_source(self):
        """Test detection of hh.ru URLs."""
        assert detect_source("https://hh.ru/resume/abc123") == "hh"
        assert detect_source("https://www.hh.ru/vacancy/456") == "hh"
        assert detect_source("https://spb.hh.ru/resume/789") == "hh"

    def test_detect_linkedin_source(self):
        """Test detection of LinkedIn URLs."""
        assert detect_source("https://linkedin.com/in/johndoe") == "linkedin"
        assert detect_source("https://www.linkedin.com/jobs/view/123") == "linkedin"

    def test_detect_superjob_source(self):
        """Test detection of SuperJob URLs."""
        assert detect_source("https://superjob.ru/resume/python-123.html") == "superjob"
        assert detect_source("https://www.superjob.ru/vakansii/backend-456.html") == "superjob"

    def test_detect_habr_source(self):
        """Test detection of Habr Career URLs."""
        assert detect_source("https://career.habr.com/user123") == "habr"
        assert detect_source("https://habr.com/career/vacancies/123") == "habr"

    def test_detect_unknown_source(self):
        """Test unknown source detection."""
        assert detect_source("https://example.com/resume") == "unknown"
        assert detect_source("https://somesite.ru/job") == "unknown"


# ============================================================================
# UNIT TESTS - JSON Response Cleaning
# ============================================================================

class TestJsonCleaning:
    """Tests for AI response JSON cleaning."""

    def test_clean_json_with_markdown_block(self):
        """Test cleaning JSON from markdown code block."""
        response = '''Here is the result:
```json
{"name": "John", "email": "john@example.com"}
```
Hope this helps!'''
        result = _clean_json_response(response)
        assert result == '{"name": "John", "email": "john@example.com"}'

    def test_clean_json_with_simple_block(self):
        """Test cleaning JSON from simple code block."""
        response = '''```
{"title": "Developer", "salary": 100000}
```'''
        result = _clean_json_response(response)
        assert result == '{"title": "Developer", "salary": 100000}'

    def test_clean_json_raw_object(self):
        """Test extracting raw JSON object from response."""
        response = 'The data is {"name": "Jane", "phone": "+79991234567"} extracted from the resume.'
        result = _clean_json_response(response)
        assert result == '{"name": "Jane", "phone": "+79991234567"}'

    def test_clean_json_pure(self):
        """Test passing through pure JSON."""
        response = '{"position": "Backend Developer", "skills": ["Python", "FastAPI"]}'
        result = _clean_json_response(response)
        assert result == response


# ============================================================================
# UNIT TESTS - HTML Text Extraction
# ============================================================================

class TestHtmlExtraction:
    """Tests for HTML text extraction."""

    def test_extract_text_basic(self):
        """Test basic text extraction from HTML."""
        html = '''
        <html>
        <body>
            <h1>John Doe</h1>
            <p>Python Developer</p>
            <div class="experience">5 years of experience</div>
        </body>
        </html>
        '''
        result = extract_text_from_html(html)
        assert "John Doe" in result
        assert "Python Developer" in result
        assert "5 years" in result

    def test_extract_text_removes_scripts(self):
        """Test that scripts are removed from HTML."""
        html = '''
        <html>
        <head><script>alert('hack');</script></head>
        <body>
            <h1>Resume</h1>
            <script>console.log('malicious');</script>
            <p>Content here</p>
        </body>
        </html>
        '''
        result = extract_text_from_html(html)
        assert "alert" not in result
        assert "malicious" not in result
        assert "Resume" in result
        assert "Content here" in result

    def test_extract_text_removes_styles(self):
        """Test that style blocks are removed."""
        html = '''
        <html>
        <head><style>.hidden { display: none; }</style></head>
        <body>
            <p>Visible text</p>
        </body>
        </html>
        '''
        result = extract_text_from_html(html)
        assert "display" not in result
        assert "Visible text" in result

    def test_extract_text_truncation(self):
        """Test that long text is truncated."""
        # Create HTML with very long content
        long_content = "A" * 20000
        html = f'<html><body><p>{long_content}</p></body></html>'
        result = extract_text_from_html(html)
        assert len(result) <= 15100  # 15000 + "[текст обрезан]"
        assert "[текст обрезан]" in result


# ============================================================================
# UNIT TESTS - Parsed Models
# ============================================================================

class TestParsedModels:
    """Tests for parsed data models."""

    def test_parsed_resume_defaults(self):
        """Test ParsedResume with default values."""
        resume = ParsedResume()
        assert resume.name is None
        assert resume.email is None
        assert resume.skills == []
        assert resume.salary_currency == "RUB"

    def test_parsed_resume_full(self):
        """Test ParsedResume with full data."""
        resume = ParsedResume(
            name="John Doe",
            email="john@example.com",
            phone="+79991234567",
            telegram="@johndoe",
            position="Senior Python Developer",
            company="TechCorp",
            experience_years=5,
            skills=["Python", "FastAPI", "PostgreSQL"],
            salary_min=200000,
            salary_max=300000,
            salary_currency="RUB",
            location="Moscow",
            summary="Experienced backend developer",
            source_url="https://hh.ru/resume/123"
        )
        assert resume.name == "John Doe"
        assert len(resume.skills) == 3
        assert resume.experience_years == 5

    def test_parsed_vacancy_defaults(self):
        """Test ParsedVacancy with default values."""
        vacancy = ParsedVacancy(title="Test Position")
        assert vacancy.title == "Test Position"
        assert vacancy.description is None
        assert vacancy.salary_currency == "RUB"

    def test_parsed_vacancy_full(self):
        """Test ParsedVacancy with full data."""
        vacancy = ParsedVacancy(
            title="Backend Developer",
            description="Join our team",
            requirements="3+ years Python",
            responsibilities="Develop APIs",
            salary_min=150000,
            salary_max=250000,
            salary_currency="USD",
            location="Remote",
            employment_type="full-time",
            experience_level="senior",
            company_name="StartupXYZ",
            source_url="https://hh.ru/vacancy/456"
        )
        assert vacancy.title == "Backend Developer"
        assert vacancy.salary_currency == "USD"
        assert vacancy.employment_type == "full-time"


# ============================================================================
# INTEGRATION TESTS - AI Parsing (Mocked)
# ============================================================================

class TestAIParsing:
    """Tests for AI-powered parsing with mocked responses."""

    @pytest.mark.asyncio
    async def test_parse_resume_with_ai(self):
        """Test resume parsing with mocked AI response."""
        mock_ai_response = {
            "name": "Иван Петров",
            "email": "ivan@example.com",
            "phone": "+79161234567",
            "position": "Python Developer",
            "experience_years": 3,
            "skills": ["Python", "Django", "PostgreSQL"],
            "salary_min": 180000,
            "salary_max": 250000,
            "salary_currency": "RUB",
            "location": "Москва"
        }

        with patch('api.services.parser._get_ai_client') as mock_client:
            # Setup mock
            mock_message = MagicMock()
            mock_message.content = [MagicMock(text=json.dumps(mock_ai_response))]
            mock_client.return_value.messages.create = AsyncMock(return_value=mock_message)

            result = await parse_with_ai("Test resume content", "resume", "hh")

            assert result["name"] == "Иван Петров"
            assert result["position"] == "Python Developer"
            assert "Python" in result["skills"]

    @pytest.mark.asyncio
    async def test_parse_vacancy_with_ai(self):
        """Test vacancy parsing with mocked AI response."""
        mock_ai_response = {
            "title": "Senior Backend Developer",
            "description": "Ищем опытного разработчика",
            "requirements": "Python 5+ лет, FastAPI",
            "responsibilities": "Разработка API",
            "salary_min": 300000,
            "salary_max": 450000,
            "salary_currency": "RUB",
            "location": "Remote",
            "employment_type": "full-time",
            "experience_level": "senior",
            "company_name": "TechCorp"
        }

        with patch('api.services.parser._get_ai_client') as mock_client:
            mock_message = MagicMock()
            mock_message.content = [MagicMock(text=json.dumps(mock_ai_response))]
            mock_client.return_value.messages.create = AsyncMock(return_value=mock_message)

            result = await parse_with_ai("Test vacancy content", "vacancy", "hh")

            assert result["title"] == "Senior Backend Developer"
            assert result["employment_type"] == "full-time"


# ============================================================================
# INTEGRATION TESTS - URL Parsing (Mocked)
# ============================================================================

class TestURLParsing:
    """Tests for URL-based parsing with mocked HTTP responses."""

    @pytest.mark.asyncio
    async def test_parse_resume_from_url(self):
        """Test resume parsing from URL."""
        mock_html = '''
        <html>
        <body>
            <h1>Иван Петров</h1>
            <p>Python Developer</p>
            <p>email: ivan@test.com</p>
            <p>Опыт: 5 лет</p>
        </body>
        </html>
        '''

        mock_ai_response = {
            "name": "Иван Петров",
            "email": "ivan@test.com",
            "position": "Python Developer",
            "experience_years": 5,
            "skills": ["Python"],
            "salary_currency": "RUB"
        }

        with patch('api.services.parser.fetch_url_content', new_callable=AsyncMock) as mock_fetch:
            with patch('api.services.parser._get_ai_client') as mock_client:
                mock_fetch.return_value = mock_html

                mock_message = MagicMock()
                mock_message.content = [MagicMock(text=json.dumps(mock_ai_response))]
                mock_client.return_value.messages.create = AsyncMock(return_value=mock_message)

                result = await parse_resume_from_url("https://hh.ru/resume/123")

                assert result.name == "Иван Петров"
                assert result.source_url == "https://hh.ru/resume/123"

    @pytest.mark.asyncio
    async def test_parse_vacancy_from_url(self):
        """Test vacancy parsing from URL."""
        mock_html = '''
        <html>
        <body>
            <h1>Backend Developer</h1>
            <p>Требуется опытный разработчик</p>
            <p>Зарплата: от 200000 до 350000 руб</p>
        </body>
        </html>
        '''

        mock_ai_response = {
            "title": "Backend Developer",
            "description": "Требуется опытный разработчик",
            "salary_min": 200000,
            "salary_max": 350000,
            "salary_currency": "RUB"
        }

        with patch('api.services.parser.fetch_url_content', new_callable=AsyncMock) as mock_fetch:
            with patch('api.services.parser._get_ai_client') as mock_client:
                mock_fetch.return_value = mock_html

                mock_message = MagicMock()
                mock_message.content = [MagicMock(text=json.dumps(mock_ai_response))]
                mock_client.return_value.messages.create = AsyncMock(return_value=mock_message)

                result = await parse_vacancy_from_url("https://hh.ru/vacancy/456")

                assert result.title == "Backend Developer"
                assert result.source_url == "https://hh.ru/vacancy/456"
                assert result.salary_min == 200000

    @pytest.mark.asyncio
    async def test_parse_url_empty_content(self):
        """Test error handling for empty URL content."""
        with patch('api.services.parser.fetch_url_content', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = "<html><body></body></html>"

            with pytest.raises(ValueError) as exc_info:
                await parse_resume_from_url("https://example.com/empty")

            assert "extract text" in str(exc_info.value).lower()


# ============================================================================
# INTEGRATION TESTS - PDF Parsing (Mocked)
# ============================================================================

class TestPDFParsing:
    """Tests for PDF file parsing with mocked document parser."""

    @pytest.mark.asyncio
    async def test_parse_resume_from_pdf(self):
        """Test resume parsing from PDF file."""
        mock_parse_result = MagicMock()
        mock_parse_result.status = "success"
        mock_parse_result.content = """
        Иван Петров
        Python Developer
        ivan@example.com
        +7 916 123-45-67
        Опыт работы: 5 лет
        Навыки: Python, FastAPI, PostgreSQL
        """

        mock_ai_response = {
            "name": "Иван Петров",
            "email": "ivan@example.com",
            "phone": "+79161234567",
            "position": "Python Developer",
            "experience_years": 5,
            "skills": ["Python", "FastAPI", "PostgreSQL"],
            "salary_currency": "RUB"
        }

        with patch('api.services.parser.document_parser') as mock_doc_parser:
            with patch('api.services.parser._get_ai_client') as mock_client:
                mock_doc_parser.parse = AsyncMock(return_value=mock_parse_result)

                mock_message = MagicMock()
                mock_message.content = [MagicMock(text=json.dumps(mock_ai_response))]
                mock_client.return_value.messages.create = AsyncMock(return_value=mock_message)

                result = await parse_resume_from_pdf(b"fake pdf content", "resume.pdf")

                assert result.name == "Иван Петров"
                assert len(result.skills) == 3

    @pytest.mark.asyncio
    async def test_parse_resume_from_pdf_failed(self):
        """Test error handling for failed PDF parsing."""
        mock_parse_result = MagicMock()
        mock_parse_result.status = "failed"
        mock_parse_result.error = "Invalid PDF format"

        with patch('api.services.parser.document_parser') as mock_doc_parser:
            mock_doc_parser.parse = AsyncMock(return_value=mock_parse_result)

            with pytest.raises(ValueError) as exc_info:
                await parse_resume_from_pdf(b"invalid content", "bad.pdf")

            assert "Invalid PDF format" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_parse_resume_from_pdf_empty(self):
        """Test error handling for empty PDF content."""
        mock_parse_result = MagicMock()
        mock_parse_result.status = "success"
        mock_parse_result.content = ""

        with patch('api.services.parser.document_parser') as mock_doc_parser:
            mock_doc_parser.parse = AsyncMock(return_value=mock_parse_result)

            with pytest.raises(ValueError) as exc_info:
                await parse_resume_from_pdf(b"empty pdf", "empty.pdf")

            assert "empty" in str(exc_info.value).lower()


# ============================================================================
# API ROUTE TESTS
# ============================================================================

class TestParserRoutes:
    """Tests for parser API routes."""

    async def test_parse_resume_url_endpoint(
        self,
        client: AsyncClient,
        admin_user,
        org_owner
    ):
        """Test POST /api/parser/resume/url endpoint."""
        from api.services.auth import create_access_token

        token = create_access_token(data={"sub": str(admin_user.id)})

        mock_ai_response = {
            "name": "Test User",
            "email": "test@test.com",
            "skills": ["Python"],
            "salary_currency": "RUB"
        }

        with patch('api.services.parser.fetch_url_content', new_callable=AsyncMock) as mock_fetch:
            with patch('api.services.parser._get_ai_client') as mock_client:
                mock_fetch.return_value = "<html><body><p>Test User - Python Developer - test@test.com</p></body></html>"

                mock_message = MagicMock()
                mock_message.content = [MagicMock(text=json.dumps(mock_ai_response))]
                mock_client.return_value.messages.create = AsyncMock(return_value=mock_message)

                response = await client.post(
                    "/api/parser/resume/url",
                    json={"url": "https://hh.ru/resume/123"},
                    headers={"Authorization": f"Bearer {token}"}
                )

                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True
                assert data["data"]["name"] == "Test User"

    async def test_parse_vacancy_url_endpoint(
        self,
        client: AsyncClient,
        admin_user,
        org_owner
    ):
        """Test POST /api/parser/vacancy/url endpoint."""
        from api.services.auth import create_access_token

        token = create_access_token(data={"sub": str(admin_user.id)})

        mock_ai_response = {
            "title": "Backend Developer",
            "description": "Looking for developer",
            "salary_currency": "RUB"
        }

        with patch('api.services.parser.fetch_url_content', new_callable=AsyncMock) as mock_fetch:
            with patch('api.services.parser._get_ai_client') as mock_client:
                mock_fetch.return_value = "<html><body><h1>Backend Developer</h1><p>Looking for developer</p></body></html>"

                mock_message = MagicMock()
                mock_message.content = [MagicMock(text=json.dumps(mock_ai_response))]
                mock_client.return_value.messages.create = AsyncMock(return_value=mock_message)

                response = await client.post(
                    "/api/parser/vacancy/url",
                    json={"url": "https://hh.ru/vacancy/456"},
                    headers={"Authorization": f"Bearer {token}"}
                )

                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True
                assert data["data"]["title"] == "Backend Developer"

    async def test_parse_resume_url_empty_url(
        self,
        client: AsyncClient,
        admin_user,
        org_owner
    ):
        """Test error handling for empty URL."""
        from api.services.auth import create_access_token

        token = create_access_token(data={"sub": str(admin_user.id)})

        response = await client.post(
            "/api/parser/resume/url",
            json={"url": ""},
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 400

    async def test_parse_resume_file_unsupported_format(
        self,
        client: AsyncClient,
        admin_user,
        org_owner
    ):
        """Test error handling for unsupported file format."""
        from api.services.auth import create_access_token
        import io

        token = create_access_token(data={"sub": str(admin_user.id)})

        # Create a fake file with unsupported extension
        files = {"file": ("test.exe", io.BytesIO(b"fake content"), "application/octet-stream")}

        response = await client.post(
            "/api/parser/resume/file",
            files=files,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 400
        assert "Unsupported file format" in response.json()["detail"]
