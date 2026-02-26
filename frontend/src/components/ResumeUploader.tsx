import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  FileText,
  File,
  X,
  CheckCircle,
  AlertCircle,
  Loader2,
  Trash2,
  User,
  Mail,
  Phone,
  Briefcase,
  MapPin,
  DollarSign,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import {
  useResumeUpload,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE,
  type UploadingFile,
  type FileValidationError,
} from '@/hooks/useResumeUpload';
import type { ParsedResume } from '@/services/api';

/**
 * Props for ResumeUploader component
 */
interface ResumeUploaderProps {
  /** Called when a resume is successfully parsed */
  onParsed?: (file: UploadingFile, data: ParsedResume) => void;
  /** Called when an entity is created from resume */
  onEntityCreated?: (entityId: number) => void;
  /** Whether to show the "Create candidate" button */
  showCreateEntity?: boolean;
  /** Maximum number of files to accept (0 = unlimited) */
  maxFiles?: number;
  /** Custom class name for the container */
  className?: string;
  /** Disable the uploader */
  disabled?: boolean;
}

/**
 * Format file size for display
 */
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Б';
  const k = 1024;
  const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

/**
 * Get icon component for file type
 */
const getFileIcon = (fileName: string) => {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'pdf') {
    return <FileText className="w-8 h-8 text-red-400" />;
  }
  if (ext === 'doc' || ext === 'docx') {
    return <FileText className="w-8 h-8 text-blue-400" />;
  }
  return <File className="w-8 h-8 text-gray-400" />;
};

/**
 * Get status icon for upload state
 */
const getStatusIcon = (status: UploadingFile['status']) => {
  switch (status) {
    case 'done':
      return <CheckCircle className="w-5 h-5 text-green-400" />;
    case 'error':
      return <AlertCircle className="w-5 h-5 text-red-400" />;
    case 'uploading':
    case 'parsing':
      return <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />;
    default:
      return null;
  }
};

/**
 * Get status text for upload state
 */
const getStatusText = (status: UploadingFile['status']): string => {
  switch (status) {
    case 'pending':
      return 'Ожидает загрузки';
    case 'uploading':
      return 'Загрузка...';
    case 'parsing':
      return 'Парсинг резюме...';
    case 'done':
      return 'Готово';
    case 'error':
      return 'Ошибка';
    default:
      return '';
  }
};

/**
 * Parsed data preview component
 */
function ParsedDataPreview({ data }: { data: ParsedResume }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-3 p-3 glass-light rounded-lg space-y-2"
    >
      {data.name && (
        <div className="flex items-center gap-2 text-sm">
          <User size={14} className="text-white/40" />
          <span className="font-medium">{data.name}</span>
        </div>
      )}
      {data.email && (
        <div className="flex items-center gap-2 text-sm text-white/70">
          <Mail size={14} className="text-white/40" />
          <span>{data.email}</span>
        </div>
      )}
      {data.phone && (
        <div className="flex items-center gap-2 text-sm text-white/70">
          <Phone size={14} className="text-white/40" />
          <span>{data.phone}</span>
        </div>
      )}
      {data.position && (
        <div className="flex items-center gap-2 text-sm text-white/70">
          <Briefcase size={14} className="text-white/40" />
          <span>{data.position}</span>
          {data.company && <span className="text-white/50">@ {data.company}</span>}
        </div>
      )}
      {data.location && (
        <div className="flex items-center gap-2 text-sm text-white/70">
          <MapPin size={14} className="text-white/40" />
          <span>{data.location}</span>
        </div>
      )}
      {(data.salary_min || data.salary_max) && (
        <div className="flex items-center gap-2 text-sm text-white/70">
          <DollarSign size={14} className="text-white/40" />
          <span>
            {data.salary_min && data.salary_max
              ? `${data.salary_min.toLocaleString()} - ${data.salary_max.toLocaleString()}`
              : data.salary_min
                ? `от ${data.salary_min.toLocaleString()}`
                : `до ${data.salary_max?.toLocaleString()}`}
            {' '}{data.salary_currency}
          </span>
        </div>
      )}
      {data.skills && data.skills.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {data.skills.slice(0, 6).map((skill, index) => (
            <span
              key={index}
              className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-300 rounded"
            >
              {skill}
            </span>
          ))}
          {data.skills.length > 6 && (
            <span className="px-2 py-0.5 text-xs text-white/40">
              +{data.skills.length - 6}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}

/**
 * Single file item component
 */
function FileItem({
  file,
  onRemove,
  onCreateEntity,
  showCreateEntity,
  isCreatingEntity,
}: {
  file: UploadingFile;
  onRemove: () => void;
  onCreateEntity?: () => void;
  showCreateEntity?: boolean;
  isCreatingEntity?: boolean;
}) {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={clsx(
        'p-4 rounded-xl border transition-colors',
        file.status === 'error'
          ? 'bg-red-500/10 border-red-500/30'
          : file.status === 'done'
            ? 'bg-green-500/10 border-green-500/30'
            : 'glass-light border-white/10'
      )}
    >
      <div className="flex items-start gap-3">
        {/* File icon */}
        <div className="flex-shrink-0 p-2 glass-light rounded-lg">
          {getFileIcon(file.file.name)}
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium truncate">{file.file.name}</p>
            {getStatusIcon(file.status)}
          </div>
          <p className="text-sm text-white/40 mt-0.5">
            {formatFileSize(file.file.size)} • {getStatusText(file.status)}
          </p>
          {file.error && (
            <p className="text-sm text-red-400 mt-1">{file.error}</p>
          )}

          {/* Progress bar */}
          {(file.status === 'uploading' || file.status === 'parsing') && (
            <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-blue-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${file.progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          )}

          {/* Parsed data toggle */}
          {file.status === 'done' && file.parsedData && (
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="mt-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              {showPreview ? 'Скрыть данные' : 'Показать данные'}
            </button>
          )}

          {/* Parsed data preview */}
          <AnimatePresence>
            {showPreview && file.parsedData && (
              <ParsedDataPreview data={file.parsedData} />
            )}
          </AnimatePresence>

          {/* Create entity button */}
          {showCreateEntity && file.status === 'done' && file.parsedData && !file.entityId && (
            <button
              onClick={onCreateEntity}
              disabled={isCreatingEntity}
              className={clsx(
                'mt-3 flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
                'bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed'
              )}
              aria-busy={isCreatingEntity}
            >
              {isCreatingEntity ? (
                <>
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  Создание...
                </>
              ) : (
                <>
                  <User size={16} aria-hidden="true" />
                  Создать кандидата
                </>
              )}
            </button>
          )}

          {/* Entity created indicator */}
          {file.entityId && (
            <div className="mt-2 flex items-center gap-2 text-sm text-green-400" role="status">
              <CheckCircle size={16} aria-hidden="true" />
              Кандидат создан (ID: {file.entityId})
            </div>
          )}
        </div>

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="flex-shrink-0 p-2 hover:bg-white/10 rounded-lg transition-colors text-white/40 hover:text-white"
          aria-label={`Удалить файл ${file.file.name}`}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </motion.div>
  );
}

/**
 * Drag & Drop Resume Uploader Component
 *
 * Features:
 * - Drag & drop zone for files
 * - Visual indication on drag over
 * - Upload progress tracking
 * - Parsed resume preview
 * - Multi-file upload support
 * - File type and size validation
 * - Optional entity creation
 */
export default function ResumeUploader({
  onParsed,
  onEntityCreated,
  showCreateEntity = false,
  maxFiles = 0,
  className,
  disabled = false,
}: ResumeUploaderProps) {
  const {
    files,
    isUploading,
    addFiles,
    removeFile,
    clearFiles,
    uploadAll,
    createEntity,
    overallProgress,
    successCount,
    errorCount,
  } = useResumeUpload();

  const [isDragging, setIsDragging] = useState(false);
  const [creatingEntityIds, setCreatingEntityIds] = useState<Set<string>>(new Set());
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  // Auto-upload when files are added
  const [autoUpload] = useState(true);

  // Handle validation errors
  const handleValidationErrors = useCallback((errors: FileValidationError[]) => {
    errors.forEach(error => {
      toast.error(`${error.file.name}: ${error.error}`);
    });
  }, []);

  // Handle file input change
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    // Check max files limit
    if (maxFiles > 0 && files.length + fileList.length > maxFiles) {
      toast.error(`Максимум ${maxFiles} файлов`);
      return;
    }

    const errors = addFiles(fileList);
    handleValidationErrors(errors);

    // Reset input
    e.target.value = '';
  }, [files.length, maxFiles, addFiles, handleValidationErrors]);

  // Drag event handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    if (disabled) return;

    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;

    // Check max files limit
    if (maxFiles > 0 && files.length + droppedFiles.length > maxFiles) {
      toast.error(`Максимум ${maxFiles} файлов`);
      return;
    }

    const errors = addFiles(droppedFiles);
    handleValidationErrors(errors);
  }, [disabled, files.length, maxFiles, addFiles, handleValidationErrors]);

  // Auto-upload effect
  useEffect(() => {
    if (autoUpload && files.some(f => f.status === 'pending') && !isUploading) {
      uploadAll();
    }
  }, [files, autoUpload, isUploading, uploadAll]);

  // Notify on successful parse
  useEffect(() => {
    files.forEach(file => {
      if (file.status === 'done' && file.parsedData) {
        onParsed?.(file, file.parsedData);
      }
    });
  }, [files, onParsed]);

  // Handle entity creation
  const handleCreateEntity = useCallback(async (fileId: string) => {
    setCreatingEntityIds(prev => new Set(prev).add(fileId));
    try {
      const entityId = await createEntity(fileId);
      if (entityId) {
        toast.success('Кандидат успешно создан');
        onEntityCreated?.(entityId);
      }
    } finally {
      setCreatingEntityIds(prev => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    }
  }, [createEntity, onEntityCreated]);

  // Click handler for drop zone
  const handleDropZoneClick = useCallback(() => {
    if (!disabled) {
      inputRef.current?.click();
    }
  }, [disabled]);

  const maxSizeMB = Math.round(MAX_FILE_SIZE / (1024 * 1024));

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Drop zone */}
      <div
        ref={dropZoneRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleDropZoneClick}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={clsx(
          'relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 cursor-pointer',
          isDragging
            ? 'border-blue-500 bg-blue-500/10 scale-[1.02]'
            : disabled
              ? 'border-white/10 glass-light opacity-50 cursor-not-allowed'
              : 'border-white/20 hover:border-white/40 hover:bg-dark-800/50'
        )}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Область для загрузки резюме. Перетащите файлы или нажмите для выбора"
        aria-disabled={disabled}
      >
        {/* Hidden file input */}
        <input
          ref={inputRef}
          type="file"
          accept={SUPPORTED_EXTENSIONS.join(',')}
          multiple={maxFiles !== 1}
          onChange={handleFileInputChange}
          className="hidden"
          disabled={disabled}
          aria-label="Выбрать файлы резюме"
        />

        {/* Icon */}
        <div className={clsx(
          'mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-colors',
          isDragging
            ? 'bg-blue-500/20'
            : 'glass-light'
        )}>
          <Upload className={clsx(
            'w-8 h-8 transition-colors',
            isDragging ? 'text-blue-400' : 'text-white/40'
          )} aria-hidden="true" />
        </div>

        {/* Text */}
        <p className={clsx(
          'text-lg font-medium mb-2 transition-colors',
          isDragging ? 'text-blue-400' : 'text-white'
        )}>
          {isDragging
            ? 'Отпустите файл для загрузки'
            : 'Перетащите резюме сюда'
          }
        </p>
        <p className="text-sm text-white/50 mb-4">
          или нажмите для выбора файла
        </p>

        {/* Supported formats */}
        <div className="flex items-center justify-center gap-2 text-xs text-white/30">
          <span>Форматы:</span>
          {SUPPORTED_EXTENSIONS.map(ext => (
            <span
              key={ext}
              className="px-2 py-0.5 glass-light rounded"
            >
              {ext.toUpperCase()}
            </span>
          ))}
          <span className="ml-2">Макс. {maxSizeMB} МБ</span>
        </div>

        {/* Drag overlay */}
        <AnimatePresence>
          {isDragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 rounded-xl border-2 border-blue-500 bg-blue-500/5 pointer-events-none"
            />
          )}
        </AnimatePresence>
      </div>

      {/* Overall progress */}
      {isUploading && (
        <div className="p-3 glass-light rounded-lg" role="status" aria-live="polite">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-white/60">Загрузка файлов...</span>
            <span className="text-white/40" aria-label={`${overallProgress} процентов`}>{overallProgress}%</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-blue-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${overallProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Files list */}
      <AnimatePresence mode="popLayout">
        {files.length > 0 && (
          <motion.div
            layout
            className="space-y-3"
          >
            {/* Header with stats and clear button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-white/60">
                  Файлов: {files.length}
                </span>
                {successCount > 0 && (
                  <span className="text-green-400">
                    Успешно: {successCount}
                  </span>
                )}
                {errorCount > 0 && (
                  <span className="text-red-400">
                    Ошибок: {errorCount}
                  </span>
                )}
              </div>
              <button
                onClick={clearFiles}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                aria-label="Очистить все файлы"
              >
                <Trash2 size={14} aria-hidden="true" />
                Очистить
              </button>
            </div>

            {/* File items */}
            {files.map(file => (
              <FileItem
                key={file.id}
                file={file}
                onRemove={() => removeFile(file.id)}
                onCreateEntity={() => handleCreateEntity(file.id)}
                showCreateEntity={showCreateEntity}
                isCreatingEntity={creatingEntityIds.has(file.id)}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
