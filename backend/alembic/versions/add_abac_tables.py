"""Add ABAC tables for policy-based access control

Revision ID: add_abac_tables
Revises: add_entity_criteria
Create Date: 2024-01-15 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_abac_tables'
down_revision = 'add_entity_criteria'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create ENUM types
    policy_effect = postgresql.ENUM('allow', 'deny', name='policy_effect', create_type=False)
    policy_effect.create(op.get_bind(), checkfirst=True)

    attribute_type = postgresql.ENUM('subject', 'resource', 'action', 'environment', name='attribute_type', create_type=False)
    attribute_type.create(op.get_bind(), checkfirst=True)

    condition_operator = postgresql.ENUM(
        'eq', 'neq', 'in', 'not_in', 'gt', 'lt', 'gte', 'lte',
        'contains', 'not_contains', 'is_null', 'is_not_null',
        name='condition_operator', create_type=False
    )
    condition_operator.create(op.get_bind(), checkfirst=True)

    access_decision = postgresql.ENUM('allow', 'deny', name='access_decision', create_type=False)
    access_decision.create(op.get_bind(), checkfirst=True)

    abac_resource_type = postgresql.ENUM(
        'entity', 'chat', 'call', 'department', 'organization', 'user',
        name='abac_resource_type', create_type=False
    )
    abac_resource_type.create(op.get_bind(), checkfirst=True)

    # Create policies table
    op.create_table(
        'abac_policies',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('effect', policy_effect, nullable=False, server_default='allow'),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('resource_type', abac_resource_type, nullable=True),
        sa.Column('org_id', sa.Integer(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name', name='uq_abac_policy_name')
    )
    op.create_index('ix_abac_policies_resource_type', 'abac_policies', ['resource_type'])
    op.create_index('ix_abac_policies_org_id', 'abac_policies', ['org_id'])
    op.create_index('ix_abac_policies_priority', 'abac_policies', ['priority', 'id'])

    # Create policy_conditions table
    op.create_table(
        'abac_policy_conditions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('policy_id', sa.Integer(), nullable=False),
        sa.Column('attribute_type', attribute_type, nullable=False),
        sa.Column('attribute_name', sa.String(255), nullable=False),
        sa.Column('operator', condition_operator, nullable=False),
        sa.Column('value', postgresql.JSONB(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['policy_id'], ['abac_policies.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_abac_policy_conditions_policy_id', 'abac_policy_conditions', ['policy_id'])

    # Create resource_attributes table for custom attributes
    op.create_table(
        'abac_resource_attributes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('resource_type', abac_resource_type, nullable=False),
        sa.Column('resource_id', sa.Integer(), nullable=False),
        sa.Column('attribute_name', sa.String(255), nullable=False),
        sa.Column('attribute_value', postgresql.JSONB(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('resource_type', 'resource_id', 'attribute_name', name='uq_resource_attribute')
    )
    op.create_index('ix_abac_resource_attrs_lookup', 'abac_resource_attributes', ['resource_type', 'resource_id'])

    # Create audit_log table
    op.create_table(
        'abac_audit_log',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('action', sa.String(50), nullable=False),
        sa.Column('resource_type', abac_resource_type, nullable=False),
        sa.Column('resource_id', sa.Integer(), nullable=False),
        sa.Column('decision', access_decision, nullable=False),
        sa.Column('policy_id', sa.Integer(), nullable=True),
        sa.Column('context', postgresql.JSONB(), nullable=True),
        sa.Column('processing_time_ms', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['policy_id'], ['abac_policies.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_abac_audit_log_user', 'abac_audit_log', ['user_id', 'created_at'])
    op.create_index('ix_abac_audit_log_resource', 'abac_audit_log', ['resource_type', 'resource_id'])
    op.create_index('ix_abac_audit_log_created', 'abac_audit_log', ['created_at'])

    # Insert default policies
    op.execute("""
        INSERT INTO abac_policies (name, description, effect, priority, resource_type, is_active) VALUES
        -- Superadmin has full access to everything
        ('superadmin_full_access', 'Superadmin has unrestricted access to all resources', 'allow', 1000, NULL, true),

        -- Org owner has full access within org
        ('org_owner_full_access', 'Organization owner has full access to all org resources', 'allow', 900, NULL, true),

        -- Deny access to private superadmin content
        ('deny_superadmin_private', 'Non-superadmins cannot access private superadmin content', 'deny', 950, NULL, true),

        -- Resource owner has full access
        ('resource_owner_access', 'Resource creator has full access to their resource', 'allow', 800, NULL, true),

        -- Department admins can see department resources
        ('dept_admin_read_dept', 'Department leads/sub_admins can read all department resources', 'allow', 700, NULL, true),

        -- Department admins can see resources created by members
        ('dept_admin_member_resources', 'Department leads/sub_admins can see resources created by dept members', 'allow', 700, NULL, true),

        -- Shared access
        ('shared_access_view', 'Users with shared access can view resources', 'allow', 600, NULL, true),
        ('shared_access_edit', 'Users with edit shared access can modify resources', 'allow', 600, NULL, true),
        ('shared_access_full', 'Users with full shared access have complete control', 'allow', 600, NULL, true),

        -- Default deny
        ('default_deny', 'Default policy - deny all unmatched requests', 'deny', 0, NULL, true);
    """)

    # Insert conditions for each policy
    op.execute("""
        -- Superadmin full access: subject.role = 'superadmin'
        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'subject', 'role', 'eq', '"superadmin"'::jsonb
        FROM abac_policies WHERE name = 'superadmin_full_access';

        -- Org owner: subject.org_role = 'owner' AND subject.org_id = resource.org_id
        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'subject', 'org_role', 'eq', '"owner"'::jsonb
        FROM abac_policies WHERE name = 'org_owner_full_access';

        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'subject', 'org_id_matches_resource', 'eq', 'true'::jsonb
        FROM abac_policies WHERE name = 'org_owner_full_access';

        -- Deny superadmin private: resource.created_by_role = 'superadmin' AND resource.is_private = true
        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'resource', 'created_by_role', 'eq', '"superadmin"'::jsonb
        FROM abac_policies WHERE name = 'deny_superadmin_private';

        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'resource', 'is_private', 'eq', 'true'::jsonb
        FROM abac_policies WHERE name = 'deny_superadmin_private';

        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'subject', 'role', 'neq', '"superadmin"'::jsonb
        FROM abac_policies WHERE name = 'deny_superadmin_private';

        -- Resource owner: subject.id = resource.created_by
        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'subject', 'is_resource_owner', 'eq', 'true'::jsonb
        FROM abac_policies WHERE name = 'resource_owner_access';

        -- Dept admin read: subject.dept_role IN ['lead', 'sub_admin'] AND resource.department_id IN subject.departments
        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'subject', 'dept_role', 'in', '["lead", "sub_admin"]'::jsonb
        FROM abac_policies WHERE name = 'dept_admin_read_dept';

        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'subject', 'resource_in_admin_dept', 'eq', 'true'::jsonb
        FROM abac_policies WHERE name = 'dept_admin_read_dept';

        -- Dept admin member resources: dept_role IN ['lead', 'sub_admin'] AND resource.created_by IN dept_member_ids
        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'subject', 'dept_role', 'in', '["lead", "sub_admin"]'::jsonb
        FROM abac_policies WHERE name = 'dept_admin_member_resources';

        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'subject', 'resource_created_by_dept_member', 'eq', 'true'::jsonb
        FROM abac_policies WHERE name = 'dept_admin_member_resources';

        -- Shared access view: resource.id IN subject.shared_resource_ids AND action = 'read'
        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'subject', 'has_shared_access', 'eq', 'true'::jsonb
        FROM abac_policies WHERE name = 'shared_access_view';

        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'action', 'type', 'eq', '"read"'::jsonb
        FROM abac_policies WHERE name = 'shared_access_view';

        -- Shared access edit
        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'subject', 'shared_access_level', 'in', '["edit", "full"]'::jsonb
        FROM abac_policies WHERE name = 'shared_access_edit';

        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'action', 'type', 'eq', '"write"'::jsonb
        FROM abac_policies WHERE name = 'shared_access_edit';

        -- Shared access full
        INSERT INTO abac_policy_conditions (policy_id, attribute_type, attribute_name, operator, value)
        SELECT id, 'subject', 'shared_access_level', 'eq', '"full"'::jsonb
        FROM abac_policies WHERE name = 'shared_access_full';

        -- Default deny has no conditions (always matches as fallback)
    """)


def downgrade() -> None:
    op.drop_table('abac_audit_log')
    op.drop_table('abac_resource_attributes')
    op.drop_table('abac_policy_conditions')
    op.drop_table('abac_policies')

    # Drop ENUM types
    op.execute("DROP TYPE IF EXISTS access_decision")
    op.execute("DROP TYPE IF EXISTS condition_operator")
    op.execute("DROP TYPE IF EXISTS attribute_type")
    op.execute("DROP TYPE IF EXISTS policy_effect")
    op.execute("DROP TYPE IF EXISTS abac_resource_type")
