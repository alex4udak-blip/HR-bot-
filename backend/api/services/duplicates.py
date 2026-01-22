"""
Duplicate Detection Service for HR-Bot.

Provides functionality to:
- Detect potential duplicate candidates based on email, phone, name
- Calculate similarity scores between entities
- Merge duplicate entities into one
"""

import logging
import re
from typing import List, Optional, Dict, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from sqlalchemy import select, or_, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import (
    Entity, EntityType, EntityStatus,
    Chat, Message, CallRecording, EntityFile, VacancyApplication
)

logger = logging.getLogger("hr-analyzer.duplicates")


def normalize_phone(phone: Optional[str]) -> Optional[str]:
    """Normalize phone number by removing all non-digits."""
    if not phone:
        return None
    digits = re.sub(r'\D', '', phone)
    # Remove leading country codes (7, 8 for Russia)
    if len(digits) == 11 and digits[0] in ('7', '8'):
        digits = digits[1:]
    return digits if len(digits) >= 10 else None


def normalize_email(email: Optional[str]) -> Optional[str]:
    """Normalize email to lowercase."""
    if not email:
        return None
    return email.lower().strip()


def normalize_name(name: Optional[str]) -> Optional[str]:
    """Normalize name for comparison."""
    if not name:
        return None
    # Remove extra spaces, convert to lowercase
    return ' '.join(name.lower().split())


def calculate_name_similarity(name1: Optional[str], name2: Optional[str]) -> float:
    """
    Calculate similarity between two names.
    Returns a score from 0.0 to 1.0.
    """
    if not name1 or not name2:
        return 0.0

    n1 = normalize_name(name1)
    n2 = normalize_name(name2)

    if not n1 or not n2:
        return 0.0

    # Exact match
    if n1 == n2:
        return 1.0

    # Split into words
    words1 = set(n1.split())
    words2 = set(n2.split())

    # Jaccard similarity
    if not words1 or not words2:
        return 0.0

    intersection = words1 & words2
    union = words1 | words2

    return len(intersection) / len(union)


@dataclass
class DuplicateCandidate:
    """Represents a potential duplicate entity."""
    entity_id: int
    entity_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    position: Optional[str] = None
    company: Optional[str] = None
    similarity_score: float = 0.0
    match_reasons: List[str] = field(default_factory=list)
    created_at: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "entity_id": self.entity_id,
            "entity_name": self.entity_name,
            "email": self.email,
            "phone": self.phone,
            "position": self.position,
            "company": self.company,
            "similarity_score": self.similarity_score,
            "match_reasons": self.match_reasons,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


@dataclass
class MergeResult:
    """Result of merging duplicate entities."""
    success: bool
    primary_entity_id: int
    merged_entity_ids: List[int]
    chats_transferred: int = 0
    calls_transferred: int = 0
    files_transferred: int = 0
    applications_transferred: int = 0
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "success": self.success,
            "primary_entity_id": self.primary_entity_id,
            "merged_entity_ids": self.merged_entity_ids,
            "chats_transferred": self.chats_transferred,
            "calls_transferred": self.calls_transferred,
            "files_transferred": self.files_transferred,
            "applications_transferred": self.applications_transferred,
            "error": self.error,
        }


class DuplicateDetectionService:
    """Service for detecting and merging duplicate entities."""

    async def find_duplicates(
        self,
        db: AsyncSession,
        entity: Entity,
        threshold: float = 0.5
    ) -> List[DuplicateCandidate]:
        """
        Find potential duplicates for an entity.

        Args:
            db: Database session
            entity: Entity to find duplicates for
            threshold: Minimum similarity score (0.0 - 1.0)

        Returns:
            List of DuplicateCandidate objects sorted by similarity
        """
        candidates = []

        # Normalize entity data
        entity_email = normalize_email(entity.email)
        entity_phone = normalize_phone(entity.phone)
        entity_name = normalize_name(entity.name)

        # Build query for potential duplicates
        conditions = []

        # Same email
        if entity_email:
            conditions.append(func.lower(Entity.email) == entity_email)

        # Similar phone
        if entity_phone:
            conditions.append(Entity.phone.ilike(f'%{entity_phone[-10:]}%'))

        # Similar name (first word match)
        if entity_name:
            first_name = entity_name.split()[0] if entity_name else None
            if first_name and len(first_name) > 2:
                conditions.append(func.lower(Entity.name).ilike(f'%{first_name}%'))

        if not conditions:
            return []

        # Query potential duplicates
        query = select(Entity).where(
            and_(
                Entity.id != entity.id,
                Entity.org_id == entity.org_id,
                Entity.type == entity.type,
                or_(*conditions)
            )
        )

        result = await db.execute(query)
        potential_duplicates = result.scalars().all()

        for dupe in potential_duplicates:
            score, reasons = self._calculate_duplicate_score(entity, dupe)

            if score >= threshold:
                candidates.append(DuplicateCandidate(
                    entity_id=dupe.id,
                    entity_name=dupe.name,
                    email=dupe.email,
                    phone=dupe.phone,
                    position=dupe.position,
                    company=dupe.company,
                    similarity_score=round(score, 2),
                    match_reasons=reasons,
                    created_at=dupe.created_at,
                ))

        # Sort by similarity score (descending)
        candidates.sort(key=lambda c: c.similarity_score, reverse=True)

        logger.info(
            f"Found {len(candidates)} potential duplicates for entity {entity.id}"
        )

        return candidates

    def _calculate_duplicate_score(
        self,
        entity1: Entity,
        entity2: Entity
    ) -> Tuple[float, List[str]]:
        """
        Calculate duplicate similarity score between two entities.

        Returns:
            Tuple of (score, match_reasons)
        """
        score = 0.0
        reasons = []

        # Email match (highest weight)
        email1 = normalize_email(entity1.email)
        email2 = normalize_email(entity2.email)
        if email1 and email2 and email1 == email2:
            score += 0.5
            reasons.append("Совпадение email")

        # Phone match (high weight)
        phone1 = normalize_phone(entity1.phone)
        phone2 = normalize_phone(entity2.phone)
        if phone1 and phone2 and phone1 == phone2:
            score += 0.35
            reasons.append("Совпадение телефона")

        # Name similarity
        name_sim = calculate_name_similarity(entity1.name, entity2.name)
        if name_sim >= 0.8:
            score += 0.15
            reasons.append("Похожее имя")
        elif name_sim >= 0.5:
            score += 0.1
            reasons.append("Частичное совпадение имени")

        return min(score, 1.0), reasons

    async def find_all_duplicates(
        self,
        db: AsyncSession,
        org_id: int,
        entity_type: EntityType = EntityType.candidate,
        limit: int = 100
    ) -> List[Tuple[Entity, List[DuplicateCandidate]]]:
        """
        Find all duplicate groups in an organization.

        Args:
            db: Database session
            org_id: Organization ID
            entity_type: Type of entities to check
            limit: Maximum number of entities to check

        Returns:
            List of (entity, duplicates) tuples
        """
        # Get entities with common identifiers
        query = select(Entity).where(
            Entity.org_id == org_id,
            Entity.type == entity_type
        ).order_by(Entity.created_at.desc()).limit(limit)

        result = await db.execute(query)
        entities = result.scalars().all()

        duplicate_groups = []
        checked_ids = set()

        for entity in entities:
            if entity.id in checked_ids:
                continue

            duplicates = await self.find_duplicates(db, entity, threshold=0.5)

            if duplicates:
                duplicate_groups.append((entity, duplicates))
                checked_ids.add(entity.id)
                for d in duplicates:
                    checked_ids.add(d.entity_id)

        logger.info(
            f"Found {len(duplicate_groups)} duplicate groups in org {org_id}"
        )

        return duplicate_groups

    async def merge_entities(
        self,
        db: AsyncSession,
        primary_id: int,
        duplicate_ids: List[int],
        user_id: int
    ) -> MergeResult:
        """
        Merge duplicate entities into a primary entity.

        This will:
        - Transfer all chats, calls, files, applications to primary entity
        - Keep the primary entity's basic info (can be updated separately)
        - Soft-delete the duplicate entities

        Args:
            db: Database session
            primary_id: ID of the entity to keep
            duplicate_ids: IDs of entities to merge into primary
            user_id: ID of user performing the merge

        Returns:
            MergeResult with statistics
        """
        try:
            # Validate entities
            result = await db.execute(
                select(Entity).where(Entity.id == primary_id)
            )
            primary = result.scalar_one_or_none()

            if not primary:
                return MergeResult(
                    success=False,
                    primary_entity_id=primary_id,
                    merged_entity_ids=duplicate_ids,
                    error="Primary entity not found"
                )

            # Check if primary entity is already merged
            if primary.status == EntityStatus.merged:
                merged_into = (primary.extra_data or {}).get('merged_into')
                return MergeResult(
                    success=False,
                    primary_entity_id=primary_id,
                    merged_entity_ids=duplicate_ids,
                    error=f"Primary entity {primary_id} was already merged into {merged_into}"
                )

            # Check for circular merges - prevent merging entities that have primary as their merge target
            for dupe_id in duplicate_ids:
                result = await db.execute(
                    select(Entity).where(Entity.id == dupe_id)
                )
                dupe = result.scalar_one_or_none()
                if dupe:
                    # Check if this dupe was previously merged INTO the primary
                    if dupe.status == EntityStatus.merged:
                        dupe_merged_into = (dupe.extra_data or {}).get('merged_into')
                        if dupe_merged_into == primary_id:
                            return MergeResult(
                                success=False,
                                primary_entity_id=primary_id,
                                merged_entity_ids=duplicate_ids,
                                error=f"Circular merge detected: entity {dupe_id} was already merged into {primary_id}"
                            )
                    # Check if primary was previously merged into this dupe
                    primary_merged_into = (primary.extra_data or {}).get('merged_into')
                    if primary_merged_into == dupe_id:
                        return MergeResult(
                            success=False,
                            primary_entity_id=primary_id,
                            merged_entity_ids=duplicate_ids,
                            error=f"Circular merge detected: primary {primary_id} was merged into {dupe_id}"
                        )

            chats_transferred = 0
            calls_transferred = 0
            files_transferred = 0
            applications_transferred = 0

            for dupe_id in duplicate_ids:
                # Transfer chats
                result = await db.execute(
                    select(Chat).where(Chat.entity_id == dupe_id)
                )
                chats = result.scalars().all()
                for chat in chats:
                    chat.entity_id = primary_id
                    chats_transferred += 1

                # Transfer calls
                result = await db.execute(
                    select(CallRecording).where(CallRecording.entity_id == dupe_id)
                )
                calls = result.scalars().all()
                for call in calls:
                    call.entity_id = primary_id
                    calls_transferred += 1

                # Transfer files
                result = await db.execute(
                    select(EntityFile).where(EntityFile.entity_id == dupe_id)
                )
                files = result.scalars().all()
                for file in files:
                    file.entity_id = primary_id
                    files_transferred += 1

                # Transfer vacancy applications (skip if already exists)
                result = await db.execute(
                    select(VacancyApplication).where(
                        VacancyApplication.entity_id == dupe_id
                    )
                )
                applications = result.scalars().all()
                for app in applications:
                    # Check if primary already has application for this vacancy
                    existing = await db.execute(
                        select(VacancyApplication).where(
                            VacancyApplication.entity_id == primary_id,
                            VacancyApplication.vacancy_id == app.vacancy_id
                        )
                    )
                    if not existing.scalar_one_or_none():
                        app.entity_id = primary_id
                        applications_transferred += 1
                    else:
                        # Delete duplicate application
                        await db.delete(app)

                # Soft delete the duplicate entity
                result = await db.execute(
                    select(Entity).where(Entity.id == dupe_id)
                )
                dupe_entity = result.scalar_one_or_none()
                if dupe_entity:
                    dupe_entity.status = EntityStatus.merged
                    # Store merge info in extra_data
                    extra = dupe_entity.extra_data or {}
                    extra['merged_into'] = primary_id
                    extra['merged_at'] = datetime.utcnow().isoformat()
                    extra['merged_by'] = user_id
                    dupe_entity.extra_data = extra

            # Collect all contact identifiers from duplicates to merge into primary
            all_tags = set(primary.tags or [])
            all_emails = set(primary.emails or [])
            all_phones = set(primary.phones or [])
            all_telegram = set(primary.telegram_usernames or [])

            # Add primary's main email/phone if not already in lists
            if primary.email:
                all_emails.add(primary.email.lower().strip())
            if primary.phone:
                normalized = normalize_phone(primary.phone)
                if normalized:
                    all_phones.add(normalized)

            for dupe_id in duplicate_ids:
                result = await db.execute(
                    select(Entity).where(Entity.id == dupe_id)
                )
                dupe = result.scalar_one_or_none()
                if dupe:
                    # Tags
                    if dupe.tags:
                        all_tags.update(dupe.tags)

                    # Emails - collect main email and additional emails
                    if dupe.email:
                        all_emails.add(dupe.email.lower().strip())
                    if dupe.emails:
                        for email in dupe.emails:
                            if email:
                                all_emails.add(email.lower().strip())

                    # Phones - normalize and collect
                    if dupe.phone:
                        normalized = normalize_phone(dupe.phone)
                        if normalized:
                            all_phones.add(normalized)
                    if dupe.phones:
                        for phone in dupe.phones:
                            normalized = normalize_phone(phone)
                            if normalized:
                                all_phones.add(normalized)

                    # Telegram usernames - normalize (lowercase, no @)
                    if dupe.telegram_usernames:
                        for tg in dupe.telegram_usernames:
                            if tg:
                                normalized = tg.lower().strip().lstrip('@')
                                if normalized:
                                    all_telegram.add(normalized)

            # Update primary with combined contact data
            primary.tags = list(all_tags)
            primary.emails = list(all_emails)
            primary.phones = list(all_phones)
            primary.telegram_usernames = list(all_telegram)

            logger.info(
                f"Merged contacts into primary {primary_id}: "
                f"emails={len(all_emails)}, phones={len(all_phones)}, "
                f"telegram={len(all_telegram)}, tags={len(all_tags)}"
            )

            await db.commit()

            logger.info(
                f"Merged entities {duplicate_ids} into {primary_id} | "
                f"chats={chats_transferred}, calls={calls_transferred}, "
                f"files={files_transferred}, apps={applications_transferred}"
            )

            return MergeResult(
                success=True,
                primary_entity_id=primary_id,
                merged_entity_ids=duplicate_ids,
                chats_transferred=chats_transferred,
                calls_transferred=calls_transferred,
                files_transferred=files_transferred,
                applications_transferred=applications_transferred,
            )

        except Exception as e:
            logger.error(f"Merge failed: {e}")
            await db.rollback()
            return MergeResult(
                success=False,
                primary_entity_id=primary_id,
                merged_entity_ids=duplicate_ids,
                error=str(e),
            )


# Global service instance
duplicate_service = DuplicateDetectionService()
