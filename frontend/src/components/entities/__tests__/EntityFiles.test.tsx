import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EntityFiles from '../EntityFiles';
import * as api from '@/services/api';
import type { EntityFile } from '@/services/api';

// Mock dependencies
vi.mock('@/services/api', () => ({
  getEntityFiles: vi.fn(),
  uploadEntityFile: vi.fn(),
  deleteEntityFile: vi.fn(),
  downloadEntityFile: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onClick, className, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div onClick={onClick as React.MouseEventHandler} className={className as string} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren<object>) => <>{children}</>,
}));

// Mock URL methods
const mockCreateObjectURL = vi.fn(() => 'mock-url');
const mockRevokeObjectURL = vi.fn();
Object.defineProperty(globalThis.URL, 'createObjectURL', { value: mockCreateObjectURL, writable: true });
Object.defineProperty(globalThis.URL, 'revokeObjectURL', { value: mockRevokeObjectURL, writable: true });

// Mock window.confirm
const mockConfirm = vi.fn(() => true);
vi.stubGlobal('confirm', mockConfirm);

const mockFiles: EntityFile[] = [
  {
    id: 1,
    entity_id: 101,
    file_type: 'resume',
    file_name: 'john_doe_resume.pdf',
    file_path: '/uploads/entity_files/101/abc123.pdf',
    file_size: 245678,
    mime_type: 'application/pdf',
    description: 'Main resume',
    uploaded_by: 1,
    created_at: '2024-01-15T10:00:00Z',
  },
  {
    id: 2,
    entity_id: 101,
    file_type: 'cover_letter',
    file_name: 'cover_letter.docx',
    file_path: '/uploads/entity_files/101/def456.docx',
    file_size: 56789,
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    description: undefined,
    uploaded_by: 1,
    created_at: '2024-01-16T11:00:00Z',
  },
  {
    id: 3,
    entity_id: 101,
    file_type: 'portfolio',
    file_name: 'portfolio.zip',
    file_path: '/uploads/entity_files/101/ghi789.zip',
    file_size: 12345678,
    mime_type: 'application/zip',
    description: 'Design portfolio',
    uploaded_by: 1,
    created_at: '2024-01-17T12:00:00Z',
  },
  {
    id: 4,
    entity_id: 101,
    file_type: 'certificate',
    file_name: 'aws_cert.png',
    file_path: '/uploads/entity_files/101/jkl012.png',
    file_size: 234567,
    mime_type: 'image/png',
    description: 'AWS Certificate',
    uploaded_by: 1,
    created_at: '2024-01-18T13:00:00Z',
  },
];

describe('EntityFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getEntityFiles as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles);
    mockConfirm.mockReturnValue(true);
  });

  describe('Loading State', () => {
    it('should show loading spinner while loading', async () => {
      (api.getEntityFiles as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockFiles), 100))
      );

      render(<EntityFiles entityId={101} />);

      // Look for the loading spinner
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('should fetch files on mount', async () => {
      render(<EntityFiles entityId={101} />);

      await waitFor(() => {
        expect(api.getEntityFiles).toHaveBeenCalledWith(101);
      });
    });
  });

  describe('File List Display', () => {
    it('should display list of files after loading', async () => {
      render(<EntityFiles entityId={101} />);

      await waitFor(() => {
        expect(screen.getByText('john_doe_resume.pdf')).toBeInTheDocument();
        expect(screen.getByText('cover_letter.docx')).toBeInTheDocument();
        expect(screen.getByText('portfolio.zip')).toBeInTheDocument();
        expect(screen.getByText('aws_cert.png')).toBeInTheDocument();
      });
    });

    it('should display file type labels in Russian', async () => {
      render(<EntityFiles entityId={101} />);

      await waitFor(() => {
        // Russian labels: "Rezyume", "Soprovoditelnoe pismo", "Portfolio", "Sertifikat"
        expect(screen.getByText(/резюме/i)).toBeInTheDocument();
        expect(screen.getByText(/сопроводительное письмо/i)).toBeInTheDocument();
        expect(screen.getByText(/портфолио/i)).toBeInTheDocument();
        expect(screen.getByText(/сертификат/i)).toBeInTheDocument();
      });
    });

    it('should display file sizes', async () => {
      render(<EntityFiles entityId={101} />);

      await waitFor(() => {
        // File sizes should be formatted (KB, MB)
        expect(screen.getByText(/239\.92 KB/)).toBeInTheDocument(); // 245678 bytes
        expect(screen.getByText(/55\.46 KB/)).toBeInTheDocument(); // 56789 bytes
        expect(screen.getByText(/11\.77 MB/)).toBeInTheDocument(); // 12345678 bytes
        expect(screen.getByText(/229\.07 KB/)).toBeInTheDocument(); // 234567 bytes
      });
    });

    it('should display file descriptions when available', async () => {
      render(<EntityFiles entityId={101} />);

      await waitFor(() => {
        expect(screen.getByText('Main resume')).toBeInTheDocument();
        expect(screen.getByText('Design portfolio')).toBeInTheDocument();
        expect(screen.getByText('AWS Certificate')).toBeInTheDocument();
      });
    });
  });

  describe('File Type Icons', () => {
    it('should display files with correct names', async () => {
      render(<EntityFiles entityId={101} />);

      await waitFor(() => {
        // Check that files are rendered with their names
        expect(screen.getByText('john_doe_resume.pdf')).toBeInTheDocument();
        expect(screen.getByText('aws_cert.png')).toBeInTheDocument();
        expect(screen.getByText('portfolio.zip')).toBeInTheDocument();
      });
    });
  });

  describe('File Upload', () => {
    it('should render upload zone when canEdit is true', async () => {
      render(<EntityFiles entityId={101} canEdit={true} />);

      await waitFor(() => {
        // Russian text: "Peretashchite fayl syuda ili" (Drag file here or)
        expect(screen.getByText(/перетащите файл сюда или/i)).toBeInTheDocument();
        // Russian text: "Vybrat fayl" (Select file)
        expect(screen.getByText(/выбрать файл/i)).toBeInTheDocument();
      });
    });

    it('should not render upload zone when canEdit is false', async () => {
      render(<EntityFiles entityId={101} canEdit={false} />);

      await waitFor(() => {
        expect(screen.queryByText(/перетащите файл сюда/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/выбрать файл/i)).not.toBeInTheDocument();
      });
    });

    it('should open upload form when file is selected', async () => {
      render(<EntityFiles entityId={101} canEdit={true} />);

      await waitFor(() => {
        expect(screen.getByText(/выбрать файл/i)).toBeInTheDocument();
      });

      // Find file input
      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput).toBeInTheDocument();

      // Create a mock file
      const file = new File(['test content'], 'test.pdf', { type: 'application/pdf' });

      if (fileInput) {
        // Simulate file selection
        await userEvent.upload(fileInput as HTMLInputElement, file);

        // Upload form modal should appear
        await waitFor(() => {
          // Russian text: "Zagruzka fayla" (Upload file)
          expect(screen.getByText(/загрузка файла/i)).toBeInTheDocument();
        });
      }
    });

    it('should show file type selector in upload form', async () => {
      render(<EntityFiles entityId={101} canEdit={true} />);

      await waitFor(() => {
        expect(screen.getByText(/выбрать файл/i)).toBeInTheDocument();
      });

      const fileInput = document.querySelector('input[type="file"]');
      const file = new File(['test content'], 'test.pdf', { type: 'application/pdf' });

      if (fileInput) {
        await userEvent.upload(fileInput as HTMLInputElement, file);

        await waitFor(() => {
          // Russian text: "Tip fayla" (File type)
          expect(screen.getByText(/тип файла/i)).toBeInTheDocument();
          // Check for select element
          const selects = screen.getAllByRole('combobox');
          expect(selects.length).toBeGreaterThan(0);
        });
      }
    });

    it('should show description input in upload form', async () => {
      render(<EntityFiles entityId={101} canEdit={true} />);

      const fileInput = document.querySelector('input[type="file"]');
      const file = new File(['test content'], 'test.pdf', { type: 'application/pdf' });

      if (fileInput) {
        await userEvent.upload(fileInput as HTMLInputElement, file);

        await waitFor(() => {
          // Russian text: "Dobavte opisanie fayla..." (Add file description...)
          expect(screen.getByPlaceholderText(/добавьте описание файла/i)).toBeInTheDocument();
        });
      }
    });

    it('should upload file when form is submitted', async () => {
      const newFile: EntityFile = {
        id: 5,
        entity_id: 101,
        file_type: 'resume',
        file_name: 'new_resume.pdf',
        file_path: '/uploads/entity_files/101/mno345.pdf',
        file_size: 123456,
        mime_type: 'application/pdf',
        created_at: new Date().toISOString(),
      };

      (api.uploadEntityFile as ReturnType<typeof vi.fn>).mockResolvedValue(newFile);

      render(<EntityFiles entityId={101} canEdit={true} />);

      const fileInput = document.querySelector('input[type="file"]');
      const file = new File(['test content'], 'new_resume.pdf', { type: 'application/pdf' });

      if (fileInput) {
        await userEvent.upload(fileInput as HTMLInputElement, file);

        await waitFor(() => {
          expect(screen.getByText(/загрузка файла/i)).toBeInTheDocument();
        });

        // Click upload button (Russian: "Zagruzit'" / Upload)
        const uploadButton = screen.getByRole('button', { name: /загрузить$/i });
        await userEvent.click(uploadButton);

        await waitFor(() => {
          expect(api.uploadEntityFile).toHaveBeenCalledWith(
            101,
            file,
            'resume', // default file type
            undefined
          );
        });
      }
    });

    it('should show loading state during upload', async () => {
      (api.uploadEntityFile as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockFiles[0]), 100))
      );

      render(<EntityFiles entityId={101} canEdit={true} />);

      const fileInput = document.querySelector('input[type="file"]');
      const file = new File(['test content'], 'test.pdf', { type: 'application/pdf' });

      if (fileInput) {
        await userEvent.upload(fileInput as HTMLInputElement, file);

        await waitFor(() => {
          expect(screen.getByText(/загрузка файла/i)).toBeInTheDocument();
        });

        const uploadButton = screen.getByRole('button', { name: /загрузить$/i });
        await userEvent.click(uploadButton);

        // Should show "Zagruzka..." (Uploading...) text
        expect(screen.getByText(/загрузка\.\.\./i)).toBeInTheDocument();
      }
    });

    it('should handle upload error', async () => {
      const toast = await import('react-hot-toast');
      (api.uploadEntityFile as ReturnType<typeof vi.fn>).mockRejectedValue({
        response: { data: { detail: 'File too large' } },
      });

      render(<EntityFiles entityId={101} canEdit={true} />);

      const fileInput = document.querySelector('input[type="file"]');
      const file = new File(['test content'], 'test.pdf', { type: 'application/pdf' });

      if (fileInput) {
        await userEvent.upload(fileInput as HTMLInputElement, file);

        await waitFor(() => {
          expect(screen.getByText(/загрузка файла/i)).toBeInTheDocument();
        });

        const uploadButton = screen.getByRole('button', { name: /загрузить$/i });
        await userEvent.click(uploadButton);

        await waitFor(() => {
          expect(toast.default.error).toHaveBeenCalledWith('File too large');
        });
      }
    });
  });

  describe('Drag and Drop', () => {
    it('should highlight drop zone on drag enter', async () => {
      render(<EntityFiles entityId={101} canEdit={true} />);

      await waitFor(() => {
        expect(screen.getByText(/перетащите файл сюда или/i)).toBeInTheDocument();
      });

      // Find the drop zone
      const dropZone = screen.getByText(/перетащите файл сюда или/i).closest('div[class*="border-dashed"]');

      if (dropZone) {
        // Simulate drag enter
        fireEvent.dragEnter(dropZone, {
          dataTransfer: {
            files: [new File(['test'], 'test.pdf', { type: 'application/pdf' })],
          },
        });

        // Should have highlighted state (border-blue-500)
        await waitFor(() => {
          expect(dropZone.className).toContain('border-blue-500');
        });
      }
    });

    it('should handle file drop', async () => {
      render(<EntityFiles entityId={101} canEdit={true} />);

      await waitFor(() => {
        expect(screen.getByText(/перетащите файл сюда или/i)).toBeInTheDocument();
      });

      const dropZone = screen.getByText(/перетащите файл сюда или/i).closest('div[class*="border-dashed"]');
      const file = new File(['test content'], 'dropped_file.pdf', { type: 'application/pdf' });

      if (dropZone) {
        fireEvent.drop(dropZone, {
          dataTransfer: {
            files: [file],
          },
          preventDefault: vi.fn(),
        });

        // Upload form should open
        await waitFor(() => {
          expect(screen.getByText(/загрузка файла/i)).toBeInTheDocument();
        });
      }
    });
  });

  describe('File Delete', () => {
    it('should render delete button for each file when canEdit is true', async () => {
      render(<EntityFiles entityId={101} canEdit={true} />);

      await waitFor(() => {
        expect(screen.getByText('john_doe_resume.pdf')).toBeInTheDocument();
      });

      // Delete buttons should exist (Russian title: "Udalit'" / Delete)
      const deleteButtons = screen.getAllByTitle(/удалить/i);
      expect(deleteButtons.length).toBe(mockFiles.length);
    });

    it('should not render delete button when canEdit is false', async () => {
      render(<EntityFiles entityId={101} canEdit={false} />);

      await waitFor(() => {
        expect(screen.getByText('john_doe_resume.pdf')).toBeInTheDocument();
      });

      // Delete buttons should not exist
      const deleteButtons = screen.queryAllByTitle(/удалить/i);
      expect(deleteButtons.length).toBe(0);
    });

    it('should confirm before deleting', async () => {
      render(<EntityFiles entityId={101} canEdit={true} />);

      await waitFor(() => {
        expect(screen.getByText('john_doe_resume.pdf')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle(/удалить/i);
      await userEvent.click(deleteButtons[0]);

      expect(mockConfirm).toHaveBeenCalled();
    });

    it('should delete file when confirmed', async () => {
      (api.deleteEntityFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      render(<EntityFiles entityId={101} canEdit={true} />);

      await waitFor(() => {
        expect(screen.getByText('john_doe_resume.pdf')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle(/удалить/i);
      await userEvent.click(deleteButtons[0]);

      await waitFor(() => {
        expect(api.deleteEntityFile).toHaveBeenCalledWith(101, 1);
      });
    });

    it('should not delete file when cancelled', async () => {
      mockConfirm.mockReturnValue(false);

      render(<EntityFiles entityId={101} canEdit={true} />);

      await waitFor(() => {
        expect(screen.getByText('john_doe_resume.pdf')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle(/удалить/i);
      await userEvent.click(deleteButtons[0]);

      expect(api.deleteEntityFile).not.toHaveBeenCalled();
    });

    it('should handle delete error', async () => {
      const toast = await import('react-hot-toast');
      (api.deleteEntityFile as ReturnType<typeof vi.fn>).mockRejectedValue({
        response: { data: { detail: 'Permission denied' } },
      });

      render(<EntityFiles entityId={101} canEdit={true} />);

      await waitFor(() => {
        expect(screen.getByText('john_doe_resume.pdf')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle(/удалить/i);
      await userEvent.click(deleteButtons[0]);

      await waitFor(() => {
        expect(toast.default.error).toHaveBeenCalledWith('Permission denied');
      });
    });
  });

  describe('File Download', () => {
    it('should render download button for each file', async () => {
      render(<EntityFiles entityId={101} />);

      await waitFor(() => {
        expect(screen.getByText('john_doe_resume.pdf')).toBeInTheDocument();
      });

      // Download buttons should exist (Russian title: "Skachat'" / Download)
      const downloadButtons = screen.getAllByTitle(/скачать/i);
      expect(downloadButtons.length).toBe(mockFiles.length);
    });

    it('should download file when download button is clicked', async () => {
      const mockBlob = new Blob(['test content'], { type: 'application/pdf' });
      (api.downloadEntityFile as ReturnType<typeof vi.fn>).mockResolvedValue(mockBlob);

      render(<EntityFiles entityId={101} />);

      await waitFor(() => {
        expect(screen.getByText('john_doe_resume.pdf')).toBeInTheDocument();
      });

      const downloadButtons = screen.getAllByTitle(/скачать/i);
      await userEvent.click(downloadButtons[0]);

      await waitFor(() => {
        expect(api.downloadEntityFile).toHaveBeenCalledWith(101, 1);
      });
    });

    it('should handle download error', async () => {
      const toast = await import('react-hot-toast');
      (api.downloadEntityFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      render(<EntityFiles entityId={101} />);

      await waitFor(() => {
        expect(screen.getByText('john_doe_resume.pdf')).toBeInTheDocument();
      });

      const downloadButtons = screen.getAllByTitle(/скачать/i);
      await userEvent.click(downloadButtons[0]);

      await waitFor(() => {
        // Russian text: "Oshibka pri skachivanii fayla" (Error downloading file)
        expect(toast.default.error).toHaveBeenCalled();
      });
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no files', async () => {
      (api.getEntityFiles as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      render(<EntityFiles entityId={101} />);

      await waitFor(() => {
        // Russian text: "Net zagruzhennykh faylov" (No uploaded files)
        expect(screen.getByText(/нет загруженных файлов/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error State', () => {
    it('should show error state on API failure', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      (api.getEntityFiles as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API Error'));

      render(<EntityFiles entityId={101} />);

      await waitFor(() => {
        // Russian text: "Ne udalos' zagruzit' fayly" (Failed to load files)
        expect(screen.getByText(/не удалось загрузить файлы/i)).toBeInTheDocument();
      });

      consoleError.mockRestore();
    });
  });

  describe('Upload Form Close', () => {
    it('should close upload form when Cancel is clicked', async () => {
      render(<EntityFiles entityId={101} canEdit={true} />);

      const fileInput = document.querySelector('input[type="file"]');
      const file = new File(['test content'], 'test.pdf', { type: 'application/pdf' });

      if (fileInput) {
        await userEvent.upload(fileInput as HTMLInputElement, file);

        await waitFor(() => {
          expect(screen.getByText(/загрузка файла/i)).toBeInTheDocument();
        });

        // Russian text: "Otmena" (Cancel)
        const cancelButton = screen.getByText(/отмена/i);
        await userEvent.click(cancelButton);

        await waitFor(() => {
          expect(screen.queryByText(/загрузка файла/i)).not.toBeInTheDocument();
        });
      }
    });
  });
});
