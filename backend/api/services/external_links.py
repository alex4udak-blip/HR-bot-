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

    async def _process_fireflies(self, call: CallRecording, url: str, call_id: Optional[int] = None) -> CallRecording:
        """
        Process Fireflies.ai shared/public transcript URL.
        Uses Playwright to render the page and extract transcript.

        NOTE: This handles PUBLIC shared Fireflies links, not the internal API.
        Fireflies uses client-side rendering, so Playwright is required for reliable extraction.

        Args:
            call: CallRecording object
            url: Fireflies URL
            call_id: Optional call ID for progress tracking (if processing async)
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

                        # Progress: Page loaded
                        if call_id:
                            await self._update_progress(call_id, 30, "Страница загружена, ищем транскрипт...")

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

                        # First try to extract from __NEXT_DATA__ (most reliable for timestamps)
                        try:
                            page_html = await page.content()
                            import json as json_module
                            next_data_match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page_html, re.DOTALL)
                            if next_data_match:
                                logger.info("Found __NEXT_DATA__ in Fireflies page via Playwright")
                                next_data = json_module.loads(next_data_match.group(1))
                                page_props = next_data.get('props', {}).get('pageProps', {})
                                transcript_data = page_props.get('transcript', {})

                                if transcript_data:
                                    # Log all available fields in transcript_data
                                    logger.info(f"Fireflies transcript_data keys: {list(transcript_data.keys())}")

                                    title = transcript_data.get('title')
                                    sentences = transcript_data.get('sentences', [])

                                    # Extract participants info (email, name) if available
                                    participants = transcript_data.get('participants', []) or transcript_data.get('attendees', []) or []
                                    if participants:
                                        logger.info(f"Fireflies participants ({len(participants)}): {participants[:3]}...")  # Log first 3

                                    # Also check for speakers list with more info
                                    speakers_info = transcript_data.get('speakers', []) or []
                                    if speakers_info:
                                        logger.info(f"Fireflies speakers info ({len(speakers_info)}): {speakers_info[:3]}...")

                                    # Build speaker ID → name mapping
                                    speaker_map = {}
                                    # Try speakers list first (usually has id and name)
                                    for sp in speakers_info:
                                        sp_id = sp.get('id') or sp.get('speaker_id') or sp.get('speakerId')
                                        sp_name = sp.get('name') or sp.get('displayName') or sp.get('speaker_name')
                                        sp_email = sp.get('email')
                                        if sp_id:
                                            # Include email in name if available for matching
                                            if sp_name and sp_email:
                                                speaker_map[str(sp_id)] = f"{sp_name} ({sp_email})"
                                            elif sp_name:
                                                speaker_map[str(sp_id)] = sp_name
                                        # Also map by name in case sentence uses name directly
                                        if sp_name:
                                            speaker_map[sp_name] = sp_name if not sp_email else f"{sp_name} ({sp_email})"

                                    # Also use participants list
                                    for i, p in enumerate(participants):
                                        if isinstance(p, dict):
                                            p_id = p.get('id') or p.get('participantId') or str(i)
                                            p_name = p.get('name') or p.get('displayName') or p.get('email', f'Participant {i+1}')
                                            p_email = p.get('email')
                                            if p_name and p_email and not p_name.endswith(')'):
                                                speaker_map[str(p_id)] = f"{p_name} ({p_email})"
                                            else:
                                                speaker_map[str(p_id)] = p_name
                                        elif isinstance(p, str):
                                            # Simple string participant
                                            speaker_map[str(i)] = p

                                    if speaker_map:
                                        logger.info(f"Built speaker mapping: {speaker_map}")

                                    # Log first sentence structure to understand fields
                                    if sentences:
                                        logger.info(f"Fireflies sentence structure (first): {list(sentences[0].keys())}")
                                        logger.info(f"Fireflies first sentence sample: {sentences[0]}")

                                    if sentences:
                                        lines = []
                                        speakers = []

                                        for s in sentences:
                                            # Get speaker name - try multiple approaches
                                            speaker_name = None

                                            # 1. Try direct name fields (most common)
                                            for name_key in ['speaker_name', 'speakerName', 'name', 'speaker', 'user_name', 'userName', 'participant_name']:
                                                val = s.get(name_key)
                                                if val and val != 'Speaker' and not str(val).startswith('Speaker '):
                                                    speaker_name = val
                                                    break

                                            # 2. Try nested objects (Fireflies sometimes uses this)
                                            if not speaker_name or speaker_name == 'Speaker':
                                                for obj_key in ['user', 'speaker', 'participant', 'attendee']:
                                                    obj = s.get(obj_key)
                                                    if isinstance(obj, dict):
                                                        for name_key in ['name', 'displayName', 'full_name', 'email']:
                                                            val = obj.get(name_key)
                                                            if val and val != 'Speaker':
                                                                speaker_name = val
                                                                break
                                                    if speaker_name and speaker_name != 'Speaker':
                                                        break

                                            # 3. Try to map speaker ID to name from speaker_map
                                            if not speaker_name or speaker_name == 'Speaker':
                                                for id_key in ['speaker_id', 'speakerId', 'speaker_index', 'speakerIndex', 'user_id', 'userId', 'participant_id']:
                                                    sp_id = s.get(id_key)
                                                    if sp_id is not None and str(sp_id) in speaker_map:
                                                        speaker_name = speaker_map[str(sp_id)]
                                                        break

                                            # 4. Use index in speakers_info if available
                                            if not speaker_name or speaker_name == 'Speaker':
                                                sp_idx = s.get('speaker_index') or s.get('speakerIndex') or s.get('speaker_id')
                                                if sp_idx is not None:
                                                    try:
                                                        idx = int(sp_idx)
                                                        if speakers_info and 0 <= idx < len(speakers_info):
                                                            sp_info = speakers_info[idx]
                                                            speaker_name = sp_info.get('name') or sp_info.get('displayName') or sp_info.get('email')
                                                    except (ValueError, TypeError):
                                                        pass

                                            # 5. Check ai_filters or other Fireflies-specific fields
                                            if not speaker_name or speaker_name == 'Speaker':
                                                ai_filters = s.get('ai_filters') or s.get('aiFilters') or {}
                                                if isinstance(ai_filters, dict):
                                                    speaker_name = ai_filters.get('speaker_name') or ai_filters.get('speakerName')

                                            speaker_name = speaker_name or 'Speaker'

                                            # Log first few sentences to debug speaker extraction
                                            if len(speakers) < 3:
                                                logger.debug(f"Sentence {len(speakers)}: extracted speaker='{speaker_name}' from keys={list(s.keys())}")

                                            text = s.get('text', s.get('raw_text', ''))
                                            if text:
                                                lines.append(f"{speaker_name}: {text}")

                                            # Extract timestamps - try many possible field names
                                            # Note: 0 is a valid timestamp (start of recording), so we use found_start flag
                                            start = None
                                            for key in ["start_time", "startTime", "start", "s", "begin", "from", "timestamp"]:
                                                val = s.get(key)
                                                if val is not None:
                                                    try:
                                                        start = float(val)
                                                        break  # Found a value, don't check other keys
                                                    except (ValueError, TypeError):
                                                        pass
                                            # Also check millisecond variants if not found
                                            if start is None:
                                                for key in ["start_ms", "startMs", "sMs"]:
                                                    val = s.get(key)
                                                    if val is not None:
                                                        try:
                                                            start = float(val) / 1000
                                                            break
                                                        except (ValueError, TypeError):
                                                            pass
                                            start = start if start is not None else 0

                                            end = None
                                            for key in ["end_time", "endTime", "end", "e", "to", "finish"]:
                                                val = s.get(key)
                                                if val is not None:
                                                    try:
                                                        end = float(val)
                                                        break  # Found a value, don't check other keys
                                                    except (ValueError, TypeError):
                                                        pass
                                            # Also check millisecond variants if not found
                                            if end is None:
                                                for key in ["end_ms", "endMs", "eMs"]:
                                                    val = s.get(key)
                                                    if val is not None:
                                                        try:
                                                            end = float(val) / 1000
                                                            break
                                                        except (ValueError, TypeError):
                                                            pass
                                            end = end if end is not None else 0

                                            speakers.append({
                                                "speaker": speaker_name,
                                                "start": start,
                                                "end": end,
                                                "text": text
                                            })

                                        transcript_text = "\n".join(lines)
                                        call.speakers = speakers
                                        call.duration_seconds = transcript_data.get('duration') or transcript_data.get('duration_seconds') or transcript_data.get('duration_sec')

                                        # Log if timestamps were found
                                        has_timestamps = any(sp['start'] > 0 or sp['end'] > 0 for sp in speakers)
                                        logger.info(f"Playwright extracted {len(transcript_text)} chars from __NEXT_DATA__ with {len(speakers)} speakers (has_timestamps={has_timestamps})")

                                        # Progress: Transcript extracted
                                        if call_id:
                                            await self._update_progress(call_id, 50, "Транскрипт извлечён, обработка спикеров...")

                        except Exception as next_data_err:
                            logger.debug(f"__NEXT_DATA__ extraction failed: {next_data_err}")

                        # Try to get title (if not already extracted)
                        if not title:
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

                        # Extract transcript via DOM if __NEXT_DATA__ didn't work
                        transcript_parts = []
                        speaker_data = []

                        if not transcript_text:
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

                            # Set transcript_text from DOM extraction
                            if transcript_parts:
                                transcript_text = "\n".join(transcript_parts)
                                if speaker_data:
                                    speakers = speaker_data
                                logger.info(f"Playwright extracted {len(transcript_text)} chars, {len(speakers)} speaker segments from Fireflies (DOM)")

                                # Progress: Transcript extracted
                                if call_id:
                                    await self._update_progress(call_id, 50, "Транскрипт извлечён, обработка спикеров...")

                        await browser.close()

                except ImportError:
                    logger.warning("Playwright not installed, falling back to HTTP scraping")
                    if call_id:
                        await self._update_progress(call_id, 15, "Playwright недоступен, HTTP fallback...")
                except Exception as e:
                    logger.error(f"Playwright failed: {type(e).__name__}: {e}", exc_info=True)
                    if call_id:
                        await self._update_progress(call_id, 15, "Ошибка Playwright, HTTP fallback...")
            else:
                logger.warning("Playwright not available - Fireflies requires JavaScript rendering for reliable extraction")
                if call_id:
                    await self._update_progress(call_id, 15, "Playwright недоступен, HTTP fallback...")

            # Fallback to HTTP if Playwright didn't work (may not work for JS-rendered content)
            if not transcript_text:
                logger.info("Attempting HTTP fallback for Fireflies transcript extraction")
                if call_id:
                    await self._update_progress(call_id, 20, "HTTP извлечение транскрипта...")
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
                        logger.info("Found __NEXT_DATA__ in Fireflies page (HTTP), parsing...")
                        try:
                            next_data = json.loads(next_data_match.group(1))
                            page_props = next_data.get('props', {}).get('pageProps', {})
                            transcript_data = page_props.get('transcript', {})

                            if transcript_data:
                                title = title or transcript_data.get('title')
                                sentences = transcript_data.get('sentences', [])

                                # Build speaker mapping (same as Playwright version)
                                speakers_info = transcript_data.get('speakers', []) or []
                                participants = transcript_data.get('participants', []) or transcript_data.get('attendees', []) or []
                                speaker_map = {}
                                for sp in speakers_info:
                                    sp_id = sp.get('id') or sp.get('speaker_id') or sp.get('speakerId')
                                    sp_name = sp.get('name') or sp.get('displayName') or sp.get('speaker_name')
                                    sp_email = sp.get('email')
                                    if sp_id:
                                        speaker_map[str(sp_id)] = f"{sp_name} ({sp_email})" if sp_name and sp_email else (sp_name or f"Speaker {sp_id}")
                                    if sp_name:
                                        speaker_map[sp_name] = f"{sp_name} ({sp_email})" if sp_email else sp_name
                                for i, p in enumerate(participants):
                                    if isinstance(p, dict):
                                        p_id = p.get('id') or p.get('participantId') or str(i)
                                        p_name = p.get('name') or p.get('displayName') or p.get('email', f'Participant {i+1}')
                                        p_email = p.get('email')
                                        speaker_map[str(p_id)] = f"{p_name} ({p_email})" if p_email and not p_name.endswith(')') else p_name
                                    elif isinstance(p, str):
                                        speaker_map[str(i)] = p

                                if sentences:
                                    lines = []
                                    speakers = []
                                    for s in sentences:
                                        # Get speaker name with mapping (same logic as Playwright path)
                                        speaker_name = None

                                        # 1. Try direct name fields
                                        for name_key in ['speaker_name', 'speakerName', 'name', 'speaker', 'user_name', 'userName']:
                                            val = s.get(name_key)
                                            if val and val != 'Speaker' and not str(val).startswith('Speaker '):
                                                speaker_name = val
                                                break

                                        # 2. Try nested objects
                                        if not speaker_name or speaker_name == 'Speaker':
                                            for obj_key in ['user', 'speaker', 'participant']:
                                                obj = s.get(obj_key)
                                                if isinstance(obj, dict):
                                                    speaker_name = obj.get('name') or obj.get('displayName') or obj.get('email')
                                                    if speaker_name and speaker_name != 'Speaker':
                                                        break

                                        # 3. Try speaker ID mapping
                                        if not speaker_name or speaker_name == 'Speaker':
                                            for id_key in ['speaker_id', 'speakerId', 'speaker_index', 'speakerIndex']:
                                                sp_id = s.get(id_key)
                                                if sp_id is not None and str(sp_id) in speaker_map:
                                                    speaker_name = speaker_map[str(sp_id)]
                                                    break

                                        # 4. Try index lookup in speakers_info
                                        if not speaker_name or speaker_name == 'Speaker':
                                            sp_idx = s.get('speaker_id') or s.get('speaker_index')
                                            if sp_idx is not None:
                                                try:
                                                    idx = int(sp_idx)
                                                    if speakers_info and 0 <= idx < len(speakers_info):
                                                        sp_info = speakers_info[idx]
                                                        speaker_name = sp_info.get('name') or sp_info.get('displayName')
                                                except (ValueError, TypeError):
                                                    pass

                                        speaker_name = speaker_name or 'Speaker'

                                        text = s.get('text', s.get('raw_text', ''))
                                        if text:
                                            lines.append(f"{speaker_name}: {text}")

                                        # Get timestamps with fallbacks
                                        # Note: 0 is a valid timestamp (start of recording)
                                        start = None
                                        for key in ["start_time", "startTime", "start", "s"]:
                                            val = s.get(key)
                                            if val is not None:
                                                try:
                                                    start = float(val)
                                                    break  # Found a value
                                                except (ValueError, TypeError):
                                                    pass
                                        if start is None and s.get("start_ms"):
                                            try:
                                                start = float(s.get("start_ms")) / 1000
                                            except (ValueError, TypeError):
                                                pass
                                        start = start if start is not None else 0

                                        end = None
                                        for key in ["end_time", "endTime", "end", "e"]:
                                            val = s.get(key)
                                            if val is not None:
                                                try:
                                                    end = float(val)
                                                    break  # Found a value
                                                except (ValueError, TypeError):
                                                    pass
                                        if end is None and s.get("end_ms"):
                                            try:
                                                end = float(s.get("end_ms")) / 1000
                                            except (ValueError, TypeError):
                                                pass
                                        end = end if end is not None else 0

                                        speakers.append({
                                            "speaker": speaker_name,
                                            "start": start,
                                            "end": end,
                                            "text": text
                                        })

                                    transcript_text = "\n".join(lines)
                                    call.speakers = speakers
                                    call.duration_seconds = transcript_data.get('duration') or transcript_data.get('duration_seconds')

                                    has_timestamps = any(sp['start'] > 0 or sp['end'] > 0 for sp in speakers)
                                    logger.info(f"HTTP fallback extracted {len(transcript_text)} chars from Fireflies (has_timestamps={has_timestamps})")
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

            # Progress: Starting AI analysis
            if call_id:
                await self._update_progress(call_id, 70, "AI анализ транскрипта...")

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

                    # Progress: AI analysis complete
                    if call_id:
                        await self._update_progress(call_id, 95, "Сохранение результатов...")
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

            # Calculate speaker stats and participant roles for AI context
            if call.speakers:
                from .call_processor import calculate_speaker_stats, identify_participant_roles
                call.speaker_stats = calculate_speaker_stats(call.speakers)
                logger.info(f"Calculated speaker stats for {len(call.speaker_stats)} speakers")

            logger.info(f"Fireflies transcript processed successfully: {len(call.transcript)} chars")

        except Exception as e:
            logger.error(f"Error processing Fireflies: {e}", exc_info=True)
            call.status = CallStatus.failed
            call.error_message = str(e)
            # Update progress to show error state
            if call_id:
                await self._update_progress(call_id, 0, f"Ошибка: {str(e)[:50]}")

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

    async def create_pending_call(
        self,
        url: str,
        organization_id: int,
        owner_id: int,
        source_type: CallSource,
        entity_id: Optional[int] = None,
        title: Optional[str] = None
    ) -> CallRecording:
        """
        Create a CallRecording with pending status (for async processing).
        Returns immediately so the client gets a fast response.
        """
        from ..database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            call = CallRecording(
                org_id=organization_id,
                owner_id=owner_id,
                entity_id=entity_id,
                source_url=url,
                source_type=source_type,
                title=title or f"External Recording - {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
                status=CallStatus.pending,
                created_at=datetime.utcnow()
            )
            db.add(call)
            await db.commit()
            await db.refresh(call)
            logger.info(f"Created pending CallRecording {call.id} for async processing")
            return call

    async def _update_progress(self, call_id: int, progress: int, stage: str):
        """Update progress for a call in the database."""
        from ..database import AsyncSessionLocal
        from sqlalchemy import update

        async with AsyncSessionLocal() as db:
            await db.execute(
                update(CallRecording)
                .where(CallRecording.id == call_id)
                .values(progress=progress, progress_stage=stage)
            )
            await db.commit()
            logger.debug(f"Call {call_id} progress: {progress}% - {stage}")

    async def process_fireflies_async(self, call_id: int):
        """
        Process Fireflies URL in background.
        Called as a background task after create_pending_call.
        Reports progress at each stage.
        """
        from ..database import AsyncSessionLocal
        from sqlalchemy import select

        logger.info(f"Starting background Fireflies processing for call {call_id}")

        # Stage 1: Starting
        await self._update_progress(call_id, 5, "Запуск обработки...")

        async with AsyncSessionLocal() as db:
            # Get the call record
            result = await db.execute(
                select(CallRecording).where(CallRecording.id == call_id)
            )
            call = result.scalar_one_or_none()

            if not call:
                logger.error(f"Call {call_id} not found for Fireflies processing")
                return

            if not call.source_url:
                logger.error(f"Call {call_id} has no source_url")
                call.status = CallStatus.failed
                call.error_message = "No source URL"
                call.progress = 0
                call.progress_stage = "Ошибка"
                await db.commit()
                return

            try:
                # Stage 2: Loading page
                await self._update_progress(call_id, 10, "Загрузка страницы Fireflies...")

                # Process Fireflies - this takes 1-2 minutes
                # The _process_fireflies method will update progress internally
                call = await self._process_fireflies(call, call.source_url, call_id)

                # Identify participant roles (evaluator, target, others)
                if call.speakers and call.status == CallStatus.done:
                    try:
                        from .call_processor import identify_participant_roles
                        call.participant_roles = await identify_participant_roles(call, db)
                        logger.info(f"Identified participant roles: {call.participant_roles}")
                    except Exception as e:
                        logger.warning(f"Failed to identify participant roles: {e}")

                # Stage 5: Complete
                call.progress = 100
                call.progress_stage = "Готово"

                # Save the updated call
                await db.commit()
                logger.info(f"Background Fireflies processing complete for call {call_id}")

            except Exception as e:
                logger.error(f"Background Fireflies processing failed for call {call_id}: {e}", exc_info=True)
                call.status = CallStatus.failed
                call.error_message = f"Processing error: {str(e)}"
                call.progress = 0
                call.progress_stage = "Ошибка"
                await db.commit()


# Singleton instance
external_link_processor = ExternalLinkProcessor()
