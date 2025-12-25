"""Add UNIQUE constraints, indexes, and cascade deletes

Revision ID: add_constraints_and_indexes
Revises: add_entity_ai_memory
Create Date: 2025-12-25

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_constraints_and_indexes'
down_revision = 'add_entity_ai_memory'
branch_labels = None
depends_on = None


def upgrade():
    """
    Add database constraints and indexes for data integrity and performance.

    Changes:
    1. Update SharedAccess unique constraint to include shared_by_id
       (allows same resource to be shared with same person by different sharers)

    Note: All other required constraints, indexes, and cascade behaviors are already
    present in the models from previous migrations:
    - OrgMember has unique constraint on (user_id, org_id)
    - DepartmentMember has unique constraint on (user_id, department_id)
    - All search columns already have indexes (Organization.name, Department.name,
      Entity.name, Entity.email, User.name, Message.content_type)
    - Cascade deletes are handled by ForeignKey ondelete='CASCADE' at database level
      and cascade='all, delete-orphan' at ORM level (now added to Organization.chats
      and Organization.calls in the models)
    """
    # Drop old unique constraint on shared_access
    op.drop_constraint('uq_shared_access_resource_user', 'shared_access', type_='unique')

    # Create new unique constraint including shared_by_id
    # This ensures the same resource can be shared with the same person by different users
    op.create_unique_constraint(
        'uq_shared_access_resource_user',
        'shared_access',
        ['resource_type', 'resource_id', 'shared_with_id', 'shared_by_id']
    )


def downgrade():
    """
    Revert the unique constraint change.
    """
    # Drop new unique constraint
    op.drop_constraint('uq_shared_access_resource_user', 'shared_access', type_='unique')

    # Restore old unique constraint (without shared_by_id)
    op.create_unique_constraint(
        'uq_shared_access_resource_user',
        'shared_access',
        ['resource_type', 'resource_id', 'shared_with_id']
    )
