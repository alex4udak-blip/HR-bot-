import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Users,
  Plus,
  Trash2,
  Shield,
  User as UserIcon,
  X,
  Crown,
  Building2,
  Eye,
  EyeOff,
  Loader2,
  Link as LinkIcon,
  Copy,
  Check,
  Clock,
  Send
} from 'lucide-react';
import { getUsers, createUser, deleteUser, getOrgMembers, inviteMember, removeMember, updateMemberRole, getCurrentOrganization, getMyOrgRole, getDepartments, createInvitation, getInvitations, revokeInvitation, type Department, type DeptRole, type Invitation } from '@/services/api';
import type { OrgMember, OrgRole, Organization } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const ORG_ROLE_CONFIG: Record<OrgRole, { label: string; icon: typeof Crown; color: string; description: string }> = {
  owner: { label: 'Владелец', icon: Crown, color: 'text-yellow-400 bg-yellow-500/20', description: 'Полный доступ, управление организацией' },
  admin: { label: 'Администратор', icon: Shield, color: 'text-cyan-400 bg-cyan-500/20', description: 'Управление пользователями, доступ к данным' },
  member: { label: 'Участник', icon: UserIcon, color: 'text-white/60 bg-white/10', description: 'Доступ к своим данным и расшаренному' },
};

export default function UsersPage() {
  const { user: currentUser } = useAuthStore();
  const isSuperadmin = currentUser?.role === 'superadmin';
  const [activeTab, setActiveTab] = useState<'org' | 'system'>(isSuperadmin ? 'system' : 'org');

  return (
    <div className="h-full overflow-y-auto p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl mx-auto space-y-6"
      >
        {/* Header with tabs */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold mb-2 flex items-center gap-3">
              <Users className="text-cyan-400" />
              Управление пользователями
            </h1>
            {isSuperadmin && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setActiveTab('org')}
                  className={clsx(
                    'px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2',
                    activeTab === 'org'
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : 'bg-white/5 text-white/60 hover:bg-white/10'
                  )}
                >
                  <Building2 size={16} />
                  Организация
                </button>
                <button
                  onClick={() => setActiveTab('system')}
                  className={clsx(
                    'px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2',
                    activeTab === 'system'
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : 'bg-white/5 text-white/60 hover:bg-white/10'
                  )}
                >
                  <Shield size={16} />
                  Система
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          {activeTab === 'org' ? (
            <OrganizationMembers key="org" currentUser={currentUser} />
          ) : (
            <SystemUsers key="system" currentUser={currentUser} />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// Organization Members Component
function OrganizationMembers({ currentUser }: { currentUser: any }) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [myRole, setMyRole] = useState<OrgRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showInvitationsTab, setShowInvitationsTab] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [orgData, membersData, roleData, invitationsData] = await Promise.all([
        getCurrentOrganization(),
        getOrgMembers(),
        getMyOrgRole(),
        getInvitations()
      ]);
      setOrganization(orgData);
      setMembers(membersData);
      setMyRole(roleData.role);
      setInvitations(invitationsData);
    } catch (e) {
      console.error('Failed to load organization data:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeRole = async (userId: number, newRole: OrgRole) => {
    try {
      await updateMemberRole(userId, newRole);
      toast.success('Роль изменена');
      loadData();
    } catch (e) {
      toast.error('Не удалось изменить роль');
    }
  };

  const handleRemoveMember = async (member: OrgMember) => {
    if (!confirm(`Удалить ${member.user_name} из организации?`)) return;

    try {
      await removeMember(member.user_id);
      toast.success('Пользователь удалён');
      loadData();
    } catch (e) {
      toast.error('Не удалось удалить пользователя');
    }
  };

  const handleRevokeInvitation = async (invitation: Invitation) => {
    if (!confirm('Отменить приглашение?')) return;

    try {
      await revokeInvitation(invitation.id);
      toast.success('Приглашение отменено');
      loadData();
    } catch (e) {
      toast.error('Не удалось отменить приглашение');
    }
  };

  const canManageUsers = myRole === 'owner' || myRole === 'admin' || currentUser?.role === 'superadmin';
  const canChangeRoles = myRole === 'owner' || currentUser?.role === 'superadmin';

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="flex items-center justify-center py-12"
      >
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      {/* Organization Info */}
      {organization && (
        <div className="bg-white/5 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Building2 className="text-cyan-400" size={20} />
                {organization.name}
              </h3>
              <p className="text-sm text-white/40">{members.length} участников</p>
            </div>
            {canManageUsers && (
              <button
                onClick={() => setShowInviteModal(true)}
                className="px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 flex items-center gap-2"
              >
                <LinkIcon size={18} />
                Пригласить
              </button>
            )}
          </div>
          {/* Tabs */}
          <div className="flex gap-2 border-t border-white/5 pt-3">
            <button
              onClick={() => setShowInvitationsTab(false)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2',
                !showInvitationsTab
                  ? 'bg-cyan-500/20 text-cyan-400'
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              )}
            >
              <Users size={14} />
              Участники ({members.length})
            </button>
            {canManageUsers && (
              <button
                onClick={() => setShowInvitationsTab(true)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2',
                  showInvitationsTab
                    ? 'bg-cyan-500/20 text-cyan-400'
                    : 'bg-white/5 text-white/60 hover:bg-white/10'
                )}
              >
                <Send size={14} />
                Приглашения ({invitations.length})
              </button>
            )}
          </div>
        </div>
      )}

      {/* My Role */}
      {myRole && (
        <div className="bg-white/5 rounded-xl p-4">
          <p className="text-sm text-white/40 mb-1">Ваша роль в организации</p>
          <div className="flex items-center gap-2">
            {(() => {
              const config = ORG_ROLE_CONFIG[myRole];
              const Icon = config.icon;
              return (
                <>
                  <span className={clsx('p-1.5 rounded-lg', config.color)}>
                    <Icon size={16} />
                  </span>
                  <span className="text-white font-medium">{config.label}</span>
                  <span className="text-white/40 text-sm">— {config.description}</span>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Members List */}
      {!showInvitationsTab && (
        <div className="space-y-3">
          {members.map((member) => {
            const roleConfig = ORG_ROLE_CONFIG[member.role];
            const RoleIcon = roleConfig.icon;
            const isMe = member.user_id === currentUser?.id;

            return (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={clsx(
                  'p-4 rounded-xl border transition-colors',
                  isMe ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-white/5 border-white/5'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={clsx('p-2 rounded-lg', roleConfig.color)}>
                      <RoleIcon size={20} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-white font-medium">{member.user_name}</h3>
                        {isMe && (
                          <span className="text-xs px-2 py-0.5 bg-cyan-500/20 text-cyan-400 rounded-full">
                            Это вы
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-white/40">{member.user_email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {canChangeRoles && !isMe && member.role !== 'owner' && (
                      <select
                        value={member.role}
                        onChange={(e) => handleChangeRole(member.user_id, e.target.value as OrgRole)}
                        className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm"
                      >
                        <option value="admin">Администратор</option>
                        <option value="member">Участник</option>
                      </select>
                    )}

                    {!canChangeRoles && (
                      <span className={clsx('text-sm px-2 py-1 rounded-lg', roleConfig.color)}>
                        {roleConfig.label}
                      </span>
                    )}

                    {canManageUsers && !isMe && (
                      // Owner can delete admins/members, admin can only delete members
                      // Superadmin can delete anyone
                      (currentUser?.role === 'superadmin' ||
                       (myRole === 'owner' && member.role !== 'owner') ||
                       (myRole === 'admin' && member.role === 'member')
                      ) && (
                        <button
                          onClick={() => handleRemoveMember(member)}
                          className="p-2 rounded-lg hover:bg-red-500/20 text-red-400 transition-colors"
                          title={`Удалить ${member.user_name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      )
                    )}
                  </div>
                </div>

                {member.invited_by_name && (
                  <p className="text-xs text-white/30 mt-2">
                    Приглашён: {member.invited_by_name} • {new Date(member.created_at).toLocaleDateString('ru-RU')}
                  </p>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Invitations List */}
      {showInvitationsTab && (
        <div className="space-y-3">
          {invitations.length === 0 ? (
            <div className="text-center py-8">
              <Send className="w-12 h-12 mx-auto text-white/20 mb-3" />
              <p className="text-white/40">Нет активных приглашений</p>
              <p className="text-sm text-white/30 mt-1">Создайте приглашение для добавления нового участника</p>
            </div>
          ) : (
            invitations.map((invitation) => (
              <InvitationCard
                key={invitation.id}
                invitation={invitation}
                onRevoke={() => handleRevokeInvitation(invitation)}
              />
            ))
          )}
        </div>
      )}

      {/* Invite Modal */}
      <AnimatePresence>
        {showInviteModal && (
          <InviteMemberModal
            onClose={() => setShowInviteModal(false)}
            onSuccess={() => {
              setShowInviteModal(false);
              loadData();
            }}
            canSetRole={canChangeRoles}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Invitation Card Component
function InvitationCard({ invitation, onRevoke }: { invitation: Invitation; onRevoke: () => void }) {
  const [copied, setCopied] = useState(false);

  const inviteUrl = `${window.location.origin}${invitation.invitation_url}`;
  const isExpired = invitation.expires_at && new Date(invitation.expires_at) < new Date();

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast.success('Ссылка скопирована');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const roleConfig = ORG_ROLE_CONFIG[invitation.org_role];
  const RoleIcon = roleConfig.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        'p-4 rounded-xl border',
        isExpired ? 'bg-red-500/5 border-red-500/20' : 'bg-white/5 border-white/5'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <div className={clsx('p-1.5 rounded-lg', roleConfig.color)}>
              <RoleIcon size={16} />
            </div>
            <span className="text-white font-medium">
              {invitation.name || invitation.email || 'Новый участник'}
            </span>
            {isExpired && (
              <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded-full">
                Истекло
              </span>
            )}
          </div>

          {invitation.email && (
            <p className="text-sm text-white/40 mb-2">{invitation.email}</p>
          )}

          {/* Invite Link */}
          <div className="flex items-center gap-2 p-2 bg-white/5 rounded-lg">
            <input
              type="text"
              value={inviteUrl}
              readOnly
              className="flex-1 bg-transparent text-white/60 text-xs truncate border-none outline-none"
            />
            <button
              onClick={copyLink}
              className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-cyan-400 transition-colors"
              title="Копировать ссылку"
            >
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
            </button>
          </div>

          <div className="flex items-center gap-4 mt-2 text-xs text-white/30">
            {invitation.invited_by_name && (
              <span>От: {invitation.invited_by_name}</span>
            )}
            {invitation.expires_at && (
              <span className="flex items-center gap-1">
                <Clock size={12} />
                До: {new Date(invitation.expires_at).toLocaleDateString('ru-RU')}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={onRevoke}
          className="p-2 rounded-lg hover:bg-red-500/20 text-red-400 transition-colors"
          title="Отменить приглашение"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </motion.div>
  );
}

// Invite Member Modal - Creates invitation link
function InviteMemberModal({
  onClose,
  onSuccess,
  canSetRole
}: {
  onClose: () => void;
  onSuccess: () => void;
  canSetRole: boolean;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [createdInvitation, setCreatedInvitation] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<{ id: number; role: DeptRole }[]>([]);

  // Load departments on mount
  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const depts = await getDepartments(-1); // Get all departments
        setDepartments(depts);
      } catch (e) {
        console.error('Failed to load departments:', e);
      }
    };
    loadDepartments();
  }, []);

  const toggleDepartment = (deptId: number) => {
    setSelectedDepartments(prev => {
      const exists = prev.find(d => d.id === deptId);
      if (exists) {
        return prev.filter(d => d.id !== deptId);
      }
      return [...prev, { id: deptId, role: 'member' as DeptRole }];
    });
  };

  const setDepartmentRole = (deptId: number, newRole: DeptRole) => {
    setSelectedDepartments(prev =>
      prev.map(d => d.id === deptId ? { ...d, role: newRole } : d)
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    try {
      const invitation = await createInvitation({
        email: email || undefined,
        name: name || undefined,
        org_role: role,
        department_ids: selectedDepartments.length > 0 ? selectedDepartments : undefined,
        expires_in_days: expiresInDays
      });
      setCreatedInvitation(invitation);
      toast.success('Приглашение создано!');
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Ошибка создания приглашения');
    } finally {
      setLoading(false);
    }
  };

  const inviteUrl = createdInvitation ? `${window.location.origin}${createdInvitation.invitation_url}` : '';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast.success('Ссылка скопирована');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  // If invitation created, show success screen with link
  if (createdInvitation) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="w-8 h-8 text-green-400" />
            </div>
            <h3 className="text-lg font-semibold text-white">Приглашение создано!</h3>
            <p className="text-sm text-white/60 mt-1">Отправьте ссылку новому участнику</p>
          </div>

          {/* Invite Link */}
          <div className="mb-6">
            <label className="block text-sm text-white/60 mb-2">Ссылка для приглашения</label>
            <div className="flex items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10">
              <input
                type="text"
                value={inviteUrl}
                readOnly
                className="flex-1 bg-transparent text-white text-sm truncate border-none outline-none"
              />
              <button
                onClick={copyLink}
                className="p-2 rounded-lg hover:bg-white/10 text-cyan-400 transition-colors flex items-center gap-2"
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
                <span className="text-sm">{copied ? 'Скопировано' : 'Копировать'}</span>
              </button>
            </div>
          </div>

          {createdInvitation.expires_at && (
            <p className="text-xs text-white/40 text-center mb-4 flex items-center justify-center gap-1">
              <Clock size={12} />
              Действует до: {new Date(createdInvitation.expires_at).toLocaleDateString('ru-RU')}
            </p>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => {
                setCreatedInvitation(null);
                setName('');
                setEmail('');
                setSelectedDepartments([]);
              }}
              className="flex-1 py-2.5 bg-white/5 text-white rounded-lg hover:bg-white/10 transition-colors"
            >
              Создать ещё
            </button>
            <button
              onClick={() => {
                onSuccess();
              }}
              className="flex-1 py-2.5 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors"
            >
              Готово
            </button>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <LinkIcon className="text-cyan-400" size={20} />
            Создать приглашение
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-white/60 mb-1">Имя (необязательно)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Иван Иванов"
              className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40"
            />
            <p className="text-xs text-white/30 mt-1">Будет предзаполнено в форме регистрации</p>
          </div>

          <div>
            <label className="block text-sm text-white/60 mb-1">Email (необязательно)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@company.com"
              className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40"
            />
          </div>

          {canSetRole && (
            <div>
              <label className="block text-sm text-white/60 mb-1">Роль</label>
              <div className="grid grid-cols-2 gap-2">
                {(['admin', 'member'] as OrgRole[]).map((r) => {
                  const config = ORG_ROLE_CONFIG[r];
                  const Icon = config.icon;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={clsx(
                        'p-3 rounded-lg border transition-colors text-left',
                        role === r
                          ? 'bg-cyan-500/20 border-cyan-500/50'
                          : 'bg-white/5 border-white/10 hover:bg-white/10'
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon size={16} className={role === r ? 'text-cyan-400' : 'text-white/60'} />
                        <span className={role === r ? 'text-cyan-400' : 'text-white'}>{config.label}</span>
                      </div>
                      <p className="text-xs text-white/40">{config.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Department Selection */}
          {departments.length > 0 && (
            <div>
              <label className="block text-sm text-white/60 mb-2">Департаменты</label>
              <div className="max-h-40 overflow-y-auto space-y-1.5 mb-2">
                {departments.map((dept) => {
                  const selected = selectedDepartments.find(d => d.id === dept.id);
                  return (
                    <div
                      key={dept.id}
                      className={clsx(
                        'flex items-center gap-3 p-2.5 rounded-lg transition-colors',
                        selected
                          ? 'bg-cyan-500/20 border border-cyan-500/50'
                          : 'bg-white/5 border border-transparent hover:bg-white/10'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={!!selected}
                        onChange={() => toggleDepartment(dept.id)}
                        className="w-4 h-4 rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500"
                      />
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: dept.color || '#06b6d4' }}
                      />
                      <span className="text-white text-sm flex-1">{dept.name}</span>
                      {selected && canSetRole && (
                        <select
                          value={selected.role}
                          onChange={(e) => setDepartmentRole(dept.id, e.target.value as DeptRole)}
                          onClick={(e) => e.stopPropagation()}
                          className="px-2 py-0.5 bg-white/5 border border-white/10 rounded text-white text-xs"
                        >
                          <option value="member">Участник</option>
                          <option value="lead">Руководитель</option>
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Expiration */}
          <div>
            <label className="block text-sm text-white/60 mb-1">Срок действия</label>
            <select
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
            >
              <option value={1}>1 день</option>
              <option value={3}>3 дня</option>
              <option value={7}>7 дней</option>
              <option value={14}>14 дней</option>
              <option value={30}>30 дней</option>
              <option value={0}>Без ограничения</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <LinkIcon size={18} />}
            Создать приглашение
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}

// System Users Component (for superadmin)
function SystemUsers({ currentUser }: { currentUser: any }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', name: '', role: 'admin' });
  const queryClient = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
    enabled: currentUser?.role === 'superadmin',
    refetchOnMount: 'always',
  });

  const createMutation = useMutation({
    mutationFn: () => createUser(newUser),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setIsDialogOpen(false);
      setNewUser({ email: '', password: '', name: '', role: 'admin' });
      toast.success('Пользователь создан');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Ошибка создания');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Пользователь удалён');
    },
    onError: () => {
      toast.error('Ошибка удаления');
    },
  });

  if (currentUser?.role !== 'superadmin') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="text-center py-12"
      >
        <Shield className="w-16 h-16 mx-auto text-white/20 mb-4" />
        <h2 className="text-xl font-semibold mb-2 text-white/60">Доступ ограничен</h2>
        <p className="text-white/40">Только суперадмины могут управлять системными пользователями</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-white/60">Системные пользователи ({users.length})</p>
        <Dialog.Root open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <Dialog.Trigger asChild>
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-white hover:bg-cyan-600">
              <Plus className="w-5 h-5" />
              Создать
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
            <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-gray-900 border border-white/10 rounded-xl p-6 z-50">
              <Dialog.Title className="text-xl font-semibold mb-4 text-white">
                Создать пользователя
              </Dialog.Title>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createMutation.mutate();
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm text-white/60 mb-1">Имя</label>
                  <input
                    type="text"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-1">Email</label>
                  <input
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-1">Пароль</label>
                  <input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-1">Системная роль</label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white"
                  >
                    <option value="admin">Admin</option>
                    <option value="superadmin">Superadmin</option>
                  </select>
                </div>
                <div className="flex gap-3 pt-4">
                  <Dialog.Close asChild>
                    <button type="button" className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white">
                      Отмена
                    </button>
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="flex-1 py-2.5 rounded-lg bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-50"
                  >
                    {createMutation.isPending ? 'Создание...' : 'Создать'}
                  </button>
                </div>
              </form>
              <Dialog.Close asChild>
                <button className="absolute top-4 right-4 p-2 rounded-lg hover:bg-white/5 text-white/60">
                  <X className="w-5 h-5" />
                </button>
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      {/* Users List */}
      <div className="bg-white/5 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-12 h-12 mx-auto text-white/20 mb-3" />
            <p className="text-white/40">Нет пользователей</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {users.map((user, index) => (
              <motion.div
                key={user.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center gap-4 p-4 hover:bg-white/5 transition-colors"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
                  <span className="text-lg font-semibold text-cyan-400">
                    {user.name?.[0]?.toUpperCase() || 'U'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-white truncate">{user.name}</h3>
                    <span
                      className={clsx(
                        'px-2 py-0.5 rounded-full text-xs font-medium',
                        user.role === 'superadmin'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-cyan-500/20 text-cyan-400'
                      )}
                    >
                      {user.role}
                    </span>
                  </div>
                  <p className="text-sm text-white/40 truncate">{user.email}</p>
                </div>
                {user.id !== currentUser?.id && (
                  <button
                    onClick={() => {
                      if (confirm('Удалить пользователя?')) {
                        deleteMutation.mutate(user.id);
                      }
                    }}
                    className="p-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
