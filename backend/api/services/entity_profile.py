"""
Entity Profile Service - generates and manages AI profiles for similarity matching.

Features:
- Generates structured profile from entity context (files, chats, calls)
- Stores profile in entity.extra_data['ai_profile']
- Finds similar candidates based on profile matching
- No embeddings needed - uses structured fields for fast comparison
"""
from typing import List, Optional, Dict, Any
from anthropic import AsyncAnthropic
import logging
import json
from datetime import datetime

from ..config import get_settings
from ..models.database import Entity, Chat, CallRecording, EntityFile
from .entity_ai import EntityAIService

logger = logging.getLogger("hr-analyzer.entity-profile")
settings = get_settings()

# Profile generation prompt
PROFILE_GENERATION_PROMPT = """На основе ВСЕХ предоставленных данных о кандидате создай структурированный профиль.

Верни JSON в ТОЧНО таком формате (без markdown, только JSON):
{
  "skills": ["навык1", "навык2", ...],
  "experience_years": число или null,
  "level": "junior" | "middle" | "senior" | "lead" | "unknown",
  "specialization": "основная специализация одним-двумя словами",
  "salary_min": число или null,
  "salary_max": число или null,
  "salary_currency": "RUB" | "USD" | "EUR",
  "location": "город или страна" или null,
  "work_format": "office" | "remote" | "hybrid" | "unknown",
  "languages": ["язык1", "язык2", ...],
  "education": "краткое описание" или null,
  "summary": "2-3 предложения о кандидате - кто он, что умеет, чем выделяется",
  "strengths": ["сильная сторона 1", "сильная сторона 2", ...],
  "weaknesses": ["слабая сторона 1", ...],
  "red_flags": ["red flag 1", ...] или [],
  "communication_style": "краткое описание стиля общения"
}

ПРАВИЛА:
1. Извлекай информацию ТОЛЬКО из предоставленных данных
2. Если информации нет - ставь null или пустой массив
3. Skills - реальные технические и софт навыки
4. Level определяй по опыту и сложности проектов
5. Salary бери из резюме или обсуждений в чатах/звонках
6. Summary должен быть информативным и полезным для быстрой оценки
7. Red flags - только реальные проблемы, не юмор/сарказм
8. Верни ТОЛЬКО JSON, без пояснений"""


class EntityProfileService:
    """Service for generating and managing entity AI profiles"""

    def __init__(self):
        self._client: Optional[AsyncAnthropic] = None
        self.model = settings.claude_model
        self._entity_ai = EntityAIService()

    @property
    def client(self) -> AsyncAnthropic:
        if self._client is None:
            if not settings.anthropic_api_key:
                raise ValueError("ANTHROPIC_API_KEY не настроен")
            self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        return self._client

    async def generate_profile(
        self,
        entity: Entity,
        chats: List[Chat],
        calls: List[CallRecording],
        files: Optional[List[EntityFile]] = None
    ) -> Dict[str, Any]:
        """
        Generate AI profile for entity based on all available context.

        Returns structured profile dict that can be stored in entity.extra_data['ai_profile']
        """
        # Build context using entity_ai service
        context = await self._entity_ai._build_entity_context(entity, chats, calls, files)

        # Add existing entity data to help AI
        entity_data = {
            "name": entity.name,
            "tags": entity.tags or [],
            "position": entity.position,
            "company": entity.company,
            "expected_salary_min": entity.expected_salary_min,
            "expected_salary_max": entity.expected_salary_max,
            "expected_salary_currency": entity.expected_salary_currency
        }

        system_prompt = f"""Ты — AI для создания структурированных профилей кандидатов.

Данные о кандидате:
{context}

Базовая информация из карточки:
{json.dumps(entity_data, ensure_ascii=False)}

Создай структурированный профиль на основе ВСЕХ доступных данных."""

        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=2000,
                system=system_prompt,
                messages=[{"role": "user", "content": PROFILE_GENERATION_PROMPT}]
            )

            response_text = response.content[0].text.strip()

            # Try to parse JSON from response
            # Handle cases where AI might wrap in ```json
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                json_lines = []
                in_json = False
                for line in lines:
                    if line.startswith("```") and not in_json:
                        in_json = True
                        continue
                    elif line.startswith("```") and in_json:
                        break
                    elif in_json:
                        json_lines.append(line)
                response_text = "\n".join(json_lines)

            profile = json.loads(response_text)

            # Add metadata
            profile["generated_at"] = datetime.utcnow().isoformat()
            profile["context_sources"] = {
                "chats_count": len(chats),
                "calls_count": len(calls),
                "files_count": len(files) if files else 0
            }

            logger.info(f"Generated profile for entity {entity.id}: {profile.get('specialization', 'unknown')}")
            return profile

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse profile JSON: {e}")
            logger.error(f"Response was: {response_text[:500]}")
            # Return minimal profile
            return {
                "skills": entity.tags or [],
                "experience_years": None,
                "level": "unknown",
                "specialization": entity.position or "unknown",
                "salary_min": entity.expected_salary_min,
                "salary_max": entity.expected_salary_max,
                "salary_currency": entity.expected_salary_currency or "RUB",
                "summary": f"{entity.name} - {entity.position or 'специалист'}",
                "generated_at": datetime.utcnow().isoformat(),
                "error": "Failed to generate full profile"
            }
        except Exception as e:
            logger.error(f"Profile generation error: {e}")
            raise

    def calculate_similarity(
        self,
        profile1: Dict[str, Any],
        profile2: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Calculate similarity between two profiles.

        Returns:
            {
                "score": 0-100,
                "matches": ["skill match", "similar level", ...],
                "differences": ["salary mismatch", ...],
                "summary": "краткое сравнение"
            }
        """
        score = 0
        max_score = 0
        matches = []
        differences = []

        # 1. Skills match (weight: 30)
        max_score += 30
        skills1 = set(s.lower() for s in (profile1.get("skills") or []))
        skills2 = set(s.lower() for s in (profile2.get("skills") or []))

        if skills1 and skills2:
            common_skills = skills1 & skills2
            all_skills = skills1 | skills2
            skill_ratio = len(common_skills) / len(all_skills) if all_skills else 0
            skill_score = int(skill_ratio * 30)
            score += skill_score

            if common_skills:
                matches.append(f"Общие навыки: {', '.join(list(common_skills)[:5])}")

            unique1 = skills1 - skills2
            unique2 = skills2 - skills1
            if unique1 or unique2:
                differences.append(f"Разные навыки: {', '.join(list(unique1 | unique2)[:3])}")

        # 2. Level match (weight: 20)
        max_score += 20
        level1 = profile1.get("level", "unknown")
        level2 = profile2.get("level", "unknown")

        level_order = {"junior": 1, "middle": 2, "senior": 3, "lead": 4, "unknown": 0}
        if level1 != "unknown" and level2 != "unknown":
            level_diff = abs(level_order.get(level1, 0) - level_order.get(level2, 0))
            if level_diff == 0:
                score += 20
                matches.append(f"Одинаковый уровень: {level1}")
            elif level_diff == 1:
                score += 10
                differences.append(f"Близкий уровень: {level1} vs {level2}")
            else:
                differences.append(f"Разный уровень: {level1} vs {level2}")

        # 3. Specialization match (weight: 20)
        max_score += 20
        spec1 = (profile1.get("specialization") or "").lower()
        spec2 = (profile2.get("specialization") or "").lower()

        if spec1 and spec2:
            # Simple word overlap check
            words1 = set(spec1.split())
            words2 = set(spec2.split())
            if words1 & words2 or spec1 in spec2 or spec2 in spec1:
                score += 20
                matches.append(f"Похожая специализация")
            else:
                differences.append(f"Разная специализация: {spec1} vs {spec2}")

        # 4. Salary range overlap (weight: 15)
        max_score += 15
        sal1_min = profile1.get("salary_min") or profile1.get("expected_salary_min")
        sal1_max = profile1.get("salary_max") or profile1.get("expected_salary_max")
        sal2_min = profile2.get("salary_min") or profile2.get("expected_salary_min")
        sal2_max = profile2.get("salary_max") or profile2.get("expected_salary_max")

        if sal1_min and sal2_min:
            # Check if ranges overlap
            min1, max1 = sal1_min, sal1_max or sal1_min * 1.3
            min2, max2 = sal2_min, sal2_max or sal2_min * 1.3

            overlap = min(max1, max2) - max(min1, min2)
            if overlap > 0:
                score += 15
                matches.append("Пересекающиеся зарплатные ожидания")
            else:
                diff_percent = abs(min1 - min2) / max(min1, min2) * 100
                if diff_percent < 30:
                    score += 7
                    differences.append(f"Близкие зарплатные ожидания (разница ~{int(diff_percent)}%)")
                else:
                    differences.append(f"Разные зарплатные ожидания")

        # 5. Experience match (weight: 15)
        max_score += 15
        exp1 = profile1.get("experience_years")
        exp2 = profile2.get("experience_years")

        if exp1 is not None and exp2 is not None:
            exp_diff = abs(exp1 - exp2)
            if exp_diff <= 1:
                score += 15
                matches.append(f"Похожий опыт: ~{exp1} лет")
            elif exp_diff <= 3:
                score += 7
                differences.append(f"Близкий опыт: {exp1} vs {exp2} лет")
            else:
                differences.append(f"Разный опыт: {exp1} vs {exp2} лет")

        # Calculate final percentage
        final_score = int((score / max_score) * 100) if max_score > 0 else 0

        # Generate summary
        if final_score >= 70:
            summary = "Очень похожие кандидаты"
        elif final_score >= 50:
            summary = "Частично похожие кандидаты"
        elif final_score >= 30:
            summary = "Есть общие черты"
        else:
            summary = "Разные профили"

        return {
            "score": final_score,
            "matches": matches,
            "differences": differences,
            "summary": summary
        }

    def find_similar(
        self,
        target_profile: Dict[str, Any],
        candidates: List[tuple],  # List of (entity, profile) tuples
        min_score: int = 30,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Find similar candidates based on profile matching.

        Args:
            target_profile: Profile to match against
            candidates: List of (entity, profile) tuples
            min_score: Minimum similarity score (0-100)
            limit: Max results to return

        Returns:
            List of {entity_id, entity_name, score, matches, differences, summary}
        """
        results = []

        for entity, profile in candidates:
            if not profile:
                continue

            similarity = self.calculate_similarity(target_profile, profile)

            if similarity["score"] >= min_score:
                results.append({
                    "entity_id": entity.id,
                    "entity_name": entity.name,
                    "entity_position": entity.position,
                    "entity_status": entity.status.value if hasattr(entity.status, 'value') else entity.status,
                    "profile_summary": profile.get("summary", ""),
                    "profile_level": profile.get("level", "unknown"),
                    "profile_specialization": profile.get("specialization", ""),
                    **similarity
                })

        # Sort by score descending
        results.sort(key=lambda x: x["score"], reverse=True)

        return results[:limit]


# Singleton instance
entity_profile_service = EntityProfileService()
