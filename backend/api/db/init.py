"""
Database initialization module.

This module handles all database initialization logic including:
- Running migrations
- Adding enum values
- Creating tables
- Setting up default data
"""

import asyncio
import logging
from pathlib import Path

from sqlalchemy import text

from api.utils.db_url import get_sync_database_url
from api.db.migrations import (
    ENUM_DEFINITIONS,
    CHATTYPE_VALUES,
    ROLE_ENUM_VALUES,
    HR_PIPELINE_STAGES,
    CREATE_CALL_RECORDINGS_SQL,
    CALL_RECORDINGS_INDEXES,
    COLUMN_MIGRATIONS,
    CREATE_ENTITY_AI_CONVERSATIONS_SQL,
    ENTITY_AI_CONVERSATIONS_INDEXES,
    CREATE_ENTITY_ANALYSES_SQL,
    ENTITY_ANALYSES_INDEXES,
    CREATE_ORGANIZATIONS_SQL,
    CREATE_ORG_MEMBERS_SQL,
    ORG_MEMBERS_INDEXES,
    MULTI_TENANCY_COLUMNS,
    SMART_CONTEXT_COLUMNS,
    CREATE_DEPARTMENTS_SQL,
    CREATE_DEPARTMENT_MEMBERS_SQL,
    DEPARTMENT_INDEXES,
    DEPARTMENT_COLUMNS,
    ENTITY_TRANSFERS_COLUMNS,
    ENTITY_TRACKING_COLUMNS,
    CREATE_INVITATIONS_SQL,
    INVITATIONS_INDEXES,
    CREATE_VACANCYSTATUS_ENUM,
    CREATE_APPLICATIONSTAGE_ENUM,
    APPLICATIONSTAGE_VALUES,
    CREATE_VACANCIES_SQL,
    VACANCIES_INDEXES,
    CREATE_VACANCY_APPLICATIONS_SQL,
    VACANCY_APPLICATIONS_INDEXES,
    CREATE_ENTITYFILETYPE_ENUM,
    CREATE_ENTITY_FILES_SQL,
    ENTITY_FILES_INDEXES,
    CREATE_DEPARTMENT_FEATURES_SQL,
    DEPARTMENT_FEATURES_INDEXES,
    ROLE_CONVERSIONS,
    SHARED_ACCESS_COLUMNS,
    SHARED_ACCESS_CALL_ID,
    SHARED_ACCESS_VACANCY_ID,
    ENTITY_FILES_ORG_ID,
)

logger = logging.getLogger("hr-analyzer")


async def run_migration(engine, sql: str, description: str):
    """Run a single migration in its own transaction."""
    try:
        async with engine.begin() as conn:
            await conn.execute(text(sql))
        logger.info(f"Migration OK: {description}")
        return True
    except Exception as e:
        logger.warning(f"Migration failed ({description}): {e}")
        return False


def add_enum_value_sync(enum_name: str, value: str, description: str):
    """Add a value to an existing enum type using psycopg2 with autocommit.

    PostgreSQL requires ALTER TYPE ADD VALUE to run outside of a transaction block.
    We use synchronous psycopg2 with autocommit=True to ensure no transaction wrapping.
    """
    import psycopg2

    try:
        # Get sync database URL for psycopg2
        db_url = get_sync_database_url()

        # Connect with autocommit enabled
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        try:
            cur = conn.cursor()
            cur.execute(f"ALTER TYPE {enum_name} ADD VALUE IF NOT EXISTS '{value}'")
            cur.close()
            logger.info(f"Enum value OK: {description}")
            return True
        finally:
            conn.close()
    except Exception as e:
        logger.warning(f"Enum value failed ({description}): {e}")
        return False


async def add_enum_value(engine, enum_name: str, value: str, description: str):
    """Async wrapper for add_enum_value_sync - runs in executor to not block event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, add_enum_value_sync, enum_name, value, description)


async def init_database():
    """Initialize database with separate transactions for each migration."""
    from api.database import engine, AsyncSessionLocal
    from api.models.database import Base
    from api.services.auth import create_superadmin_if_not_exists

    logger.info("=== DATABASE INITIALIZATION START ===")

    # Step 1: Create enum types (each in separate transaction)
    for enum_name, values in ENUM_DEFINITIONS:
        values_str = ', '.join([f"'{v}'" for v in values])
        await run_migration(engine, f"CREATE TYPE {enum_name} AS ENUM ({values_str})", f"Create {enum_name} enum")

    # Step 2: Add enum values to chattype (each in separate transaction)
    for value in CHATTYPE_VALUES:
        await run_migration(engine, f"ALTER TYPE chattype ADD VALUE IF NOT EXISTS '{value}'", f"Add {value} to chattype")

    # Step 2.1: Add sub_admin to role enums (critical for sandbox - moved here to ensure it runs early)
    await run_migration(engine, "ALTER TYPE deptrole ADD VALUE IF NOT EXISTS 'sub_admin'", "Add sub_admin to deptrole enum")
    await run_migration(engine, "ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'sub_admin'", "Add sub_admin to userrole enum")

    # Step 2.2: Add lowercase role values to userrole enum (for migration)
    for role_val in ROLE_ENUM_VALUES:
        await run_migration(engine, f"ALTER TYPE userrole ADD VALUE IF NOT EXISTS '{role_val}'", f"Add {role_val} to userrole enum")

    # Step 2.3: Add HR pipeline stages to entitystatus enum (for Entity.status sync)
    for status_val in HR_PIPELINE_STAGES:
        await run_migration(engine, f"ALTER TYPE entitystatus ADD VALUE IF NOT EXISTS '{status_val}'", f"Add {status_val} to entitystatus enum")

    # Step 3: Create all tables
    logger.info("Creating tables with create_all...")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Tables created successfully")
    except Exception as e:
        logger.error(f"Error creating tables: {e}")
        return

    # Step 3.1: Convert existing uppercase role values to lowercase (critical fix)
    for sql, description in ROLE_CONVERSIONS:
        await run_migration(engine, sql, description)

    # Step 3.2: Add 'vacancy' to resourcetype enum (needed for vacancy sharing)
    await add_enum_value(engine, "resourcetype", "vacancy", "Add vacancy to resourcetype enum")

    # Step 3.3: Add foreign key columns to shared_access for proper cascade delete (critical for sandbox)
    for sql, description in SHARED_ACCESS_COLUMNS:
        await run_migration(engine, sql, description)

    # Step 3.4: Add vacancy_id to shared_access EARLY (critical for vacancy sharing/deletion)
    # This runs early because vacancies table already exists in production
    await run_migration(engine, SHARED_ACCESS_VACANCY_ID[0], SHARED_ACCESS_VACANCY_ID[1])

    # Step 4: Create call_recordings table if not exists (preserves existing data)
    logger.info("=== SETTING UP call_recordings TABLE ===")
    await run_migration(engine, CREATE_CALL_RECORDINGS_SQL, "Create call_recordings table")

    # Create indexes
    for sql, description in CALL_RECORDINGS_INDEXES:
        await run_migration(engine, sql, description)

    logger.info("=== call_recordings TABLE READY ===")

    # Step 4.1: Now add call_id to shared_access (requires call_recordings to exist)
    await run_migration(engine, SHARED_ACCESS_CALL_ID[0], SHARED_ACCESS_CALL_ID[1])

    # Step 5: Other column migrations
    for sql, description in COLUMN_MIGRATIONS:
        await run_migration(engine, sql, description)

    # Entity AI tables
    await run_migration(engine, CREATE_ENTITY_AI_CONVERSATIONS_SQL, "Create entity_ai_conversations table")
    for sql, description in ENTITY_AI_CONVERSATIONS_INDEXES:
        await run_migration(engine, sql, description)

    await run_migration(engine, CREATE_ENTITY_ANALYSES_SQL, "Create entity_analyses table")
    for sql, description in ENTITY_ANALYSES_INDEXES:
        await run_migration(engine, sql, description)

    # Step 6: Multi-tenancy - Organizations
    logger.info("=== SETTING UP MULTI-TENANCY ===")

    # Create enums for organizations
    await run_migration(engine, "CREATE TYPE orgrole AS ENUM ('owner', 'admin', 'member')", "Create orgrole enum")
    await run_migration(engine, "CREATE TYPE subscriptionplan AS ENUM ('free', 'pro', 'enterprise')", "Create subscriptionplan enum")

    # Create organizations table
    await run_migration(engine, CREATE_ORGANIZATIONS_SQL, "Create organizations table")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_organizations_slug ON organizations(slug)", "Index organizations.slug")

    # Create org_members table
    await run_migration(engine, CREATE_ORG_MEMBERS_SQL, "Create org_members table")
    for sql, description in ORG_MEMBERS_INDEXES:
        await run_migration(engine, sql, description)

    # Add org_id to existing tables
    for sql, description in MULTI_TENANCY_COLUMNS:
        await run_migration(engine, sql, description)

    # Smart context fields for AI analysis
    for sql, description in SMART_CONTEXT_COLUMNS:
        await run_migration(engine, sql, description)

    logger.info("=== MULTI-TENANCY TABLES READY ===")

    # Step 8: Departments
    logger.info("=== SETTING UP DEPARTMENTS ===")

    # Create deptrole enum
    await run_migration(engine, "CREATE TYPE deptrole AS ENUM ('lead', 'member')", "Create deptrole enum")

    # Create departments table
    await run_migration(engine, CREATE_DEPARTMENTS_SQL, "Create departments table")
    await run_migration(engine, CREATE_DEPARTMENT_MEMBERS_SQL, "Create department_members table")
    for sql, description in DEPARTMENT_INDEXES:
        await run_migration(engine, sql, description)

    # Department additional columns
    for sql, description in DEPARTMENT_COLUMNS:
        await run_migration(engine, sql, description)

    # Entity transfers columns
    for sql, description in ENTITY_TRANSFERS_COLUMNS:
        await run_migration(engine, sql, description)

    logger.info("=== DEPARTMENTS TABLES READY ===")

    # Entity transfer tracking columns
    for sql, description in ENTITY_TRACKING_COLUMNS:
        await run_migration(engine, sql, description)

    # Step 8: Invitations table
    logger.info("=== SETTING UP INVITATIONS ===")
    await run_migration(engine, CREATE_INVITATIONS_SQL, "Create invitations table")
    for sql, description in INVITATIONS_INDEXES:
        await run_migration(engine, sql, description)

    logger.info("=== INVITATIONS TABLE READY ===")

    # Step 9: Vacancies and Kanban pipeline
    logger.info("=== SETTING UP VACANCIES ===")

    # Create vacancy status enum
    await run_migration(engine, CREATE_VACANCYSTATUS_ENUM, "Create vacancystatus enum")

    # Create application stage enum
    await run_migration(engine, CREATE_APPLICATIONSTAGE_ENUM, "Create applicationstage enum")

    # Add HR Pipeline stages to applicationstage enum (MUST use autocommit - no transaction)
    for value in APPLICATIONSTAGE_VALUES:
        await add_enum_value(engine, "applicationstage", value, f"Add {value} to applicationstage enum")

    # Create vacancies table
    await run_migration(engine, CREATE_VACANCIES_SQL, "Create vacancies table")
    for sql, description in VACANCIES_INDEXES:
        await run_migration(engine, sql, description)

    # Create vacancy_applications table
    await run_migration(engine, CREATE_VACANCY_APPLICATIONS_SQL, "Create vacancy_applications table")
    for sql, description in VACANCY_APPLICATIONS_INDEXES:
        await run_migration(engine, sql, description)

    # Add vacancy_id to shared_access (requires vacancies table to exist)
    await run_migration(engine, SHARED_ACCESS_VACANCY_ID[0], SHARED_ACCESS_VACANCY_ID[1])

    logger.info("=== VACANCIES TABLES READY ===")

    # Step 10: Entity files for document attachments
    logger.info("=== SETTING UP ENTITY FILES ===")

    # Create entity file type enum
    await run_migration(engine, CREATE_ENTITYFILETYPE_ENUM, "Create entityfiletype enum")

    # Create entity_files table
    await run_migration(engine, CREATE_ENTITY_FILES_SQL, "Create entity_files table")
    for sql, description in ENTITY_FILES_INDEXES:
        await run_migration(engine, sql, description)

    # Add org_id column if table exists but column doesn't (for existing deployments)
    await run_migration(engine, ENTITY_FILES_ORG_ID[0], ENTITY_FILES_ORG_ID[1])

    logger.info("=== ENTITY FILES TABLE READY ===")

    # Step 11: Department Features for feature access control
    logger.info("=== SETTING UP DEPARTMENT FEATURES ===")

    # Create department_features table
    await run_migration(engine, CREATE_DEPARTMENT_FEATURES_SQL, "Create department_features table")
    for sql, description in DEPARTMENT_FEATURES_INDEXES:
        await run_migration(engine, sql, description)

    logger.info("=== DEPARTMENT FEATURES TABLE READY ===")

    # Step 11.1: Enable vacancies feature org-wide by default for all organizations
    logger.info("=== ENABLING VACANCIES FEATURE ===")
    try:
        async with engine.begin() as conn:
            # Get all organization IDs
            orgs_result = await conn.execute(text("SELECT id FROM organizations"))
            org_ids = [row[0] for row in orgs_result.fetchall()]

            for org_id in org_ids:
                # Check if vacancies feature already exists for this org (org-wide setting)
                check_result = await conn.execute(
                    text("""
                        SELECT id FROM department_features
                        WHERE org_id = :org_id
                        AND feature_name = 'vacancies'
                        AND department_id IS NULL
                    """),
                    {"org_id": org_id}
                )
                existing = check_result.fetchone()

                if not existing:
                    # Enable vacancies org-wide
                    await conn.execute(
                        text("""
                            INSERT INTO department_features (org_id, department_id, feature_name, enabled, created_at, updated_at)
                            VALUES (:org_id, NULL, 'vacancies', TRUE, NOW(), NOW())
                        """),
                        {"org_id": org_id}
                    )
                    logger.info(f"Enabled vacancies feature for org_id={org_id}")

        logger.info("=== VACANCIES FEATURE ENABLED ===")
    except Exception as e:
        logger.warning(f"Enable vacancies feature: {e}")

    # Step 12: Create superadmin and default organization
    try:
        async with AsyncSessionLocal() as db:
            await create_superadmin_if_not_exists(db)
    except Exception as e:
        logger.warning(f"Superadmin creation: {e}")

    # Step 12: Fix chats with NULL org_id - assign them to the default organization
    logger.info("=== FIXING CHATS WITH NULL ORG_ID ===")
    try:
        async with engine.begin() as conn:
            # Get the first organization (default org)
            result = await conn.execute(text("SELECT id FROM organizations ORDER BY id LIMIT 1"))
            org_row = result.fetchone()
            if org_row:
                default_org_id = org_row[0]
                # Update all chats with NULL org_id
                update_result = await conn.execute(
                    text("UPDATE chats SET org_id = :org_id WHERE org_id IS NULL"),
                    {"org_id": default_org_id}
                )
                logger.info(f"Updated {update_result.rowcount} chats with NULL org_id to org_id={default_org_id}")

                # Also update entities and call_recordings with NULL org_id
                await conn.execute(
                    text("UPDATE entities SET org_id = :org_id WHERE org_id IS NULL"),
                    {"org_id": default_org_id}
                )
                await conn.execute(
                    text("UPDATE call_recordings SET org_id = :org_id WHERE org_id IS NULL"),
                    {"org_id": default_org_id}
                )
    except Exception as e:
        logger.warning(f"Fix NULL org_id: {e}")

    logger.info("=== DATABASE INITIALIZATION COMPLETE ===")


def run_alembic_migrations_sync():
    """Run Alembic migrations synchronously on startup."""
    import subprocess

    backend_dir = Path(__file__).parent.parent.parent

    try:
        # First try 'head' (single head expected)
        result = subprocess.run(
            ["alembic", "upgrade", "head"],
            cwd=backend_dir,
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode == 0:
            logger.info("Alembic migrations applied successfully")
            if result.stdout:
                for line in result.stdout.strip().split('\n'):
                    if line:
                        logger.info(f"  {line}")
        elif "Multiple head" in result.stderr:
            # Fallback: if multiple heads, try 'heads' to apply all
            logger.warning("Multiple Alembic heads detected, trying 'heads'...")
            result = subprocess.run(
                ["alembic", "upgrade", "heads"],
                cwd=backend_dir,
                capture_output=True,
                text=True,
                timeout=60
            )
            if result.returncode == 0:
                logger.info("Alembic migrations applied (multiple heads)")
            else:
                logger.error(f"Alembic: {result.stderr or 'unknown error'}")
        else:
            logger.warning(f"Alembic: {result.stderr or 'unknown error'}")
    except FileNotFoundError:
        logger.warning("Alembic not found in PATH, skipping migrations")
    except subprocess.TimeoutExpired:
        logger.error("Alembic migration timed out")
    except Exception as e:
        logger.warning(f"Alembic migration skipped: {e}")
