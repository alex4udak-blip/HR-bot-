"""Add impersonation logs table

Revision ID: add_impersonation_logs
Revises: add_entity_transfer_tracking
Create Date: 2024-12-24

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_impersonation_logs'
down_revision = 'add_entity_transfer_tracking'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'impersonation_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('superadmin_id', sa.Integer(), nullable=False),
        sa.Column('impersonated_user_id', sa.Integer(), nullable=False),
        sa.Column('started_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('ended_at', sa.DateTime(), nullable=True),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.Column('user_agent', sa.String(512), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['superadmin_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['impersonated_user_id'], ['users.id'], ondelete='CASCADE')
    )
    op.create_index('ix_impersonation_logs_superadmin_id', 'impersonation_logs', ['superadmin_id'])
    op.create_index('ix_impersonation_logs_impersonated_user_id', 'impersonation_logs', ['impersonated_user_id'])


def downgrade():
    op.drop_index('ix_impersonation_logs_impersonated_user_id', 'impersonation_logs')
    op.drop_index('ix_impersonation_logs_superadmin_id', 'impersonation_logs')
    op.drop_table('impersonation_logs')
