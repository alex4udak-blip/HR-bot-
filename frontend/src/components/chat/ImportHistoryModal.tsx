import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, FileJson, CheckCircle, AlertCircle, Loader2, Apple, Monitor } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { importTelegramHistory, ImportResult } from '@/services/api';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface ImportHistoryModalProps {
  chatId: number;
  chatTitle: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function ImportHistoryModal({ chatId, chatTitle, isOpen, onClose }: ImportHistoryModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [platform, setPlatform] = useState<'mac' | 'windows'>('mac');
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: (file: File) => importTelegramHistory(chatId, file),
    onSuccess: (data) => {
      setResult(data);
      if (data.imported > 0) {
        queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
        queryClient.invalidateQueries({ queryKey: ['chats'] });
        toast.success(`Импортировано ${data.imported} сообщений`);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith('.json')) {
      setFile(droppedFile);
      setResult(null);
    } else {
      toast.error('Пожалуйста, загрузите JSON файл');
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleImport = () => {
    if (file) {
      importMutation.mutate(file);
    }
  };

  const handleClose = () => {
    setFile(null);
    setResult(null);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/80"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="glass rounded-2xl p-6 max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Upload className="w-5 h-5 text-accent-400" />
                  Загрузить историю
                </h2>
                <p className="text-sm text-dark-400 mt-1 truncate max-w-[300px]">{chatTitle}</p>
              </div>
              <button
                onClick={handleClose}
                className="p-2 rounded-lg hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Instructions */}
            <div className="mb-6 glass-light rounded-xl overflow-hidden">
              {/* Platform tabs */}
              <div className="flex border-b border-white/5">
                <button
                  onClick={() => setPlatform('mac')}
                  className={clsx(
                    'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
                    platform === 'mac'
                      ? 'bg-white/5 text-white'
                      : 'text-dark-400 hover:text-dark-200'
                  )}
                >
                  <Apple className="w-4 h-4" />
                  macOS
                </button>
                <button
                  onClick={() => setPlatform('windows')}
                  className={clsx(
                    'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
                    platform === 'windows'
                      ? 'bg-white/5 text-white'
                      : 'text-dark-400 hover:text-dark-200'
                  )}
                >
                  <Monitor className="w-4 h-4" />
                  Windows
                </button>
              </div>

              {/* Instructions content */}
              <div className="p-4 text-sm">
                <p className="font-medium mb-3">Как экспортировать историю:</p>
                {platform === 'mac' ? (
                  <ol className="list-decimal list-inside space-y-1.5 text-dark-300">
                    <li>Откройте <strong>Telegram Desktop</strong></li>
                    <li>Откройте нужный чат</li>
                    <li>Нажмите <strong>⋮</strong> (три точки) в правом верхнем углу</li>
                    <li>Выберите <strong>Export chat history</strong></li>
                    <li>В настройках выберите формат <strong>JSON</strong></li>
                    <li>Нажмите <strong>Export</strong> и дождитесь завершения</li>
                    <li>Загрузите файл <strong>result.json</strong> сюда</li>
                  </ol>
                ) : (
                  <ol className="list-decimal list-inside space-y-1.5 text-dark-300">
                    <li>Откройте <strong>Telegram Desktop</strong></li>
                    <li>Откройте нужный чат</li>
                    <li>Нажмите на <strong>имя чата</strong> вверху (откроется профиль)</li>
                    <li>Нажмите <strong>⋮</strong> (три точки) → <strong>Export chat history</strong></li>
                    <li>В настройках выберите формат <strong>JSON</strong></li>
                    <li>Нажмите <strong>Export</strong> и дождитесь завершения</li>
                    <li>Загрузите файл <strong>result.json</strong> сюда</li>
                  </ol>
                )}
                <p className="mt-3 text-xs text-dark-500">
                  Файл обычно сохраняется в папку <code className="px-1 py-0.5 rounded bg-white/5">Telegram Desktop/ChatExport_дата</code>
                </p>
              </div>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`
                relative border-2 border-dashed rounded-xl p-8 text-center transition-all
                ${isDragging ? 'border-accent-400 bg-accent-500/10' : 'border-dark-700 hover:border-dark-500'}
                ${file ? 'border-green-500/50 bg-green-500/5' : ''}
              `}
            >
              <input
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />

              {file ? (
                <div className="flex flex-col items-center gap-2">
                  <FileJson className="w-12 h-12 text-green-400" />
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-dark-400">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-12 h-12 text-dark-500" />
                  <p className="text-dark-300">
                    Перетащите файл сюда или <span className="text-accent-400">выберите</span>
                  </p>
                  <p className="text-sm text-dark-500">Поддерживается: JSON</p>
                </div>
              )}
            </div>

            {/* Result */}
            {result && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mt-4 p-4 rounded-xl ${result.imported > 0 ? 'bg-green-500/10' : 'bg-yellow-500/10'}`}
              >
                <div className="flex items-start gap-3">
                  {result.imported > 0 ? (
                    <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium">
                      {result.imported > 0 ? 'Импорт завершён' : 'Нет новых сообщений'}
                    </p>
                    <div className="text-sm text-dark-300 mt-1 space-y-0.5">
                      <p>Импортировано: <strong>{result.imported}</strong></p>
                      <p>Пропущено (дубликаты): <strong>{result.skipped}</strong></p>
                      {result.total_errors > 0 && (
                        <p className="text-red-400">Ошибок: {result.total_errors}</p>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Actions */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2.5 rounded-xl glass-light hover:bg-white/10 transition-colors"
              >
                {result ? 'Закрыть' : 'Отмена'}
              </button>
              {!result && (
                <button
                  onClick={handleImport}
                  disabled={!file || importMutation.isPending}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {importMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Импорт...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Импортировать
                    </>
                  )}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
