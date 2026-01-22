import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  Upload,
  Trash2,
  Download,
  Loader2,
  File,
  FileImage,
  FileArchive,
  X,
  FolderOpen
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { getEntityFiles, uploadEntityFile, deleteEntityFile, downloadEntityFile } from '@/services/api';
import { formatDate } from '@/utils';
import { EmptyFiles } from '@/components/ui';
import type { EntityFile } from '@/services/api';

interface EntityFilesProps {
  entityId: number;
  canEdit?: boolean;
}

// File type options with Russian labels
const FILE_TYPE_OPTIONS = [
  { value: 'resume', label: 'Резюме' },
  { value: 'cover_letter', label: 'Сопроводительное письмо' },
  { value: 'test_assignment', label: 'Тестовое задание' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'portfolio', label: 'Портфолио' },
  { value: 'other', label: 'Другое' },
];

// File type labels for display
const FILE_TYPE_LABELS: Record<string, string> = {
  resume: 'Резюме',
  cover_letter: 'Сопроводительное письмо',
  test_assignment: 'Тестовое задание',
  certificate: 'Сертификат',
  portfolio: 'Портфолио',
  other: 'Другое',
};

// Get icon for file based on mime type
const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('rar')) return FileArchive;
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('word')) return FileText;
  return File;
};

// Format file size for display
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default function EntityFiles({ entityId, canEdit = true }: EntityFilesProps) {
  const [files, setFiles] = useState<EntityFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Upload form state
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState('resume');
  const [description, setDescription] = useState('');

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Load files on mount
  useEffect(() => {
    loadFiles();
  }, [entityId]);

  const loadFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getEntityFiles(entityId);
      setFiles(data);
    } catch (err) {
      console.error('Failed to load files:', err);
      setError('Не удалось загрузить файлы');
    } finally {
      setLoading(false);
    }
  };

  // Handle file selection
  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setShowUploadForm(true);
  };

  // Handle file upload
  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error('Выберите файл');
      return;
    }

    setUploading(true);
    try {
      await uploadEntityFile(entityId, selectedFile, fileType, description || undefined);
      toast.success('Файл загружен');
      setShowUploadForm(false);
      setSelectedFile(null);
      setDescription('');
      setFileType('resume');
      loadFiles();
    } catch (err: any) {
      const message = err?.response?.data?.detail || 'Ошибка при загрузке файла';
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  // Handle file delete
  const handleDelete = async (fileId: number) => {
    if (!confirm('Вы уверены, что хотите удалить этот файл?')) return;

    try {
      await deleteEntityFile(entityId, fileId);
      toast.success('Файл удалён');
      setFiles(files.filter(f => f.id !== fileId));
    } catch (err: any) {
      const message = err?.response?.data?.detail || 'Ошибка при удалении файла';
      toast.error(message);
    }
  };

  // Handle file download
  const handleDownload = async (file: EntityFile) => {
    try {
      const blob = await downloadEntityFile(entityId, file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Ошибка при скачивании файла');
    }
  };

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we're leaving the drop zone
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
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

    if (!canEdit) return;

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length > 0) {
      handleFileSelect(droppedFiles[0]);
    }
  }, [canEdit]);


  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-white/40">
        <FolderOpen className="mx-auto mb-2" size={40} />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Upload Zone */}
      {canEdit && (
        <div
          ref={dropZoneRef}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={clsx(
            'border-2 border-dashed rounded-xl p-6 text-center transition-colors',
            isDragging
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-white/20 hover:border-white/40'
          )}
        >
          <Upload className={clsx(
            'w-8 h-8 mx-auto mb-2',
            isDragging ? 'text-blue-400' : 'text-white/40'
          )} />
          <p className="text-white/60 mb-2">
            {isDragging ? 'Отпустите файл для загрузки' : 'Перетащите файл сюда или'}
          </p>
          <label className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg cursor-pointer transition-colors">
            <Upload size={16} />
            <span>Выбрать файл</span>
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}

      {/* Upload Form Modal */}
      <AnimatePresence>
        {showUploadForm && selectedFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => {
              setShowUploadForm(false);
              setSelectedFile(null);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-md p-4"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Загрузка файла</h3>
                <button
                  onClick={() => {
                    setShowUploadForm(false);
                    setSelectedFile(null);
                  }}
                  className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Selected file info */}
              <div className="p-3 bg-white/5 rounded-lg mb-4 flex items-center gap-3">
                <File className="w-8 h-8 text-blue-400" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{selectedFile.name}</p>
                  <p className="text-sm text-white/40">{formatFileSize(selectedFile.size)}</p>
                </div>
              </div>

              {/* File type selector */}
              <div className="mb-4">
                <label className="block text-sm text-white/60 mb-1">Тип файла</label>
                <select
                  value={fileType}
                  onChange={(e) => setFileType(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  {FILE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div className="mb-4">
                <label className="block text-sm text-white/60 mb-1">Описание (опционально)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Добавьте описание файла..."
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowUploadForm(false);
                    setSelectedFile(null);
                  }}
                  className="px-4 py-2 text-white/60 hover:text-white transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
                >
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload size={16} />
                  )}
                  {uploading ? 'Загрузка...' : 'Загрузить'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Files List */}
      {files.length === 0 ? (
        canEdit ? null : <EmptyFiles />
      ) : (
        <div className="space-y-2">
          {files.map((file) => {
            const FileIcon = getFileIcon(file.mime_type);
            return (
              <motion.div
                key={file.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 bg-white/5 rounded-lg border border-white/10 flex items-center gap-3 group"
              >
                <div className="p-2 bg-blue-500/20 rounded-lg flex-shrink-0">
                  <FileIcon size={20} className="text-blue-400" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{file.file_name}</p>
                  <div className="flex items-center gap-2 text-xs text-white/40">
                    <span className="px-1.5 py-0.5 bg-white/10 rounded">
                      {FILE_TYPE_LABELS[file.file_type] || file.file_type}
                    </span>
                    <span>{formatFileSize(file.file_size)}</span>
                    <span>•</span>
                    <span>{formatDate(file.created_at, 'medium')}</span>
                  </div>
                  {file.description && (
                    <p className="text-xs text-white/50 mt-1 truncate">{file.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={() => handleDownload(file)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    title="Скачать"
                  >
                    <Download size={16} className="text-white/60" />
                  </button>
                  {canEdit && (
                    <button
                      onClick={() => handleDelete(file.id)}
                      className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                      title="Удалить"
                    >
                      <Trash2 size={16} className="text-red-400" />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
