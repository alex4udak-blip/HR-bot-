"""add is_template to form_templates

Revision ID: add_form_template_is_template
Revises: add_custom_roles
Create Date: 2026-06-25
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_form_template_is_template'
down_revision = 'add_custom_roles'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'form_templates',
        sa.Column('is_template', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column('form_templates', 'is_template')
