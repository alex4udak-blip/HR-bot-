import { useState, useCallback, useRef } from 'react';
import { parseResumeFromFile, createEntityFromResume, type ParsedResume } from '@/services/api';

/**
 * Supported file types for resume upload
 */
export const SUPPORTED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/**
 * Supported file extensions
 */
export const SUPPORTED_EXTENSIONS = ['.pdf', '.doc', '.docx'];

/**
 * Maximum file size in bytes (10MB)
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Individual file upload state
 */
export interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'parsing' | 'done' | 'error';
  error?: string;
  parsedData?: ParsedResume;
  entityId?: number;
}

/**
 * Validation error structure
 */
export interface FileValidationError {
  file: File;
  error: string;
  code: 'invalid_type' | 'file_too_large' | 'empty_file';
}

/**
 * Return type for useResumeUpload hook
 */
export interface UseResumeUploadReturn {
  /** List of files being uploaded */
  files: UploadingFile[];
  /** Whether any upload is in progress */
  isUploading: boolean;
  /** Add files to upload queue */
  addFiles: (files: FileList | File[]) => FileValidationError[];
  /** Remove file from queue */
  removeFile: (id: string) => void;
  /** Clear all files */
  clearFiles: () => void;
  /** Start uploading all pending files */
  uploadAll: () => Promise<void>;
  /** Upload a single file */
  uploadFile: (id: string) => Promise<ParsedResume | null>;
  /** Create entity from parsed resume */
  createEntity: (id: string) => Promise<number | null>;
  /** Validate a single file */
  validateFile: (file: File) => FileValidationError | null;
  /** Overall progress (0-100) */
  overallProgress: number;
  /** Number of successfully parsed files */
  successCount: number;
  /** Number of failed files */
  errorCount: number;
}

/**
 * Generate unique ID for file tracking
 */
const generateFileId = (): string => {
  return `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Check if file type is supported
 */
const isFileTypeSupported = (file: File): boolean => {
  // Check MIME type
  if (SUPPORTED_FILE_TYPES.includes(file.type)) {
    return true;
  }

  // Fallback to extension check
  const fileName = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => fileName.endsWith(ext));
};

/**
 * Get human-readable file type error message
 */
const getFileTypeErrorMessage = (): string => {
  return `Поддерживаются только файлы: ${SUPPORTED_EXTENSIONS.join(', ')}`;
};

/**
 * Get human-readable file size error message
 */
const getFileSizeErrorMessage = (maxSize: number): string => {
  const maxSizeMB = Math.round(maxSize / (1024 * 1024));
  return `Максимальный размер файла: ${maxSizeMB} МБ`;
};

/**
 * Hook for managing resume file uploads with parsing.
 *
 * Features:
 * - Multi-file upload support
 * - File type and size validation
 * - Upload progress tracking
 * - Resume parsing via API
 * - Entity creation from parsed data
 *
 * @example
 * ```tsx
 * const {
 *   files,
 *   addFiles,
 *   uploadAll,
 *   removeFile,
 *   isUploading,
 *   overallProgress
 * } = useResumeUpload();
 *
 * // Add files from input
 * const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
 *   if (e.target.files) {
 *     const errors = addFiles(e.target.files);
 *     if (errors.length > 0) {
 *       // Show validation errors
 *     }
 *   }
 * };
 *
 * // Start upload
 * await uploadAll();
 * ```
 */
export function useResumeUpload(): UseResumeUploadReturn {
  const [files, setFiles] = useState<UploadingFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Track mounted state
  const isMountedRef = useRef(true);

  /**
   * Validate a single file
   */
  const validateFile = useCallback((file: File): FileValidationError | null => {
    // Check for empty file
    if (file.size === 0) {
      return {
        file,
        error: 'Файл пустой',
        code: 'empty_file',
      };
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return {
        file,
        error: getFileSizeErrorMessage(MAX_FILE_SIZE),
        code: 'file_too_large',
      };
    }

    // Check file type
    if (!isFileTypeSupported(file)) {
      return {
        file,
        error: getFileTypeErrorMessage(),
        code: 'invalid_type',
      };
    }

    return null;
  }, []);

  /**
   * Add files to upload queue with validation
   */
  const addFiles = useCallback((fileList: FileList | File[]): FileValidationError[] => {
    const filesToAdd = Array.from(fileList);
    const validationErrors: FileValidationError[] = [];
    const validFiles: UploadingFile[] = [];

    for (const file of filesToAdd) {
      const validationError = validateFile(file);
      if (validationError) {
        validationErrors.push(validationError);
      } else {
        validFiles.push({
          id: generateFileId(),
          file,
          progress: 0,
          status: 'pending',
        });
      }
    }

    if (validFiles.length > 0) {
      setFiles(prev => [...prev, ...validFiles]);
    }

    return validationErrors;
  }, [validateFile]);

  /**
   * Remove file from queue
   */
  const removeFile = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  /**
   * Clear all files from queue
   */
  const clearFiles = useCallback(() => {
    setFiles([]);
  }, []);

  /**
   * Update file state by ID
   */
  const updateFile = useCallback((id: string, updates: Partial<UploadingFile>) => {
    if (!isMountedRef.current) return;
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, ...updates } : f
    ));
  }, []);

  /**
   * Upload and parse a single file
   */
  const uploadFile = useCallback(async (id: string): Promise<ParsedResume | null> => {
    const fileEntry = files.find(f => f.id === id);
    if (!fileEntry) return null;

    try {
      // Set uploading status
      updateFile(id, { status: 'uploading', progress: 10 });

      // Simulate upload progress (actual upload is handled by API)
      const progressInterval = setInterval(() => {
        setFiles(prev => {
          const file = prev.find(f => f.id === id);
          if (file && file.progress < 50 && file.status === 'uploading') {
            return prev.map(f => f.id === id ? { ...f, progress: f.progress + 10 } : f);
          }
          return prev;
        });
      }, 200);

      // Update to parsing status
      updateFile(id, { status: 'parsing', progress: 60 });

      // Parse resume via API
      const parsedData = await parseResumeFromFile(fileEntry.file);

      clearInterval(progressInterval);

      // Update with parsed data
      updateFile(id, {
        status: 'done',
        progress: 100,
        parsedData
      });

      return parsedData;
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : 'Ошибка при парсинге резюме';

      updateFile(id, {
        status: 'error',
        error: errorMessage,
        progress: 0
      });

      return null;
    }
  }, [files, updateFile]);

  /**
   * Upload all pending files
   */
  const uploadAll = useCallback(async () => {
    const pendingFiles = files.filter(f => f.status === 'pending');
    if (pendingFiles.length === 0) return;

    setIsUploading(true);

    try {
      // Upload files in parallel (max 3 at a time)
      const batchSize = 3;
      for (let i = 0; i < pendingFiles.length; i += batchSize) {
        const batch = pendingFiles.slice(i, i + batchSize);
        await Promise.all(batch.map(f => uploadFile(f.id)));
      }
    } finally {
      if (isMountedRef.current) {
        setIsUploading(false);
      }
    }
  }, [files, uploadFile]);

  /**
   * Create entity from parsed resume data
   */
  const createEntity = useCallback(async (id: string): Promise<number | null> => {
    const fileEntry = files.find(f => f.id === id);
    if (!fileEntry || fileEntry.status !== 'done' || !fileEntry.parsedData) {
      return null;
    }

    try {
      const result = await createEntityFromResume(fileEntry.file);
      updateFile(id, { entityId: result.entity_id });
      return result.entity_id;
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : 'Ошибка при создании кандидата';

      updateFile(id, { error: errorMessage });
      return null;
    }
  }, [files, updateFile]);

  // Calculate overall progress
  const overallProgress = files.length === 0
    ? 0
    : Math.round(files.reduce((sum, f) => sum + f.progress, 0) / files.length);

  // Count successes and errors
  const successCount = files.filter(f => f.status === 'done').length;
  const errorCount = files.filter(f => f.status === 'error').length;

  return {
    files,
    isUploading,
    addFiles,
    removeFile,
    clearFiles,
    uploadAll,
    uploadFile,
    createEntity,
    validateFile,
    overallProgress,
    successCount,
    errorCount,
  };
}

export default useResumeUpload;
