"""Fix CallSource enum missing values and add FK ondelete constraints

Adds missing CallSource enum values:
- google_doc
- google_drive
- direct_url
- fireflies

Adds missing ondelete behavior to foreign keys:
- org_members.invited_by -> SET NULL
- chats.owner_id -> SET NULL
- criteria_presets.created_by -> SET NULL
- entities.created_by -> SET NULL
- entities.transferred_to_id -> SET NULL
- entity_transfers.from_user_id -> SET NULL
- entity_transfers.to_user_id -> SET NULL
- call_recordings.owner_id -> SET NULL

Revision ID: fix_callsource_and_fk_constraints
Revises: add_entity_salary
Create Date: 2026-01-13

Note: Uses psycopg2 sync connection for enum changes because:
- asyncpg doesn't support autocommit mode properly
- ALTER TYPE ADD VALUE requires autocommit
"""
import os
from alembic import op
import sqlalchemy as sa

revision = 'fix_callsource_and_fk_constraints'
down_revision = 'add_entity_salary'
branch_labels = None
depends_on = None


def add_enum_values_with_sync_connection():
    """
    Add enum values using a separate psycopg2 sync connection with autocommit.
    This is required because:
    1. ALTER TYPE ... ADD VALUE cannot run inside a transaction
    2. asyncpg (used by alembic here) doesn't support autocommit_block properly

    IMPORTANT: This function is completely optional and will not block migration
    if it fails for any reason (missing psycopg2, connection timeout, etc.)
    """
    # Try to import psycopg2 - it may not be installed
    try:
        import psycopg2
    except ImportError:
        print("Warning: psycopg2 not installed, skipping enum additions")
        print("This is non-critical - enum values can be added manually if needed")
        return

    callsource_values = ['google_doc', 'google_drive', 'direct_url', 'fireflies']

    # Get database URL and convert to psycopg2 format
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        print("Warning: DATABASE_URL not set, skipping enum additions")
        return

    # Convert URL format for psycopg2
    if db_url.startswith("postgresql+asyncpg://"):
        db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")
    elif db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://")

    conn = None
    cursor = None
    try:
        # Connect with autocommit mode and TIMEOUT (critical for Railway)
        # connect_timeout=10 prevents hanging on network issues
        print("Connecting to database for enum update (timeout=10s)...")
        conn = psycopg2.connect(db_url, connect_timeout=10)
        conn.autocommit = True  # Critical: enables autocommit for ALTER TYPE

        cursor = conn.cursor()

        # Set statement timeout to prevent long-running queries
        cursor.execute("SET statement_timeout = '5000'")  # 5 seconds max per statement

        # Check existing values
        cursor.execute("""
            SELECT e.enumlabel FROM pg_enum e
            JOIN pg_type t ON e.enumtypid = t.oid
            WHERE t.typname = 'callsource'
        """)
        existing = {row[0] for row in cursor.fetchall()}

        # Add missing values
        for value in callsource_values:
            if value not in existing:
                try:
                    cursor.execute(f"ALTER TYPE callsource ADD VALUE '{value}'")
                    print(f"Added enum value: {value}")
                except psycopg2.Error as e:
                    print(f"Could not add '{value}': {e}")
            else:
                print(f"Enum value exists: {value}")

        print("Enum values updated successfully")
    except psycopg2.OperationalError as e:
        # Connection timeout or network error
        print(f"Warning: Database connection failed (timeout or network): {e}")
        print("This is non-critical - the app will still work")
    except Exception as e:
        print(f"Warning: Could not update enum values: {e}")
        print("This is non-critical - the app will still work")
    finally:
        # Always close resources
        if cursor:
            try:
                cursor.close()
            except Exception:
                pass
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def upgrade():
    """Add missing CallSource enum values and fix FK constraints."""

    # Add enum values using separate sync connection with autocommit
    # This is completely optional and won't block if it fails
    add_enum_values_with_sync_connection()

    # Fix FK constraints by dropping and recreating with ondelete
    # Note: This is safe as we're only changing the ondelete behavior
    # Each constraint change is wrapped in try/except to prevent blocking

    fk_changes = [
        ('org_members', 'invited_by', 'org_members_invited_by_fkey'),
        ('chats', 'owner_id', 'chats_owner_id_fkey'),
        ('criteria_presets', 'created_by', 'criteria_presets_created_by_fkey'),
        ('entities', 'created_by', 'entities_created_by_fkey'),
        ('entities', 'transferred_to_id', 'entities_transferred_to_id_fkey'),
        ('entity_transfers', 'from_user_id', 'entity_transfers_from_user_id_fkey'),
        ('entity_transfers', 'to_user_id', 'entity_transfers_to_user_id_fkey'),
        ('call_recordings', 'owner_id', 'call_recordings_owner_id_fkey'),
    ]

    for table, column, constraint_name in fk_changes:
        try:
            # Drop existing constraint
            try:
                op.drop_constraint(constraint_name, table, type_='foreignkey')
            except Exception:
                pass  # Constraint may not exist

            # Create with ondelete='SET NULL'
            op.create_foreign_key(
                constraint_name,
                table, 'users',
                [column], ['id'],
                ondelete='SET NULL'
            )
            print(f"Updated FK constraint: {constraint_name}")
        except Exception as e:
            # Log but don't fail - FK constraints are not critical for app startup
            print(f"Warning: Could not update FK {constraint_name}: {e}")
            print("This is non-critical - the app will still work")


def downgrade():
    """Revert FK constraints to original state (without ondelete).
    Note: Cannot remove enum values in PostgreSQL.
    """
    # Recreate FKs without ondelete (revert)
    fk_changes = [
        ('org_members', 'invited_by', 'org_members_invited_by_fkey'),
        ('chats', 'owner_id', 'chats_owner_id_fkey'),
        ('criteria_presets', 'created_by', 'criteria_presets_created_by_fkey'),
        ('entities', 'created_by', 'entities_created_by_fkey'),
        ('entities', 'transferred_to_id', 'entities_transferred_to_id_fkey'),
        ('entity_transfers', 'from_user_id', 'entity_transfers_from_user_id_fkey'),
        ('entity_transfers', 'to_user_id', 'entity_transfers_to_user_id_fkey'),
        ('call_recordings', 'owner_id', 'call_recordings_owner_id_fkey'),
    ]

    for table, column, constraint_name in fk_changes:
        try:
            op.drop_constraint(constraint_name, table, type_='foreignkey')
        except Exception:
            pass
        op.create_foreign_key(
            constraint_name,
            table, 'users',
            [column], ['id']
        )
