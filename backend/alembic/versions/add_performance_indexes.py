"""Add performance indexes for faster queries

Revision ID: add_performance_indexes
Revises: add_transfer_cancel_fields
Create Date: 2025-12-28

Adds indexes to improve query performance:
- Composite index on shared_access for permission lookups
- Index on entities.transferred_to_id for transfer queries
- Index on messages.file_path for media queries
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'add_performance_indexes'
down_revision = 'add_transfer_cancel_fields'
branch_labels = None
depends_on = None


def upgrade():
    """Add performance indexes."""
    # Composite index for fast permission lookups in SharedAccess
    op.create_index(
        'ix_shared_access_user_resource',
        'shared_access',
        ['shared_with_id', 'resource_type', 'resource_id'],
        unique=False
    )

    # Index for transfer queries
    op.create_index(
        'ix_entities_transferred_to_id',
        'entities',
        ['transferred_to_id'],
        unique=False
    )

    # Index for media queries (finding messages with files)
    op.create_index(
        'ix_messages_file_path',
        'messages',
        ['file_path'],
        unique=False
    )


def downgrade():
    """Remove performance indexes."""
    op.drop_index('ix_messages_file_path', table_name='messages')
    op.drop_index('ix_entities_transferred_to_id', table_name='entities')
    op.drop_index('ix_shared_access_user_resource', table_name='shared_access')
