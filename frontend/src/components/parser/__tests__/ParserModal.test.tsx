import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ParserModal from '../ParserModal';
import type { ParsedResume, ParsedVacancy } from '@/services/api';

// Mock the API
vi.mock('@/services/api', () => ({
  parseResumeFromUrl: vi.fn(),
  parseResumeFromFile: vi.fn(),
  parseVacancyFromUrl: vi.fn(),
}));

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onClick, className, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div onClick={onClick as React.MouseEventHandler} className={className as string} {...props}>
        {children}
      </div>
    ),
  },
}));

import {
  parseResumeFromUrl,
  parseResumeFromFile,
  parseVacancyFromUrl,
} from '@/services/api';
import toast from 'react-hot-toast';

const mockParsedResume: ParsedResume = {
  name: 'John Doe',
  email: 'john@example.com',
  phone: '+79991234567',
  telegram: '@johndoe',
  position: 'Python Developer',
  company: 'TechCorp',
  experience_years: 5,
  skills: ['Python', 'FastAPI', 'PostgreSQL'],
  salary_min: 200000,
  salary_max: 300000,
  salary_currency: 'RUB',
  location: 'Moscow',
  summary: 'Experienced backend developer',
  source_url: 'https://hh.ru/resume/123',
};

const mockParsedVacancy: ParsedVacancy = {
  title: 'Senior Python Developer',
  description: 'We are looking for an experienced developer',
  requirements: '5+ years Python experience',
  responsibilities: 'Develop backend services',
  salary_min: 250000,
  salary_max: 400000,
  salary_currency: 'RUB',
  location: 'Remote',
  employment_type: 'full-time',
  experience_level: 'senior',
  company_name: 'StartupXYZ',
  source_url: 'https://hh.ru/vacancy/456',
};

describe('ParserModal', () => {
  const mockOnClose = vi.fn();
  const mockOnParsed = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (parseResumeFromUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockParsedResume);
    (parseResumeFromFile as ReturnType<typeof vi.fn>).mockResolvedValue(mockParsedResume);
    (parseVacancyFromUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockParsedVacancy);
  });

  describe('Resume Parser Modal', () => {
    const renderResumeModal = () => {
      return render(
        <ParserModal type="resume" onClose={mockOnClose} onParsed={mockOnParsed} />
      );
    };

    describe('Rendering', () => {
      it('should render resume parser modal with correct title', () => {
        renderResumeModal();
        expect(screen.getByText('Парсинг резюме')).toBeInTheDocument();
      });

      it('should render URL tab by default', () => {
        renderResumeModal();
        expect(screen.getByText('По ссылке')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('https://hh.ru/resume/123456')).toBeInTheDocument();
      });

      it('should render file upload tab for resume', () => {
        renderResumeModal();
        expect(screen.getByText('Загрузить файл')).toBeInTheDocument();
      });

      it('should render close button', () => {
        renderResumeModal();
        expect(screen.getByText('Отмена')).toBeInTheDocument();
      });

      it('should not show create button initially', () => {
        renderResumeModal();
        expect(screen.queryByText('Создать контакт')).not.toBeInTheDocument();
      });
    });

    describe('URL Input and Source Detection', () => {
      it('should detect HeadHunter source from URL', async () => {
        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        expect(screen.getByText('HeadHunter')).toBeInTheDocument();
      });

      it('should detect LinkedIn source from URL', async () => {
        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://linkedin.com/in/johndoe');
        expect(screen.getByText('LinkedIn')).toBeInTheDocument();
      });

      it('should detect SuperJob source from URL', async () => {
        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://superjob.ru/resume/python-123');
        expect(screen.getByText('SuperJob')).toBeInTheDocument();
      });

      it('should detect Habr Career source from URL', async () => {
        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://career.habr.com/user123');
        // Note: The source displays as "Хабр Карьера" in the UI
        await waitFor(() => {
          const habrBadge = screen.queryByText(/Хабр/);
          expect(habrBadge).toBeInTheDocument();
        });
      });

      it('should not show source badge for unknown URLs', async () => {
        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://example.com/resume');
        expect(screen.queryByText('HeadHunter')).not.toBeInTheDocument();
        expect(screen.queryByText('LinkedIn')).not.toBeInTheDocument();
      });

      it('should disable parse button when URL is empty', () => {
        renderResumeModal();
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        expect(parseButton).toBeDisabled();
      });

      it('should disable parse button for invalid URL', async () => {
        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'not-a-valid-url');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        expect(parseButton).toBeDisabled();
      });

      it('should enable parse button for valid URL', async () => {
        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        expect(parseButton).not.toBeDisabled();
      });
    });

    describe('Parsing Loading State', () => {
      it('should show loading state while parsing', async () => {
        (parseResumeFromUrl as ReturnType<typeof vi.fn>).mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(mockParsedResume), 100))
        );

        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        expect(await screen.findByText('Загрузка...')).toBeInTheDocument();
      });

      it('should disable parse button during loading', async () => {
        (parseResumeFromUrl as ReturnType<typeof vi.fn>).mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(mockParsedResume), 100))
        );

        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(parseButton).toBeDisabled();
        });
      });

      it('should disable URL input during loading', async () => {
        (parseResumeFromUrl as ReturnType<typeof vi.fn>).mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(mockParsedResume), 100))
        );

        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(urlInput).toBeDisabled();
        });
      });
    });

    describe('Parsed Data Preview', () => {
      it('should show parsed resume data after parsing', async () => {
        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(screen.getByText('Распознано:')).toBeInTheDocument();
        });
      });

      it('should show create contact button after parsing', async () => {
        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(screen.getByText('Создать контакт')).toBeInTheDocument();
        });
      });

      it('should call parseResumeFromUrl with correct URL', async () => {
        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(parseResumeFromUrl).toHaveBeenCalledWith('https://hh.ru/resume/abc123');
        });
      });
    });

    describe('Create Entity from Parsed Data', () => {
      it('should call onParsed when creating entity', async () => {
        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(screen.getByText('Создать контакт')).toBeInTheDocument();
        });

        const createButton = screen.getByText('Создать контакт');
        fireEvent.click(createButton);

        await waitFor(() => {
          expect(mockOnParsed).toHaveBeenCalledWith(mockParsedResume);
        });
      });

      it('should show error and not call onParsed when name is empty', async () => {
        const resumeWithoutName = { ...mockParsedResume, name: '' };
        (parseResumeFromUrl as ReturnType<typeof vi.fn>).mockResolvedValue(resumeWithoutName);

        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(screen.getByText('Создать контакт')).toBeInTheDocument();
        });

        const createButton = screen.getByText('Создать контакт');
        fireEvent.click(createButton);

        expect(toast.error).toHaveBeenCalledWith('Имя контакта обязательно');
        expect(mockOnParsed).not.toHaveBeenCalled();
      });
    });

    describe('File Upload Tab', () => {
      it('should switch to file upload tab when clicked', async () => {
        renderResumeModal();
        const fileTab = screen.getByText('Загрузить файл');
        await userEvent.click(fileTab);
        expect(screen.getByText(/Перетащите файл сюда/i)).toBeInTheDocument();
      });

      it('should display file type restrictions', async () => {
        renderResumeModal();
        const fileTab = screen.getByText('Загрузить файл');
        await userEvent.click(fileTab);
        expect(screen.getByText(/PDF, DOC, DOCX или TXT/i)).toBeInTheDocument();
      });

      it('should handle file input change', async () => {
        renderResumeModal();
        const fileTab = screen.getByText('Загрузить файл');
        await userEvent.click(fileTab);

        // Find the hidden file input
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        expect(fileInput).toBeInTheDocument();

        const file = new File(['resume content'], 'resume.pdf', { type: 'application/pdf' });
        await userEvent.upload(fileInput, file);

        await waitFor(() => {
          expect(parseResumeFromFile).toHaveBeenCalled();
        });
      });

      it('should show error for unsupported file type', async () => {
        renderResumeModal();
        const fileTab = screen.getByText('Загрузить файл');
        await userEvent.click(fileTab);

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(['content'], 'image.exe', { type: 'application/octet-stream' });

        // Create a mock event with the file
        Object.defineProperty(fileInput, 'files', {
          value: [file],
          configurable: true,
        });
        fireEvent.change(fileInput);

        await waitFor(() => {
          expect(screen.getByText(/Поддерживаются только PDF, DOC, DOCX и TXT файлы/i)).toBeInTheDocument();
        });
      });

      it('should show error for file size exceeding 10MB', async () => {
        renderResumeModal();
        const fileTab = screen.getByText('Загрузить файл');
        await userEvent.click(fileTab);

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        // Create a file larger than 10MB
        const largeContent = new Array(11 * 1024 * 1024).fill('a').join('');
        const file = new File([largeContent], 'large.pdf', { type: 'application/pdf' });

        Object.defineProperty(fileInput, 'files', {
          value: [file],
          configurable: true,
        });
        fireEvent.change(fileInput);

        await waitFor(() => {
          expect(screen.getByText(/Размер файла не должен превышать 10 МБ/i)).toBeInTheDocument();
        });
      });

      it('should show loading state during file processing', async () => {
        (parseResumeFromFile as ReturnType<typeof vi.fn>).mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(mockParsedResume), 100))
        );

        renderResumeModal();
        const fileTab = screen.getByText('Загрузить файл');
        await userEvent.click(fileTab);

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(['resume content'], 'resume.pdf', { type: 'application/pdf' });
        await userEvent.upload(fileInput, file);

        expect(await screen.findByText('Обработка файла...')).toBeInTheDocument();
      });
    });

    describe('Error Handling', () => {
      it('should show error message when parsing fails', async () => {
        (parseResumeFromUrl as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error('Network error')
        );

        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(screen.getByText('Network error')).toBeInTheDocument();
        });
        expect(toast.error).toHaveBeenCalledWith('Ошибка распознавания');
      });

      it('should show generic error for non-Error exceptions', async () => {
        (parseResumeFromUrl as ReturnType<typeof vi.fn>).mockRejectedValue('Unknown error');

        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(screen.getByText('Ошибка парсинга')).toBeInTheDocument();
        });
      });

      it('should clear error when typing new URL', async () => {
        (parseResumeFromUrl as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error('Network error')
        );

        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(screen.getByText('Network error')).toBeInTheDocument();
        });

        // Type new URL
        await userEvent.clear(urlInput);
        await userEvent.type(urlInput, 'https://hh.ru/resume/xyz789');

        expect(screen.queryByText('Network error')).not.toBeInTheDocument();
      });
    });

    describe('Keyboard Navigation', () => {
      it('should parse on Enter key when URL is valid', async () => {
        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        await userEvent.keyboard('{Enter}');

        await waitFor(() => {
          expect(parseResumeFromUrl).toHaveBeenCalled();
        });
      });

      it('should not parse on Enter when URL is invalid', async () => {
        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'not-a-url');
        await userEvent.keyboard('{Enter}');

        expect(parseResumeFromUrl).not.toHaveBeenCalled();
      });
    });

    describe('Modal Interactions', () => {
      it('should close modal when clicking cancel button', async () => {
        renderResumeModal();
        const cancelButton = screen.getByText('Отмена');
        await userEvent.click(cancelButton);
        expect(mockOnClose).toHaveBeenCalledTimes(1);
      });

      it('should close modal when clicking X button', async () => {
        renderResumeModal();
        // Find the X button (it's the one with just an X icon)
        const closeButtons = screen.getAllByRole('button');
        const xButton = closeButtons.find(btn => btn.querySelector('svg'));
        if (xButton && xButton !== screen.getByRole('button', { name: /Парсить/i })) {
          await userEvent.click(xButton);
          expect(mockOnClose).toHaveBeenCalled();
        }
      });

      it('should close modal when clicking backdrop', async () => {
        renderResumeModal();
        // Find the backdrop (the outer container)
        const backdrop = document.querySelector('.fixed.inset-0');
        if (backdrop) {
          fireEvent.click(backdrop);
          expect(mockOnClose).toHaveBeenCalled();
        }
      });
    });

    describe('Tab Switching', () => {
      it('should clear error when switching tabs', async () => {
        (parseResumeFromUrl as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error('Network error')
        );

        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(screen.getByText('Network error')).toBeInTheDocument();
        });

        // Switch to file tab
        const fileTab = screen.getByText('Загрузить файл');
        await userEvent.click(fileTab);

        expect(screen.queryByText('Network error')).not.toBeInTheDocument();
      });

      it('should clear parsed data when switching tabs', async () => {
        renderResumeModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/resume/123456');
        await userEvent.type(urlInput, 'https://hh.ru/resume/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(screen.getByText('Распознано:')).toBeInTheDocument();
        });

        // Switch to file tab
        const fileTab = screen.getByText('Загрузить файл');
        await userEvent.click(fileTab);

        expect(screen.queryByText('Распознано:')).not.toBeInTheDocument();
      });
    });
  });

  describe('Vacancy Parser Modal', () => {
    const renderVacancyModal = () => {
      return render(
        <ParserModal type="vacancy" onClose={mockOnClose} onParsed={mockOnParsed} />
      );
    };

    describe('Rendering', () => {
      it('should render vacancy parser modal with correct title', () => {
        renderVacancyModal();
        expect(screen.getByText('Парсинг вакансии')).toBeInTheDocument();
      });

      it('should show vacancy URL placeholder', () => {
        renderVacancyModal();
        expect(screen.getByPlaceholderText('https://hh.ru/vacancy/123456')).toBeInTheDocument();
      });

      it('should NOT show file upload tab for vacancy', () => {
        renderVacancyModal();
        expect(screen.queryByText('Загрузить файл')).not.toBeInTheDocument();
      });
    });

    describe('Create Vacancy from Parsed Data', () => {
      it('should call onParsed when creating vacancy', async () => {
        renderVacancyModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/vacancy/123456');
        await userEvent.type(urlInput, 'https://hh.ru/vacancy/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(screen.getByText('Создать вакансию')).toBeInTheDocument();
        });

        const createButton = screen.getByText('Создать вакансию');
        fireEvent.click(createButton);

        await waitFor(() => {
          expect(mockOnParsed).toHaveBeenCalledWith(mockParsedVacancy);
        });
      });

      it('should show error when vacancy title is empty', async () => {
        const vacancyWithoutTitle = { ...mockParsedVacancy, title: '' };
        (parseVacancyFromUrl as ReturnType<typeof vi.fn>).mockResolvedValue(vacancyWithoutTitle);

        renderVacancyModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/vacancy/123456');
        await userEvent.type(urlInput, 'https://hh.ru/vacancy/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(screen.getByText('Создать вакансию')).toBeInTheDocument();
        });

        const createButton = screen.getByText('Создать вакансию');
        fireEvent.click(createButton);

        expect(toast.error).toHaveBeenCalledWith('Название вакансии обязательно');
        expect(mockOnParsed).not.toHaveBeenCalled();
      });

      it('should call parseVacancyFromUrl with correct URL', async () => {
        renderVacancyModal();
        const urlInput = screen.getByPlaceholderText('https://hh.ru/vacancy/123456');
        await userEvent.type(urlInput, 'https://hh.ru/vacancy/abc123');
        const parseButton = screen.getByRole('button', { name: /Парсить/i });
        fireEvent.click(parseButton);

        await waitFor(() => {
          expect(parseVacancyFromUrl).toHaveBeenCalledWith('https://hh.ru/vacancy/abc123');
        });
      });
    });
  });
});
