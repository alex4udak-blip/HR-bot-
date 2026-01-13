import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResumeUploader from '../ResumeUploader';
import * as useResumeUploadModule from '@/hooks/useResumeUpload';

/**
 * Tests for ResumeUploader component
 * Verifies drag & drop functionality, file validation UI, and upload state display
 */

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Helper to create mock files
const createMockFile = (
  name: string,
  size: number = 1024,
  type: string = 'application/pdf'
): File => {
  const file = new File(['test content'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

// Mock hook return type
const createMockHookReturn = (
  overrides: Partial<useResumeUploadModule.UseResumeUploadReturn> = {}
): useResumeUploadModule.UseResumeUploadReturn => ({
  files: [],
  isUploading: false,
  addFiles: vi.fn(() => []),
  removeFile: vi.fn(),
  clearFiles: vi.fn(),
  uploadAll: vi.fn(),
  uploadFile: vi.fn(),
  createEntity: vi.fn(),
  validateFile: vi.fn(() => null),
  overallProgress: 0,
  successCount: 0,
  errorCount: 0,
  ...overrides,
});

describe('ResumeUploader', () => {
  let mockUseResumeUpload: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseResumeUpload = vi.spyOn(useResumeUploadModule, 'useResumeUpload');
    mockUseResumeUpload.mockReturnValue(createMockHookReturn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('should render drop zone with instructions', () => {
      render(<ResumeUploader />);

      expect(screen.getByText('Перетащите резюме сюда')).toBeInTheDocument();
      expect(screen.getByText('или нажмите для выбора файла')).toBeInTheDocument();
    });

    it('should display supported formats', () => {
      render(<ResumeUploader />);

      expect(screen.getByText('.PDF')).toBeInTheDocument();
      expect(screen.getByText('.DOC')).toBeInTheDocument();
      expect(screen.getByText('.DOCX')).toBeInTheDocument();
    });

    it('should display max file size', () => {
      render(<ResumeUploader />);

      expect(screen.getByText(/Макс\. 10 МБ/)).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(<ResumeUploader className="custom-class" />);

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('File input', () => {
    it('should have hidden file input', () => {
      render(<ResumeUploader />);

      const input = document.querySelector('input[type="file"]');
      expect(input).toBeInTheDocument();
      expect(input).toHaveClass('hidden');
    });

    it('should accept correct file types', () => {
      render(<ResumeUploader />);

      const input = document.querySelector('input[type="file"]');
      expect(input).toHaveAttribute('accept', '.pdf,.doc,.docx');
    });

    it('should allow multiple files by default', () => {
      render(<ResumeUploader />);

      const input = document.querySelector('input[type="file"]');
      expect(input).toHaveAttribute('multiple');
    });

    it('should not allow multiple files when maxFiles is 1', () => {
      render(<ResumeUploader maxFiles={1} />);

      const input = document.querySelector('input[type="file"]');
      expect(input).not.toHaveAttribute('multiple');
    });
  });

  describe('Drag and drop', () => {
    it('should show drag indicator when dragging over', () => {
      render(<ResumeUploader />);

      const dropZone = screen.getByText('Перетащите резюме сюда').closest('div');

      fireEvent.dragEnter(dropZone!, {
        dataTransfer: { items: [{}], files: [] },
      });

      expect(screen.getByText('Отпустите файл для загрузки')).toBeInTheDocument();
    });

    it('should call addFiles on file drop', () => {
      const addFiles = vi.fn(() => []);
      mockUseResumeUpload.mockReturnValue(createMockHookReturn({ addFiles }));

      render(<ResumeUploader />);

      const dropZone = screen.getByText('Перетащите резюме сюда').closest('div');
      const file = createMockFile('resume.pdf');

      fireEvent.drop(dropZone!, {
        dataTransfer: { files: [file] },
      });

      // Drop event passes files array-like, hook accepts FileList or File[]
      expect(addFiles).toHaveBeenCalled();
      const calledWith = addFiles.mock.calls[0][0];
      expect(calledWith).toHaveLength(1);
      expect(calledWith[0].name).toBe('resume.pdf');
    });

    it('should not accept files when disabled', () => {
      const addFiles = vi.fn(() => []);
      mockUseResumeUpload.mockReturnValue(createMockHookReturn({ addFiles }));

      render(<ResumeUploader disabled />);

      const dropZone = screen.getByText('Перетащите резюме сюда').closest('div');
      const file = createMockFile('resume.pdf');

      fireEvent.drop(dropZone!, {
        dataTransfer: { files: [file] },
      });

      expect(addFiles).not.toHaveBeenCalled();
    });
  });

  describe('Files list', () => {
    it('should display uploaded files', () => {
      const mockFiles: useResumeUploadModule.UploadingFile[] = [
        {
          id: 'file-1',
          file: createMockFile('resume1.pdf'),
          progress: 100,
          status: 'done',
          parsedData: {
            name: 'John Doe',
            email: 'john@example.com',
            skills: ['JavaScript'],
            salary_currency: 'RUB',
          },
        },
      ];

      mockUseResumeUpload.mockReturnValue(createMockHookReturn({ files: mockFiles }));

      render(<ResumeUploader />);

      expect(screen.getByText('resume1.pdf')).toBeInTheDocument();
      expect(screen.getByText(/Готово/)).toBeInTheDocument();
    });

    it('should display file count', () => {
      const mockFiles: useResumeUploadModule.UploadingFile[] = [
        { id: 'file-1', file: createMockFile('resume1.pdf'), progress: 100, status: 'done' },
        { id: 'file-2', file: createMockFile('resume2.pdf'), progress: 100, status: 'done' },
      ];

      mockUseResumeUpload.mockReturnValue(
        createMockHookReturn({ files: mockFiles, successCount: 2 })
      );

      render(<ResumeUploader />);

      expect(screen.getByText('Файлов: 2')).toBeInTheDocument();
      expect(screen.getByText('Успешно: 2')).toBeInTheDocument();
    });

    it('should display error count', () => {
      const mockFiles: useResumeUploadModule.UploadingFile[] = [
        { id: 'file-1', file: createMockFile('resume1.pdf'), progress: 0, status: 'error', error: 'Parse failed' },
      ];

      mockUseResumeUpload.mockReturnValue(
        createMockHookReturn({ files: mockFiles, errorCount: 1 })
      );

      render(<ResumeUploader />);

      expect(screen.getByText('Ошибок: 1')).toBeInTheDocument();
    });

    it('should display error message for failed files', () => {
      const mockFiles: useResumeUploadModule.UploadingFile[] = [
        {
          id: 'file-1',
          file: createMockFile('resume1.pdf'),
          progress: 0,
          status: 'error',
          error: 'Failed to parse resume',
        },
      ];

      mockUseResumeUpload.mockReturnValue(createMockHookReturn({ files: mockFiles }));

      render(<ResumeUploader />);

      expect(screen.getByText('Failed to parse resume')).toBeInTheDocument();
    });
  });

  describe('Upload progress', () => {
    it('should show progress bar when uploading', () => {
      mockUseResumeUpload.mockReturnValue(
        createMockHookReturn({
          isUploading: true,
          overallProgress: 50,
          files: [
            { id: 'file-1', file: createMockFile('resume.pdf'), progress: 50, status: 'uploading' },
          ],
        })
      );

      render(<ResumeUploader />);

      expect(screen.getByText('Загрузка файлов...')).toBeInTheDocument();
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('should show parsing status', () => {
      mockUseResumeUpload.mockReturnValue(
        createMockHookReturn({
          files: [
            { id: 'file-1', file: createMockFile('resume.pdf'), progress: 60, status: 'parsing' },
          ],
        })
      );

      render(<ResumeUploader />);

      expect(screen.getByText(/Парсинг резюме/)).toBeInTheDocument();
    });
  });

  describe('File removal', () => {
    it('should call removeFile when remove button is clicked', async () => {
      const removeFile = vi.fn();
      const mockFiles: useResumeUploadModule.UploadingFile[] = [
        { id: 'file-1', file: createMockFile('resume.pdf'), progress: 100, status: 'done' },
      ];

      mockUseResumeUpload.mockReturnValue(
        createMockHookReturn({ files: mockFiles, removeFile })
      );

      render(<ResumeUploader />);

      const removeButton = screen.getByTitle('Удалить');
      await userEvent.click(removeButton);

      expect(removeFile).toHaveBeenCalledWith('file-1');
    });

    it('should call clearFiles when clear button is clicked', async () => {
      const clearFiles = vi.fn();
      const mockFiles: useResumeUploadModule.UploadingFile[] = [
        { id: 'file-1', file: createMockFile('resume.pdf'), progress: 100, status: 'done' },
      ];

      mockUseResumeUpload.mockReturnValue(
        createMockHookReturn({ files: mockFiles, clearFiles })
      );

      render(<ResumeUploader />);

      const clearButton = screen.getByText('Очистить');
      await userEvent.click(clearButton);

      expect(clearFiles).toHaveBeenCalled();
    });
  });

  describe('Parsed data preview', () => {
    it('should show toggle button for parsed data', () => {
      const mockFiles: useResumeUploadModule.UploadingFile[] = [
        {
          id: 'file-1',
          file: createMockFile('resume.pdf'),
          progress: 100,
          status: 'done',
          parsedData: {
            name: 'John Doe',
            skills: [],
            salary_currency: 'RUB',
          },
        },
      ];

      mockUseResumeUpload.mockReturnValue(createMockHookReturn({ files: mockFiles }));

      render(<ResumeUploader />);

      expect(screen.getByText('Показать данные')).toBeInTheDocument();
    });

    it('should toggle parsed data visibility', async () => {
      const mockFiles: useResumeUploadModule.UploadingFile[] = [
        {
          id: 'file-1',
          file: createMockFile('resume.pdf'),
          progress: 100,
          status: 'done',
          parsedData: {
            name: 'John Doe',
            email: 'john@example.com',
            skills: [],
            salary_currency: 'RUB',
          },
        },
      ];

      mockUseResumeUpload.mockReturnValue(createMockHookReturn({ files: mockFiles }));

      render(<ResumeUploader />);

      // Initially hidden
      expect(screen.queryByText('john@example.com')).not.toBeInTheDocument();

      // Show data
      await userEvent.click(screen.getByText('Показать данные'));
      expect(screen.getByText('john@example.com')).toBeInTheDocument();

      // Hide data
      await userEvent.click(screen.getByText('Скрыть данные'));
      await waitFor(() => {
        expect(screen.queryByText('john@example.com')).not.toBeInTheDocument();
      });
    });
  });

  describe('Entity creation', () => {
    it('should not show create button by default', () => {
      const mockFiles: useResumeUploadModule.UploadingFile[] = [
        {
          id: 'file-1',
          file: createMockFile('resume.pdf'),
          progress: 100,
          status: 'done',
          parsedData: { name: 'Test', skills: [], salary_currency: 'RUB' },
        },
      ];

      mockUseResumeUpload.mockReturnValue(createMockHookReturn({ files: mockFiles }));

      render(<ResumeUploader />);

      expect(screen.queryByText('Создать кандидата')).not.toBeInTheDocument();
    });

    it('should show create button when showCreateEntity is true', () => {
      const mockFiles: useResumeUploadModule.UploadingFile[] = [
        {
          id: 'file-1',
          file: createMockFile('resume.pdf'),
          progress: 100,
          status: 'done',
          parsedData: { name: 'Test', skills: [], salary_currency: 'RUB' },
        },
      ];

      mockUseResumeUpload.mockReturnValue(createMockHookReturn({ files: mockFiles }));

      render(<ResumeUploader showCreateEntity />);

      expect(screen.getByText('Создать кандидата')).toBeInTheDocument();
    });

    it('should call createEntity when create button is clicked', async () => {
      const createEntity = vi.fn().mockResolvedValue(123);
      const mockFiles: useResumeUploadModule.UploadingFile[] = [
        {
          id: 'file-1',
          file: createMockFile('resume.pdf'),
          progress: 100,
          status: 'done',
          parsedData: { name: 'Test', skills: [], salary_currency: 'RUB' },
        },
      ];

      mockUseResumeUpload.mockReturnValue(
        createMockHookReturn({ files: mockFiles, createEntity })
      );

      render(<ResumeUploader showCreateEntity />);

      await userEvent.click(screen.getByText('Создать кандидата'));

      await waitFor(() => {
        expect(createEntity).toHaveBeenCalledWith('file-1');
      });
    });

    it('should show entity created indicator after creation', () => {
      const mockFiles: useResumeUploadModule.UploadingFile[] = [
        {
          id: 'file-1',
          file: createMockFile('resume.pdf'),
          progress: 100,
          status: 'done',
          parsedData: { name: 'Test', skills: [], salary_currency: 'RUB' },
          entityId: 123,
        },
      ];

      mockUseResumeUpload.mockReturnValue(createMockHookReturn({ files: mockFiles }));

      render(<ResumeUploader showCreateEntity />);

      expect(screen.getByText(/Кандидат создан/)).toBeInTheDocument();
      expect(screen.getByText(/ID: 123/)).toBeInTheDocument();
    });
  });

  describe('Disabled state', () => {
    it('should apply disabled styles', () => {
      render(<ResumeUploader disabled />);

      const dropZone = screen.getByText('Перетащите резюме сюда').closest('div');
      expect(dropZone).toHaveClass('opacity-50');
      expect(dropZone).toHaveClass('cursor-not-allowed');
    });

    it('should disable file input', () => {
      render(<ResumeUploader disabled />);

      const input = document.querySelector('input[type="file"]');
      expect(input).toBeDisabled();
    });
  });

  describe('Callbacks', () => {
    it('should call onEntityCreated when entity is created', async () => {
      const onEntityCreated = vi.fn();
      const createEntity = vi.fn().mockResolvedValue(123);
      const mockFiles: useResumeUploadModule.UploadingFile[] = [
        {
          id: 'file-1',
          file: createMockFile('resume.pdf'),
          progress: 100,
          status: 'done',
          parsedData: { name: 'Test', skills: [], salary_currency: 'RUB' },
        },
      ];

      mockUseResumeUpload.mockReturnValue(
        createMockHookReturn({ files: mockFiles, createEntity })
      );

      render(<ResumeUploader showCreateEntity onEntityCreated={onEntityCreated} />);

      await userEvent.click(screen.getByText('Создать кандидата'));

      await waitFor(() => {
        expect(onEntityCreated).toHaveBeenCalledWith(123);
      });
    });
  });
});
