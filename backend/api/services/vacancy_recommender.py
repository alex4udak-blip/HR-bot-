"""
Vacancy Recommendation Service for HR-Bot.

Provides AI-powered vacancy recommendations for candidates based on:
- Skills matching
- Salary expectations
- Location preferences
- Experience level
"""

import logging
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import (
    Entity, EntityType, EntityStatus,
    Vacancy, VacancyStatus, VacancyApplication, ApplicationStage,
    User
)

logger = logging.getLogger("hr-analyzer.vacancy_recommender")


@dataclass
class VacancyRecommendation:
    """Represents a vacancy recommendation for a candidate."""
    vacancy_id: int
    vacancy_title: str
    match_score: int  # 0-100
    match_reasons: List[str] = field(default_factory=list)
    missing_requirements: List[str] = field(default_factory=list)
    salary_compatible: bool = True
    location_match: bool = True

    # Additional vacancy info for display
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str = "RUB"
    location: Optional[str] = None
    employment_type: Optional[str] = None
    experience_level: Optional[str] = None
    department_name: Optional[str] = None
    applications_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "vacancy_id": self.vacancy_id,
            "vacancy_title": self.vacancy_title,
            "match_score": self.match_score,
            "match_reasons": self.match_reasons,
            "missing_requirements": self.missing_requirements,
            "salary_compatible": self.salary_compatible,
            "location_match": self.location_match,
            "salary_min": self.salary_min,
            "salary_max": self.salary_max,
            "salary_currency": self.salary_currency,
            "location": self.location,
            "employment_type": self.employment_type,
            "experience_level": self.experience_level,
            "department_name": self.department_name,
            "applications_count": self.applications_count,
        }


@dataclass
class CandidateMatch:
    """Represents a candidate match for a vacancy."""
    entity_id: int
    entity_name: str
    match_score: int  # 0-100
    match_reasons: List[str] = field(default_factory=list)
    missing_skills: List[str] = field(default_factory=list)
    salary_compatible: bool = True

    # Additional entity info for display
    email: Optional[str] = None
    phone: Optional[str] = None
    position: Optional[str] = None
    status: Optional[str] = None
    expected_salary_min: Optional[int] = None
    expected_salary_max: Optional[int] = None
    expected_salary_currency: str = "RUB"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "entity_id": self.entity_id,
            "entity_name": self.entity_name,
            "match_score": self.match_score,
            "match_reasons": self.match_reasons,
            "missing_skills": self.missing_skills,
            "salary_compatible": self.salary_compatible,
            "email": self.email,
            "phone": self.phone,
            "position": self.position,
            "status": self.status,
            "expected_salary_min": self.expected_salary_min,
            "expected_salary_max": self.expected_salary_max,
            "expected_salary_currency": self.expected_salary_currency,
        }


class VacancyRecommenderService:
    """Service for recommending vacancies to candidates and vice versa."""

    def __init__(self):
        """Initialize the vacancy recommender service."""
        # Keywords commonly found in job requirements
        self.skill_keywords = {
            "python", "javascript", "typescript", "react", "node", "nodejs",
            "java", "kotlin", "swift", "golang", "go", "rust", "c++", "c#",
            "sql", "postgresql", "mysql", "mongodb", "redis", "elasticsearch",
            "docker", "kubernetes", "aws", "azure", "gcp", "devops", "ci/cd",
            "machine learning", "ml", "ai", "data science", "analytics",
            "frontend", "backend", "fullstack", "full-stack", "mobile",
            "ios", "android", "flutter", "react native",
            "agile", "scrum", "kanban", "jira",
            "management", "leadership", "team lead", "product", "pm",
            "sales", "marketing", "hr", "recruiting", "finance",
            "english", "german", "french", "chinese", "spanish",
        }

    def _extract_skills_from_text(self, text: Optional[str]) -> List[str]:
        """Extract skill keywords from text (requirements, position, tags, etc.)."""
        if not text:
            return []

        text_lower = text.lower()
        found_skills = []

        for skill in self.skill_keywords:
            if skill in text_lower:
                found_skills.append(skill)

        return found_skills

    def _extract_candidate_skills(self, entity: Entity) -> List[str]:
        """Extract skills from candidate's profile."""
        skills = set()

        # From position
        if entity.position:
            skills.update(self._extract_skills_from_text(entity.position))

        # From tags
        if entity.tags:
            for tag in entity.tags:
                skills.update(self._extract_skills_from_text(tag))

        # From extra_data (skills field if present)
        if entity.extra_data:
            if "skills" in entity.extra_data:
                skill_data = entity.extra_data["skills"]
                if isinstance(skill_data, list):
                    for s in skill_data:
                        skills.update(self._extract_skills_from_text(str(s)))
                elif isinstance(skill_data, str):
                    skills.update(self._extract_skills_from_text(skill_data))

            # From resume text if present
            if "resume_text" in entity.extra_data:
                skills.update(self._extract_skills_from_text(
                    str(entity.extra_data["resume_text"])
                ))

        return list(skills)

    def _extract_vacancy_requirements(self, vacancy: Vacancy) -> List[str]:
        """Extract required skills from vacancy."""
        skills = set()

        # From title
        skills.update(self._extract_skills_from_text(vacancy.title))

        # From requirements
        if vacancy.requirements:
            skills.update(self._extract_skills_from_text(vacancy.requirements))

        # From description
        if vacancy.description:
            skills.update(self._extract_skills_from_text(vacancy.description))

        # From tags
        if vacancy.tags:
            for tag in vacancy.tags:
                skills.update(self._extract_skills_from_text(tag))

        return list(skills)

    def _check_salary_compatibility(
        self,
        entity: Entity,
        vacancy: Vacancy
    ) -> tuple[bool, Optional[str]]:
        """
        Check if candidate's salary expectations match vacancy salary range.

        Returns:
            Tuple of (is_compatible, reason_if_not_compatible)
        """
        # If candidate has no salary expectations, consider compatible
        if not entity.expected_salary_min and not entity.expected_salary_max:
            return True, None

        # If vacancy has no salary info, consider compatible
        if not vacancy.salary_min and not vacancy.salary_max:
            return True, None

        # Check currency compatibility (simple approach - same currency)
        entity_currency = entity.expected_salary_currency or "RUB"
        vacancy_currency = vacancy.salary_currency or "RUB"

        if entity_currency != vacancy_currency:
            # For now, mark as potentially incompatible
            return False, f"Валюта не совпадает ({entity_currency} vs {vacancy_currency})"

        # Check salary range overlap
        entity_min = entity.expected_salary_min or 0
        entity_max = entity.expected_salary_max or float('inf')
        vacancy_min = vacancy.salary_min or 0
        vacancy_max = vacancy.salary_max or float('inf')

        # There's overlap if candidate's min <= vacancy's max AND vacancy's min <= candidate's max
        if entity_min <= vacancy_max and vacancy_min <= entity_max:
            return True, None

        if entity_min > vacancy_max:
            return False, f"Ожидания кандидата ({entity_min:,}) выше максимума вакансии ({vacancy_max:,})"

        return False, f"Зарплата вакансии ({vacancy_min:,}) выше ожиданий кандидата ({entity_max:,})"

    def _calculate_match_score(
        self,
        candidate_skills: List[str],
        vacancy_skills: List[str],
        salary_compatible: bool,
        location_match: bool = True
    ) -> int:
        """
        Calculate match score (0-100) based on various factors.

        Scoring weights:
        - Skills match: 60%
        - Salary compatibility: 25%
        - Location match: 15%
        """
        score = 0.0

        # Skills matching (60%)
        if vacancy_skills:
            matched_skills = set(candidate_skills) & set(vacancy_skills)
            skill_score = len(matched_skills) / len(vacancy_skills)
            score += skill_score * 60
        else:
            # No specific skills required, give base score
            score += 30

        # Salary compatibility (25%)
        if salary_compatible:
            score += 25

        # Location match (15%)
        if location_match:
            score += 15

        return min(100, int(score))

    async def get_recommendations(
        self,
        db: AsyncSession,
        entity: Entity,
        limit: int = 5,
        org_id: Optional[int] = None
    ) -> List[VacancyRecommendation]:
        """
        Get vacancy recommendations for a candidate.

        Args:
            db: Database session
            entity: Entity (candidate) to get recommendations for
            limit: Maximum number of recommendations
            org_id: Optional organization ID to filter vacancies

        Returns:
            List of VacancyRecommendation objects sorted by match score
        """
        if entity.type != EntityType.candidate:
            logger.warning(f"Entity {entity.id} is not a candidate, skipping recommendations")
            return []

        # Extract candidate skills
        candidate_skills = self._extract_candidate_skills(entity)
        logger.debug(f"Candidate {entity.id} skills: {candidate_skills}")

        # Get active vacancies not already applied to
        applied_vacancy_ids_query = (
            select(VacancyApplication.vacancy_id)
            .where(VacancyApplication.entity_id == entity.id)
        )
        applied_result = await db.execute(applied_vacancy_ids_query)
        applied_vacancy_ids = {row[0] for row in applied_result.all()}

        # Query active vacancies
        vacancy_query = select(Vacancy).where(
            Vacancy.status == VacancyStatus.open
        )

        if org_id:
            vacancy_query = vacancy_query.where(Vacancy.org_id == org_id)

        if applied_vacancy_ids:
            vacancy_query = vacancy_query.where(
                Vacancy.id.notin_(applied_vacancy_ids)
            )

        vacancy_result = await db.execute(vacancy_query)
        vacancies = vacancy_result.scalars().all()

        recommendations = []

        for vacancy in vacancies:
            # Extract vacancy requirements
            vacancy_skills = self._extract_vacancy_requirements(vacancy)

            # Check salary compatibility
            salary_compatible, salary_reason = self._check_salary_compatibility(entity, vacancy)

            # Calculate match score
            match_score = self._calculate_match_score(
                candidate_skills,
                vacancy_skills,
                salary_compatible
            )

            # Build match reasons
            match_reasons = []
            missing_requirements = []

            if candidate_skills and vacancy_skills:
                matched = set(candidate_skills) & set(vacancy_skills)
                missing = set(vacancy_skills) - set(candidate_skills)

                if matched:
                    match_reasons.append(
                        f"Совпадающие навыки: {', '.join(sorted(matched))}"
                    )

                if missing:
                    missing_requirements.append(
                        f"Требуемые навыки: {', '.join(sorted(missing))}"
                    )

            if salary_compatible:
                match_reasons.append("Зарплатные ожидания совпадают")
            elif salary_reason:
                missing_requirements.append(salary_reason)

            # Get applications count
            apps_count_result = await db.execute(
                select(func.count(VacancyApplication.id))
                .where(VacancyApplication.vacancy_id == vacancy.id)
            )
            apps_count = apps_count_result.scalar() or 0

            # Get department name if exists
            dept_name = None
            if vacancy.department_id:
                from ..models.database import Department
                dept_result = await db.execute(
                    select(Department.name).where(Department.id == vacancy.department_id)
                )
                dept_name = dept_result.scalar()

            recommendations.append(VacancyRecommendation(
                vacancy_id=vacancy.id,
                vacancy_title=vacancy.title,
                match_score=match_score,
                match_reasons=match_reasons,
                missing_requirements=missing_requirements,
                salary_compatible=salary_compatible,
                salary_min=vacancy.salary_min,
                salary_max=vacancy.salary_max,
                salary_currency=vacancy.salary_currency or "RUB",
                location=vacancy.location,
                employment_type=vacancy.employment_type,
                experience_level=vacancy.experience_level,
                department_name=dept_name,
                applications_count=apps_count,
            ))

        # Sort by match score (descending) and limit
        recommendations.sort(key=lambda r: r.match_score, reverse=True)

        logger.info(
            f"Generated {len(recommendations[:limit])} recommendations for entity {entity.id}"
        )

        return recommendations[:limit]

    async def find_matching_candidates(
        self,
        db: AsyncSession,
        vacancy: Vacancy,
        limit: int = 10,
        exclude_applied: bool = True
    ) -> List[CandidateMatch]:
        """
        Find candidates that match a vacancy.

        Args:
            db: Database session
            vacancy: Vacancy to find candidates for
            limit: Maximum number of candidates
            exclude_applied: Whether to exclude already applied candidates

        Returns:
            List of CandidateMatch objects sorted by match score
        """
        # Extract vacancy requirements
        vacancy_skills = self._extract_vacancy_requirements(vacancy)
        logger.debug(f"Vacancy {vacancy.id} required skills: {vacancy_skills}")

        # Get already applied entity IDs
        applied_entity_ids = set()
        if exclude_applied:
            applied_query = (
                select(VacancyApplication.entity_id)
                .where(VacancyApplication.vacancy_id == vacancy.id)
            )
            applied_result = await db.execute(applied_query)
            applied_entity_ids = {row[0] for row in applied_result.all()}

        # Query candidates in the same organization
        candidate_query = select(Entity).where(
            and_(
                Entity.type == EntityType.candidate,
                Entity.org_id == vacancy.org_id,
                Entity.status.notin_([EntityStatus.rejected, EntityStatus.hired])
            )
        )

        if applied_entity_ids:
            candidate_query = candidate_query.where(
                Entity.id.notin_(applied_entity_ids)
            )

        candidate_result = await db.execute(candidate_query)
        candidates = candidate_result.scalars().all()

        matches = []

        for candidate in candidates:
            # Extract candidate skills
            candidate_skills = self._extract_candidate_skills(candidate)

            # Check salary compatibility
            salary_compatible, _ = self._check_salary_compatibility(candidate, vacancy)

            # Calculate match score
            match_score = self._calculate_match_score(
                candidate_skills,
                vacancy_skills,
                salary_compatible
            )

            # Build match reasons
            match_reasons = []
            missing_skills = []

            if candidate_skills and vacancy_skills:
                matched = set(candidate_skills) & set(vacancy_skills)
                missing = set(vacancy_skills) - set(candidate_skills)

                if matched:
                    match_reasons.append(
                        f"Совпадающие навыки: {', '.join(sorted(matched))}"
                    )

                if missing:
                    missing_skills.extend(sorted(missing))

            if salary_compatible:
                match_reasons.append("Зарплатные ожидания совпадают")

            matches.append(CandidateMatch(
                entity_id=candidate.id,
                entity_name=candidate.name,
                match_score=match_score,
                match_reasons=match_reasons,
                missing_skills=missing_skills,
                salary_compatible=salary_compatible,
                email=candidate.email,
                phone=candidate.phone,
                position=candidate.position,
                status=candidate.status.value if candidate.status else None,
                expected_salary_min=candidate.expected_salary_min,
                expected_salary_max=candidate.expected_salary_max,
                expected_salary_currency=candidate.expected_salary_currency or "RUB",
            ))

        # Sort by match score (descending) and limit
        matches.sort(key=lambda m: m.match_score, reverse=True)

        logger.info(
            f"Found {len(matches[:limit])} matching candidates for vacancy {vacancy.id}"
        )

        return matches[:limit]

    async def auto_apply(
        self,
        db: AsyncSession,
        entity: Entity,
        vacancy: Vacancy,
        source: str = "auto_recommendation",
        created_by: Optional[int] = None
    ) -> Optional[VacancyApplication]:
        """
        Create an automatic application for a candidate to a vacancy.

        Args:
            db: Database session
            entity: Candidate entity
            vacancy: Target vacancy
            source: Source of the application
            created_by: User ID who initiated the auto-apply

        Returns:
            Created VacancyApplication or None if already applied
        """
        # Check if already applied
        existing_query = select(VacancyApplication).where(
            and_(
                VacancyApplication.vacancy_id == vacancy.id,
                VacancyApplication.entity_id == entity.id
            )
        )
        existing_result = await db.execute(existing_query)
        if existing_result.scalar():
            logger.info(
                f"Entity {entity.id} already applied to vacancy {vacancy.id}"
            )
            return None

        # Get max stage_order for applied stage
        max_order_result = await db.execute(
            select(func.max(VacancyApplication.stage_order))
            .where(
                VacancyApplication.vacancy_id == vacancy.id,
                VacancyApplication.stage == ApplicationStage.applied
            )
        )
        max_order = max_order_result.scalar() or 0

        # Create application
        application = VacancyApplication(
            vacancy_id=vacancy.id,
            entity_id=entity.id,
            stage=ApplicationStage.applied,
            stage_order=max_order + 1,
            source=source,
            created_by=created_by,
            notes=f"Автоматическая заявка на основе рекомендации"
        )

        db.add(application)
        await db.commit()
        await db.refresh(application)

        logger.info(
            f"Auto-applied entity {entity.id} to vacancy {vacancy.id}"
        )

        return application

    async def notify_new_vacancy(
        self,
        db: AsyncSession,
        vacancy: Vacancy,
        match_threshold: int = 50,
        limit: int = 20
    ) -> List[CandidateMatch]:
        """
        Find candidates to notify about a new vacancy.

        This method finds matching candidates that could be interested
        in the new vacancy based on their profile and preferences.

        Args:
            db: Database session
            vacancy: Newly created/opened vacancy
            match_threshold: Minimum match score to include (0-100)
            limit: Maximum candidates to notify

        Returns:
            List of CandidateMatch objects that should be notified
        """
        # Find matching candidates
        all_matches = await self.find_matching_candidates(
            db=db,
            vacancy=vacancy,
            limit=limit * 2,  # Get more to filter by threshold
            exclude_applied=True
        )

        # Filter by match threshold
        qualified_matches = [
            m for m in all_matches
            if m.match_score >= match_threshold
        ]

        logger.info(
            f"Found {len(qualified_matches[:limit])} candidates to notify "
            f"for vacancy {vacancy.id} (threshold: {match_threshold})"
        )

        return qualified_matches[:limit]


# Global service instance
vacancy_recommender = VacancyRecommenderService()
