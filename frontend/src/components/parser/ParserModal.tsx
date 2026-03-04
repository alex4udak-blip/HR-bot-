import { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Search, Link, FileText, Upload, Loader2, AlertCircle, UserCheck, Plus } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import type { ParsedResume, ParsedVacancy } from '@/services/api';
import {
  parseResumeFromUrl,
  parseResumeFromFile,
  parseVacancyFromUrl,
  getEntities,
  uploadEntityFile,
} from '@/services/api';
import ParsedDataPreview from './ParsedDataPreview';
import { OnboardingTooltip } from '@/components/onboarding';
import type { Entity } from '@/types';

interface ParserModalProps {
  type: 'resume' | 'vacancy';
  onClose: () => void;
  onParsed: (data: ParsedResume | ParsedVacancy) => void;
  /** Callback when background job is started */
  onJobStarted?: (jobId: number, fileName: string) => void;
  /** Callback when resume is attached to existing entity */
  onAttachedToEntity?: (entityId: number) => void;
}

type TabType = 'url' | 'file';

// Source detection
interface SourceInfo {
  domain: string;
  name: string;
  color: string;
}

const SOURCE_PATTERNS: Record<string, SourceInfo> = {
  'hh.ru': { domain: 'hh.ru', name: 'HeadHunter', color: 'bg-red-500/20 text-red-300' },
  'linkedin.com': { domain: 'linkedin.com', name: 'LinkedIn', color: 'bg-blue-500/20 text-blue-300' },
  'superjob.ru': { domain: 'superjob.ru', name: 'SuperJob', color: 'bg-green-500/20 text-green-300' },
  'career.habr.com': { domain: 'career.habr.com', name: 'Хабр Карьера', color: 'bg-purple-500/20 text-purple-300' },
  'zarplata.ru': { domain: 'zarplata.ru', name: 'Zarplata.ru', color: 'bg-yellow-500/20 text-yellow-300' },
  'rabota.ru': { domain: 'rabota.ru', name: 'Rabota.ru', color: 'bg-orange-500/20 text-orange-300' },
  'indeed.com': { domain: 'indeed.com', name: 'Indeed', color: 'bg-indigo-500/20 text-indigo-300' },
};

const detectSource = (url: string): SourceInfo | null => {
  try {
    const urlLower = url.toLowerCase();
    for (const [pattern, info] of Object.entries(SOURCE_PATTERNS)) {
      if (urlLower.includes(pattern)) {
        return info;
      }
    }
  } catch {
    // Invalid URL
  }
  return null;
};

const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

export default function ParserModal({ type, onClose, onParsed, onJobStarted: _onJobStarted, onAttachedToEntity }: ParserModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('url');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedResume | ParsedVacancy | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Candidate matching state
  const [matchedCandidates, setMatchedCandidates] = useState<Entity[]>([]);
  const [isSearchingCandidates, setIsSearchingCandidates] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);

  const detectedSource = url ? detectSource(url) : null;
  const isUrlValid = url && isValidUrl(url);
  const isResume = type === 'resume';

  // Search for matching candidates when resume is parsed
  useEffect(() => {
    if (!parsedData || type !== 'resume') return;
    const resumeData = parsedData as ParsedResume;
    if (!resumeData.name && !resumeData.email) return;

    const searchMatches = async () => {
      setIsSearchingCandidates(true);
      try {
        const candidates: Entity[] = [];

        // Search by name
        if (resumeData.name) {
          const byName = await getEntities({ search: resumeData.name, type: 'candidate', limit: 10 });
          candidates.push(...byName);
        }

        // Search by email
        if (resumeData.email) {
          const byEmail = await getEntities({ search: resumeData.email, type: 'candidate', limit: 10 });
          for (const c of byEmail) {
            if (!candidates.find(existing => existing.id === c.id)) {
              candidates.push(c);
            }
          }
        }

        setMatchedCandidates(candidates);
      } catch (err) {
        console.error('Error searching candidates:', err);
      } finally {
        setIsSearchingCandidates(false);
      }
    };

    searchMatches();
  }, [parsedData, type]);

  // Attach resume file to existing candidate
  const handleAttachToCandidate = async (candidateId: number) => {
    if (!uploadedFile) return;
    setIsAttaching(true);
    try {
      await uploadEntityFile(candidateId, uploadedFile, 'resume', 'Resume (attached via parser)');
      toast.success('Резюме прикреплено к кандидату');
      onAttachedToEntity?.(candidateId);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка прикрепления файла';
      toast.error(message);
    } finally {
      setIsAttaching(false);
    }
  };

  const handleParse = async () => {
    if (!isUrlValid) {
      setError('Введите корректный URL');
      return;
    }

    setLoading(true);
    setError(null);
    setParsedData(null);

    try {
      const data = isResume
        ? await parseResumeFromUrl(url)
        : await parseVacancyFromUrl(url);
      setParsedData(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка парсинга';
      setError(message);
      toast.error(message, { duration: 6000 });
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    if (!isResume) {
      toast.error('Загрузка файлов доступна только для резюме');
      return;
    }

    // Check file type by MIME type AND extension (some browsers return empty file.type)
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    const allowedExtensions = ['.pdf', '.doc', '.docx', '.txt'];
    const fileExtension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    const isTypeValid = allowedTypes.includes(file.type) || (file.type === '' && allowedExtensions.includes(fileExtension));
    const isExtensionValid = allowedExtensions.includes(fileExtension);

    if (!isTypeValid && !isExtensionValid) {
      const errorMsg = 'Поддерживаются только PDF, DOC, DOCX и TXT файлы';
      setError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    // Check file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('Размер файла не должен превышать 10 МБ');
      return;
    }

    setLoading(true);
    setError(null);
    setParsedData(null);
    setUploadedFile(file);
    setMatchedCandidates([]);

    try {
      // Parse resume inline - shows results in preview
      const data = await parseResumeFromFile(file);
      setParsedData(data);
      toast.success('Резюме распознано');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка парсинга файла';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileSelectRef = useRef(handleFileSelect);
  handleFileSelectRef.current = handleFileSelect;

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelectRef.current(files[0]);
    }
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleDataChange = (data: ParsedResume | ParsedVacancy) => {
    setParsedData(data);
  };

  const handleCreate = () => {
    if (!parsedData) return;

    // Validate required fields
    if (type === 'vacancy') {
      const vacancyData = parsedData as ParsedVacancy;
      if (!vacancyData.title?.trim()) {
        toast.error('Название вакансии обязательно');
        return;
      }
    } else {
      const resumeData = parsedData as ParsedResume;
      if (!resumeData.name?.trim()) {
        toast.error('Имя контакта обязательно');
        return;
      }
    }

    onParsed(parsedData);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && isUrlValid && !parsedData) {
      handleParse();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="parser-modal-title"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="glass rounded-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 flex-shrink-0">
          <OnboardingTooltip
            id="parser-modal"
            content="Paste a URL from hh.ru, LinkedIn or upload a PDF resume"
            position="bottom"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-cyan-500/20 rounded-lg">
                <Search className="w-5 h-5 text-cyan-400" aria-hidden="true" />
              </div>
              <h2 id="parser-modal-title" className="text-lg font-semibold">
                {isResume ? 'Парсинг резюме' : 'Парсинг вакансии'}
              </h2>
            </div>
          </OnboardingTooltip>
          <button
            onClick={onClose}
            className="p-2 hover:bg-dark-800/50 rounded-lg transition-colors"
            aria-label="Закрыть окно"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Tabs - only show file tab for resume */}
        <div className="flex border-b border-white/10 flex-shrink-0" role="tablist" aria-label="Способ загрузки">
          <button
            onClick={() => {
              setActiveTab('url');
              setError(null);
              setParsedData(null);
            }}
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm transition-colors',
              activeTab === 'url'
                ? 'glass-light text-white border-b-2 border-cyan-500'
                : 'text-white/60 hover:text-white hover:bg-dark-800/50'
            )}
            role="tab"
            aria-selected={activeTab === 'url'}
            aria-controls="parser-url-panel"
            id="parser-url-tab"
          >
            <Link className="w-4 h-4" aria-hidden="true" />
            По ссылке
          </button>
          {isResume && (
            <button
              onClick={() => {
                setActiveTab('file');
                setError(null);
                setParsedData(null);
              }}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm transition-colors',
                activeTab === 'file'
                  ? 'glass-light text-white border-b-2 border-cyan-500'
                  : 'text-white/60 hover:text-white hover:bg-dark-800/50'
              )}
              role="tab"
              aria-selected={activeTab === 'file'}
              aria-controls="parser-file-panel"
              id="parser-file-tab"
            >
              <FileText className="w-4 h-4" aria-hidden="true" />
              Загрузить файл
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {!parsedData ? (
            // Input section
            <div className="space-y-4">
              {activeTab === 'url' ? (
                // URL input
                <div
                  role="tabpanel"
                  id="parser-url-panel"
                  aria-labelledby="parser-url-tab"
                >
                  <label htmlFor="parser-url-input" className="block text-sm text-white/60 mb-2">
                    Ссылка на {isResume ? 'резюме' : 'вакансию'}
                  </label>
                  <div className="relative">
                    <input
                      id="parser-url-input"
                      type="url"
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        setError(null);
                      }}
                      onKeyDown={handleKeyDown}
                      placeholder={isResume
                        ? 'https://hh.ru/resume/123456'
                        : 'https://hh.ru/vacancy/123456'
                      }
                      className={clsx(
                        'w-full px-4 py-3 glass-light border rounded-lg focus:outline-none text-sm pr-24',
                        error ? 'border-red-500/50' : 'border-white/10 focus:border-cyan-500'
                      )}
                      disabled={loading}
                      aria-invalid={error ? 'true' : 'false'}
                      aria-describedby={error ? 'parser-url-error' : undefined}
                    />
                    {detectedSource && (
                      <span className={clsx(
                        'absolute right-3 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded-full',
                        detectedSource.color
                      )}>
                        {detectedSource.name}
                      </span>
                    )}
                  </div>
                  {error && (
                    <p id="parser-url-error" className="text-xs text-red-400 mt-2 flex items-center gap-1" role="alert">
                      <AlertCircle className="w-3 h-3" aria-hidden="true" />
                      {error}
                    </p>
                  )}
                </div>
              ) : (
                // File upload
                <div
                  className="space-y-4"
                  role="tabpanel"
                  id="parser-file-panel"
                  aria-labelledby="parser-file-tab"
                >
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    className={clsx(
                      'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
                      isDragging
                        ? 'border-cyan-500 bg-cyan-500/10'
                        : 'border-white/20 hover:border-white/40 hover:bg-dark-800/50'
                    )}
                    role="button"
                    tabIndex={0}
                    aria-label="Область для загрузки файла. Перетащите файл или нажмите для выбора"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx,.txt"
                      onChange={handleFileInputChange}
                      className="hidden"
                      aria-label="Выбрать файл резюме"
                    />
                    <Upload className={clsx(
                      'w-10 h-10 mx-auto mb-4',
                      isDragging ? 'text-cyan-400' : 'text-white/40'
                    )} aria-hidden="true" />
                    <p className="text-white/60 mb-2">
                      {isDragging
                        ? 'Отпустите файл для загрузки'
                        : 'Перетащите файл сюда или нажмите для выбора'
                      }
                    </p>
                    <p className="text-xs text-white/40">
                      PDF, DOC, DOCX или TXT (максимум 10 МБ)
                    </p>
                    {error && (
                      <p className="text-xs text-red-400 mt-4 flex items-center justify-center gap-1" role="alert">
                        <AlertCircle className="w-3 h-3" aria-hidden="true" />
                        {error}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Parse button */}
              {activeTab === 'url' && (
                <button
                  onClick={handleParse}
                  disabled={loading || !isUrlValid}
                  className={clsx(
                    'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors',
                    loading || !isUrlValid
                      ? 'glass-light text-white/40 cursor-not-allowed'
                      : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                  )}
                  aria-busy={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                      Загрузка...
                    </>
                  ) : (
                    <>
                      <Search className="w-5 h-5" aria-hidden="true" />
                      Парсить
                    </>
                  )}
                </button>
              )}

              {/* Loading indicator for file */}
              {activeTab === 'file' && loading && (
                <div className="flex items-center justify-center gap-2 py-4 text-cyan-400" role="status" aria-live="polite">
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  <span>Обработка файла...</span>
                </div>
              )}
            </div>
          ) : (
            // Preview section
            <div className="space-y-4">
              <ParsedDataPreview
                type={type}
                data={parsedData}
                onDataChange={handleDataChange}
              />

              {/* Matched candidates section for resume */}
              {isResume && (isSearchingCandidates || matchedCandidates.length > 0) && (
                <div className="border-t border-white/10 pt-4">
                  <h3 className="text-sm font-medium text-white/70 mb-3 flex items-center gap-2">
                    <UserCheck className="w-4 h-4" />
                    {isSearchingCandidates ? 'Поиск совпадений...' : `Найденные кандидаты (${matchedCandidates.length})`}
                  </h3>
                  {isSearchingCandidates ? (
                    <div className="flex items-center gap-2 text-white/40 text-sm py-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Поиск существующих кандидатов...
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {matchedCandidates.map((candidate) => (
                        <div
                          key={candidate.id}
                          className="flex items-center justify-between p-3 glass-light rounded-lg"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">{candidate.name}</p>
                            <p className="text-xs text-white/40 truncate">
                              {[candidate.email, candidate.phone, candidate.position].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <button
                            onClick={() => handleAttachToCandidate(candidate.id)}
                            disabled={isAttaching}
                            className="flex-shrink-0 ml-3 px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {isAttaching ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Upload className="w-3 h-3" />
                            )}
                            Прикрепить
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-white/10 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-white/60 hover:text-white transition-colors"
          >
            Отмена
          </button>
          {parsedData && (
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              {isResume ? 'Создать нового кандидата' : 'Создать вакансию'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
