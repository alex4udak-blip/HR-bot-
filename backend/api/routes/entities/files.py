"""
File upload/download operations for entities.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, File, Form, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel
from pathlib import Path
import os
import uuid
import mimetypes
import re
import asyncio
import logging

import aiofiles

from .common import (
    logger, get_db, Entity, EntityType, EntityStatus, User, Department,
    EntityFile, EntityFileType, AccessLevel, OrgRole,
    get_current_user, get_user_org, get_user_org_role,
    check_entity_access, regenerate_entity_profile_background,
    normalize_and_validate_identifiers, broadcast_entity_created
)

router = APIRouter()

# Uploads directory for entity files
ENTITY_FILES_DIR = Path(__file__).parent.parent.parent.parent / "uploads" / "entity_files"
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB
MAX_FILES_PER_ENTITY = 20  # Maximum files per entity
MIN_DISK_SPACE_MB = 100  # Minimum required free disk space in MB

# File operations logger
file_logger = logging.getLogger("hr-analyzer.entity-files")

# Allowed file extensions whitelist (security: prevent executable uploads)
ALLOWED_EXTENSIONS = {
    # Documents
    '.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt',
    # Spreadsheets
    '.xls', '.xlsx', '.ods', '.csv',
    # Images
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg',
    # Archives
    '.zip', '.rar', '.7z', '.tar', '.gz',
    # Presentations
    '.ppt', '.pptx', '.odp',
}

# MIME type whitelist for content validation
ALLOWED_MIME_TYPES = {
    # Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text',
    'application/rtf',
    'text/plain',
    # Spreadsheets
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv',
    # Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/bmp',
    'image/webp',
    'image/svg+xml',
    # Archives
    'application/zip',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    'application/x-tar',
    'application/gzip',
    # Presentations
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.presentation',
    # Generic (fallback for unknown but allowed extensions)
    'application/octet-stream',
}

# Dangerous patterns in filenames
DANGEROUS_PATTERNS = [
    '.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.js', '.jar',
    '.msi', '.dll', '.scr', '.com', '.pif', '.application', '.gadget',
    '.hta', '.cpl', '.msc', '.wsf', '.wsh', '.reg', '.inf', '.lnk',
]


def validate_file_upload(filename: str, content_type: str) -> tuple[bool, str]:
    """
    Validate uploaded file for security.
    Returns (is_valid, error_message).
    """
    if not filename:
        return False, "Filename is required"

    # Normalize filename to lowercase for checks
    filename_lower = filename.lower()

    # Check for null bytes (path traversal attack)
    if '\x00' in filename:
        return False, "Invalid filename"

    # Check for path traversal attempts
    if '..' in filename or '/' in filename or '\\' in filename:
        return False, "Invalid filename"

    # Check for dangerous double extensions (e.g., resume.pdf.exe)
    for pattern in DANGEROUS_PATTERNS:
        if pattern in filename_lower:
            return False, f"File type not allowed: {pattern}"

    # Get and validate extension
    extension = Path(filename_lower).suffix
    if not extension:
        return False, "File must have an extension"

    if extension not in ALLOWED_EXTENSIONS:
        return False, f"File type '{extension}' is not allowed. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"

    # Validate MIME type if provided
    if content_type and content_type not in ALLOWED_MIME_TYPES:
        # Log suspicious MIME type but allow if extension is valid
        # (MIME types can be spoofed, but extensions we control)
        logger.warning(f"Suspicious MIME type {content_type} for file {filename}")

    return True, ""


def check_disk_space(path: Path, required_mb: int = MIN_DISK_SPACE_MB) -> tuple[bool, int]:
    """
    Check if there is enough free disk space.
    Returns (has_enough_space, free_space_mb).
    """
    try:
        import shutil
        # Get disk usage stats for the path (or its parent if it doesn't exist)
        check_path = path if path.exists() else path.parent
        while not check_path.exists() and check_path != check_path.parent:
            check_path = check_path.parent

        if not check_path.exists():
            check_path = Path("/")

        total, used, free = shutil.disk_usage(check_path)
        free_mb = free // (1024 * 1024)
        return free_mb >= required_mb, free_mb
    except Exception as e:
        file_logger.warning(f"Failed to check disk space: {e}")
        # If we can't check, assume there's enough space
        return True, -1


async def get_entity_file_count(db: AsyncSession, entity_id: int) -> int:
    """Get the number of files attached to an entity."""
    result = await db.execute(
        select(func.count(EntityFile.id)).where(EntityFile.entity_id == entity_id)
    )
    return result.scalar() or 0


async def cleanup_orphaned_files_for_entity(
    db: AsyncSession,
    entity_id: int,
    org_id: int
) -> tuple[int, list[str]]:
    """
    Find and remove orphaned files for an entity.
    Orphaned files are files on disk that have no corresponding DB record.
    Returns (count of removed files, list of removed file paths).
    """
    entity_dir = ENTITY_FILES_DIR / str(entity_id)
    if not entity_dir.exists():
        return 0, []

    # Get all files on disk for this entity
    disk_files = set()
    for file_path in entity_dir.iterdir():
        if file_path.is_file():
            disk_files.add(str(file_path))

    if not disk_files:
        return 0, []

    # Get all file paths from database
    result = await db.execute(
        select(EntityFile.file_path).where(
            EntityFile.entity_id == entity_id,
            EntityFile.org_id == org_id
        )
    )
    db_file_paths = set(row[0] for row in result.fetchall())

    # Find orphaned files (on disk but not in DB)
    orphaned_files = disk_files - db_file_paths
    removed_files = []

    for orphan_path in orphaned_files:
        try:
            Path(orphan_path).unlink()
            removed_files.append(orphan_path)
            file_logger.info(f"Removed orphaned file: {orphan_path}")
        except OSError as e:
            file_logger.warning(f"Failed to remove orphaned file {orphan_path}: {e}")

    return len(removed_files), removed_files


async def cleanup_all_orphaned_files(db: AsyncSession, org_id: int) -> dict:
    """
    Clean up orphaned files across all entities in an organization.
    Returns statistics about the cleanup.
    """
    if not ENTITY_FILES_DIR.exists():
        return {"total_removed": 0, "entities_processed": 0, "errors": []}

    total_removed = 0
    entities_processed = 0
    errors = []

    # Get all entity directories
    for entity_dir in ENTITY_FILES_DIR.iterdir():
        if not entity_dir.is_dir():
            continue

        try:
            entity_id = int(entity_dir.name)
        except ValueError:
            continue

        # Check if entity belongs to this org
        entity_result = await db.execute(
            select(Entity.id).where(Entity.id == entity_id, Entity.org_id == org_id)
        )
        if not entity_result.scalar():
            continue

        try:
            count, _ = await cleanup_orphaned_files_for_entity(db, entity_id, org_id)
            total_removed += count
            entities_processed += 1
        except Exception as e:
            errors.append(f"Entity {entity_id}: {str(e)}")
            file_logger.error(f"Error cleaning up entity {entity_id}: {e}")

    return {
        "total_removed": total_removed,
        "entities_processed": entities_processed,
        "errors": errors
    }


class EntityFileResponse(BaseModel):
    """Response schema for entity file."""
    id: int
    entity_id: int
    file_type: str
    file_name: str
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    description: Optional[str] = None
    uploaded_by: Optional[int] = None
    uploader_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/{entity_id}/files")
async def get_entity_files(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all files attached to an entity.
    Returns a list of EntityFile with metadata.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Get entity
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Check if user has access to view this entity
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=None)
    if not has_access:
        raise HTTPException(404, "Entity not found")

    # Get all files for this entity
    files_result = await db.execute(
        select(EntityFile)
        .where(EntityFile.entity_id == entity_id)
        .order_by(EntityFile.created_at.desc())
    )
    files = files_result.scalars().all()

    if not files:
        return []

    # Get uploader names
    uploader_ids = [f.uploaded_by for f in files if f.uploaded_by]
    uploader_names = {}
    if uploader_ids:
        uploaders_result = await db.execute(
            select(User).where(User.id.in_(uploader_ids))
        )
        uploader_names = {u.id: u.name for u in uploaders_result.scalars().all()}

    # Build response
    response = []
    for f in files:
        response.append(EntityFileResponse(
            id=f.id,
            entity_id=f.entity_id,
            file_type=f.file_type.value if f.file_type else "other",
            file_name=f.file_name,
            file_size=f.file_size,
            mime_type=f.mime_type,
            description=f.description,
            uploaded_by=f.uploaded_by,
            uploader_name=uploader_names.get(f.uploaded_by) if f.uploaded_by else None,
            created_at=f.created_at
        ))

    return response


@router.post("/{entity_id}/files")
async def upload_entity_file(
    entity_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    file_type: str = Form("other"),
    description: str = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload a file for an entity.
    Saves file to uploads/entities/{entity_id}/ and creates EntityFile record.
    Automatically triggers AI profile regeneration if profile exists.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Get entity
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Check if user has edit access to this entity
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=AccessLevel.edit)
    if not has_access:
        file_logger.warning(
            f"Upload denied: user {current_user.id} lacks edit permission for entity {entity_id}"
        )
        raise HTTPException(403, "No edit permission for this entity")

    # Check file count limit per entity
    current_file_count = await get_entity_file_count(db, entity_id)
    if current_file_count >= MAX_FILES_PER_ENTITY:
        file_logger.warning(
            f"Upload denied: entity {entity_id} has reached file limit ({MAX_FILES_PER_ENTITY}), "
            f"user {current_user.id}"
        )
        raise HTTPException(
            400,
            f"Maximum number of files ({MAX_FILES_PER_ENTITY}) per entity reached. "
            "Please delete some files before uploading new ones."
        )

    # Parse file_type enum
    try:
        file_type_enum = EntityFileType(file_type)
    except ValueError:
        file_type_enum = EntityFileType.other

    # Get original filename and validate
    original_name = file.filename or "unnamed_file"
    content_type = file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"

    # SECURITY: Validate file type before reading content
    is_valid, error_msg = validate_file_upload(original_name, content_type)
    if not is_valid:
        file_logger.warning(
            f"Upload denied: invalid file '{original_name}' for entity {entity_id}, "
            f"user {current_user.id}, reason: {error_msg}"
        )
        raise HTTPException(400, error_msg)

    # Create directory if not exists
    entity_files_dir = ENTITY_FILES_DIR / str(entity_id)
    entity_files_dir.mkdir(parents=True, exist_ok=True)

    # Check disk space before uploading
    has_space, free_mb = check_disk_space(entity_files_dir)
    if not has_space:
        file_logger.error(
            f"Upload denied: insufficient disk space ({free_mb}MB free, "
            f"need {MIN_DISK_SPACE_MB}MB), entity {entity_id}, user {current_user.id}"
        )
        raise HTTPException(
            507,
            f"Insufficient disk space. Only {free_mb}MB available, "
            f"minimum {MIN_DISK_SPACE_MB}MB required."
        )

    # Generate unique filename to avoid collisions
    file_extension = Path(original_name.lower()).suffix
    unique_name = f"{uuid.uuid4().hex}{file_extension}"
    file_path = entity_files_dir / unique_name

    # Read and save file
    content = await file.read()
    file_size = len(content)

    # Validate file size
    if file_size > MAX_FILE_SIZE:
        file_logger.warning(
            f"Upload denied: file too large ({file_size} bytes > {MAX_FILE_SIZE} bytes), "
            f"entity {entity_id}, user {current_user.id}"
        )
        raise HTTPException(400, f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)}MB")

    # Check if file size fits in available space (with buffer)
    file_size_mb = file_size / (1024 * 1024)
    if free_mb > 0 and file_size_mb > (free_mb - MIN_DISK_SPACE_MB):
        file_logger.error(
            f"Upload denied: file ({file_size_mb:.2f}MB) would exceed safe disk space limit, "
            f"entity {entity_id}, user {current_user.id}"
        )
        raise HTTPException(
            507,
            f"File size ({file_size_mb:.2f}MB) exceeds available disk space."
        )

    # SECURITY: Additional content-based validation for PDFs and images
    # Check magic bytes to ensure file content matches extension
    if file_extension == '.pdf' and not content.startswith(b'%PDF'):
        file_logger.warning(
            f"Upload denied: invalid PDF magic bytes for '{original_name}', "
            f"entity {entity_id}, user {current_user.id}"
        )
        raise HTTPException(400, "Invalid PDF file: content does not match PDF format")
    elif file_extension in {'.jpg', '.jpeg'} and not content.startswith(b'\xff\xd8\xff'):
        file_logger.warning(
            f"Upload denied: invalid JPEG magic bytes for '{original_name}', "
            f"entity {entity_id}, user {current_user.id}"
        )
        raise HTTPException(400, "Invalid JPEG file: content does not match JPEG format")
    elif file_extension == '.png' and not content.startswith(b'\x89PNG'):
        file_logger.warning(
            f"Upload denied: invalid PNG magic bytes for '{original_name}', "
            f"entity {entity_id}, user {current_user.id}"
        )
        raise HTTPException(400, "Invalid PNG file: content does not match PNG format")
    elif file_extension == '.zip' and not content.startswith(b'PK'):
        file_logger.warning(
            f"Upload denied: invalid ZIP magic bytes for '{original_name}', "
            f"entity {entity_id}, user {current_user.id}"
        )
        raise HTTPException(400, "Invalid ZIP file: content does not match ZIP format")

    file_path.write_bytes(content)

    # Use validated MIME type
    mime_type = content_type

    # Create database record
    entity_file = EntityFile(
        entity_id=entity_id,
        org_id=org.id,
        file_type=file_type_enum,
        file_name=original_name,
        file_path=str(file_path),
        file_size=file_size,
        mime_type=mime_type,
        description=description,
        uploaded_by=current_user.id
    )

    db.add(entity_file)
    await db.commit()
    await db.refresh(entity_file)

    file_logger.info(
        f"FILE_UPLOAD: success | entity_id={entity_id} | file_id={entity_file.id} | "
        f"file_name='{original_name}' | file_type={file_type_enum.value} | "
        f"size={file_size} bytes | mime_type={mime_type} | "
        f"user_id={current_user.id} | user_name='{current_user.name}' | "
        f"org_id={org.id} | path={file_path}"
    )

    # Generate/regenerate AI profile in background with new file context
    # Always generate profile when new context is added (chat, call, file)
    background_tasks.add_task(
        asyncio.create_task,
        regenerate_entity_profile_background(entity_id, org.id)
    )

    return EntityFileResponse(
        id=entity_file.id,
        entity_id=entity_file.entity_id,
        file_type=entity_file.file_type.value if entity_file.file_type else "other",
        file_name=entity_file.file_name,
        file_size=entity_file.file_size,
        mime_type=entity_file.mime_type,
        description=entity_file.description,
        uploaded_by=entity_file.uploaded_by,
        uploader_name=current_user.name,
        created_at=entity_file.created_at
    )


@router.delete("/{entity_id}/files/{file_id}")
async def delete_entity_file(
    entity_id: int,
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete a file from an entity.
    Removes file from disk and deletes EntityFile record.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Get entity
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Check if user has edit access to this entity
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=AccessLevel.edit)
    if not has_access:
        file_logger.warning(
            f"FILE_DELETE: denied | entity_id={entity_id} | file_id={file_id} | "
            f"user_id={current_user.id} | reason=no_edit_permission"
        )
        raise HTTPException(403, "No edit permission for this entity")

    # Get file record
    file_result = await db.execute(
        select(EntityFile).where(
            EntityFile.id == file_id,
            EntityFile.entity_id == entity_id
        )
    )
    entity_file = file_result.scalar_one_or_none()

    if not entity_file:
        file_logger.warning(
            f"FILE_DELETE: not_found | entity_id={entity_id} | file_id={file_id} | "
            f"user_id={current_user.id}"
        )
        raise HTTPException(404, "File not found")

    # Store file info for logging before deletion
    deleted_file_name = entity_file.file_name
    deleted_file_path = entity_file.file_path
    deleted_file_size = entity_file.file_size

    # Delete file from disk
    file_path = Path(entity_file.file_path)
    disk_deleted = False
    if file_path.exists():
        try:
            file_path.unlink()
            disk_deleted = True
            file_logger.debug(f"Deleted file from disk: {file_path}")
        except OSError as e:
            file_logger.warning(f"Failed to delete file from disk {file_path}: {e}")

    # Delete database record
    await db.delete(entity_file)
    await db.commit()

    file_logger.info(
        f"FILE_DELETE: success | entity_id={entity_id} | file_id={file_id} | "
        f"file_name='{deleted_file_name}' | size={deleted_file_size} bytes | "
        f"disk_deleted={disk_deleted} | user_id={current_user.id} | "
        f"user_name='{current_user.name}' | org_id={org.id} | path={deleted_file_path}"
    )

    return {"success": True, "file_id": file_id}


@router.get("/{entity_id}/files/{file_id}/download")
async def download_entity_file(
    entity_id: int,
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Download a file from an entity.
    Returns the file as a FileResponse.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Get entity
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Check if user has access to view this entity
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=None)
    if not has_access:
        file_logger.warning(
            f"FILE_DOWNLOAD: denied | entity_id={entity_id} | file_id={file_id} | "
            f"user_id={current_user.id} | reason=no_view_permission"
        )
        raise HTTPException(404, "Entity not found")

    # Get file record
    file_result = await db.execute(
        select(EntityFile).where(
            EntityFile.id == file_id,
            EntityFile.entity_id == entity_id
        )
    )
    entity_file = file_result.scalar_one_or_none()

    if not entity_file:
        file_logger.warning(
            f"FILE_DOWNLOAD: not_found | entity_id={entity_id} | file_id={file_id} | "
            f"user_id={current_user.id}"
        )
        raise HTTPException(404, "File not found")

    # Check if file exists on disk
    file_path = Path(entity_file.file_path)
    if not file_path.exists():
        file_logger.error(
            f"FILE_DOWNLOAD: missing_on_disk | entity_id={entity_id} | file_id={file_id} | "
            f"file_name='{entity_file.file_name}' | path={entity_file.file_path} | "
            f"user_id={current_user.id}"
        )
        raise HTTPException(404, "File not found on disk")

    # Log successful download
    file_logger.info(
        f"FILE_DOWNLOAD: success | entity_id={entity_id} | file_id={file_id} | "
        f"file_name='{entity_file.file_name}' | size={entity_file.file_size} bytes | "
        f"mime_type={entity_file.mime_type} | user_id={current_user.id} | "
        f"user_name='{current_user.name}' | org_id={org.id}"
    )

    # Return file
    return FileResponse(
        path=file_path,
        filename=entity_file.file_name,
        media_type=entity_file.mime_type or "application/octet-stream"
    )


@router.post("/{entity_id}/files/cleanup")
async def cleanup_entity_orphaned_files(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Clean up orphaned files for a specific entity.
    Orphaned files are files on disk that have no corresponding database record.
    Requires edit permission on the entity.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Get entity
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Check if user has edit access to this entity
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=AccessLevel.edit)
    if not has_access:
        file_logger.warning(
            f"FILE_CLEANUP: denied | entity_id={entity_id} | "
            f"user_id={current_user.id} | reason=no_edit_permission"
        )
        raise HTTPException(403, "No edit permission for this entity")

    # Perform cleanup
    count, removed_files = await cleanup_orphaned_files_for_entity(db, entity_id, org.id)

    file_logger.info(
        f"FILE_CLEANUP: success | entity_id={entity_id} | "
        f"removed_count={count} | user_id={current_user.id} | "
        f"user_name='{current_user.name}' | org_id={org.id}"
    )

    return {
        "success": True,
        "entity_id": entity_id,
        "removed_count": count,
        "removed_files": removed_files
    }


@router.post("/files/cleanup-all")
async def cleanup_all_orphaned_files_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Clean up orphaned files for all entities in the user's organization.
    Orphaned files are files on disk that have no corresponding database record.
    Requires admin or owner role in the organization.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Check if user has admin access
    org_role = await get_user_org_role(current_user, org.id, db)
    if org_role not in [OrgRole.owner, OrgRole.admin]:
        file_logger.warning(
            f"FILE_CLEANUP_ALL: denied | org_id={org.id} | "
            f"user_id={current_user.id} | role={org_role} | reason=not_admin"
        )
        raise HTTPException(403, "Admin or owner access required for organization-wide cleanup")

    # Perform cleanup
    result = await cleanup_all_orphaned_files(db, org.id)

    file_logger.info(
        f"FILE_CLEANUP_ALL: success | org_id={org.id} | "
        f"entities_processed={result['entities_processed']} | "
        f"total_removed={result['total_removed']} | "
        f"errors_count={len(result['errors'])} | "
        f"user_id={current_user.id} | user_name='{current_user.name}'"
    )

    return {
        "success": True,
        "org_id": org.id,
        **result
    }
