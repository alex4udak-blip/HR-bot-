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
import asyncio
import subprocess
import aiohttp
from datetime import datetime
from typing import Optional, Tuple
from urllib.parse import urlparse, unquote

from ..config import settings
from ..models.database import CallRecording, CallSource, CallStatus
from .google_docs import google_docs_service
from .call_processor import call_processor

logger = logging.getLogger("hr-analyzer.external_links")

# Track Playwright installation status
_playwright_installed = False
_playwright_install_attempted = False


async def ensure_playwright_installed() -> bool:
    """
    Ensure Playwright browsers are installed.
    Auto-installs chromium if not present.
    Returns True if Playwright is ready to use.
    """
    global _playwright_installed, _playwright_install_attempted

    if _playwright_installed:
        return True

    if _playwright_install_attempted:
        return False

    _playwright_install_attempted = True

    # Log environment info for debugging
    browsers_path = os.environ.get('PLAYWRIGHT_BROWSERS_PATH', 'not set')
    logger.info(f"Playwright check - PLAYWRIGHT_BROWSERS_PATH: {browsers_path}")

    # Check if chromium is already installed
    try:
        from playwright.async_api import async_playwright
        logger.info("Attempting to launch Playwright chromium...")
        async with async_playwright() as p:
            # Try to launch with --no-sandbox for Docker/Railway environments
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--single-process'
                ]
            )
            await browser.close()
            _playwright_installed = True
            logger.info("Playwright chromium is ready and working")
            return True
    except Exception as e:
        logger.warning(f"Playwright launch failed: {type(e).__name__}: {e}", exc_info=True)

    # Try to install chromium
    logger.info("Installing Playwright chromium browser...")
    try:
        result = await asyncio.create_subprocess_exec(
            "playwright", "install", "chromium",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(result.communicate(), timeout=300)

        if result.returncode == 0:
            logger.info("Playwright chromium installed successfully")
            _playwright_installed = True
            return True
        else:
            logger.error(f"Playwright install failed: {stderr.decode()}")
            return False
    except asyncio.TimeoutError:
        logger.error("Playwright install timed out after 5 minutes")
        return False
    except FileNotFoundError:
        logger.error("Playwright CLI not found - pip install playwright first")
        return False
    except Exception as e:
        logger.error(f"Failed to install Playwright: {e}")
        return False


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
                call.source_type = CallSource.fireflies
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
            try:
                await db.commit()
                await db.refresh(call)
            except Exception as db_error:
                logger.error(f"Database error saving CallRecording: {type(db_error).__name__}: {db_error}", exc_info=True)
                raise

            logger.info(f"Created CallRecording {call.id} from external URL")
            return call

    async def _process_fireflies(self, call: CallRecording, url: str) -> CallRecording:
        """
        Process Fireflies.ai shared/public transcript URL.
        Uses Playwright to render the page and extract transcript.

        NOTE: This handles PUBLIC shared Fireflies links, not the internal API.
        Fireflies uses client-side rendering, so Playwright is required for reliable extraction.
        """
        try:
            transcript_id = self._extract_fireflies_transcript_id(url)
            if not transcript_id:
                call.status = CallStatus.failed
                call.error_message = "Invalid Fireflies URL - could not extract transcript ID"
                return call

            call.status = CallStatus.transcribing
            call.fireflies_transcript_id = transcript_id

            logger.info(f"Fetching Fireflies transcript: {url}")

            transcript_text = None
            title = None
            speakers = []

            # Fireflies uses client-side rendering - Playwright is required
            playwright_ready = await ensure_playwright_installed()

            if playwright_ready:
                try:
                    from playwright.async_api import async_playwright

                    logger.info("Using Playwright for Fireflies extraction")
                    async with async_playwright() as p:
                        # Launch with --no-sandbox for Docker/Railway environments
                        browser = await p.chromium.launch(
                            headless=True,
                            args=[
                                '--no-sandbox',
                                '--disable-setuid-sandbox',
                                '--disable-dev-shm-usage',
                                '--disable-gpu',
                                '--single-process'
                            ]
                        )
                        context = await browser.new_context(
                            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                            viewport={'width': 1920, 'height': 1080},
                            locale='en-US'
                        )
                        page = await context.new_page()

                        # Navigate to the page with longer timeout for heavy JS apps
                        try:
                            await page.goto(url, wait_until='networkidle', timeout=90000)
                        except Exception as nav_err:
                            logger.warning(f"Navigation with networkidle failed: {nav_err}, trying domcontentloaded")
                            await page.goto(url, wait_until='domcontentloaded', timeout=60000)
                            await page.wait_for_timeout(10000)  # Extra wait for JS

                        # Wait for transcript content to load - try multiple selectors
                        transcript_loaded = False
                        wait_selectors = [
                            '[class*="transcript"]',
                            '[class*="Transcript"]',
                            '[class*="sentence"]',
                            '[class*="Sentence"]',
                            '.is-speaker',
                            '[data-testid*="transcript"]',
                        ]

                        for wait_selector in wait_selectors:
                            try:
                                await page.wait_for_selector(wait_selector, timeout=10000)
                                transcript_loaded = True
                                logger.info(f"Found transcript element with selector: {wait_selector}")
                                break
                            except Exception:
                                continue

                        if not transcript_loaded:
                            # Extra wait for dynamic content
                            logger.warning("No transcript selectors found, waiting extra time for JS rendering")
                            await page.wait_for_timeout(15000)

                            # Get page HTML and URL for debugging
                            try:
                                current_url = page.url
                                page_content = await page.content()
                                page_title = await page.title()

                                logger.info(f"Page URL after loading: {current_url}")
                                logger.info(f"Page title: {page_title}")
                                logger.info(f"Page content length: {len(page_content)} chars")

                                # Check for common issues
                                if "sign" in current_url.lower() or "login" in current_url.lower():
                                    logger.error("FIREFLIES ERROR: Page redirected to login - link is NOT publicly shared!")
                                    call.error_message = "Fireflies link requires login. Please share the link publicly: click 'Share' > enable 'Anyone with link can view'"
                                elif "captcha" in page_content.lower() or "verify" in page_title.lower():
                                    logger.error("FIREFLIES ERROR: Captcha or verification detected")
                                    call.error_message = "Fireflies is showing captcha/verification. Try again later or use a different link."
                                elif "not found" in page_title.lower() or "404" in page_content[:1000]:
                                    logger.error("FIREFLIES ERROR: Page not found (404)")
                                    call.error_message = "Fireflies transcript not found. The link may be expired or invalid."
                                elif len(page_content) < 1000:
                                    logger.warning(f"Page content seems too short: {page_content[:500]}")

                                # Save screenshot for debugging
                                try:
                                    screenshot_path = f"/tmp/fireflies_debug_{transcript_id}.png"
                                    await page.screenshot(path=screenshot_path, full_page=True)
                                    logger.info(f"Debug screenshot saved: {screenshot_path}")
                                except Exception as ss_err:
                                    logger.debug(f"Screenshot failed: {ss_err}")

                            except Exception as debug_err:
                                logger.debug(f"Debug info extraction failed: {debug_err}")

                        # Try to get title
                        try:
                            title_selectors = ['h1', '[class*="MeetingTitle"]', '[class*="title"]', '[class*="Title"]']
                            for ts in title_selectors:
                                title_el = await page.query_selector(ts)
                                if title_el:
                                    title = await title_el.text_content()
                                    if title and title.strip() and len(title.strip()) > 3:
                                        title = title.strip()
                                        break
                        except Exception as e:
                            logger.debug(f"Title extraction failed: {e}")

                        # Extract transcript - updated selectors for modern Fireflies UI
                        transcript_parts = []
                        speaker_data = []

                        # Modern Fireflies selectors (2024-2025) - updated for latest UI
                        selectors = [
                            # Primary: Direct transcript text elements
                            '[data-testid="transcript-text"]',
                            '[data-testid*="sentence"]',
                            '[data-testid*="transcript"]',
                            # Sentence-based extraction (best quality)
                            '[class*="SentenceItem"], [class*="sentence-item"]',
                            '[class*="TranscriptSentence"], [class*="transcript-sentence"]',
                            '[class*="TranscriptLine"], [class*="transcript-line"]',
                            # Speaker blocks with text
                            '[class*="SpeakerSegment"], [class*="speaker-segment"]',
                            '[class*="SpeakerBlock"], [class*="speaker-block"]',
                            '.is-speaker',
                            # Generic transcript containers
                            '[class*="transcript"] p',
                            '[class*="transcript"] [class*="text"]',
                            '[class*="Transcript"] [class*="Text"]',
                            # React/Next.js dynamic content
                            '[class*="css-"][class*="text"]',
                            'div[class*="transcript"] > div > div',
                            # Fallback - any sentence-like elements
                            '[class*="sentence"]',
                            '[class*="Sentence"]',
                        ]

                        for selector in selectors:
                            try:
                                elements = await page.query_selector_all(selector)
                                if elements and len(elements) > 0:
                                    logger.info(f"Found {len(elements)} elements with selector: {selector}")

                                    for el in elements:
                                        # Try to get speaker name from parent or sibling
                                        speaker_name = "Speaker"
                                        try:
                                            # Look for speaker in parent or nearby elements
                                            speaker_el = await el.query_selector('[class*="speaker"], [class*="Speaker"], [class*="name"], [class*="Name"]')
                                            if speaker_el:
                                                speaker_name = await speaker_el.text_content() or "Speaker"
                                            else:
                                                # Try data attribute
                                                speaker_name = await el.get_attribute('data-speaker') or "Speaker"
                                        except Exception:
                                            pass

                                        # Get text content
                                        text = await el.text_content()
                                        if text and text.strip():
                                            clean_text = text.strip()
                                            # Skip if it's just the speaker name or too short
                                            if len(clean_text) > 2 and clean_text.lower() != speaker_name.lower():
                                                transcript_parts.append(clean_text)

                                                # Try to get timing
                                                start_time = 0
                                                end_time = 0
                                                try:
                                                    start_time = float(await el.get_attribute('data-start') or 0)
                                                    end_time = float(await el.get_attribute('data-end') or 0)
                                                except Exception:
                                                    pass

                                                speaker_data.append({
                                                    "speaker": speaker_name.strip(),
                                                    "text": clean_text,
                                                    "start": start_time,
                                                    "end": end_time
                                                })

                                    if transcript_parts:
                                        logger.info(f"Extracted {len(transcript_parts)} transcript parts")
                                        break
                            except Exception as sel_err:
                                logger.debug(f"Selector {selector} failed: {sel_err}")
                                continue

                        # If no transcript found, try main content as fallback
                        if not transcript_parts:
                            logger.warning("No transcript elements found, trying main content fallback")
                            try:
                                main_content = await page.query_selector('main, [class*="content"], [class*="Content"], [role="main"]')
                                if main_content:
                                    text = await main_content.text_content()
                                    if text:
                                        # Filter out short lines and navigation elements
                                        lines = []
                                        for line in text.split('\n'):
                                            line = line.strip()
                                            if line and len(line) > 15 and not any(skip in line.lower() for skip in ['sign in', 'log in', 'cookie', 'privacy', 'terms']):
                                                lines.append(line)
                                        transcript_parts = lines
                            except Exception as main_err:
                                logger.debug(f"Main content fallback failed: {main_err}")

                        await browser.close()

                        if transcript_parts:
                            transcript_text = "\n".join(transcript_parts)
                            if speaker_data:
                                speakers = speaker_data
                            logger.info(f"Playwright extracted {len(transcript_text)} chars, {len(speakers)} speaker segments from Fireflies")

                except ImportError:
                    logger.warning("Playwright not installed, falling back to HTTP scraping")
                except Exception as e:
                    logger.error(f"Playwright failed: {type(e).__name__}: {e}", exc_info=True)
            else:
                logger.warning("Playwright not available - Fireflies requires JavaScript rendering for reliable extraction")

            # Fallback to HTTP if Playwright didn't work (may not work for JS-rendered content)
            if not transcript_text:
                logger.info("Attempting HTTP fallback for Fireflies transcript extraction")
                try:
                    session = await self._get_session()
                    async with session.get(url, headers={
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                    }, timeout=aiohttp.ClientTimeout(total=30)) as response:
                        if response.status != 200:
                            logger.warning(f"Fireflies HTTP request returned status {response.status}")
                            call.status = CallStatus.failed
                            call.error_message = f"Failed to access Fireflies link: HTTP {response.status}"
                            return call

                        html = await response.text()
                        logger.info(f"Fireflies HTTP response received: {len(html)} chars")

                    # Try __NEXT_DATA__ extraction (Next.js SSR data)
                    import json
                    next_data_match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)

                    if next_data_match:
                        logger.info("Found __NEXT_DATA__ in Fireflies page, parsing...")
                        try:
                            next_data = json.loads(next_data_match.group(1))
                            page_props = next_data.get('props', {}).get('pageProps', {})
                            transcript_data = page_props.get('transcript', {})

                            if transcript_data:
                                title = title or transcript_data.get('title')
                                sentences = transcript_data.get('sentences', [])

                                if sentences:
                                    lines = []
                                    for s in sentences:
                                        speaker = s.get('speaker_name', 'Speaker')
                                        text = s.get('text', s.get('raw_text', ''))
                                        if text:
                                            lines.append(f"{speaker}: {text}")
                                    transcript_text = "\n".join(lines)

                                    # Extract speakers
                                    speakers = []
                                    for s in sentences:
                                        speakers.append({
                                            "speaker": s.get("speaker_name", "Speaker"),
                                            "start": s.get("start_time", 0),
                                            "end": s.get("end_time", 0),
                                            "text": s.get("text", s.get("raw_text", ""))
                                        })
                                    call.speakers = speakers
                                    call.duration_seconds = transcript_data.get('duration')

                                    logger.info(f"HTTP fallback extracted {len(transcript_text)} chars from Fireflies via __NEXT_DATA__")
                                else:
                                    logger.warning("No sentences found in Fireflies transcript_data")
                            else:
                                logger.warning("No transcript_data found in Fireflies pageProps")

                        except json.JSONDecodeError as e:
                            logger.warning(f"Failed to parse __NEXT_DATA__: {e}")
                    else:
                        logger.warning("No __NEXT_DATA__ found in Fireflies page - transcript may require JavaScript rendering")

                except aiohttp.ClientError as e:
                    logger.error(f"HTTP request to Fireflies failed: {e}")
                except asyncio.TimeoutError:
                    logger.error("HTTP request to Fireflies timed out")
                except Exception as e:
                    logger.error(f"Unexpected error in Fireflies HTTP fallback: {type(e).__name__}: {e}")

            # Lower minimum to 20 chars to handle short meetings
            if not transcript_text or len(transcript_text) < 20:
                logger.warning(f"Fireflies transcript too short or empty: {len(transcript_text) if transcript_text else 0} chars")
                call.status = CallStatus.failed
                call.error_message = (
                    "Could not extract transcript from Fireflies. Please check:\n"
                    "1. The link is publicly shared (click 'Share' in Fireflies and enable 'Anyone with link')\n"
                    "2. The meeting has a transcript (not just a scheduled meeting)\n"
                    "3. The link is valid and not expired\n"
                    "If issue persists, check server logs for details."
                )
                return call

            # Update call with extracted data
            if title and (not call.title or call.title.startswith("External Recording") or call.title.startswith("Auto-imported")):
                call.title = title

            call.transcript = transcript_text

            # Save speakers data if extracted
            if speakers and not call.speakers:
                call.speakers = speakers
                logger.info(f"Saved {len(speakers)} speaker segments")

            logger.info(f"Fireflies transcript extracted: {len(transcript_text)} chars")

            # Run AI analysis
            try:
                call.status = CallStatus.analyzing
                call_processor._init_clients()
                analysis = await call_processor._analyze(call.transcript)
                if analysis:
                    call.summary = analysis.get("summary")
                    call.action_items = analysis.get("action_items")
                    call.key_points = analysis.get("key_points")
                    logger.info("Fireflies AI analysis complete")
                else:
                    logger.warning("Fireflies AI analysis returned None")
            except Exception as e:
                logger.error(f"Fireflies AI analysis failed: {type(e).__name__}: {e}")
                # Don't fail the whole process - we still have the transcript
                call.summary = None
                call.action_items = None
                call.key_points = None

            call.status = CallStatus.done
            call.processed_at = datetime.utcnow()

            logger.info(f"Fireflies transcript processed successfully: {len(call.transcript)} chars")

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
