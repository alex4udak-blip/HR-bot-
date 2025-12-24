"""Add entity transfer tracking fields

Revision ID: add_entity_transfer
Revises: add_sub_admin_role
Create Date: 2025-12-24

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_entity_transfer'
down_revision = 'add_sub_admin_role'
branch_labels = None
depends_on = None


def upgrade():
    # Add is_transferred column
    op.add_column('entities', sa.Column('is_transferred', sa.Boolean(), nullable=True, server_default='false'))
    op.create_index('ix_entities_is_transferred', 'entities', ['is_transferred'])

    # Add transferred_to_id column (FK to users)
    op.add_column('entities', sa.Column('transferred_to_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_entities_transferred_to_id', 'entities', 'users', ['transferred_to_id'], ['id'])

    # Add transferred_at column
    op.add_column('entities', sa.Column('transferred_at', sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column('entities', 'transferred_at')
    op.drop_constraint('fk_entities_transferred_to_id', 'entities', type_='foreignkey')
    op.drop_column('entities', 'transferred_to_id')
    op.drop_index('ix_entities_is_transferred', 'entities')
    op.drop_column('entities', 'is_transferred')
