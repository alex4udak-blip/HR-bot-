import { create } from 'zustand';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
  // Role helpers
  isSuperAdmin: () => boolean;
  isOwner: () => boolean;
  isAdmin: () => boolean;
  isSubAdmin: () => boolean;
  isMember: () => boolean;
  isDepartmentAdmin: () => boolean;
  canShareTo: (targetUserId: number, targetUserRole?: string, targetDepartmentId?: number) => boolean;
  canDeleteUser: (targetUserId: number, targetUserRole?: string) => boolean;
  canEditResource: (resource: { owner_id?: number; is_mine?: boolean; access_level?: string }) => boolean;
  canDeleteResource: (resource: { owner_id?: number; is_mine?: boolean; access_level?: string }) => boolean;
  canShareResource: (resource: { owner_id?: number; is_mine?: boolean; access_level?: string }) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem('token'),
  isLoading: true,
  setUser: (user) => set({ user }),
  setToken: (token) => {
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
    set({ token });
  },
  setLoading: (isLoading) => set({ isLoading }),
  logout: () => {
    localStorage.removeItem('token');
    set({ user: null, token: null });
  },

  // Role helper methods
  isSuperAdmin: () => {
    const { user } = get();
    return user?.role === 'superadmin';
  },

  isOwner: () => {
    const { user } = get();
    return user?.org_role === 'owner';
  },

  isAdmin: () => {
    const { user } = get();
    // Org admin or department lead/sub_admin
    return user?.org_role === 'admin' || user?.department_role === 'lead' || user?.department_role === 'sub_admin';
  },

  isSubAdmin: () => {
    const { user } = get();
    return user?.department_role === 'sub_admin';
  },

  isMember: () => {
    const { user } = get();
    return user?.org_role === 'member' && user?.department_role === 'member';
  },

  isDepartmentAdmin: () => {
    const { user } = get();
    return user?.department_role === 'lead' || user?.department_role === 'sub_admin';
  },

  // Check if current user can share to target user
  // Logic mirrors backend auth.py can_share_to()
  canShareTo: (targetUserId: number, targetUserRole?: string, targetDepartmentId?: number) => {
    const { user, isSuperAdmin, isOwner } = get();
    if (!user) return false;

    // Can't share to yourself
    if (user.id === targetUserId) return false;

    // 1. SUPERADMIN can share to anyone
    if (isSuperAdmin()) return true;

    // 2. OWNER can share to anyone in organization
    if (isOwner()) return true;

    // Determine if target is OWNER or SUPERADMIN
    const targetIsOwner = targetUserRole === 'owner';
    const targetIsSuperAdmin = targetUserRole === 'superadmin';

    // Determine if target is department admin (lead or sub_admin)
    const targetIsDeptAdmin = targetUserRole === 'lead' || targetUserRole === 'sub_admin';

    // Determine if current user is department admin
    const currentUserIsDeptAdmin = user.department_role === 'lead' || user.department_role === 'sub_admin';

    // 3. ADMIN/SUB_ADMIN (department_role === 'lead' or 'sub_admin') can share to:
    //    - OWNER and SUPERADMIN
    //    - Other ADMIN/SUB_ADMIN (any department)
    //    - Members in their department
    if (currentUserIsDeptAdmin) {
      // Can share to OWNER or SUPERADMIN
      if (targetIsOwner || targetIsSuperAdmin) return true;

      // Can share to other department admins (any department)
      if (targetIsDeptAdmin) return true;

      // Can share to members in same department
      if (targetDepartmentId && user.department_id && targetDepartmentId === user.department_id) {
        return true;
      }

      return false;
    }

    // 4. MEMBER can only share within their department
    return targetDepartmentId !== undefined &&
           user.department_id !== undefined &&
           targetDepartmentId === user.department_id;
  },

  // Check if current user can delete target user
  canDeleteUser: (targetUserId: number, targetUserRole?: string) => {
    const { user, isSuperAdmin, isOwner } = get();
    if (!user || user.id === targetUserId) return false;

    // SUPERADMIN can delete anyone except other superadmins
    if (isSuperAdmin()) {
      return targetUserRole !== 'superadmin';
    }

    // OWNER can delete anyone except superadmin and other owners
    if (isOwner()) {
      return targetUserRole !== 'superadmin' && targetUserRole !== 'owner';
    }

    // Department LEAD can delete sub_admins and members (but not other leads)
    if (user.department_role === 'lead') {
      return targetUserRole === 'sub_admin' || targetUserRole === 'member';
    }

    // SUB_ADMIN cannot delete other users
    return false;
  },

  // Check if user can edit a resource
  canEditResource: (resource: { owner_id?: number; is_mine?: boolean; access_level?: string }) => {
    const { user, isSuperAdmin, isOwner } = get();
    if (!user) return false;

    // SUPERADMIN and OWNER can edit everything
    if (isSuperAdmin() || isOwner()) return true;

    // Owner can always edit
    if (resource.is_mine || resource.owner_id === user.id) return true;

    // Shared with edit or full access
    if (resource.access_level === 'edit' || resource.access_level === 'full') return true;

    return false;
  },

  // Check if user can delete a resource
  canDeleteResource: (resource: { owner_id?: number; is_mine?: boolean; access_level?: string }) => {
    const { user, isSuperAdmin, isOwner } = get();
    if (!user) return false;

    // SUPERADMIN and OWNER can delete everything
    if (isSuperAdmin() || isOwner()) return true;

    // Only owner can delete (even with full access, you can't delete shared items)
    if (resource.is_mine || resource.owner_id === user.id) return true;

    return false;
  },

  // Check if user can share a resource
  canShareResource: (resource: { owner_id?: number; is_mine?: boolean; access_level?: string }) => {
    const { user, isSuperAdmin, isOwner } = get();
    if (!user) return false;

    // SUPERADMIN and OWNER can share everything
    if (isSuperAdmin() || isOwner()) return true;

    // Owner can share
    if (resource.is_mine || resource.owner_id === user.id) return true;

    // Users with full access can re-share
    if (resource.access_level === 'full') return true;

    return false;
  },
}));
