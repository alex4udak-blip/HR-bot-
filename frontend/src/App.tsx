import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { getCurrentUser } from '@/services/api';
import LoginPage from '@/pages/LoginPage';
import InvitePage from '@/pages/InvitePage';
import DashboardPage from '@/pages/DashboardPage';
import ChatsPage from '@/pages/ChatsPage';
import ContactsPage from '@/pages/ContactsPage';
import CallsPage from '@/pages/CallsPage';
import TrashPage from '@/pages/TrashPage';
import UsersPage from '@/pages/UsersPage';
import DepartmentsPage from '@/pages/DepartmentsPage';
import SettingsPage from '@/pages/SettingsPage';
import AdminSimulatorPage from '@/pages/AdminSimulatorPage';
import Layout from '@/components/Layout';
import { WebSocketProvider } from '@/components/WebSocketProvider';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const { setUser, setLoading } = useAuthStore();

  useEffect(() => {
    // Try to get current user - cookie is sent automatically
    getCurrentUser()
      .then(setUser)
      .catch(() => {
        // Not authenticated or session expired - just set loading to false
        // Don't call logout() here as it could clear a user that was just set
        // by a concurrent login (race condition)
      })
      .finally(() => setLoading(false));
  }, [setUser, setLoading]);

  // Pause animations when tab is not visible to save CPU/GPU
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        document.body.classList.add('animations-paused');
      } else {
        document.body.classList.remove('animations-paused');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <WebSocketProvider>
              <Layout />
            </WebSocketProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="chats" element={<ChatsPage />} />
        <Route path="chats/:chatId" element={<ChatsPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="contacts/:entityId" element={<ContactsPage />} />
        <Route path="calls" element={<CallsPage />} />
        <Route path="calls/:callId" element={<CallsPage />} />
        <Route path="trash" element={<TrashPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="departments" element={<DepartmentsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<Navigate to="/admin/simulator" replace />} />
        <Route path="admin/simulator" element={<AdminSimulatorPage />} />
        {/* Catch-all for unknown routes */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
