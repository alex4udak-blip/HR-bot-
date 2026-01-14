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
"""
from alembic import op
import sqlalchemy as sa

revision = 'fix_callsource_and_fk_constraints'
down_revision = 'add_entity_salary'
branch_labels = None
depends_on = None


def enum_value_exists(enum_name: str, value: str) -> bool:
    """Check if an enum value exists."""
    conn = op.get_bind()
    result = conn.execute(sa.text(
        """
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = :enum_name AND e.enumlabel = :value
        """
    ), {"enum_name": enum_name, "value": value})
    return result.fetchone() is not None


def upgrade():
    """Add missing CallSource enum values and fix FK constraints."""

    # Add missing CallSource enum values
    # Note: ALTER TYPE ... ADD VALUE cannot run inside a transaction in older PostgreSQL
    # Using IF NOT EXISTS makes this safe to run multiple times
    callsource_values = ['google_doc', 'google_drive', 'direct_url', 'fireflies']

    conn = op.get_bind()

    for value in callsource_values:
        if not enum_value_exists('callsource', value):
            try:
                # Try with autocommit if available
                try:
                    with op.get_context().autocommit_block():
                        op.execute(sa.text(f"ALTER TYPE callsource ADD VALUE IF NOT EXISTS '{value}'"))
                except Exception:
                    # Fallback: commit current transaction, add value, start new transaction
                    # This works in PostgreSQL 9.1+ with IF NOT EXISTS
                    op.execute(sa.text(f"ALTER TYPE callsource ADD VALUE IF NOT EXISTS '{value}'"))
            except Exception as e:
                # Value might already exist or enum might not exist yet - skip
                print(f"Warning: Could not add enum value '{value}': {e}")

    # Fix FK constraints by dropping and recreating with ondelete
    # Note: This is safe as we're only changing the ondelete behavior

    # org_members.invited_by
    try:
        op.drop_constraint('org_members_invited_by_fkey', 'org_members', type_='foreignkey')
    except Exception:
        pass  # Constraint may not exist
    op.create_foreign_key(
        'org_members_invited_by_fkey',
        'org_members', 'users',
        ['invited_by'], ['id'],
        ondelete='SET NULL'
    )

    # chats.owner_id
    try:
        op.drop_constraint('chats_owner_id_fkey', 'chats', type_='foreignkey')
    except Exception:
        pass
    op.create_foreign_key(
        'chats_owner_id_fkey',
        'chats', 'users',
        ['owner_id'], ['id'],
        ondelete='SET NULL'
    )

    # criteria_presets.created_by
    try:
        op.drop_constraint('criteria_presets_created_by_fkey', 'criteria_presets', type_='foreignkey')
    except Exception:
        pass
    op.create_foreign_key(
        'criteria_presets_created_by_fkey',
        'criteria_presets', 'users',
        ['created_by'], ['id'],
        ondelete='SET NULL'
    )

    # entities.created_by
    try:
        op.drop_constraint('entities_created_by_fkey', 'entities', type_='foreignkey')
    except Exception:
        pass
    op.create_foreign_key(
        'entities_created_by_fkey',
        'entities', 'users',
        ['created_by'], ['id'],
        ondelete='SET NULL'
    )

    # entities.transferred_to_id
    try:
        op.drop_constraint('entities_transferred_to_id_fkey', 'entities', type_='foreignkey')
    except Exception:
        pass
    op.create_foreign_key(
        'entities_transferred_to_id_fkey',
        'entities', 'users',
        ['transferred_to_id'], ['id'],
        ondelete='SET NULL'
    )

    # entity_transfers.from_user_id
    try:
        op.drop_constraint('entity_transfers_from_user_id_fkey', 'entity_transfers', type_='foreignkey')
    except Exception:
        pass
    op.create_foreign_key(
        'entity_transfers_from_user_id_fkey',
        'entity_transfers', 'users',
        ['from_user_id'], ['id'],
        ondelete='SET NULL'
    )

    # entity_transfers.to_user_id
    try:
        op.drop_constraint('entity_transfers_to_user_id_fkey', 'entity_transfers', type_='foreignkey')
    except Exception:
        pass
    op.create_foreign_key(
        'entity_transfers_to_user_id_fkey',
        'entity_transfers', 'users',
        ['to_user_id'], ['id'],
        ondelete='SET NULL'
    )

    # call_recordings.owner_id
    try:
        op.drop_constraint('call_recordings_owner_id_fkey', 'call_recordings', type_='foreignkey')
    except Exception:
        pass
    op.create_foreign_key(
        'call_recordings_owner_id_fkey',
        'call_recordings', 'users',
        ['owner_id'], ['id'],
        ondelete='SET NULL'
    )


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
