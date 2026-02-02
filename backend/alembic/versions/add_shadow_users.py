"""Add shadow users system

Adds support for hidden superadmin accounts (shadow users) with content isolation.

Creates:
- users.is_shadow (Boolean) - marks hidden superadmin accounts
- users.shadow_owner_id (FK to users.id) - who created this shadow user
- Index on is_shadow for fast filtering

Shadow users:
- Have full superadmin access to all org data
- Are completely hidden from user listings
- Have content isolation (main superadmin and shadow users don't see each other's content)

Revision ID: add_shadow_users
Revises: add_embeddings
Create Date: 2026-02-02
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_shadow_users'
down_revision = 'add_embeddings'
branch_labels = None
depends_on = None


def upgrade():
    # Add is_shadow column
    op.add_column('users', sa.Column('is_shadow', sa.Boolean(), nullable=False, server_default='false'))

    # Add shadow_owner_id column (who created this shadow user)
    op.add_column('users', sa.Column('shadow_owner_id', sa.Integer(), nullable=True))

    # Add foreign key constraint
    op.create_foreign_key(
        'fk_users_shadow_owner_id',
        'users', 'users',
        ['shadow_owner_id'], ['id'],
        ondelete='SET NULL'
    )

    # Add index for fast filtering of shadow users
    op.create_index('ix_users_is_shadow', 'users', ['is_shadow'])

    # Remove server default after migration (keep column default in model)
    op.alter_column('users', 'is_shadow', server_default=None)


def downgrade():
    # Drop index
    op.drop_index('ix_users_is_shadow', table_name='users')

    # Drop foreign key
    op.drop_constraint('fk_users_shadow_owner_id', 'users', type_='foreignkey')

    # Drop columns
    op.drop_column('users', 'shadow_owner_id')
    op.drop_column('users', 'is_shadow')
