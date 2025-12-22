"""
Fireflies.ai API Client

Клиент для работы с Fireflies API:
- Добавление бота на встречи (addToLiveMeeting)
- Получение транскрипций (transcript)
- Загрузка аудио файлов (uploadAudio)
"""
import httpx
import logging
from typing import Optional, Dict, Any, List

from ..config import get_settings

logger = logging.getLogger("hr-analyzer.fireflies")


class FirefliesClient:
    """Клиент для Fireflies.ai GraphQL API"""

    ENDPOINT = "https://api.fireflies.ai/graphql"

    def __init__(self):
        self._api_key: Optional[str] = None

    @property
    def api_key(self) -> str:
        if self._api_key is None:
            settings = get_settings()
            self._api_key = settings.fireflies_api_key
        return self._api_key

    @property
    def headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }

    async def _execute(self, query: str, variables: Optional[Dict] = None) -> Dict[str, Any]:
        """Выполнить GraphQL запрос"""
        payload = {"query": query}
        if variables:
            payload["variables"] = variables

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                self.ENDPOINT,
                json=payload,
                headers=self.headers
            )
            response.raise_for_status()
            return response.json()

    async def add_to_live_meeting(
        self,
        meeting_link: str,
        title: Optional[str] = None,
        language: str = "ru",
        duration: int = 60
    ) -> Dict[str, Any]:
        """
        Добавить бота Fireflies на встречу.

        Args:
            meeting_link: URL встречи (Google Meet, Zoom, Teams)
            title: Название встречи (для идентификации в webhook)
            language: Язык встречи (по умолчанию русский)
            duration: Максимальная длительность записи в минутах (15-120)

        Returns:
            {"success": True/False, "message": "..."}
        """
        mutation = """
        mutation AddToLiveMeeting(
            $meeting_link: String!
            $title: String
            $language: String
            $duration: Int
        ) {
            addToLiveMeeting(
                meeting_link: $meeting_link
                title: $title
                language: $language
                duration: $duration
            ) {
                success
                message
            }
        }
        """

        variables = {
            "meeting_link": meeting_link,
            "title": title,
            "language": language,
            "duration": min(max(duration, 15), 120)  # Clamp to 15-120
        }

        logger.info(f"Adding Fireflies bot to meeting: {meeting_link}, title: {title}")

        result = await self._execute(mutation, variables)

        if "errors" in result:
            error_msg = result["errors"][0].get("message", "Unknown error")
            logger.error(f"Fireflies addToLiveMeeting error: {error_msg}")
            return {"success": False, "message": error_msg}

        data = result.get("data", {}).get("addToLiveMeeting", {})
        logger.info(f"Fireflies addToLiveMeeting result: {data}")
        return data

    async def get_transcript(self, transcript_id: str) -> Optional[Dict[str, Any]]:
        """
        Получить полную транскрипцию по ID.

        Returns:
            {
                "id": "...",
                "title": "...",
                "date": "...",
                "duration": 1234,
                "speakers": [{"id": "0", "name": "Speaker 1"}, ...],
                "sentences": [
                    {"speaker_id": "0", "speaker_name": "Speaker 1", "text": "...", "start_time": 0.0, "end_time": 3.5},
                    ...
                ],
                "summary": {
                    "overview": "...",
                    "action_items": [...],
                    "keywords": [...]
                }
            }
        """
        query = """
        query GetTranscript($id: String!) {
            transcript(id: $id) {
                id
                title
                date
                duration
                meeting_link
                speakers {
                    id
                    name
                }
                sentences {
                    index
                    speaker_id
                    speaker_name
                    text
                    raw_text
                    start_time
                    end_time
                }
                summary {
                    overview
                    action_items
                    keywords
                    short_summary
                }
            }
        }
        """

        logger.info(f"Fetching transcript: {transcript_id}")

        result = await self._execute(query, {"id": transcript_id})

        if "errors" in result:
            error_msg = result["errors"][0].get("message", "Unknown error")
            logger.error(f"Fireflies get_transcript error: {error_msg}")
            return None

        transcript = result.get("data", {}).get("transcript")
        if transcript:
            logger.info(f"Transcript fetched: {transcript.get('title')}, {len(transcript.get('sentences', []))} sentences")
        return transcript

    async def get_recent_transcripts(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Получить список последних транскрипций"""
        query = """
        query GetTranscripts($limit: Int) {
            transcripts(limit: $limit) {
                id
                title
                date
                duration
                meeting_link
            }
        }
        """

        result = await self._execute(query, {"limit": limit})

        if "errors" in result:
            logger.error(f"Fireflies get_recent_transcripts error: {result['errors']}")
            return []

        return result.get("data", {}).get("transcripts", [])

    async def upload_audio(
        self,
        audio_url: str,
        title: Optional[str] = None,
        webhook_url: Optional[str] = None,
        language: str = "ru"
    ) -> Dict[str, Any]:
        """
        Загрузить аудио файл для транскрипции.

        Args:
            audio_url: Публичный URL аудио файла (https, mp3/mp4/wav/m4a/ogg)
            title: Название записи
            webhook_url: URL для webhook уведомления о готовности
            language: Язык аудио

        Returns:
            {"success": True/False, "title": "...", "message": "..."}
        """
        mutation = """
        mutation UploadAudio($input: AudioUploadInput!) {
            uploadAudio(input: $input) {
                success
                title
                message
            }
        }
        """

        input_data = {
            "url": audio_url,
            "title": title,
            "custom_language": language
        }

        if webhook_url:
            input_data["webhook"] = webhook_url

        logger.info(f"Uploading audio to Fireflies: {audio_url}, title: {title}")

        result = await self._execute(mutation, {"input": input_data})

        if "errors" in result:
            error_msg = result["errors"][0].get("message", "Unknown error")
            logger.error(f"Fireflies uploadAudio error: {error_msg}")
            return {"success": False, "message": error_msg}

        data = result.get("data", {}).get("uploadAudio", {})
        logger.info(f"Fireflies uploadAudio result: {data}")
        return data


# Singleton instance
fireflies_client = FirefliesClient()
