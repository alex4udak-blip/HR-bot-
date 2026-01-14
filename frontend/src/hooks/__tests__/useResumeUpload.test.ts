import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useResumeUpload,
  SUPPORTED_FILE_TYPES,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE,
} from '../useResumeUpload';
import * as api from '@/services/api';

/**
 * Tests for useResumeUpload hook
 * Verifies file validation, upload queue management, and API integration
 */

// Mock the API module
vi.mock('@/services/api', () => ({
  parseResumeFromFile: vi.fn(),
  createEntityFromResume: vi.fn(),
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

describe('useResumeUpload', () => {
  const mockParseResumeFromFile = api.parseResumeFromFile as ReturnType<typeof vi.fn>;
  const mockCreateEntityFromResume = api.createEntityFromResume as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Initial state', () => {
    it('should initialize with empty files array', () => {
      const { result } = renderHook(() => useResumeUpload());

      expect(result.current.files).toEqual([]);
      expect(result.current.isUploading).toBe(false);
      expect(result.current.overallProgress).toBe(0);
      expect(result.current.successCount).toBe(0);
      expect(result.current.errorCount).toBe(0);
    });
  });

  describe('validateFile', () => {
    it('should accept valid PDF file', () => {
      const { result } = renderHook(() => useResumeUpload());
      const file = createMockFile('resume.pdf', 1024, 'application/pdf');

      const error = result.current.validateFile(file);

      expect(error).toBeNull();
    });

    it('should accept valid DOC file', () => {
      const { result } = renderHook(() => useResumeUpload());
      const file = createMockFile('resume.doc', 1024, 'application/msword');

      const error = result.current.validateFile(file);

      expect(error).toBeNull();
    });

    it('should accept valid DOCX file', () => {
      const { result } = renderHook(() => useResumeUpload());
      const file = createMockFile(
        'resume.docx',
        1024,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );

      const error = result.current.validateFile(file);

      expect(error).toBeNull();
    });

    it('should reject file by extension if MIME type is unknown', () => {
      const { result } = renderHook(() => useResumeUpload());
      // File with .pdf extension but unknown MIME type should pass by extension
      const file = createMockFile('resume.pdf', 1024, 'application/octet-stream');

      const error = result.current.validateFile(file);

      expect(error).toBeNull();
    });

    it('should reject unsupported file type', () => {
      const { result } = renderHook(() => useResumeUpload());
      const file = createMockFile('image.jpg', 1024, 'image/jpeg');

      const error = result.current.validateFile(file);

      expect(error).not.toBeNull();
      expect(error?.code).toBe('invalid_type');
    });

    it('should reject file exceeding size limit', () => {
      const { result } = renderHook(() => useResumeUpload());
      const file = createMockFile('resume.pdf', MAX_FILE_SIZE + 1);

      const error = result.current.validateFile(file);

      expect(error).not.toBeNull();
      expect(error?.code).toBe('file_too_large');
    });

    it('should reject empty file', () => {
      const { result } = renderHook(() => useResumeUpload());
      const file = createMockFile('resume.pdf', 0);

      const error = result.current.validateFile(file);

      expect(error).not.toBeNull();
      expect(error?.code).toBe('empty_file');
    });
  });

  describe('addFiles', () => {
    it('should add valid files to queue', () => {
      const { result } = renderHook(() => useResumeUpload());
      const file = createMockFile('resume.pdf');

      act(() => {
        const errors = result.current.addFiles([file]);
        expect(errors).toHaveLength(0);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].file).toBe(file);
      expect(result.current.files[0].status).toBe('pending');
    });

    it('should return validation errors for invalid files', () => {
      const { result } = renderHook(() => useResumeUpload());
      const invalidFile = createMockFile('image.jpg', 1024, 'image/jpeg');
      const validFile = createMockFile('resume.pdf');

      act(() => {
        const errors = result.current.addFiles([invalidFile, validFile]);
        expect(errors).toHaveLength(1);
        expect(errors[0].file).toBe(invalidFile);
      });

      // Only valid file should be added
      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].file).toBe(validFile);
    });

    it('should handle multiple valid files', () => {
      const { result } = renderHook(() => useResumeUpload());
      const file1 = createMockFile('resume1.pdf');
      const file2 = createMockFile('resume2.docx', 1024, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

      act(() => {
        result.current.addFiles([file1, file2]);
      });

      expect(result.current.files).toHaveLength(2);
    });

    it('should generate unique IDs for each file', () => {
      const { result } = renderHook(() => useResumeUpload());
      const file1 = createMockFile('resume1.pdf');
      const file2 = createMockFile('resume2.pdf');

      act(() => {
        result.current.addFiles([file1, file2]);
      });

      const ids = result.current.files.map(f => f.id);
      expect(new Set(ids).size).toBe(2);
    });
  });

  describe('removeFile', () => {
    it('should remove file from queue by ID', () => {
      const { result } = renderHook(() => useResumeUpload());
      const file1 = createMockFile('resume1.pdf');
      const file2 = createMockFile('resume2.pdf');

      act(() => {
        result.current.addFiles([file1, file2]);
      });

      const fileIdToRemove = result.current.files[0].id;

      act(() => {
        result.current.removeFile(fileIdToRemove);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].file).toBe(file2);
    });

    it('should do nothing for non-existent ID', () => {
      const { result } = renderHook(() => useResumeUpload());
      const file = createMockFile('resume.pdf');

      act(() => {
        result.current.addFiles([file]);
      });

      act(() => {
        result.current.removeFile('non-existent-id');
      });

      expect(result.current.files).toHaveLength(1);
    });
  });

  describe('clearFiles', () => {
    it('should remove all files from queue', () => {
      const { result } = renderHook(() => useResumeUpload());

      act(() => {
        result.current.addFiles([
          createMockFile('resume1.pdf'),
          createMockFile('resume2.pdf'),
        ]);
      });

      expect(result.current.files).toHaveLength(2);

      act(() => {
        result.current.clearFiles();
      });

      expect(result.current.files).toHaveLength(0);
    });
  });

  describe('uploadFile', () => {
    it('should upload and parse file successfully', async () => {
      const parsedData = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+1234567890',
        skills: ['JavaScript', 'TypeScript'],
        salary_currency: 'RUB',
      };
      mockParseResumeFromFile.mockResolvedValueOnce(parsedData);

      const { result } = renderHook(() => useResumeUpload());
      const file = createMockFile('resume.pdf');

      act(() => {
        result.current.addFiles([file]);
      });

      const fileId = result.current.files[0].id;

      await act(async () => {
        vi.advanceTimersByTime(500);
        const returnedData = await result.current.uploadFile(fileId);
        expect(returnedData).toEqual(parsedData);
      });

      expect(result.current.files[0].status).toBe('done');
      expect(result.current.files[0].parsedData).toEqual(parsedData);
      expect(result.current.files[0].progress).toBe(100);
    });

    it('should handle upload errors', async () => {
      mockParseResumeFromFile.mockRejectedValueOnce(new Error('Parse failed'));

      const { result } = renderHook(() => useResumeUpload());
      const file = createMockFile('resume.pdf');

      act(() => {
        result.current.addFiles([file]);
      });

      const fileId = result.current.files[0].id;

      await act(async () => {
        const returnedData = await result.current.uploadFile(fileId);
        expect(returnedData).toBeNull();
      });

      expect(result.current.files[0].status).toBe('error');
      expect(result.current.files[0].error).toBe('Parse failed');
    });

    it('should return null for non-existent file ID', async () => {
      const { result } = renderHook(() => useResumeUpload());

      await act(async () => {
        const returnedData = await result.current.uploadFile('non-existent');
        expect(returnedData).toBeNull();
      });
    });
  });

  describe('uploadAll', () => {
    it('should upload all pending files', async () => {
      const parsedData = { name: 'Test', skills: [], salary_currency: 'RUB' };
      mockParseResumeFromFile.mockResolvedValue(parsedData);

      const { result } = renderHook(() => useResumeUpload());

      act(() => {
        result.current.addFiles([
          createMockFile('resume1.pdf'),
          createMockFile('resume2.pdf'),
        ]);
      });

      await act(async () => {
        await result.current.uploadAll();
      });

      expect(mockParseResumeFromFile).toHaveBeenCalledTimes(2);
      expect(result.current.files.every(f => f.status === 'done')).toBe(true);
    });

    it('should do nothing if no pending files', async () => {
      const { result } = renderHook(() => useResumeUpload());

      await act(async () => {
        await result.current.uploadAll();
      });

      expect(mockParseResumeFromFile).not.toHaveBeenCalled();
    });
  });

  describe('createEntity', () => {
    it('should create entity from parsed resume', async () => {
      const parsedData = {
        name: 'John Doe',
        email: 'john@example.com',
        skills: [],
        salary_currency: 'RUB',
      };
      mockParseResumeFromFile.mockResolvedValueOnce(parsedData);
      mockCreateEntityFromResume.mockResolvedValueOnce({
        entity_id: 123,
        parsed_data: parsedData,
        message: 'Created',
      });

      const { result } = renderHook(() => useResumeUpload());

      act(() => {
        result.current.addFiles([createMockFile('resume.pdf')]);
      });

      const fileId = result.current.files[0].id;

      // First upload the file
      await act(async () => {
        await result.current.uploadFile(fileId);
      });

      // Then create entity
      await act(async () => {
        const entityId = await result.current.createEntity(fileId);
        expect(entityId).toBe(123);
      });

      expect(result.current.files[0].entityId).toBe(123);
    });

    it('should return null if file not parsed yet', async () => {
      const { result } = renderHook(() => useResumeUpload());

      act(() => {
        result.current.addFiles([createMockFile('resume.pdf')]);
      });

      const fileId = result.current.files[0].id;

      await act(async () => {
        const entityId = await result.current.createEntity(fileId);
        expect(entityId).toBeNull();
      });
    });
  });

  describe('Progress tracking', () => {
    it('should calculate overall progress correctly', async () => {
      mockParseResumeFromFile.mockResolvedValue({ name: 'Test', skills: [], salary_currency: 'RUB' });

      const { result } = renderHook(() => useResumeUpload());

      act(() => {
        result.current.addFiles([
          createMockFile('resume1.pdf'),
          createMockFile('resume2.pdf'),
        ]);
      });

      expect(result.current.overallProgress).toBe(0);

      await act(async () => {
        await result.current.uploadAll();
      });

      expect(result.current.overallProgress).toBe(100);
    });

    it('should count successes and errors correctly', async () => {
      mockParseResumeFromFile
        .mockResolvedValueOnce({ name: 'Test', skills: [], salary_currency: 'RUB' })
        .mockRejectedValueOnce(new Error('Failed'));

      const { result } = renderHook(() => useResumeUpload());

      act(() => {
        result.current.addFiles([
          createMockFile('resume1.pdf'),
          createMockFile('resume2.pdf'),
        ]);
      });

      await act(async () => {
        await result.current.uploadAll();
      });

      expect(result.current.successCount).toBe(1);
      expect(result.current.errorCount).toBe(1);
    });
  });

  describe('Constants', () => {
    it('should export correct supported file types', () => {
      expect(SUPPORTED_FILE_TYPES).toContain('application/pdf');
      expect(SUPPORTED_FILE_TYPES).toContain('application/msword');
      expect(SUPPORTED_FILE_TYPES).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    });

    it('should export correct supported extensions', () => {
      expect(SUPPORTED_EXTENSIONS).toContain('.pdf');
      expect(SUPPORTED_EXTENSIONS).toContain('.doc');
      expect(SUPPORTED_EXTENSIONS).toContain('.docx');
    });

    it('should export correct max file size (10MB)', () => {
      expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
    });
  });
});
