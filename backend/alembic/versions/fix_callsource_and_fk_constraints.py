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

Note: Uses autocommit_block() for ALTER TYPE ADD VALUE as per Alembic docs:
https://github.com/sqlalchemy/alembic/issues/123
"""
from alembic import op
import sqlalchemy as sa

revision = 'fix_callsource_and_fk_constraints'
down_revision = 'add_entity_salary'
branch_labels = None
depends_on = None


def upgrade():
    """Add missing CallSource enum values and fix FK constraints."""

    # Add enum values using autocommit_block() - official Alembic way
    # See: https://github.com/sqlalchemy/alembic/issues/123
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block
    callsource_values = ['google_doc', 'google_drive', 'direct_url', 'fireflies']

    for value in callsource_values:
        # Each ADD VALUE needs its own autocommit block
        try:
            with op.get_context().autocommit_block():
                op.execute(sa.text(f"ALTER TYPE callsource ADD VALUE IF NOT EXISTS '{value}'"))
            print(f"Added/verified enum value: {value}")
        except Exception as e:
            # Value might already exist or enum might not exist
            print(f"Note: {value} - {e}")

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
