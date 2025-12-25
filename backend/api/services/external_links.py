"""
External Links Processor Service.

Processes external URLs containing call recordings or transcripts:
- Google Docs (already transcribed)
- Google Drive (audio/video files)
- Direct URLs (audio/video files)
- Fireflies.ai (transcripts)
"""

import os
import re
import logging
import tempfile
import aiohttp
from datetime import datetime
from typing import Optional, Tuple
from urllib.parse import urlparse, unquote

from ..config import settings
from ..models.database import CallRecording, CallSource, CallStatus
from .google_docs import google_docs_service
from .call_processor import call_processor

logger = logging.getLogger("hr-analyzer.external_links")


class LinkType:
    """Constants for link types."""
    GOOGLE_DOC = "google_doc"
    GOOGLE_SHEET = "google_sheet"
    GOOGLE_FORM = "google_form"
    GOOGLE_DRIVE = "google_drive"
    DIRECT_MEDIA = "direct_media"
    FIREFLIES = "fireflies"
    UNKNOWN = "unknown"


class ExternalLinkProcessor:
    """Processes external links to call recordings or transcripts."""

    # Supported media extensions
    MEDIA_EXTENSIONS = {'.mp3', '.mp4', '.wav', '.m4a', '.webm', '.ogg', '.aac', '.flac', '.wma', '.avi', '.mov', '.mkv'}

    # Google Drive file URL pattern
    GDRIVE_PATTERN = re.compile(r'drive\.google\.com/file/d/([a-zA-Z0-9_-]+)')
    GDRIVE_OPEN_PATTERN = re.compile(r'drive\.google\.com/open\?id=([a-zA-Z0-9_-]+)')

    # Fireflies URL pattern
    FIREFLIES_PATTERN = re.compile(r'app\.fireflies\.ai/view/([^/?]+)')

    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
        self.temp_dir = tempfile.mkdtemp()

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session."""
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession()
        return self.session

    async def close(self):
        """Close the session."""
        if self.session and not self.session.closed:
            await self.session.close()

    def detect_link_type(self, url: str) -> str:
        """
        Detect the type of link.

        Returns:
            LinkType constant
        """
        url_lower = url.lower()

        # Fireflies.ai
        if "fireflies.ai" in url_lower:
            return LinkType.FIREFLIES

        # Google Docs
        if "docs.google.com/document" in url_lower:
            return LinkType.GOOGLE_DOC

        # Google Sheets
        if "docs.google.com/spreadsheets" in url_lower:
            return LinkType.GOOGLE_SHEET

        # Google Forms
        if "docs.google.com/forms" in url_lower:
            return LinkType.GOOGLE_FORM

        # Google Drive
        if "drive.google.com" in url_lower:
            return LinkType.GOOGLE_DRIVE

        # Direct media URL
        parsed = urlparse(url)
        ext = os.path.splitext(parsed.path)[1].lower()
        if ext in self.MEDIA_EXTENSIONS:
            return LinkType.DIRECT_MEDIA

        # Check Content-Type header as fallback (will be done during download)
        return LinkType.UNKNOWN

    def _extract_gdrive_file_id(self, url: str) -> Optional[str]:
        """Extract file ID from Google Drive URL."""
        match = self.GDRIVE_PATTERN.search(url)
        if match:
            return match.group(1)

        match = self.GDRIVE_OPEN_PATTERN.search(url)
        if match:
            return match.group(1)

        return None

    def _extract_fireflies_transcript_id(self, url: str) -> Optional[str]:
        """Extract transcript ID from Fireflies URL."""
        match = self.FIREFLIES_PATTERN.search(url)
        if match:
            # URL decode the ID (it may contain special chars like ::)
            return unquote(match.group(1))
        return None

    async def process_url(
        self,
        url: str,
        organization_id: int,
        owner_id: int,
        department_id: Optional[int] = None,
        entity_id: Optional[int] = None,
        title: Optional[str] = None
    ) -> CallRecording:
        """
        Process an external URL and create a CallRecording.

        Args:
            url: External URL (Google Docs, Google Drive, Fireflies, or direct media)
            organization_id: Organization ID
            owner_id: Owner user ID
            department_id: Optional department ID
            entity_id: Optional entity ID to link
            title: Optional custom title

        Returns:
            Created CallRecording
        """
        from ..database import AsyncSessionLocal

        link_type = self.detect_link_type(url)
        logger.info(f"Processing external URL: {url} (type: {link_type})")

        async with AsyncSessionLocal() as db:
            # Create initial CallRecording
            call = CallRecording(
                org_id=organization_id,
                owner_id=owner_id,
                entity_id=entity_id,
                source_url=url,
                title=title or f"External Recording - {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
                status=CallStatus.pending,
                created_at=datetime.utcnow()
            )

            if link_type == LinkType.FIREFLIES:
                call.source_type = CallSource.telegram  # Use telegram as placeholder until we add fireflies enum
                call = await self._process_fireflies(call, url)

            elif link_type == LinkType.GOOGLE_DOC:
                call.source_type = CallSource.google_doc
                call = await self._process_google_doc(call, url)

            elif link_type == LinkType.GOOGLE_SHEET:
                call.source_type = CallSource.google_doc  # Use google_doc as source type
                call = await self._process_google_sheet(call, url)

            elif link_type == LinkType.GOOGLE_FORM:
                call.source_type = CallSource.google_doc  # Use google_doc as source type
                call = await self._process_google_form(call, url)

            elif link_type == LinkType.GOOGLE_DRIVE:
                call.source_type = CallSource.google_drive
                call = await self._process_google_drive(call, url)

            elif link_type == LinkType.DIRECT_MEDIA:
                call.source_type = CallSource.direct_url
                call = await self._process_direct_media(call, url)

            else:
                # Try to detect type by downloading
                call.source_type = CallSource.direct_url
                call = await self._process_unknown(call, url)

            db.add(call)
            await db.commit()
            await db.refresh(call)

            logger.info(f"Created CallRecording {call.id} from external URL")
            return call

    async def _process_fireflies(self, call: CallRecording, url: str) -> CallRecording:
        """
        Process Fireflies.ai shared/public transcript URL.
        Scrapes the public transcript page and runs AI analysis.

        NOTE: This handles PUBLIC shared Fireflies links, not the internal API.
        """
        try:
            transcript_id = self._extract_fireflies_transcript_id(url)
            if not transcript_id:
                call.status = CallStatus.failed
                call.error_message = "Invalid Fireflies URL - could not extract transcript ID"
                return call

            call.status = CallStatus.transcribing
            call.fireflies_transcript_id = transcript_id

            # Fetch the public Fireflies page
            logger.info(f"Fetching public Fireflies transcript: {url}")

            session = await self._get_session()

            # Fireflies uses a share URL that we can scrape
            async with session.get(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }) as response:
                if response.status != 200:
                    call.status = CallStatus.failed
                    call.error_message = f"Failed to access Fireflies link: HTTP {response.status}. Make sure the link is public/shared."
                    return call

                html = await response.text()

            # Try to extract transcript from the HTML
            # Fireflies embeds JSON data in the page for Next.js
            import json

            transcript_text = None
            title = None

            # Look for __NEXT_DATA__ script tag which contains the transcript data
            next_data_match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
            logger.info(f"__NEXT_DATA__ found: {next_data_match is not None}")

            if next_data_match:
                try:
                    next_data = json.loads(next_data_match.group(1))
                    # Navigate to transcript data
                    page_props = next_data.get('props', {}).get('pageProps', {})
                    logger.info(f"pageProps keys: {list(page_props.keys())}")

                    transcript_data = page_props.get('transcript', {})
                    logger.info(f"transcript_data keys: {list(transcript_data.keys()) if transcript_data else 'None'}")

                    if transcript_data:
                        title = transcript_data.get('title')
                        sentences = transcript_data.get('sentences', [])
                        logger.info(f"sentences count: {len(sentences)}")

                        if sentences:
                            # Build transcript text
                            lines = []
                            for s in sentences:
                                speaker = s.get('speaker_name', 'Speaker')
                                text = s.get('text', s.get('raw_text', ''))
                                if text:
                                    lines.append(f"{speaker}: {text}")
                            transcript_text = "\n".join(lines)

                            # Build speaker segments
                            speakers = []
                            for s in sentences:
                                speakers.append({
                                    "speaker": s.get("speaker_name", "Speaker"),
                                    "start": s.get("start_time", 0),
                                    "end": s.get("end_time", 0),
                                    "text": s.get("text", s.get("raw_text", ""))
                                })
                            call.speakers = speakers

                            # Get duration
                            call.duration_seconds = transcript_data.get('duration')

                            # Get summary if available
                            summary = transcript_data.get('summary', {})
                            if summary:
                                call.summary = summary.get('overview') or summary.get('short_summary')
                                call.action_items = summary.get('action_items', [])
                                call.key_points = summary.get('keywords', [])

                except json.JSONDecodeError as e:
                    logger.warning(f"Failed to parse __NEXT_DATA__: {e}")

            # Fallback: try to extract text from readable elements
            if not transcript_text:
                # Simple extraction of visible text
                from html.parser import HTMLParser

                class TextExtractor(HTMLParser):
                    def __init__(self):
                        super().__init__()
                        self.text_parts = []
                        self.in_script = False
                        self.in_style = False

                    def handle_starttag(self, tag, attrs):
                        if tag in ('script', 'style'):
                            self.in_script = True

                    def handle_endtag(self, tag):
                        if tag in ('script', 'style'):
                            self.in_script = False

                    def handle_data(self, data):
                        if not self.in_script:
                            text = data.strip()
                            if text and len(text) > 20:  # Skip short fragments
                                self.text_parts.append(text)

                extractor = TextExtractor()
                extractor.feed(html)

                if extractor.text_parts:
                    transcript_text = "\n".join(extractor.text_parts)

            if not transcript_text or len(transcript_text) < 50:
                call.status = CallStatus.failed
                call.error_message = "Could not extract transcript from Fireflies page. The link might not be public or the format changed."
                return call

            # Update call with extracted data
            if title and (not call.title or call.title.startswith("External Recording")):
                call.title = title

            call.transcript = transcript_text

            # Run AI analysis if no summary from Fireflies
            if not call.summary:
                call.status = CallStatus.analyzing
                call_processor._init_clients()
                analysis = await call_processor._analyze(call.transcript)
                call.summary = analysis.get("summary")
                call.action_items = analysis.get("action_items")
                call.key_points = analysis.get("key_points")

            call.status = CallStatus.done
            call.processed_at = datetime.utcnow()

            logger.info(f"Fireflies transcript processed: {len(call.transcript)} chars")

        except Exception as e:
            logger.error(f"Error processing Fireflies: {e}")
            call.status = CallStatus.failed
            call.error_message = str(e)

        return call

    async def _process_google_doc(self, call: CallRecording, url: str) -> CallRecording:
        """
        Process Google Docs document as a transcript.
        Parses the document text and runs AI analysis.
        """
        try:
            # Parse document using google_docs_service
            result = await google_docs_service.parse_from_url(url)

            if not result or not result.content:
                call.status = CallStatus.failed
                error_msg = result.error if result and result.error else "document may not be public"
                call.error_message = f"Failed to parse Google Doc - {error_msg}"
                return call

            # Store document text as transcript
            call.transcript = result.content
            if result.metadata and result.metadata.get('title'):
                call.title = result.metadata.get('title')

            # Run AI analysis
            call.status = CallStatus.analyzing
            call_processor._init_clients()
            analysis = await call_processor._analyze(call.transcript)
            if analysis:
                call.summary = analysis.get("summary")
                call.action_items = analysis.get("action_items")
                call.key_points = analysis.get("key_points")

            call.status = CallStatus.done
            call.processed_at = datetime.utcnow()

            logger.info(f"Google Doc processed: {len(call.transcript)} chars")

        except Exception as e:
            logger.error(f"Error processing Google Doc: {e}")
            call.status = CallStatus.failed
            call.error_message = str(e)

        return call

    async def _process_google_sheet(self, call: CallRecording, url: str) -> CallRecording:
        """
        Process Google Sheets as text data.
        Exports the spreadsheet as CSV/text and runs AI analysis.
        """
        try:
            # Extract sheet ID
            match = re.search(r'spreadsheets/d/([a-zA-Z0-9_-]+)', url)
            if not match:
                call.status = CallStatus.failed
                call.error_message = "Invalid Google Sheets URL"
                return call

            sheet_id = match.group(1)

            # Try to export as CSV (public sheet)
            export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"

            session = await self._get_session()
            async with session.get(export_url, allow_redirects=True) as response:
                if response.status != 200:
                    call.status = CallStatus.failed
                    call.error_message = "Failed to export Google Sheet - document may not be public"
                    return call

                text = await response.text()

            if not text.strip():
                call.status = CallStatus.failed
                call.error_message = "Google Sheet is empty"
                return call

            # Store CSV text as transcript
            call.transcript = text
            call.title = call.title or f"Google Sheet - {sheet_id[:8]}"

            # Run AI analysis
            call.status = CallStatus.analyzing
            call_processor._init_clients()
            analysis = await call_processor._analyze(call.transcript)
            if analysis:
                call.summary = analysis.get("summary")
                call.action_items = analysis.get("action_items")
                call.key_points = analysis.get("key_points")

            call.status = CallStatus.done
            call.processed_at = datetime.utcnow()

            logger.info(f"Google Sheet processed: {len(call.transcript)} chars")

        except Exception as e:
            logger.error(f"Error processing Google Sheet: {e}")
            call.status = CallStatus.failed
            call.error_message = str(e)

        return call

    async def _process_google_form(self, call: CallRecording, url: str) -> CallRecording:
        """
        Process Google Forms responses as text data.
        Fetches form data and runs AI analysis.
        """
        try:
            # Extract form ID
            match = re.search(r'forms/d/([a-zA-Z0-9_-]+)', url)
            if not match:
                # Try e/ format for published forms
                match = re.search(r'forms/d/e/([a-zA-Z0-9_-]+)', url)

            if not match:
                call.status = CallStatus.failed
                call.error_message = "Invalid Google Forms URL"
                return call

            form_id = match.group(1)

            # Fetch the form page
            session = await self._get_session()
            async with session.get(url, allow_redirects=True) as response:
                if response.status != 200:
                    call.status = CallStatus.failed
                    call.error_message = "Failed to fetch Google Form - may not be accessible"
                    return call

                html = await response.text()

            # Parse form content
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html, 'html.parser')

            # Extract text content
            text_parts = []

            # Get form title
            title_elem = soup.find('div', {'class': 'freebirdFormviewerViewHeaderTitle'})
            if title_elem:
                text_parts.append(f"Title: {title_elem.get_text(strip=True)}")

            # Get form description
            desc_elem = soup.find('div', {'class': 'freebirdFormviewerViewHeaderDescription'})
            if desc_elem:
                text_parts.append(f"Description: {desc_elem.get_text(strip=True)}")

            # Get all text from questions
            for elem in soup.find_all(['div', 'span'], string=True):
                text = elem.get_text(strip=True)
                if text and len(text) > 3:
                    text_parts.append(text)

            if not text_parts:
                call.status = CallStatus.failed
                call.error_message = "Could not extract text from Google Form"
                return call

            call.transcript = "\n".join(text_parts)
            call.title = call.title or f"Google Form - {form_id[:8]}"

            # Run AI analysis
            call.status = CallStatus.analyzing
            call_processor._init_clients()
            analysis = await call_processor._analyze(call.transcript)
            if analysis:
                call.summary = analysis.get("summary")
                call.action_items = analysis.get("action_items")
                call.key_points = analysis.get("key_points")

            call.status = CallStatus.done
            call.processed_at = datetime.utcnow()

            logger.info(f"Google Form processed: {len(call.transcript)} chars")

        except Exception as e:
            logger.error(f"Error processing Google Form: {e}")
            call.status = CallStatus.failed
            call.error_message = str(e)

        return call

    async def _process_google_drive(self, call: CallRecording, url: str) -> CallRecording:
        """
        Process file from Google Drive.
        Downloads the file and processes like regular audio.
        """
        try:
            file_id = self._extract_gdrive_file_id(url)
            if not file_id:
                call.status = CallStatus.failed
                call.error_message = "Invalid Google Drive URL"
                return call

            # Download file
            download_url = f"https://drive.google.com/uc?export=download&id={file_id}"
            file_path = await self._download_file(download_url, f"gdrive_{file_id}")

            if not file_path:
                call.status = CallStatus.failed
                call.error_message = "Failed to download file from Google Drive"
                return call

            call.audio_file_path = file_path

            # Let call_processor handle the rest
            return call

        except Exception as e:
            logger.error(f"Error processing Google Drive: {e}")
            call.status = CallStatus.failed
            call.error_message = str(e)

        return call

    async def _process_direct_media(self, call: CallRecording, url: str) -> CallRecording:
        """
        Process direct media URL.
        Downloads the file and sets up for processing.
        """
        try:
            parsed = urlparse(url)
            filename = os.path.basename(parsed.path) or "media_file"

            file_path = await self._download_file(url, filename)

            if not file_path:
                call.status = CallStatus.failed
                call.error_message = "Failed to download media file"
                return call

            call.audio_file_path = file_path

            # The call will be processed by call_processor after save
            return call

        except Exception as e:
            logger.error(f"Error processing direct media: {e}")
            call.status = CallStatus.failed
            call.error_message = str(e)

        return call

    async def _process_unknown(self, call: CallRecording, url: str) -> CallRecording:
        """
        Try to process unknown URL type.
        First try to download and detect content type.
        """
        try:
            session = await self._get_session()
            async with session.head(url, allow_redirects=True) as response:
                content_type = response.headers.get('Content-Type', '')

                # Check if it's audio/video
                if any(t in content_type.lower() for t in ['audio', 'video']):
                    return await self._process_direct_media(call, url)

                # Check if it's text/html (might be a document)
                if 'text' in content_type.lower():
                    call.status = CallStatus.failed
                    call.error_message = "URL appears to be a web page, not a media file. Use Google Docs links for documents."
                    return call

            call.status = CallStatus.failed
            call.error_message = f"Unsupported URL type. Supported: Google Docs, Google Drive, or direct media links."

        except Exception as e:
            logger.error(f"Error processing unknown URL: {e}")
            call.status = CallStatus.failed
            call.error_message = str(e)

        return call

    async def _download_file(self, url: str, filename: str) -> Optional[str]:
        """
        Download file from URL to temp directory.

        Returns:
            Path to downloaded file, or None on failure
        """
        try:
            session = await self._get_session()

            # Get content type to determine extension
            async with session.get(url, allow_redirects=True) as response:
                if response.status != 200:
                    logger.error(f"Download failed: HTTP {response.status}")
                    return None

                content_type = response.headers.get('Content-Type', '')

                # Determine extension
                ext = self._content_type_to_ext(content_type)
                if not ext:
                    ext = os.path.splitext(filename)[1] or '.tmp'

                # Create temp file
                file_path = os.path.join(self.temp_dir, f"{filename}{ext}")

                # Download
                with open(file_path, 'wb') as f:
                    async for chunk in response.content.iter_chunked(8192):
                        f.write(chunk)

                file_size = os.path.getsize(file_path)
                logger.info(f"Downloaded file: {file_path} ({file_size} bytes)")

                return file_path

        except Exception as e:
            logger.error(f"Error downloading file: {e}")
            return None

    def _content_type_to_ext(self, content_type: str) -> str:
        """Convert Content-Type to file extension."""
        content_type = content_type.lower().split(';')[0].strip()

        mapping = {
            'audio/mpeg': '.mp3',
            'audio/mp3': '.mp3',
            'audio/wav': '.wav',
            'audio/x-wav': '.wav',
            'audio/mp4': '.m4a',
            'audio/x-m4a': '.m4a',
            'audio/ogg': '.ogg',
            'audio/webm': '.webm',
            'video/mp4': '.mp4',
            'video/webm': '.webm',
            'video/x-matroska': '.mkv',
            'video/quicktime': '.mov',
        }

        return mapping.get(content_type, '')

    async def process_call_audio(self, call_id: int):
        """
        Process downloaded audio file for a call.
        This is called after the CallRecording is saved with audio_file_path.
        """
        await call_processor.process_call(call_id)


# Singleton instance
external_link_processor = ExternalLinkProcessor()
