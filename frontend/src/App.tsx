import { useEffect, lazy, Suspense, ComponentType } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useAuthStore } from '@/stores/authStore';
import { getCurrentUser } from '@/services/api';
import Layout from '@/components/Layout';
import RoleRoute from '@/components/RoleRoute';
import { WebSocketProvider } from '@/components/WebSocketProvider';

// Code splitting: Lazy load pages for better initial bundle size
// Login and Invite are loaded eagerly since they're entry points
import LoginPage from '@/pages/LoginPage';
import InvitePage from '@/pages/InvitePage';

/**
 * Retry wrapper for lazy imports - handles chunk loading failures after deployments
 * Retries up to 3 times with exponential backoff before giving up
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  retries = 3,
  interval = 1000
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    for (let i = 0; i < retries; i++) {
      try {
        return await importFn();
      } catch (error) {
        // Only retry on chunk loading errors
        const isChunkError =
          error instanceof Error &&
          (error.message.includes('Failed to fetch dynamically imported module') ||
            error.message.includes('Loading chunk') ||
            error.message.includes('ChunkLoadError'));

        if (!isChunkError || i === retries - 1) {
          throw error;
        }

        // Wait before retrying with exponential backoff
        console.warn(`Chunk load failed, retrying (${i + 1}/${retries})...`);
        await new Promise((resolve) => setTimeout(resolve, interval * (i + 1)));

        // Add cache-busting query param on retry
        // This helps when the old chunk URL returns 404 after deployment
      }
    }
    // This should never be reached, but TypeScript needs it
    throw new Error('Failed to load module after retries');
  });
}

// Lazy loaded pages - only loaded when navigated to
// Using lazyWithRetry to handle chunk loading failures gracefully
const DashboardPage = lazyWithRetry(() => import('@/pages/DashboardPage'));
const ChatsPage = lazyWithRetry(() => import('@/pages/ChatsPage'));
const ContactsPage = lazyWithRetry(() => import('@/pages/ContactsPage'));
const CandidatesPage = lazyWithRetry(() => import('@/pages/CandidatesPage'));
const CallsPage = lazyWithRetry(() => import('@/pages/CallsPage'));
const TrashPage = lazyWithRetry(() => import('@/pages/TrashPage'));
const UsersPage = lazyWithRetry(() => import('@/pages/UsersPage'));
const DepartmentsPage = lazyWithRetry(() => import('@/pages/DepartmentsPage'));
const SettingsPage = lazyWithRetry(() => import('@/pages/SettingsPage'));
const AdminSimulatorPage = lazyWithRetry(() => import('@/pages/AdminSimulatorPage'));
const VacanciesPage = lazyWithRetry(() => import('@/pages/VacanciesPage'));
const EmailTemplatesPage = lazyWithRetry(() => import('@/pages/EmailTemplatesPage'));
const AnalyticsPage = lazyWithRetry(() => import('@/pages/AnalyticsPage'));
const InternsPage = lazyWithRetry(() => import('@/pages/InternsPage'));
const InternStatsPage = lazyWithRetry(() => import('@/pages/InternStatsPage'));
const ExportsPage = lazyWithRetry(() => import('@/pages/ExportsPage'));
const ProjectsPage = lazyWithRetry(() => import('@/pages/ProjectsPage'));
const ProjectDetailPage = lazyWithRetry(() => import('@/pages/ProjectDetailPage'));
const AllTasksPage = lazyWithRetry(() => import('@/pages/AllTasksPage'));
const SaturnPage = lazyWithRetry(() => import('@/pages/SaturnPage'));
const TeamPage = lazyWithRetry(() => import('@/pages/TeamPage'));
const DeptManagerPage = lazyWithRetry(() => import('@/pages/DeptManagerPage'));
const AllCandidatesPage = lazyWithRetry(() => import('@/pages/AllCandidatesPage'));
const RecruiterFunnelsPage = lazyWithRetry(() => import('@/pages/RecruiterFunnelsPage'));
const CandidateDatabasePage = lazyWithRetry(() => import('@/pages/CandidateDatabasePage'));
const PracticeListPage = lazyWithRetry(() => import('@/pages/PracticeListPage'));
const FormBuilderPage = lazyWithRetry(() => import('@/pages/FormBuilderPage'));
const PublicFormPage = lazyWithRetry(() => import('@/pages/PublicFormPage'));
const DocumentTemplatesPage = lazyWithRetry(() => import('@/pages/DocumentTemplatesPage'));
const EmployeePortalPage = lazyWithRetry(() => import('@/pages/EmployeePortalPage'));
const PENDashboardPage = lazyWithRetry(() => import('@/pages/PENDashboardPage'));
const ExtensionPage = lazyWithRetry(() => import('@/pages/ExtensionPage'));
const CsvImportPage = lazyWithRetry(() => import('@/pages/CsvImportPage'));

// Loading fallback component for Suspense
function PageLoader() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-dark-400">Загрузка...</span>
      </div>
    </div>
  );
}

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

  // Performance mode is ON by default (saves battery/CPU)
  // Only disable if user explicitly enabled animations
  useEffect(() => {
    const animationsEnabled = localStorage.getItem('animations-enabled');
    if (animationsEnabled !== 'true') {
      document.body.classList.add('performance-mode');
    }
  }, []);

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/form/:slug" element={<Suspense fallback={<PageLoader />}><PublicFormPage /></Suspense>} />
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
          {/* Wrap lazy-loaded routes in Suspense for loading state */}
          {/* Open routes — any authenticated user */}
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>} />
          <Route path="projects" element={<Suspense fallback={<PageLoader />}><ProjectsPage /></Suspense>} />
          <Route path="projects/:projectId" element={<Suspense fallback={<PageLoader />}><ProjectDetailPage /></Suspense>} />
          <Route path="all-tasks" element={<Suspense fallback={<PageLoader />}><AllTasksPage /></Suspense>} />
          <Route path="chats" element={<Suspense fallback={<PageLoader />}><ChatsPage /></Suspense>} />
          <Route path="chats/:chatId" element={<Suspense fallback={<PageLoader />}><ChatsPage /></Suspense>} />
          <Route path="team" element={<Suspense fallback={<PageLoader />}><TeamPage /></Suspense>} />
          <Route path="my-profile" element={<Suspense fallback={<PageLoader />}><EmployeePortalPage /></Suspense>} />

          {/* HR routes — superadmin, owner, admin, hr (recruiter like Мария) */}
          <Route path="candidates" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><CandidatesPage /></RoleRoute></Suspense>} />
          <Route path="candidate-database" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><CandidateDatabasePage /></RoleRoute></Suspense>} />
          <Route path="all-candidates" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><AllCandidatesPage /></RoleRoute></Suspense>} />
          <Route path="vacancies" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><VacanciesPage /></RoleRoute></Suspense>} />
          <Route path="vacancies/:vacancyId" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><VacanciesPage /></RoleRoute></Suspense>} />
          <Route path="contacts" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><ContactsPage /></RoleRoute></Suspense>} />
          <Route path="contacts/:entityId" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><ContactsPage /></RoleRoute></Suspense>} />
          <Route path="calls" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><CallsPage /></RoleRoute></Suspense>} />
          <Route path="calls/:callId" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><CallsPage /></RoleRoute></Suspense>} />
          <Route path="my-funnels" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><RecruiterFunnelsPage /></RoleRoute></Suspense>} />
<Route path="interns" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><InternsPage /></RoleRoute></Suspense>} />
          <Route path="interns/:internId/stats" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><InternStatsPage /></RoleRoute></Suspense>} />
          <Route path="practice-list" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><PracticeListPage /></RoleRoute></Suspense>} />
          <Route path="form-builder" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><FormBuilderPage /></RoleRoute></Suspense>} />
          <Route path="form-builder/:formId" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><FormBuilderPage /></RoleRoute></Suspense>} />
          <Route path="document-templates" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><DocumentTemplatesPage /></RoleRoute></Suspense>} />
          <Route path="email-templates" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><EmailTemplatesPage /></RoleRoute></Suspense>} />
          <Route path="extension" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><ExtensionPage /></RoleRoute></Suspense>} />
          <Route path="analytics" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr']}><AnalyticsPage /></RoleRoute></Suspense>} />
          <Route path="saturn" element={<Suspense fallback={<PageLoader />}><SaturnPage /></Suspense>} />

          {/* HR Admin routes — superadmin, owner, admin (Настя). NOT for hr recruiter */}
          <Route path="pen" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr_admin']}><PENDashboardPage /></RoleRoute></Suspense>} />
          <Route path="exports" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr_admin']}><ExportsPage /></RoleRoute></Suspense>} />
          <Route path="import" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr_admin']}><CsvImportPage /></RoleRoute></Suspense>} />
          <Route path="employees" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr_admin']}><EmployeePortalPage /></RoleRoute></Suspense>} />
          <Route path="dept-manager" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr_admin']}><DeptManagerPage /></RoleRoute></Suspense>} />
          <Route path="trash" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['hr_admin']}><TrashPage /></RoleRoute></Suspense>} />

          {/* Management routes — superadmin and owner only */}
          <Route path="departments" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['management']}><DepartmentsPage /></RoleRoute></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['management']}><SettingsPage /></RoleRoute></Suspense>} />

          {/* Superadmin only */}
          <Route path="users" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['superadmin']}><UsersPage /></RoleRoute></Suspense>} />
          <Route path="admin" element={<Navigate to="/admin/simulator" replace />} />
          <Route path="admin/simulator" element={<Suspense fallback={<PageLoader />}><RoleRoute allow={['superadmin']}><AdminSimulatorPage /></RoleRoute></Suspense>} />
          {/* Catch-all for unknown routes */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
