import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Link2,
  FileText,
  Music,
  Cloud,
  ExternalLink,
  Loader2,
  CheckCircle,
  AlertCircle,
  HelpCircle,
  Copy,
  Flame,
  Table,
  ClipboardList
} from 'lucide-react';
import {
  detectExternalLinkType,
  processExternalURL,
  getExternalProcessingStatus,
  type ExternalLinkType
} from '@/services/api';
import type { Entity } from '@/types';

interface ExternalLinksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (callId: number) => void;
  entities?: Entity[];
}

const LINK_TYPE_INFO: Record<ExternalLinkType, {
  label: string;
  description: string;
  icon: typeof FileText;
  color: string;
  examples: string[];
}> = {
  fireflies: {
    label: 'Fireflies.ai',
    description: 'Транскрипт из Fireflies.ai',
    icon: Flame,
    color: 'text-orange-400 bg-orange-500/20',
    examples: ['app.fireflies.ai/view/...']
  },
  google_doc: {
    label: 'Google Docs',
    description: 'Транскрипт из Google Документа',
    icon: FileText,
    color: 'text-blue-400 bg-blue-500/20',
    examples: ['docs.google.com/document/d/...']
  },
  google_sheet: {
    label: 'Google Sheets',
    description: 'Данные из Google Таблицы',
    icon: Table,
    color: 'text-emerald-400 bg-emerald-500/20',
    examples: ['docs.google.com/spreadsheets/d/...']
  },
  google_form: {
    label: 'Google Forms',
    description: 'Данные из Google Формы',
    icon: ClipboardList,
    color: 'text-violet-400 bg-violet-500/20',
    examples: ['docs.google.com/forms/d/...']
  },
  google_drive: {
    label: 'Google Drive',
    description: 'Аудио/видео файл из Google Drive',
    icon: Cloud,
    color: 'text-green-400 bg-green-500/20',
    examples: ['drive.google.com/file/d/...']
  },
  direct_media: {
    label: 'Прямая ссылка',
    description: 'Прямая ссылка на аудио/видео файл',
    icon: Music,
    color: 'text-purple-400 bg-purple-500/20',
    examples: ['example.com/audio.mp3', 'example.com/video.mp4']
  },
  unknown: {
    label: 'Неизвестный',
    description: 'Тип ссылки будет определён автоматически',
    icon: HelpCircle,
    color: 'text-gray-400 bg-gray-500/20',
    examples: []
  }
};

export default function ExternalLinksModal({
  isOpen,
  onClose,
  onSuccess,
  entities = []
}: ExternalLinksModalProps) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [entityId, setEntityId] = useState<number | undefined>();
  const [detectedType, setDetectedType] = useState<ExternalLinkType | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingCallId, setProcessingCallId] = useState<number | null>(null);
  const [_processingStatus, setProcessingStatus] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Detect link type when URL changes
  const detectType = useCallback(async (inputUrl: string) => {
    if (!inputUrl.trim() || !inputUrl.includes('://')) {
      setDetectedType(null);
      return;
    }

    setIsDetecting(true);
    setError(null);

    try {
      const result = await detectExternalLinkType(inputUrl);
      setDetectedType(result.link_type);
      if (!result.can_process) {
        setError(result.message || 'Этот тип ссылки не поддерживается');
      }
    } catch (err) {
      console.error('Error detecting link type:', err);
      setDetectedType('unknown');
    } finally {
      setIsDetecting(false);
    }
  }, []);

  // Debounced URL change handler
  useEffect(() => {
    const timer = setTimeout(() => {
      if (url) {
        detectType(url);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [url, detectType]);

  // Poll processing status
  useEffect(() => {
    if (!processingCallId) return;

    const pollInterval = setInterval(async () => {
      try {
        const status = await getExternalProcessingStatus(processingCallId);
        setProcessingStatus(status.status);
        setProgress(status.progress || 0);
        setProgressStage(status.progress_stage || '');

        if (status.status === 'done') {
          setProgress(100);
          setProgressStage('Готово!');
          setSuccess(true);
          setIsProcessing(false);
          clearInterval(pollInterval);

          // Send browser notification if page is not visible
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('Запись обработана', {
              body: status.title || 'Fireflies транскрипт готов',
              icon: '/favicon.ico'
            });
          }

          setTimeout(() => {
            onSuccess(processingCallId);
            handleClose();
          }, 1500);
        } else if (status.status === 'failed') {
          setError(status.error_message || 'Ошибка обработки');
          setIsProcessing(false);
          setProgress(0);
          setProgressStage('Ошибка');
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error('Error polling status:', err);
      }
    }, 1500);  // Poll every 1.5s for smoother progress updates

    return () => clearInterval(pollInterval);
  }, [processingCallId, onSuccess]);

  // Request notification permission when processing starts
  useEffect(() => {
    if (isProcessing && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [isProcessing]);

  const handleSubmit = async () => {
    if (!url.trim()) {
      setError('Введите URL');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProcessingStatus('pending');

    try {
      const result = await processExternalURL({
        url: url.trim(),
        title: title.trim() || undefined,
        entity_id: entityId
      });

      setProcessingCallId(result.call_id);
      setProcessingStatus(result.status);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Ошибка обработки ссылки';
      setError(errorMessage);
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    setUrl('');
    setTitle('');
    setEntityId(undefined);
    setDetectedType(null);
    setError(null);
    setSuccess(false);
    setIsProcessing(false);
    setProcessingCallId(null);
    setProcessingStatus('');
    setProgress(0);
    setProgressStage('');
    onClose();
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch (err) {
      console.error('Failed to read clipboard:', err);
    }
  };

  const typeInfo = detectedType ? LINK_TYPE_INFO[detectedType] : null;
  const TypeIcon = typeInfo?.icon || Link2;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="w-full max-w-lg bg-dark-800 rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20">
                  <ExternalLink className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Добавить внешнюю ссылку</h2>
                  <p className="text-sm text-white/50">Google Docs, Drive или прямая ссылка на медиа</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 rounded-lg hover:bg-white/5 text-white/60 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-5">
              {/* URL Input */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/70">URL ссылки</label>
                <div className="relative">
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://docs.google.com/document/d/..."
                    className="w-full px-4 py-3 pr-24 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-colors"
                    disabled={isProcessing}
                  />
                  <button
                    onClick={handlePaste}
                    disabled={isProcessing}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 text-xs font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Вставить
                  </button>
                </div>

                {/* Link Type Detection */}
                {(isDetecting || typeInfo) && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 mt-2"
                  >
                    {isDetecting ? (
                      <>
                        <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
                        <span className="text-sm text-white/40">Определение типа...</span>
                      </>
                    ) : typeInfo && (
                      <>
                        <div className={`p-1.5 rounded-lg ${typeInfo.color}`}>
                          <TypeIcon className="w-4 h-4" />
                        </div>
                        <span className="text-sm text-white/70">{typeInfo.label}</span>
                        <span className="text-xs text-white/40">— {typeInfo.description}</span>
                      </>
                    )}
                  </motion.div>
                )}
              </div>

              {/* Title Input */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/70">Название (опционально)</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Название записи"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-colors"
                  disabled={isProcessing}
                />
              </div>

              {/* Entity Select */}
              {entities.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white/70">Привязать к контакту</label>
                  <select
                    value={entityId || ''}
                    onChange={(e) => setEntityId(e.target.value ? Number(e.target.value) : undefined)}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-colors"
                    disabled={isProcessing}
                  >
                    <option value="">Не привязывать</option>
                    {entities.map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Supported Types Info */}
              <div className="p-4 bg-white/5 rounded-xl space-y-3">
                <h4 className="text-sm font-medium text-white/70 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4" />
                  Поддерживаемые типы ссылок
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  {Object.entries(LINK_TYPE_INFO).filter(([key]) => key !== 'unknown').map(([key, info]) => {
                    const Icon = info.icon;
                    return (
                      <div key={key} className="flex items-center gap-3 text-sm">
                        <div className={`p-1.5 rounded-lg ${info.color}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-white/70">{info.label}</span>
                        <span className="text-white/40 text-xs">{info.examples[0]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Status Messages */}
              <AnimatePresence mode="wait">
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl"
                  >
                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                    <p className="text-sm text-red-300">{error}</p>
                  </motion.div>
                )}

                {isProcessing && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-xl space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                        <span className="text-sm text-cyan-300">{progressStage || 'Обработка...'}</span>
                      </div>
                      <span className="text-sm font-medium text-cyan-400">{progress}%</span>
                    </div>
                    {/* Progress bar */}
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-cyan-500 to-blue-500"
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                      />
                    </div>
                    <p className="text-xs text-cyan-400/60">
                      {progress < 30 && "Загрузка страницы Fireflies..."}
                      {progress >= 30 && progress < 50 && "Извлечение транскрипта..."}
                      {progress >= 50 && progress < 70 && "Обработка данных спикеров..."}
                      {progress >= 70 && progress < 95 && "AI анализирует разговор..."}
                      {progress >= 95 && "Сохранение результатов..."}
                    </p>
                  </motion.div>
                )}

                {success && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl"
                  >
                    <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                    <p className="text-sm text-green-300">Успешно обработано!</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 bg-white/[0.02]">
              <button
                onClick={handleClose}
                disabled={isProcessing}
                className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleSubmit}
                disabled={!url.trim() || isDetecting || isProcessing || !!error}
                className="px-5 py-2 text-sm font-medium text-white bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg hover:from-cyan-400 hover:to-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Обработка...
                  </>
                ) : (
                  <>
                    <Link2 className="w-4 h-4" />
                    Обработать
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
