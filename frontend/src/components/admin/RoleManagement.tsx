import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Shield,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  AlertCircle,
  Users,
  History,
  ChevronDown,
  ChevronRight,
  Save
} from 'lucide-react';
import {
  getCustomRoles,
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  setRolePermission,
  removeRolePermission,
  getUsers,
  assignCustomRole,
  getPermissionAuditLogs,
  type CustomRole
} from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import toast from 'react-hot-toast';
import clsx from 'clsx';

// Available permissions that can be configured
const AVAILABLE_PERMISSIONS = [
  { id: 'can_view_all_users', label: 'View All Users', category: 'Users' },
  { id: 'can_delete_users', label: 'Delete Users', category: 'Users' },
  { id: 'can_change_roles', label: 'Change User Roles', category: 'Users' },
  { id: 'can_invite_users', label: 'Invite Users', category: 'Organization' },
  { id: 'can_manage_org_settings', label: 'Manage Org Settings', category: 'Organization' },
  { id: 'can_create_departments', label: 'Create Departments', category: 'Departments' },
  { id: 'can_manage_dept_members', label: 'Manage Department Members', category: 'Departments' },
  { id: 'can_create_resources', label: 'Create Resources', category: 'Resources' },
  { id: 'can_share_resources', label: 'Share Resources', category: 'Resources' },
  { id: 'can_transfer_resources', label: 'Transfer Resources', category: 'Resources' },
  { id: 'can_delete_resources', label: 'Delete Resources', category: 'Resources' },
  { id: 'can_view_audit_logs', label: 'View Audit Logs', category: 'Admin' },
  { id: 'can_impersonate', label: 'Impersonate Users', category: 'Admin' },
];

const BASE_ROLES = [
  { value: 'owner', label: 'Owner', color: 'text-amber-400' },
  { value: 'admin', label: 'Admin', color: 'text-blue-400' },
  { value: 'sub_admin', label: 'Sub Admin', color: 'text-cyan-400' },
  { value: 'member', label: 'Member', color: 'text-green-400' },
];

interface RoleCardProps {
  role: CustomRole;
  onEdit: (role: CustomRole) => void;
  onDelete: (role: CustomRole) => void;
  onManagePermissions: (role: CustomRole) => void;
  onManageUsers: (role: CustomRole) => void;
}

function RoleCard({ role, onEdit, onDelete, onManagePermissions, onManageUsers }: RoleCardProps) {
  const baseRoleConfig = BASE_ROLES.find(r => r.value === role.base_role);
  const permissionCount = role.permission_overrides?.length || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        'glass rounded-xl p-4 border transition-all',
        role.is_active ? 'border-white/10' : 'border-red-500/30 opacity-60'
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-accent-500/20 rounded-lg">
            <Shield className="w-5 h-5 text-accent-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">{role.name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={clsx('text-xs', baseRoleConfig?.color)}>
                Based on: {baseRoleConfig?.label}
              </span>
              {!role.is_active && (
                <span className="px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">
                  Inactive
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onManageUsers(role)}
            className="p-2 rounded-lg text-dark-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
            title="Manage Users"
          >
            <Users className="w-4 h-4" />
          </button>
          <button
            onClick={() => onEdit(role)}
            className="p-2 rounded-lg text-dark-400 hover:text-accent-400 hover:bg-accent-500/10 transition-colors"
            title="Edit Role"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(role)}
            className="p-2 rounded-lg text-dark-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete Role"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {role.description && (
        <p className="text-sm text-dark-400 mb-3">{role.description}</p>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-dark-500">
          {permissionCount} permission override{permissionCount !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => onManagePermissions(role)}
          className="text-xs text-accent-400 hover:text-accent-300 transition-colors"
        >
          Configure Permissions
        </button>
      </div>
    </motion.div>
  );
}

interface PermissionEditorProps {
  role: CustomRole;
  onClose: () => void;
}

function PermissionEditor({ role, onClose }: PermissionEditorProps) {
  const queryClient = useQueryClient();
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['Users', 'Organization', 'Resources']);

  const permissionMap = new Map(
    role.permission_overrides?.map(p => [p.permission, p.allowed]) || []
  );

  const setPermissionMutation = useMutation({
    mutationFn: ({ permission, allowed }: { permission: string; allowed: boolean }) =>
      setRolePermission(role.id, permission, allowed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      toast.success('Permission updated');
    },
    onError: () => {
      toast.error('Failed to update permission');
    },
  });

  const removePermissionMutation = useMutation({
    mutationFn: (permission: string) => removeRolePermission(role.id, permission),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      toast.success('Permission reset to default');
    },
    onError: () => {
      toast.error('Failed to reset permission');
    },
  });

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const categories = [...new Set(AVAILABLE_PERMISSIONS.map(p => p.category))];

  return (
    <Dialog.Root open onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[85vh] glass rounded-2xl p-6 shadow-xl overflow-hidden flex flex-col z-50">
          <Dialog.Title className="text-xl font-semibold mb-4 flex items-center gap-3">
            <Shield className="w-6 h-6 text-accent-400" />
            Permissions: {role.name}
          </Dialog.Title>

          <div className="flex-1 overflow-y-auto space-y-4">
            {categories.map(category => (
              <div key={category} className="glass-light rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleCategory(category)}
                  className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
                >
                  <span className="font-medium">{category}</span>
                  {expandedCategories.includes(category) ? (
                    <ChevronDown className="w-4 h-4 text-dark-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-dark-400" />
                  )}
                </button>

                <AnimatePresence>
                  {expandedCategories.includes(category) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-white/5"
                    >
                      {AVAILABLE_PERMISSIONS.filter(p => p.category === category).map(perm => {
                        const currentValue = permissionMap.get(perm.id);
                        const hasOverride = currentValue !== undefined;

                        return (
                          <div
                            key={perm.id}
                            className="flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
                          >
                            <div>
                              <span className="text-sm font-medium">{perm.label}</span>
                              {hasOverride && (
                                <span className={clsx(
                                  'ml-2 text-xs px-1.5 py-0.5 rounded',
                                  currentValue ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                                )}>
                                  {currentValue ? 'Allowed' : 'Denied'}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setPermissionMutation.mutate({ permission: perm.id, allowed: true })}
                                className={clsx(
                                  'p-1.5 rounded-lg transition-colors',
                                  currentValue === true
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'text-dark-500 hover:text-green-400 hover:bg-green-500/10'
                                )}
                                title="Allow"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setPermissionMutation.mutate({ permission: perm.id, allowed: false })}
                                className={clsx(
                                  'p-1.5 rounded-lg transition-colors',
                                  currentValue === false
                                    ? 'bg-red-500/20 text-red-400'
                                    : 'text-dark-500 hover:text-red-400 hover:bg-red-500/10'
                                )}
                                title="Deny"
                              >
                                <X className="w-4 h-4" />
                              </button>
                              {hasOverride && (
                                <button
                                  onClick={() => removePermissionMutation.mutate(perm.id)}
                                  className="p-1.5 rounded-lg text-dark-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                                  title="Reset to default"
                                >
                                  <AlertCircle className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-4 mt-4 border-t border-white/5">
            <Dialog.Close asChild>
              <button className="px-4 py-2 rounded-xl glass-light hover:bg-white/10 transition-colors">
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface UserAssignmentDialogProps {
  role: CustomRole;
  onClose: () => void;
}

function UserAssignmentDialog({ role, onClose }: UserAssignmentDialogProps) {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  });

  const assignMutation = useMutation({
    mutationFn: (userId: number) => assignCustomRole(role.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      toast.success('User assigned to role');
      setSelectedUserId(null);
    },
    onError: () => {
      toast.error('Failed to assign user');
    },
  });


  return (
    <Dialog.Root open onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg max-h-[85vh] glass rounded-2xl p-6 shadow-xl overflow-hidden flex flex-col z-50">
          <Dialog.Title className="text-xl font-semibold mb-4 flex items-center gap-3">
            <Users className="w-6 h-6 text-blue-400" />
            Users with role: {role.name}
          </Dialog.Title>

          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Add user */}
            <div className="flex gap-2">
              <select
                value={selectedUserId || ''}
                onChange={(e) => setSelectedUserId(e.target.value ? Number(e.target.value) : null)}
                className="flex-1 glass-light rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-accent-500/50"
              >
                <option value="">Select user to add...</option>
                {users.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.name || user.email}
                  </option>
                ))}
              </select>
              <button
                onClick={() => selectedUserId && assignMutation.mutate(selectedUserId)}
                disabled={!selectedUserId || assignMutation.isPending}
                className="px-4 py-2 rounded-xl bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 transition-colors"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            {/* Current users placeholder - would need to extend API */}
            <div className="glass-light rounded-xl p-4 text-center text-dark-400">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Users with this role will appear here</p>
            </div>
          </div>

          <div className="flex justify-end pt-4 mt-4 border-t border-white/5">
            <Dialog.Close asChild>
              <button className="px-4 py-2 rounded-xl glass-light hover:bg-white/10 transition-colors">
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function RoleManagement() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [permissionRole, setPermissionRole] = useState<CustomRole | null>(null);
  const [userAssignRole, setUserAssignRole] = useState<CustomRole | null>(null);
  const [showAuditLog, setShowAuditLog] = useState(false);

  const [newRole, setNewRole] = useState({
    name: '',
    description: '',
    base_role: 'member',
  });

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['custom-roles'],
    queryFn: getCustomRoles,
  });

  const { data: auditLogs = [] } = useQuery({
    queryKey: ['permission-audit-logs'],
    queryFn: () => getPermissionAuditLogs({ limit: 50 }),
    enabled: showAuditLog,
  });

  const createMutation = useMutation({
    mutationFn: () => createCustomRole(newRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      setIsCreateDialogOpen(false);
      setNewRole({ name: '', description: '', base_role: 'member' });
      toast.success('Role created');
    },
    onError: () => {
      toast.error('Failed to create role');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Parameters<typeof updateCustomRole>[1] }) =>
      updateCustomRole(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      setEditingRole(null);
      toast.success('Role updated');
    },
    onError: () => {
      toast.error('Failed to update role');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCustomRole,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      toast.success('Role deleted');
    },
    onError: () => {
      toast.error('Failed to delete role');
    },
  });

  const handleDelete = (role: CustomRole) => {
    if (confirm(`Delete role "${role.name}"? This action cannot be undone.`)) {
      deleteMutation.mutate(role.id);
    }
  };

  if (user?.role !== 'superadmin') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield className="w-12 h-12 mx-auto text-dark-500 mb-3" />
          <p className="text-dark-400">Superadmin access required</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-accent-400" />
            Custom Roles
          </h2>
          <p className="text-sm text-dark-400 mt-1">
            Create and manage custom roles with fine-grained permissions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAuditLog(!showAuditLog)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-xl transition-colors',
              showAuditLog ? 'bg-accent-500/20 text-accent-400' : 'glass-light hover:bg-white/10'
            )}
          >
            <History className="w-5 h-5" />
            Audit Log
          </button>
          <button
            onClick={() => setIsCreateDialogOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-500 text-white hover:bg-accent-600 transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Role
          </button>
        </div>
      </div>

      {/* Roles Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : roles.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center">
          <Shield className="w-12 h-12 mx-auto text-dark-500 mb-3" />
          <p className="text-dark-400">No custom roles yet</p>
          <p className="text-sm text-dark-500 mt-1">
            Create your first custom role to get started
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map(role => (
            <RoleCard
              key={role.id}
              role={role}
              onEdit={setEditingRole}
              onDelete={handleDelete}
              onManagePermissions={setPermissionRole}
              onManageUsers={setUserAssignRole}
            />
          ))}
        </div>
      )}

      {/* Audit Log Panel */}
      <AnimatePresence>
        {showAuditLog && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="glass rounded-xl overflow-hidden"
          >
            <div className="p-4 border-b border-white/5">
              <h3 className="font-semibold flex items-center gap-2">
                <History className="w-5 h-5 text-amber-400" />
                Permission Audit Log
              </h3>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {auditLogs.length === 0 ? (
                <p className="p-4 text-center text-dark-500">No audit logs yet</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {auditLogs.map(log => (
                    <div key={log.id} className="p-3 hover:bg-white/5">
                      <div className="flex items-center justify-between text-sm">
                        <span className={clsx(
                          'px-2 py-0.5 rounded text-xs',
                          log.action === 'create' && 'bg-green-500/20 text-green-400',
                          log.action === 'update' && 'bg-blue-500/20 text-blue-400',
                          log.action === 'delete' && 'bg-red-500/20 text-red-400'
                        )}>
                          {log.action}
                        </span>
                        <span className="text-dark-500 text-xs">
                          {new Date(log.created_at).toLocaleString()}
                        </span>
                      </div>
                      {log.permission && (
                        <p className="text-sm text-dark-400 mt-1">
                          Permission: {log.permission}
                          {log.old_value !== null && log.new_value !== null && (
                            <span className="ml-2">
                              {log.old_value ? 'allowed' : 'denied'} &rarr; {log.new_value ? 'allowed' : 'denied'}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Role Dialog */}
      <Dialog.Root open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md glass rounded-2xl p-6 shadow-xl z-50">
            <Dialog.Title className="text-xl font-semibold mb-4">
              Create Custom Role
            </Dialog.Title>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate();
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm text-dark-400 mb-1">Name</label>
                <input
                  type="text"
                  value={newRole.name}
                  onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                  required
                  placeholder="e.g., Content Manager"
                  className="w-full glass-light rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                />
              </div>
              <div>
                <label htmlFor="base-role-select" className="block text-sm text-dark-400 mb-1">Base Role</label>
                <select
                  id="base-role-select"
                  value={newRole.base_role}
                  onChange={(e) => setNewRole({ ...newRole, base_role: e.target.value })}
                  className="w-full glass-light rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                >
                  {BASE_ROLES.map(role => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-dark-500 mt-1">
                  Inherits default permissions from this role
                </p>
              </div>
              <div>
                <label className="block text-sm text-dark-400 mb-1">Description</label>
                <textarea
                  value={newRole.description}
                  onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                  rows={2}
                  placeholder="Optional description..."
                  className="w-full glass-light rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-accent-500/50 resize-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="flex-1 py-2.5 rounded-xl glass-light hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={createMutation.isPending || !newRole.name.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Edit Role Dialog */}
      {editingRole && (
        <Dialog.Root open onOpenChange={() => setEditingRole(null)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
            <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md glass rounded-2xl p-6 shadow-xl z-50">
              <Dialog.Title className="text-xl font-semibold mb-4">
                Edit Role: {editingRole.name}
              </Dialog.Title>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.target as HTMLFormElement;
                  const formData = new FormData(form);
                  updateMutation.mutate({
                    id: editingRole.id,
                    updates: {
                      name: formData.get('name') as string,
                      description: formData.get('description') as string,
                      is_active: formData.get('is_active') === 'on',
                    },
                  });
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm text-dark-400 mb-1">Name</label>
                  <input
                    type="text"
                    name="name"
                    defaultValue={editingRole.name}
                    required
                    className="w-full glass-light rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm text-dark-400 mb-1">Description</label>
                  <textarea
                    name="description"
                    defaultValue={editingRole.description}
                    rows={2}
                    className="w-full glass-light rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-accent-500/50 resize-none"
                  />
                </div>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    name="is_active"
                    defaultChecked={editingRole.is_active}
                    className="w-5 h-5 rounded accent-accent-500"
                  />
                  <span>Active</span>
                </label>
                <div className="flex gap-3 pt-2">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="flex-1 py-2.5 rounded-xl glass-light hover:bg-white/10 transition-colors"
                    >
                      Cancel
                    </button>
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={updateMutation.isPending}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    {updateMutation.isPending ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {/* Permission Editor Dialog */}
      {permissionRole && (
        <PermissionEditor role={permissionRole} onClose={() => setPermissionRole(null)} />
      )}

      {/* User Assignment Dialog */}
      {userAssignRole && (
        <UserAssignmentDialog role={userAssignRole} onClose={() => setUserAssignRole(null)} />
      )}
    </div>
  );
}
