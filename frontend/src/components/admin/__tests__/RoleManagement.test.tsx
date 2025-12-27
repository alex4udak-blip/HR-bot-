import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RoleManagement from '../RoleManagement';
import * as api from '@/services/api';

// Mock the API module
vi.mock('@/services/api', async () => {
  const actual = await vi.importActual('@/services/api');
  return {
    ...actual,
    getCustomRoles: vi.fn(),
    createCustomRole: vi.fn(),
    updateCustomRole: vi.fn(),
    deleteCustomRole: vi.fn(),
    setRolePermission: vi.fn(),
    removeRolePermission: vi.fn(),
    getUsers: vi.fn(),
    assignCustomRole: vi.fn(),
    unassignCustomRole: vi.fn(),
    getPermissionAuditLogs: vi.fn(),
  };
});

// Mock the authStore
vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(() => ({
    user: { id: 1, email: 'admin@test.com', role: 'superadmin' },
  })),
}));

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockRoles: api.CustomRole[] = [
  {
    id: 1,
    name: 'Content Manager',
    description: 'Manages content across the platform',
    base_role: 'admin',
    created_at: '2025-01-01T00:00:00Z',
    is_active: true,
    permission_overrides: [
      { id: 1, role_id: 1, permission: 'can_create_resources', allowed: true },
    ],
  },
  {
    id: 2,
    name: 'Viewer',
    description: 'Read-only access',
    base_role: 'member',
    created_at: '2025-01-01T00:00:00Z',
    is_active: true,
    permission_overrides: [],
  },
];

const mockUsers = [
  { id: 1, email: 'user1@test.com', name: 'User One' },
  { id: 2, email: 'user2@test.com', name: 'User Two' },
];

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
};

describe('RoleManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getCustomRoles as ReturnType<typeof vi.fn>).mockResolvedValue(mockRoles);
    (api.getUsers as ReturnType<typeof vi.fn>).mockResolvedValue(mockUsers);
    (api.getPermissionAuditLogs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  describe('Rendering', () => {
    it('should render the component title', async () => {
      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByText('Custom Roles')).toBeInTheDocument();
      });
    });

    it('should render the "New Role" button', async () => {
      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /new role/i })).toBeInTheDocument();
      });
    });

    it('should render role cards when roles exist', async () => {
      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByText('Content Manager')).toBeInTheDocument();
        expect(screen.getByText('Viewer')).toBeInTheDocument();
      });
    });

    it('should show empty state when no roles exist', async () => {
      (api.getCustomRoles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByText('No custom roles yet')).toBeInTheDocument();
      });
    });

    it('should show permission override count on role cards', async () => {
      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByText('1 permission override')).toBeInTheDocument();
        expect(screen.getByText('0 permission overrides')).toBeInTheDocument();
      });
    });
  });

  describe('Create Role Dialog', () => {
    it('should open create dialog when clicking "New Role"', async () => {
      const user = userEvent.setup();
      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /new role/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /new role/i }));

      await waitFor(() => {
        expect(screen.getByText('Create Custom Role')).toBeInTheDocument();
      });
    });

    it('should show base role selector in create dialog', async () => {
      const user = userEvent.setup();
      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /new role/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /new role/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/base role/i)).toBeInTheDocument();
      });
    });

    it('should call createCustomRole when form is submitted', async () => {
      const user = userEvent.setup();
      (api.createCustomRole as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 3,
        name: 'New Role',
        base_role: 'member',
        created_at: '2025-01-01T00:00:00Z',
        is_active: true,
      });

      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /new role/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /new role/i }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/e.g., content manager/i)).toBeInTheDocument();
      });

      await user.type(screen.getByPlaceholderText(/e.g., content manager/i), 'New Role');
      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(api.createCustomRole).toHaveBeenCalledWith({
          name: 'New Role',
          description: '',
          base_role: 'member',
        });
      });
    });
  });

  describe('Delete Role', () => {
    it('should call deleteCustomRole when delete is confirmed', async () => {
      const user = userEvent.setup();
      (api.deleteCustomRole as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      // Mock window.confirm
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByText('Content Manager')).toBeInTheDocument();
      });

      // Find and click delete button
      const deleteButtons = screen.getAllByTitle('Delete Role');
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(confirmSpy).toHaveBeenCalled();
        expect(api.deleteCustomRole).toHaveBeenCalledWith(1);
      });

      confirmSpy.mockRestore();
    });

    it('should not delete when confirmation is cancelled', async () => {
      const user = userEvent.setup();
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByText('Content Manager')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Delete Role');
      await user.click(deleteButtons[0]);

      expect(api.deleteCustomRole).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
    });
  });

  describe('Audit Log', () => {
    it('should toggle audit log visibility when button is clicked', async () => {
      const user = userEvent.setup();
      (api.getPermissionAuditLogs as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 1,
          action: 'create',
          permission: 'can_view_all_users',
          old_value: null,
          new_value: true,
          created_at: '2025-01-01T00:00:00Z',
        },
      ]);

      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /audit log/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /audit log/i }));

      await waitFor(() => {
        expect(screen.getByText('Permission Audit Log')).toBeInTheDocument();
      });
    });
  });

  describe('Access Control', () => {
    it('should show access denied message for non-superadmin users', async () => {
      // Override the mock for this test
      const { useAuthStore } = await import('@/stores/authStore');
      vi.mocked(useAuthStore).mockReturnValue({
        user: { id: 1, email: 'user@test.com', role: 'admin' },
      } as ReturnType<typeof useAuthStore>);

      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByText('Superadmin access required')).toBeInTheDocument();
      });
    });
  });

  describe('Role Cards', () => {
    it('should display role description', async () => {
      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByText('Manages content across the platform')).toBeInTheDocument();
        expect(screen.getByText('Read-only access')).toBeInTheDocument();
      });
    });

    it('should display base role information', async () => {
      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByText(/based on: admin/i)).toBeInTheDocument();
        expect(screen.getByText(/based on: member/i)).toBeInTheDocument();
      });
    });

    it('should have configure permissions button', async () => {
      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        const configButtons = screen.getAllByText('Configure Permissions');
        expect(configButtons.length).toBe(2);
      });
    });

    it('should show inactive badge for inactive roles', async () => {
      (api.getCustomRoles as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          ...mockRoles[0],
          is_active: false,
        },
      ]);

      renderWithProviders(<RoleManagement />);

      await waitFor(() => {
        expect(screen.getByText('Inactive')).toBeInTheDocument();
      });
    });
  });
});
