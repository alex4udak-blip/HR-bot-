/**
 * RoleRoute — route-level access guard based on user role.
 *
 * Usage:
 *   <RoleRoute allow={['superadmin']}>
 *     <AdminPage />
 *   </RoleRoute>
 *
 *   <RoleRoute allow={['superadmin', 'owner', 'admin']}>
 *     <SettingsPage />
 *   </RoleRoute>
 *
 * Allowed role tokens:
 *   'superadmin'  — system superadmin (user.role === 'superadmin')
 *   'owner'       — org owner (user.org_role === 'owner')
 *   'admin'       — org admin (user.org_role === 'admin')
 *   'lead'        — department lead (user.department_role === 'lead')
 *   'sub_admin'   — department sub-admin (user.department_role === 'sub_admin')
 *   'member'      — any authenticated user
 *   'hr'          — shortcut for superadmin | owner | admin | lead
 */

import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

interface RoleRouteProps {
  children: React.ReactNode;
  allow: string[];
  feature?: string;
  redirectTo?: string;
}

export default function RoleRoute({ children, allow, feature, redirectTo = '/dashboard' }: RoleRouteProps) {
  const { user, hasFeature } = useAuthStore();

  if (!user) return <Navigate to="/login" replace />;

  // Feature check first
  if (feature && !hasFeature(feature)) {
    // Superadmin always passes
    if (user.role !== 'superadmin') {
      return <AccessDenied />;
    }
  }

  // 'member' means any authenticated user
  if (allow.includes('member')) return <>{children}</>;

  // Expand 'hr' shortcut
  const roles = new Set(allow);
  if (roles.has('hr')) {
    roles.add('superadmin');
    roles.add('owner');
    roles.add('admin');
    roles.add('lead');
  }

  // Check each role token
  const hasAccess =
    (roles.has('superadmin') && user.role === 'superadmin') ||
    (roles.has('owner') && user.org_role === 'owner') ||
    (roles.has('admin') && (user.org_role === 'admin' || user.org_role === 'owner')) ||
    (roles.has('lead') && user.department_role === 'lead') ||
    (roles.has('sub_admin') && user.department_role === 'sub_admin');

  if (!hasAccess) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}

function AccessDenied() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-8">
      <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v.01M12 9v3m-7 4h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2z" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-white mb-2">Доступ запрещён</h2>
      <p className="text-white/40 text-sm max-w-md">
        У вас нет прав для просмотра этой страницы. Обратитесь к администратору.
      </p>
    </div>
  );
}
