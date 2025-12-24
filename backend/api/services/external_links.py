"""
External Links Processor Service.

Processes external URLs containing call recordings or transcripts:
- Google Docs (already transcribed)
- Google Drive (audio/video files)
- Direct URLs (audio/video files)
"""

import os
import re
import logging
import tempfile
import aiohttp
from datetime import datetime
from typing import Optional, Tuple
from urllib.parse import urlparse

from ..config import settings
from ..models.database import CallRecording, CallSource, CallStatus
from .google_docs import google_docs_service
from .call_processor import call_processor

logger = logging.getLogger("hr-analyzer.external_links")


class LinkType:
    """Constants for link types."""
    GOOGLE_DOC = "google_doc"
    GOOGLE_DRIVE = "google_drive"
    DIRECT_MEDIA = "direct_media"
    UNKNOWN = "unknown"


class ExternalLinkProcessor:
    """Processes external links to call recordings or transcripts."""

    # Supported media extensions
    MEDIA_EXTENSIONS = {'.mp3', '.mp4', '.wav', '.m4a', '.webm', '.ogg', '.aac', '.flac', '.wma', '.avi', '.mov', '.mkv'}

    # Google Drive file URL pattern
    GDRIVE_PATTERN = re.compile(r'drive\.google\.com/file/d/([a-zA-Z0-9_-]+)')
    GDRIVE_OPEN_PATTERN = re.compile(r'drive\.google\.com/open\?id=([a-zA-Z0-9_-]+)')

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

        # Google Docs
        if "docs.google.com/document" in url_lower:
            return LinkType.GOOGLE_DOC

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
            url: External URL (Google Docs, Google Drive, or direct media)
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

            if link_type == LinkType.GOOGLE_DOC:
                call.source_type = CallSource.google_doc
                call = await self._process_google_doc(call, url)

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

    async def _process_google_doc(self, call: CallRecording, url: str) -> CallRecording:
        """
        Process Google Doc as a transcript.
        Skip transcription, go directly to AI analysis.
        """
        try:
            call.status = CallStatus.transcribing

            # Parse document
            result = await google_docs_service.parse_from_url(url)

            if result.status != "parsed":
                call.status = CallStatus.failed
                call.error_message = result.error or "Failed to parse Google Doc"
                return call

            # Document content is the transcript
            call.transcript = result.content
            call.status = CallStatus.analyzing

            # Run AI analysis
            call_processor._init_clients()
            analysis = await call_processor._analyze(result.content)

            call.summary = analysis.get("summary")
            call.action_items = analysis.get("action_items")
            call.key_points = analysis.get("key_points")

            call.status = CallStatus.done
            call.processed_at = datetime.utcnow()

            logger.info(f"Google Doc processed: {len(result.content)} chars")

        except Exception as e:
            logger.error(f"Error processing Google Doc: {e}")
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
