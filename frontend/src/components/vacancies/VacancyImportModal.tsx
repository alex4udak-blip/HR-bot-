import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Link, FileUp, Loader2, Sparkles, AlertCircle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { parseVacancyFromUrl, parseVacancyFromFile, type ParsedVacancy } from '@/services/api';

interface VacancyImportModalProps {
  onClose: () => void;
  onImportSuccess: (data: ParsedVacancy) => void;
}

type ImportMode = 'url' | 'file';

export default function VacancyImportModal({ onClose, onImportSuccess }: VacancyImportModalProps) {
  const [mode, setMode] = useState<ImportMode>('url');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUrlSubmit = async () => {
    if (!url.trim()) {
      setError('Введите URL вакансии');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const parsed = await parseVacancyFromUrl(url);
      toast.success('Вакансия успешно распознана');
      onImportSuccess(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка парсинга вакансии';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    const allowedExtensions = ['.pdf', '.doc', '.docx', '.txt', '.rtf'];
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

    if (!allowedExtensions.includes(ext)) {
      setError(`Неподдерживаемый формат. Допустимые форматы: ${allowedExtensions.join(', ')}`);
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setError('Файл слишком большой. Максимальный размер: 20 МБ');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const parsed = await parseVacancyFromFile(file);
      toast.success('Вакансия успешно распознана');
      onImportSuccess(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка парсинга файла';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-lg overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-lg">
              <Sparkles className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Импорт вакансии</h2>
              <p className="text-sm text-white/50">Автоматическое заполнение из ссылки или файла</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => { setMode('url'); setError(null); }}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm transition-colors ${
              mode === 'url'
                ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/5'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Link className="w-4 h-4" />
            По ссылке
          </button>
          <button
            onClick={() => { setMode('file'); setError(null); }}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm transition-colors ${
              mode === 'file'
                ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/5'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <FileUp className="w-4 h-4" />
            Из файла
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <AnimatePresence mode="wait">
            {mode === 'url' ? (
              <motion.div
                key="url"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm text-white/60 mb-2">
                    Ссылка на вакансию
                  </label>
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://hh.ru/vacancy/12345678"
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                    disabled={loading}
                    onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                  />
                </div>

                <div className="text-xs text-white/40 space-y-1">
                  <p className="font-medium text-white/60">Поддерживаемые источники:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>hh.ru (HeadHunter) - через официальный API</li>
                    <li>LinkedIn Jobs</li>
                    <li>SuperJob</li>
                    <li>Habr Career</li>
                  </ul>
                </div>

                <button
                  onClick={handleUrlSubmit}
                  disabled={loading || !url.trim()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Распознавание...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Распознать вакансию
                    </>
                  )}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="file"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => !loading && fileInputRef.current?.click()}
                  className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
                    dragActive
                      ? 'border-blue-400 bg-blue-500/10'
                      : 'border-white/20 hover:border-white/40 hover:bg-white/5'
                  } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.txt,.rtf"
                    onChange={handleFileInputChange}
                    className="hidden"
                    disabled={loading}
                  />

                  {loading ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
                      <p className="text-white/60">Распознавание файла...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-4 bg-white/5 rounded-xl">
                        <FileUp className="w-8 h-8 text-white/40" />
                      </div>
                      <div>
                        <p className="font-medium">
                          Перетащите файл сюда
                        </p>
                        <p className="text-sm text-white/50 mt-1">
                          или нажмите для выбора
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="text-xs text-white/40 space-y-1">
                  <p className="font-medium text-white/60">Поддерживаемые форматы:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>PDF (.pdf)</li>
                    <li>Word (.doc, .docx)</li>
                    <li>Текст (.txt, .rtf)</li>
                  </ul>
                  <p className="mt-2">Максимальный размер: 20 МБ</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error display */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-4 flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg"
              >
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-red-400 font-medium">Ошибка</p>
                  <p className="text-xs text-red-400/80 mt-1">{error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer info */}
        <div className="px-4 pb-4">
          <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <CheckCircle className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-300/80">
              После распознавания вы сможете отредактировать данные перед сохранением.
              Валюта определяется автоматически.
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
