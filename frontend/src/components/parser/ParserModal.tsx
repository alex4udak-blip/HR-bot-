import { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Search, Upload, Loader2, AlertCircle, UserCheck, Plus, Briefcase } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import type { ParsedResume, ParsedVacancy } from '@/services/api';
import {
  parseResumeFromFile,
  getEntities,
  createEntity,
  uploadEntityFile,
  getVacancies,
  createApplication,
} from '@/services/api';
import ParsedDataPreview from './ParsedDataPreview';
import type { Entity, Vacancy } from '@/types';
import { useAuthStore } from '@/stores/authStore';

interface ParserModalProps {
  type: 'resume' | 'vacancy';
  onClose: () => void;
  onParsed: (data: ParsedResume | ParsedVacancy) => void;
  /** Callback when background job is started */
  onJobStarted?: (jobId: number, fileName: string) => void;
  /** Callback when resume is attached to existing entity */
  onAttachedToEntity?: (entityId: number) => void;
}



export default function ParserModal({ type, onClose, onParsed, onJobStarted: _onJobStarted, onAttachedToEntity }: ParserModalProps) {
  const [loading, setLoading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  // Фейковый прогресс во время AI-анализа (не быстрее, чем реальный parse, медленно идёт к 100%)
  const [error, setError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedResume | ParsedVacancy | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Candidate matching state
  const [matchedCandidates, setMatchedCandidates] = useState<Entity[]>([]);
  const [isSearchingCandidates, setIsSearchingCandidates] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const { user } = useAuthStore();
  const isHrAdmin =
    user?.role === 'superadmin' ||
    user?.org_role === 'owner' ||
    user?.org_role === 'admin';

  // Vacancy attachment state — кандидата можно сразу добавить на воронку
  const [vacancyOptions, setVacancyOptions] = useState<Pick<Vacancy, 'id' | 'title'>[]>([]);
  const [selectedVacancyId, setSelectedVacancyId] = useState<number | ''>('');
  const [isCreating, setIsCreating] = useState(false);

  // Подгружаем список своих воронок один раз — нужен только в режиме резюме.
  useEffect(() => {
    if (type !== 'resume') return;
    let cancelled = false;
    (async () => {
      try {
        const all = await getVacancies({ status: 'open' });
        if (cancelled) return;
        const myOpen = all
          // Только СВОИ открытые воронки: заявки (pending_review) и чужие
          // visible_to_all — НЕ цель добавления (рекрутёр их сначала берёт в работу).
          .filter(v => v.status === 'open' && (isHrAdmin || (!!user && v.created_by === user.id)))
          .map(v => ({ id: v.id, title: v.title }));
        setVacancyOptions(myOpen);
      } catch (e) {
        console.warn('Failed to load vacancies for attach picker:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [type, isHrAdmin, user]);

  const isResume = type === 'resume';

  // Search for matching candidates when resume is parsed
  useEffect(() => {
    if (!parsedData || type !== 'resume') return;
    const resumeData = parsedData as ParsedResume;
    if (!resumeData.name && !resumeData.email) return;

    const searchMatches = async () => {
      setIsSearchingCandidates(true);
      try {
        const candidatesMap = new Map<number, Entity>();

        // Search by name
        if (resumeData.name) {
          const byName = await getEntities({ search: resumeData.name, type: 'candidate', limit: 10 });
          byName.forEach(c => candidatesMap.set(c.id, c));
        }

        // Search by email
        if (resumeData.email) {
          const byEmail = await getEntities({ search: resumeData.email, type: 'candidate', limit: 10 });
          byEmail.forEach(c => candidatesMap.set(c.id, c));
        }

        setMatchedCandidates(Array.from(candidatesMap.values()));
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
    setUploadPct(0);
    setError(null);
    setParsedData(null);
    setUploadedFile(file);
    setMatchedCandidates([]);

    try {
      // Реальный % отправки файла; на 100% сервер начинает AI-разбор → переключаемся на
      // индетерминантную (бегущую) полоса, которую юзер видит в UI.
      const data = await parseResumeFromFile(file, (pct) => setUploadPct(pct >= 100 ? null : pct));
      setParsedData(data);
      toast.success('Резюме распознано');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка парсинга файла';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setUploadPct(null);
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

  const handleCreate = async () => {
    if (!parsedData) return;

    // Validate required fields
    if (type === 'vacancy') {
      const vacancyData = parsedData as ParsedVacancy;
      if (!vacancyData.title?.trim()) {
        toast.error('Название вакансии обязательно');
        return;
      }
      onParsed(parsedData);
      return;
    }

    const resumeData = parsedData as ParsedResume;
    if (!resumeData.name?.trim()) {
      toast.error('Имя контакта обязательно');
      return;
    }

    // Резюме: создаём кандидата здесь же. Раньше onParsed только показывал
    // toast и ничего не создавал — пользователи жаловались «куда этот файл
    // загружается». Теперь либо createEntityFromResume (если есть файл,
    // он же приложит резюме как файл к карточке), либо парент-форма
    // (URL-парс — там нужны доп. поля).
    setIsCreating(true);
    try {
      let createdEntityId: number | null = null;

      if (uploadedFile) {
        // Создаём из ОТРЕДАКТИРОВАННЫХ полей (parsedData), а не повторным парсингом
        // файла — иначе правки пользователя (имя и пр.) терялись. Файл прикрепляем
        // отдельно: upload конвертит PDF в картинки-страницы → чистый просмотр.
        const r = parsedData as ParsedResume;
        const created = await createEntity({
          type: 'candidate',
          name: r.name!.trim(),
          email: r.email?.trim() || undefined,
          phone: r.phone?.trim() || undefined,
          telegram_usernames: r.telegram?.trim() ? [r.telegram.trim().replace(/^@/, '')] : undefined,
          position: r.position?.trim() || undefined,
          company: r.company?.trim() || undefined,
          expected_salary_min: r.salary_min ?? undefined,
          expected_salary_max: r.salary_max ?? undefined,
          expected_salary_currency: r.salary_currency || undefined,
          extra_data: {
            source: 'resume_upload',
            ...(r.location ? { city: r.location, location: r.location } : {}),
            ...(r.experience_years != null ? { experience_years: r.experience_years } : {}),
            ...(r.skills?.length ? { skills: r.skills } : {}),
            ...(r.summary ? { summary: r.summary, resume_text: r.summary } : {}),
          },
        });
        createdEntityId = created.id;
        try {
          await uploadEntityFile(created.id, uploadedFile, 'resume');
        } catch (e) {
          console.error('attach resume file failed', e);
        }
      } else {
        // URL-парсинг — оставляем парент-flow (CandidatesDatabase открывает
        // pre-filled CreateCandidateModal). Просто пробрасываем данные.
        onParsed(parsedData);
        return;
      }

      if (!createdEntityId) {
        toast.error('Кандидат не создан — попробуйте ещё раз');
        return;
      }

      // Опционально цепляем на воронку.
      if (selectedVacancyId) {
        try {
          await createApplication(Number(selectedVacancyId), {
            vacancy_id: Number(selectedVacancyId),
            entity_id: createdEntityId,
            source: 'resume_upload',
          });
          const vacancyTitle = vacancyOptions.find(v => v.id === selectedVacancyId)?.title;
          toast.success(`Кандидат добавлен на воронку «${vacancyTitle ?? '...'}»`);
        } catch (e) {
          console.error('Attach to vacancy failed:', e);
          toast.error('Кандидат создан, но не удалось добавить на воронку');
        }
      } else {
        toast.success('Кандидат добавлен');
      }

      onParsed(parsedData);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка создания кандидата';
      toast.error(msg);
    } finally {
      setIsCreating(false);
    }
  };


  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
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
        className="bg-white text-slate-900 shadow-xl border border-slate-200 rounded-xl w-full max-w-lg max-h-[95vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[var(--hf-status-cyan-badge)] rounded-lg">
              <Search className="w-5 h-5 text-[var(--hf-cyan-400)]" aria-hidden="true" />
            </div>
            <h2 id="parser-modal-title" className="text-lg font-semibold">
              {isResume ? 'Парсинг резюме' : 'Парсинг вакансии'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label="Закрыть окно"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>


        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 no-scrollbar">
          {!parsedData ? (
            // File upload section
            <div className="space-y-4">
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
                    ? 'border-[color:var(--hf-cyan-500)] bg-[var(--hf-status-cyan-bg)]'
                    : 'border-slate-300 hover:border-slate-400 hover:bg-slate-100'
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
                  isDragging ? 'text-[var(--hf-cyan-400)]' : 'text-slate-400'
                )} aria-hidden="true" />
                <p className="text-slate-500 mb-2">
                  {isDragging
                    ? 'Отпустите файл для загрузки'
                    : 'Перетащите файл сюда или нажмите для выбора'
                  }
                </p>
                <p className="text-xs text-slate-400">
                  PDF, DOC, DOCX или TXT (максимум 10 МБ)
                </p>
                {error && (
                  <p className="text-xs text-[var(--hf-status-red)] mt-4 flex items-center justify-center gap-1" role="alert">
                    <AlertCircle className="w-3 h-3" aria-hidden="true" />
                    {error}
                  </p>
                )}
              </div>

              {/* Loading indicator — реальный % загрузки, затем индетерминантный AI-анализ */}
              {loading && (
                <div className="py-4 space-y-2" role="status" aria-live="polite">
                  <div className="flex items-center justify-center gap-2 text-[var(--hf-cyan-400)]">
                    <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                    <span>{uploadPct !== null ? `Загрузка файла… ${uploadPct}%` : 'AI анализирует резюме…'}</span>
                  </div>
                  <div className="h-1.5 bg-[var(--hf-white-alpha-10)] rounded-full overflow-hidden">
                    {uploadPct !== null ? (
                      <div className="h-full bg-[var(--hf-cyan-400)] rounded-full transition-all duration-200" style={{ width: `${uploadPct}%` }} />
                    ) : (
                      <motion.div
                        className="h-full w-1/3 bg-[var(--hf-cyan-400)] rounded-full"
                        animate={{ x: ['-100%', '300%'] }}
                        transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    )}
                  </div>
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

              {/* Vacancy attach picker — только для резюме с загруженным файлом.
                  Для URL-резюме сначала открывается форма редактирования карточки,
                  поэтому пикер тут не имеет смысла. */}
              {isResume && uploadedFile && (
                <div className="border-t border-slate-200 pt-4">
                  <label className="block text-sm font-medium text-slate-600 mb-2 flex items-center gap-2">
                    <Briefcase className="w-4 h-4" />
                    Добавить на воронку (опционально)
                  </label>
                  <select
                    value={selectedVacancyId}
                    onChange={(e) => setSelectedVacancyId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[color:var(--hf-cyan-500)]"
                    disabled={isCreating}
                  >
                    <option value="">— без воронки —</option>
                    {vacancyOptions.map(v => (
                      <option key={v.id} value={v.id}>{v.title}</option>
                    ))}
                  </select>
                  {vacancyOptions.length === 0 && (
                    <p className="text-xs text-slate-400 mt-1.5">У вас нет открытых воронок</p>
                  )}
                </div>
              )}

              {/* Matched candidates section for resume */}
              {isResume && (isSearchingCandidates || matchedCandidates.length > 0) && (
                <div className="border-t border-slate-200 pt-4">
                  <h3 className="text-sm font-medium text-slate-600 mb-3 flex items-center gap-2">
                    <UserCheck className="w-4 h-4" />
                    {isSearchingCandidates ? 'Поиск совпадений...' : `Найденные кандидаты (${matchedCandidates.length})`}
                  </h3>
                  {isSearchingCandidates ? (
                    <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Поиск существующих кандидатов...
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {matchedCandidates.map((candidate) => (
                        <div
                          key={candidate.id}
                          className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{candidate.name}</p>
                            <p className="text-xs text-slate-400 truncate">
                              {[candidate.email, candidate.phone, candidate.position].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <button
                            onClick={() => handleAttachToCandidate(candidate.id)}
                            disabled={isAttaching}
                            className="flex-shrink-0 ml-3 px-3 py-1.5 text-xs font-medium bg-[var(--hf-green-600)] hover:bg-[var(--hf-green-500)] text-slate-900 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
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
        <div className="flex items-center justify-end gap-3 p-4 border-t border-slate-200 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-500 hover:text-slate-900 transition-colors"
          >
            Отмена
          </button>
          {parsedData && (
            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--hf-cyan-600)] hover:bg-[var(--hf-cyan-500)] disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 rounded-lg transition-colors"
            >
              {isCreating ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="w-4 h-4" aria-hidden="true" />
              )}
              {isResume
                ? (selectedVacancyId ? 'Создать и добавить на воронку' : 'Создать нового кандидата')
                : 'Создать вакансию'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
