"""
Red Flags Detection Service for HR Bot.

Analyzes candidates and detects potential red flags:
- Job hopping (frequent job changes)
- Employment gaps
- Salary mismatch
- Skill inconsistency
- Over/under qualification
- Location concerns
- Missing references

Uses AI analysis for deeper insights.
"""

import logging
from enum import Enum
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from anthropic import AsyncAnthropic

from ..config import get_settings
from ..models.database import Entity, Vacancy, Chat, CallRecording

logger = logging.getLogger("hr-analyzer.red-flags")
settings = get_settings()


class RedFlagType(str, Enum):
    """Types of red flags that can be detected."""
    JOB_HOPPING = "job_hopping"
    EMPLOYMENT_GAPS = "employment_gaps"
    SALARY_MISMATCH = "salary_mismatch"
    SKILL_INCONSISTENCY = "skill_inconsistency"
    OVERQUALIFIED = "overqualified"
    UNDERQUALIFIED = "underqualified"
    LOCATION_CONCERN = "location_concern"
    REFERENCE_MISSING = "reference_missing"
    COMMUNICATION_ISSUES = "communication_issues"
    INCONSISTENT_STATEMENTS = "inconsistent_statements"
    NEGATIVE_ATTITUDE = "negative_attitude"


class Severity(str, Enum):
    """Severity levels for red flags."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


# Human-readable labels for red flag types
RED_FLAG_LABELS: Dict[RedFlagType, str] = {
    RedFlagType.JOB_HOPPING: "Частая смена работ",
    RedFlagType.EMPLOYMENT_GAPS: "Пробелы в карьере",
    RedFlagType.SALARY_MISMATCH: "Несоответствие зарплатных ожиданий",
    RedFlagType.SKILL_INCONSISTENCY: "Несоответствие навыков",
    RedFlagType.OVERQUALIFIED: "Избыточная квалификация",
    RedFlagType.UNDERQUALIFIED: "Недостаточная квалификация",
    RedFlagType.LOCATION_CONCERN: "Проблемы с локацией",
    RedFlagType.REFERENCE_MISSING: "Отсутствие рекомендаций",
    RedFlagType.COMMUNICATION_ISSUES: "Проблемы коммуникации",
    RedFlagType.INCONSISTENT_STATEMENTS: "Противоречивые утверждения",
    RedFlagType.NEGATIVE_ATTITUDE: "Негативное отношение",
}


@dataclass
class RedFlag:
    """Represents a detected red flag."""
    type: RedFlagType
    severity: Severity
    description: str
    suggestion: str
    evidence: Optional[str] = None  # Quote or specific data supporting the flag

    def to_dict(self) -> dict:
        """Convert to dictionary for API response."""
        return {
            "type": self.type.value,
            "type_label": RED_FLAG_LABELS.get(self.type, self.type.value),
            "severity": self.severity.value,
            "description": self.description,
            "suggestion": self.suggestion,
            "evidence": self.evidence
        }


@dataclass
class RedFlagsAnalysis:
    """Complete red flags analysis result."""
    flags: List[RedFlag]
    risk_score: int  # 0-100
    summary: str

    def to_dict(self) -> dict:
        """Convert to dictionary for API response."""
        return {
            "flags": [f.to_dict() for f in self.flags],
            "risk_score": self.risk_score,
            "summary": self.summary,
            "flags_count": len(self.flags),
            "high_severity_count": len([f for f in self.flags if f.severity == Severity.HIGH]),
            "medium_severity_count": len([f for f in self.flags if f.severity == Severity.MEDIUM]),
            "low_severity_count": len([f for f in self.flags if f.severity == Severity.LOW])
        }


class RedFlagsService:
    """Service for detecting red flags in candidate profiles."""

    def __init__(self):
        self._client: Optional[AsyncAnthropic] = None
        self.model = "claude-sonnet-4-20250514"

    @property
    def client(self) -> AsyncAnthropic:
        """Lazy initialization of Anthropic client."""
        if self._client is None:
            if not settings.anthropic_api_key:
                raise ValueError("ANTHROPIC_API_KEY не настроен")
            self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        return self._client

    def _analyze_work_history(self, extra_data: dict) -> List[RedFlag]:
        """
        Analyze work history for job hopping and employment gaps.

        Looks for:
        - Jobs lasting less than 1 year
        - Gaps between jobs longer than 6 months
        """
        flags = []

        # Get work experience from extra_data
        experience = extra_data.get("experience", [])
        work_history = extra_data.get("work_history", experience)

        if not work_history:
            return flags

        short_jobs = []
        total_jobs = len(work_history)

        for job in work_history:
            # Parse dates
            start_date = job.get("start_date") or job.get("from")
            end_date = job.get("end_date") or job.get("to") or job.get("until")

            if not start_date:
                continue

            try:
                # Handle various date formats
                if isinstance(start_date, str):
                    if len(start_date) == 4:  # Just year
                        start = datetime(int(start_date), 1, 1)
                    elif len(start_date) == 7:  # YYYY-MM
                        start = datetime.strptime(start_date, "%Y-%m")
                    else:
                        start = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
                else:
                    start = start_date

                if end_date and end_date.lower() not in ["present", "now", "current", "настоящее время", "по настоящее время"]:
                    if isinstance(end_date, str):
                        if len(end_date) == 4:
                            end = datetime(int(end_date), 12, 31)
                        elif len(end_date) == 7:
                            end = datetime.strptime(end_date, "%Y-%m")
                        else:
                            end = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
                    else:
                        end = end_date
                else:
                    end = datetime.now()

                # Calculate duration
                duration_months = (end.year - start.year) * 12 + (end.month - start.month)

                if duration_months < 12 and end != datetime.now():
                    company = job.get("company") or job.get("employer") or "Неизвестная компания"
                    short_jobs.append(f"{company} ({duration_months} мес.)")

            except (ValueError, TypeError) as e:
                logger.debug(f"Could not parse dates for job: {e}")
                continue

        # Job hopping detection
        if total_jobs >= 3 and len(short_jobs) >= 2:
            severity = Severity.HIGH if len(short_jobs) >= 3 else Severity.MEDIUM
            flags.append(RedFlag(
                type=RedFlagType.JOB_HOPPING,
                severity=severity,
                description=f"Обнаружено {len(short_jobs)} позиций с работой менее года: {', '.join(short_jobs[:3])}{'...' if len(short_jobs) > 3 else ''}",
                suggestion="Уточните причины частой смены работы. Спросите о конкретных обстоятельствах ухода с каждой позиции.",
                evidence=f"Из {total_jobs} мест работы, {len(short_jobs)} длились менее года"
            ))

        return flags

    def _analyze_salary_match(
        self,
        entity: Entity,
        vacancy: Optional[Vacancy] = None
    ) -> List[RedFlag]:
        """
        Analyze salary expectations vs vacancy range.
        """
        flags = []

        # Get entity salary expectations
        entity_min = entity.expected_salary_min
        entity_max = entity.expected_salary_max

        if not entity_min and not entity_max:
            return flags

        if not vacancy:
            return flags

        vacancy_min = vacancy.salary_min
        vacancy_max = vacancy.salary_max

        if not vacancy_min and not vacancy_max:
            return flags

        # Check for mismatch
        entity_expected = entity_max or entity_min
        vacancy_offered = vacancy_max or vacancy_min

        if entity_expected and vacancy_offered:
            # Candidate expects more than 30% above vacancy max
            if entity_min and vacancy_max and entity_min > vacancy_max * 1.3:
                flags.append(RedFlag(
                    type=RedFlagType.SALARY_MISMATCH,
                    severity=Severity.HIGH,
                    description=f"Зарплатные ожидания кандидата ({entity_min:,} - {entity_max:,} {entity.expected_salary_currency}) значительно превышают бюджет вакансии ({vacancy_min:,} - {vacancy_max:,} {vacancy.salary_currency})",
                    suggestion="Обсудите зарплатные ожидания на раннем этапе. Возможно, кандидат готов к гибкости при интересном проекте.",
                    evidence=f"Разница: ожидания на {((entity_min / vacancy_max) - 1) * 100:.0f}% выше максимума вакансии"
                ))
            # Candidate expects less than 30% below vacancy min (might be underqualified or desperate)
            elif entity_max and vacancy_min and entity_max < vacancy_min * 0.7:
                flags.append(RedFlag(
                    type=RedFlagType.SALARY_MISMATCH,
                    severity=Severity.LOW,
                    description=f"Зарплатные ожидания кандидата ({entity_min:,} - {entity_max:,} {entity.expected_salary_currency}) значительно ниже бюджета вакансии ({vacancy_min:,} - {vacancy_max:,} {vacancy.salary_currency})",
                    suggestion="Уточните квалификацию кандидата. Возможна недооценка себя или несоответствие уровню позиции.",
                    evidence=f"Ожидания на {(1 - entity_max / vacancy_min) * 100:.0f}% ниже минимума вакансии"
                ))

        return flags

    def _analyze_skills_match(
        self,
        entity: Entity,
        vacancy: Optional[Vacancy] = None
    ) -> List[RedFlag]:
        """
        Analyze skills match between candidate and vacancy.
        """
        flags = []

        extra_data = entity.extra_data or {}
        entity_skills = set(s.lower() for s in extra_data.get("skills", []))

        if not entity_skills:
            return flags

        if not vacancy:
            return flags

        # Parse required skills from vacancy requirements
        requirements = vacancy.requirements or ""
        vacancy_extra = vacancy.extra_data or {}
        required_skills = set(s.lower() for s in vacancy_extra.get("required_skills", []))

        if not required_skills:
            return flags

        # Check for missing critical skills
        missing_skills = required_skills - entity_skills

        if len(missing_skills) > len(required_skills) * 0.5:
            flags.append(RedFlag(
                type=RedFlagType.UNDERQUALIFIED,
                severity=Severity.MEDIUM,
                description=f"Кандидату не хватает более половины требуемых навыков",
                suggestion="Оцените готовность кандидата к обучению и наличие смежного опыта.",
                evidence=f"Отсутствуют: {', '.join(list(missing_skills)[:5])}"
            ))
        elif missing_skills:
            flags.append(RedFlag(
                type=RedFlagType.SKILL_INCONSISTENCY,
                severity=Severity.LOW,
                description=f"У кандидата отсутствуют некоторые требуемые навыки",
                suggestion="Уточните практический опыт с указанными технологиями.",
                evidence=f"Отсутствуют: {', '.join(list(missing_skills)[:3])}"
            ))

        # Check for overqualification
        extra_skills = entity_skills - required_skills
        experience = extra_data.get("experience", [])
        total_years = extra_data.get("total_experience_years", 0)

        if vacancy.experience_level == "junior" and total_years > 5:
            flags.append(RedFlag(
                type=RedFlagType.OVERQUALIFIED,
                severity=Severity.MEDIUM,
                description=f"Кандидат с {total_years} годами опыта претендует на junior позицию",
                suggestion="Уточните мотивацию кандидата. Возможно, он ищет смену направления или work-life balance.",
                evidence=f"Опыт: {total_years} лет, уровень позиции: {vacancy.experience_level}"
            ))

        return flags

    def _check_references(self, entity: Entity) -> List[RedFlag]:
        """Check if candidate has provided references."""
        flags = []

        extra_data = entity.extra_data or {}
        references = extra_data.get("references", [])

        if not references:
            flags.append(RedFlag(
                type=RedFlagType.REFERENCE_MISSING,
                severity=Severity.LOW,
                description="Кандидат не предоставил контакты для рекомендаций",
                suggestion="Запросите контакты предыдущих работодателей или коллег для получения рекомендаций.",
                evidence=None
            ))

        return flags

    def _check_location(self, entity: Entity, vacancy: Optional[Vacancy] = None) -> List[RedFlag]:
        """Check for location-related concerns."""
        flags = []

        if not vacancy or not vacancy.location:
            return flags

        extra_data = entity.extra_data or {}
        candidate_location = extra_data.get("location") or extra_data.get("city")
        relocation_ready = extra_data.get("relocation_ready", None)

        if not candidate_location:
            return flags

        # Simple location comparison (not in the same city)
        vacancy_location = vacancy.location.lower()
        candidate_location_lower = candidate_location.lower()

        # Check if locations are different
        if candidate_location_lower not in vacancy_location and vacancy_location not in candidate_location_lower:
            if relocation_ready is False:
                flags.append(RedFlag(
                    type=RedFlagType.LOCATION_CONCERN,
                    severity=Severity.HIGH,
                    description=f"Кандидат находится в {candidate_location}, но не готов к релокации в {vacancy.location}",
                    suggestion="Обсудите возможность удалённой работы или гибридного формата.",
                    evidence=f"Локация кандидата: {candidate_location}, вакансии: {vacancy.location}"
                ))
            elif relocation_ready is None:
                flags.append(RedFlag(
                    type=RedFlagType.LOCATION_CONCERN,
                    severity=Severity.MEDIUM,
                    description=f"Кандидат находится в {candidate_location}, готовность к релокации в {vacancy.location} не указана",
                    suggestion="Уточните готовность к релокации или возможность удалённой работы.",
                    evidence=f"Локация кандидата: {candidate_location}, вакансии: {vacancy.location}"
                ))

        return flags

    async def _ai_analyze_communications(
        self,
        entity: Entity,
        chats: List[Chat],
        calls: List[CallRecording]
    ) -> List[RedFlag]:
        """
        Use AI to analyze communication patterns for red flags.
        """
        flags = []

        if not chats and not calls:
            return flags

        # Build context from communications
        context_parts = []

        # Add chat messages
        for chat in chats[:3]:  # Limit to 3 most recent chats
            if hasattr(chat, 'messages') and chat.messages:
                messages = sorted(chat.messages, key=lambda m: m.timestamp)[-50:]  # Last 50 messages
                chat_text = f"\n--- Чат: {chat.title} ---\n"
                for msg in messages:
                    sender = msg.first_name or msg.username or "Unknown"
                    chat_text += f"{sender}: {msg.content[:200]}\n"
                context_parts.append(chat_text)

        # Add call transcripts
        for call in calls[:3]:  # Limit to 3 most recent calls
            if call.transcript:
                context_parts.append(f"\n--- Звонок ---\n{call.transcript[:2000]}")

        if not context_parts:
            return flags

        communications_context = "\n".join(context_parts)[:8000]  # Limit total context

        # AI analysis prompt
        prompt = f"""Проанализируй коммуникации с кандидатом "{entity.name}" на наличие red flags (тревожных сигналов).

КОММУНИКАЦИИ:
{communications_context}

Найди ТОЛЬКО реальные проблемы. НЕ считай red flags:
- Юмор, шутки, сарказм
- Неформальный стиль общения
- Мемы, эмодзи

ИЩИ конкретные проблемы:
1. COMMUNICATION_ISSUES - проблемы с коммуникацией (игнорирование вопросов, агрессия, грубость)
2. INCONSISTENT_STATEMENTS - противоречивые утверждения о своём опыте или навыках
3. NEGATIVE_ATTITUDE - негатив о прошлых работодателях, коллегах, проектах

Для каждого найденного red flag верни JSON:
{{
  "type": "тип из списка выше",
  "severity": "low/medium/high",
  "description": "описание проблемы на русском",
  "evidence": "конкретная цитата из переписки",
  "suggestion": "рекомендация для HR на русском"
}}

Если проблем нет - верни пустой массив [].
Верни ТОЛЬКО валидный JSON массив без markdown форматирования."""

        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}]
            )

            # Parse AI response
            response_text = response.content[0].text.strip()

            # Clean up response (remove markdown code blocks if present)
            if response_text.startswith("```"):
                response_text = response_text.split("```")[1]
                if response_text.startswith("json"):
                    response_text = response_text[4:]
                response_text = response_text.strip()

            import json
            ai_flags = json.loads(response_text)

            for flag_data in ai_flags:
                try:
                    flag_type = RedFlagType(flag_data["type"].lower())
                    severity = Severity(flag_data["severity"].lower())

                    flags.append(RedFlag(
                        type=flag_type,
                        severity=severity,
                        description=flag_data.get("description", ""),
                        suggestion=flag_data.get("suggestion", ""),
                        evidence=flag_data.get("evidence")
                    ))
                except (ValueError, KeyError) as e:
                    logger.warning(f"Could not parse AI flag: {e}")
                    continue

        except Exception as e:
            logger.error(f"AI communication analysis failed: {e}")

        return flags

    async def detect_red_flags(
        self,
        entity: Entity,
        vacancy: Optional[Vacancy] = None,
        chats: Optional[List[Chat]] = None,
        calls: Optional[List[CallRecording]] = None
    ) -> RedFlagsAnalysis:
        """
        Detect all red flags for a candidate.

        Args:
            entity: The candidate entity to analyze
            vacancy: Optional vacancy to compare against
            chats: Optional list of linked chats with messages
            calls: Optional list of linked call recordings

        Returns:
            RedFlagsAnalysis with all detected flags and risk score
        """
        all_flags: List[RedFlag] = []

        # Rule-based analysis
        extra_data = entity.extra_data or {}

        # 1. Work history analysis (job hopping, gaps)
        all_flags.extend(self._analyze_work_history(extra_data))

        # 2. Salary match analysis
        all_flags.extend(self._analyze_salary_match(entity, vacancy))

        # 3. Skills match analysis
        all_flags.extend(self._analyze_skills_match(entity, vacancy))

        # 4. References check
        all_flags.extend(self._check_references(entity))

        # 5. Location concerns
        all_flags.extend(self._check_location(entity, vacancy))

        # 6. AI analysis of communications
        if chats or calls:
            ai_flags = await self._ai_analyze_communications(
                entity,
                chats or [],
                calls or []
            )
            all_flags.extend(ai_flags)

        # Calculate risk score
        risk_score = self._calculate_risk_score(all_flags)

        # Generate summary
        summary = self._generate_summary(all_flags, risk_score)

        return RedFlagsAnalysis(
            flags=all_flags,
            risk_score=risk_score,
            summary=summary
        )

    def _calculate_risk_score(self, flags: List[RedFlag]) -> int:
        """
        Calculate overall risk score (0-100) based on detected flags.
        """
        if not flags:
            return 0

        score = 0

        for flag in flags:
            if flag.severity == Severity.HIGH:
                score += 25
            elif flag.severity == Severity.MEDIUM:
                score += 15
            else:  # LOW
                score += 5

        # Cap at 100
        return min(100, score)

    def _generate_summary(self, flags: List[RedFlag], risk_score: int) -> str:
        """Generate human-readable summary of analysis."""
        if not flags:
            return "Тревожных сигналов не обнаружено. Кандидат выглядит перспективным."

        high_count = len([f for f in flags if f.severity == Severity.HIGH])
        medium_count = len([f for f in flags if f.severity == Severity.MEDIUM])

        if high_count > 0:
            return f"Обнаружено {len(flags)} тревожных сигналов, из них {high_count} критических. Рекомендуется детальная проверка перед принятием решения."
        elif medium_count > 0:
            return f"Обнаружено {len(flags)} тревожных сигналов средней и низкой важности. Рекомендуется обратить внимание на указанные пункты."
        else:
            return f"Обнаружено {len(flags)} незначительных замечаний. В целом кандидат выглядит хорошо."

    def get_risk_score(self, entity: Entity) -> int:
        """
        Quick synchronous risk score calculation based on available data.
        For async full analysis use detect_red_flags().
        """
        flags = []
        extra_data = entity.extra_data or {}

        # Only rule-based checks (no AI)
        flags.extend(self._analyze_work_history(extra_data))
        flags.extend(self._check_references(entity))

        return self._calculate_risk_score(flags)


# Singleton instance
red_flags_service = RedFlagsService()
