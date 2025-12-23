import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { getCurrentUser } from '@/services/api';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import ChatsPage from '@/pages/ChatsPage';
import ContactsPage from '@/pages/ContactsPage';
import CallsPage from '@/pages/CallsPage';
import TrashPage from '@/pages/TrashPage';
import UsersPage from '@/pages/UsersPage';
import DepartmentsPage from '@/pages/DepartmentsPage';
import SettingsPage from '@/pages/SettingsPage';
import Layout from '@/components/Layout';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, user, isLoading } = useAuthStore();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

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
  const { token, setUser, setLoading, logout } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (token) {
      getCurrentUser()
        .then(setUser)
        .catch(() => {
          logout();
          navigate('/login');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
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
      </Route>
    </Routes>
  );
}
