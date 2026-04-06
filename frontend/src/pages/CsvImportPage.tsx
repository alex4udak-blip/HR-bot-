import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  FileSpreadsheet,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Users,
} from 'lucide-react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { STATUS_LABELS } from '@/types';
import type { EntityStatus } from '@/types';

// ---------- types ----------

interface PreviewResponse {
  headers: string[];
  rows: string[][];
  suggested_mapping: Record<string, string>;
  row_count: number;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

interface Vacancy {
  id: number;
  title: string;
}

// ---------- constants ----------

const FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '(пропустить)' },
  { value: 'name', label: 'Имя' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Телефон' },
  { value: 'position', label: 'Должность' },
  { value: 'company', label: 'Компания' },
  { value: 'status', label: 'Статус' },
  { value: 'tags', label: 'Теги' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'source', label: 'Источник' },
  { value: 'comment', label: 'Комментарий' },
];

const STATUS_OPTIONS: { value: EntityStatus; label: string }[] = [
  { value: 'new', label: STATUS_LABELS.new },
  { value: 'screening', label: STATUS_LABELS.screening },
  { value: 'practice', label: STATUS_LABELS.practice },
  { value: 'tech_practice', label: STATUS_LABELS.tech_practice },
  { value: 'is_interview', label: STATUS_LABELS.is_interview },
  { value: 'offer', label: STATUS_LABELS.offer },
  { value: 'hired', label: STATUS_LABELS.hired },
  { value: 'rejected', label: STATUS_LABELS.rejected },
  { value: 'withdrawn', label: STATUS_LABELS.withdrawn },
];

const stepVariants = {
  enter: { opacity: 0, x: 40 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -40 },
};

// ---------- helpers ----------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------- component ----------

export default function CsvImportPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Wizard step: 1=upload, 2=preview+mapping, 3=results
  const [step, setStep] = useState(1);

  // Step 1: file
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Step 2: preview + mapping
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [defaultStatus, setDefaultStatus] = useState<EntityStatus>('new');
  const [vacancyId, setVacancyId] = useState<string>('');
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // Step 3: results
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState('');
  const [errorsExpanded, setErrorsExpanded] = useState(false);

  // ---- drag-and-drop handlers ----
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && dropped.name.endsWith('.csv')) {
      setFile(dropped);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  };

  // ---- step transitions ----
  const goToPreview = async () => {
    if (!file) return;
    setPreviewLoading(true);
    setPreviewError('');

    try {
      // Fetch preview
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/import/preview', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Server error' }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: PreviewResponse = await res.json();
      setPreview(data);

      // Apply suggested mapping
      const mapping: Record<string, string> = {};
      for (const header of data.headers) {
        mapping[header] = data.suggested_mapping[header] || '';
      }
      setColumnMapping(mapping);

      // Fetch vacancies for optional dropdown
      try {
        const vacRes = await fetch('/api/magic-button/vacancies');
        if (vacRes.ok) {
          const vacData = await vacRes.json();
          setVacancies(Array.isArray(vacData) ? vacData : []);
        }
      } catch {
        // vacancies are optional
      }

      setStep(2);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Failed to preview file');
    } finally {
      setPreviewLoading(false);
    }
  };

  const executeImport = async () => {
    if (!file) return;
    setImporting(true);
    setImportError('');
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('column_mapping', JSON.stringify(columnMapping));
      formData.append('default_status', defaultStatus);
      formData.append('skip_duplicates', String(skipDuplicates));
      if (vacancyId) formData.append('vacancy_id', vacancyId);

      const res = await fetch('/api/import/execute', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Server error' }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: ImportResult = await res.json();
      setResult(data);
      setStep(3);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const restart = () => {
    setStep(1);
    setFile(null);
    setPreview(null);
    setColumnMapping({});
    setDefaultStatus('new');
    setVacancyId('');
    setSkipDuplicates(true);
    setResult(null);
    setImportError('');
    setPreviewError('');
    setErrorsExpanded(false);
  };

  // ---------- render ----------

  return (
    <div className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl mx-auto space-y-6 w-full"
      >
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <FileSpreadsheet className="w-6 h-6 text-accent-500" />
            <h1 className="text-2xl font-bold">Импорт CSV</h1>
          </div>
          <p className="text-dark-400">
            Загрузите CSV-файл с кандидатами, настройте маппинг колонок и импортируйте данные.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {[
            { num: 1, label: 'Загрузка' },
            { num: 2, label: 'Маппинг' },
            { num: 3, label: 'Результат' },
          ].map((s, i) => (
            <div key={s.num} className="flex items-center gap-2">
              {i > 0 && <div className={clsx('w-8 h-px', step >= s.num ? 'bg-accent-500' : 'bg-white/10')} />}
              <div
                className={clsx(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  step === s.num
                    ? 'bg-accent-500/20 text-accent-400'
                    : step > s.num
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-white/[0.04] text-white/30'
                )}
              >
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs border border-current">
                  {step > s.num ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.num}
                </span>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          {/* ===== STEP 1: Upload ===== */}
          {step === 1 && (
            <motion.div
              key="step1"
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25 }}
              className="space-y-4"
            >
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={clsx(
                  'border-2 border-dashed rounded-2xl p-12 flex flex-col items-center gap-4 cursor-pointer transition-all duration-200',
                  dragActive
                    ? 'border-accent-500 bg-accent-500/10'
                    : file
                      ? 'border-green-500/40 bg-green-500/5'
                      : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div
                  className={clsx(
                    'w-16 h-16 rounded-2xl flex items-center justify-center',
                    file ? 'bg-green-500/20' : 'bg-white/[0.06]'
                  )}
                >
                  <Upload className={clsx('w-8 h-8', file ? 'text-green-400' : 'text-white/40')} />
                </div>
                {file ? (
                  <div className="text-center">
                    <p className="text-white font-medium">{file.name}</p>
                    <p className="text-dark-400 text-sm">{formatFileSize(file.size)}</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-white/60 font-medium">
                      Перетащите CSV-файл сюда
                    </p>
                    <p className="text-dark-400 text-sm mt-1">
                      или нажмите для выбора файла
                    </p>
                  </div>
                )}
              </div>

              {previewError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  <XCircle className="w-4 h-4 flex-shrink-0" />
                  {previewError}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={goToPreview}
                  disabled={!file || previewLoading}
                  className={clsx(
                    'flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                    file && !previewLoading
                      ? 'bg-gradient-to-r from-accent-500 to-accent-600 text-white hover:from-accent-600 hover:to-accent-700 shadow-lg shadow-accent-500/20'
                      : 'bg-white/[0.06] text-white/30 cursor-not-allowed'
                  )}
                >
                  {previewLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      Далее
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* ===== STEP 2: Preview & Mapping ===== */}
          {step === 2 && preview && (
            <motion.div
              key="step2"
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              {/* Preview table */}
              <div>
                <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">
                  Предпросмотр ({preview.row_count} строк)
                </h2>
                <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        {preview.headers.map((h) => (
                          <th
                            key={h}
                            className="px-3 py-2.5 text-left text-xs font-semibold text-white/40 uppercase tracking-wider bg-white/[0.02]"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, ri) => (
                        <tr
                          key={ri}
                          className="border-b border-white/[0.03] hover:bg-white/[0.02]"
                        >
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-3 py-2 text-white/70 truncate max-w-[200px]">
                              {cell || <span className="text-white/20">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Column mapping */}
              <div>
                <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">
                  Маппинг колонок
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {preview.headers.map((header) => (
                    <div
                      key={header}
                      className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]"
                    >
                      <span className="text-sm text-white/60 font-medium min-w-[100px] truncate">
                        {header}
                      </span>
                      <ChevronRight className="w-4 h-4 text-white/20 flex-shrink-0" />
                      <select
                        value={columnMapping[header] || ''}
                        onChange={(e) =>
                          setColumnMapping((prev) => ({ ...prev, [header]: e.target.value }))
                        }
                        className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent-500/50 transition-colors"
                      >
                        {FIELD_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Settings */}
              <div>
                <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">
                  Настройки импорта
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Default status */}
                  <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <label className="block text-xs text-white/40 mb-2 font-medium">
                      Статус по умолчанию
                    </label>
                    <select
                      value={defaultStatus}
                      onChange={(e) => setDefaultStatus(e.target.value as EntityStatus)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500/50 transition-colors"
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Vacancy (optional) */}
                  <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <label className="block text-xs text-white/40 mb-2 font-medium">
                      Привязать к вакансии (опционально)
                    </label>
                    <select
                      value={vacancyId}
                      onChange={(e) => setVacancyId(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500/50 transition-colors"
                    >
                      <option value="">Не привязывать</option>
                      {vacancies.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Skip duplicates */}
                  <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] sm:col-span-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={skipDuplicates}
                        onChange={(e) => setSkipDuplicates(e.target.checked)}
                        className="w-4 h-4 rounded border-white/20 bg-white/[0.04] text-accent-500 focus:ring-accent-500 focus:ring-offset-0"
                      />
                      <span className="text-sm text-white/70">
                        Пропускать дубликаты по email
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              {importError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  <XCircle className="w-4 h-4 flex-shrink-0" />
                  {importError}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition-all duration-200"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Назад
                </button>
                <button
                  onClick={executeImport}
                  disabled={importing}
                  className={clsx(
                    'flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                    !importing
                      ? 'bg-gradient-to-r from-accent-500 to-accent-600 text-white hover:from-accent-600 hover:to-accent-700 shadow-lg shadow-accent-500/20'
                      : 'bg-white/[0.06] text-white/30 cursor-not-allowed'
                  )}
                >
                  {importing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Импортируется...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Импортировать
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* ===== STEP 3: Results ===== */}
          {step === 3 && result && (
            <motion.div
              key="step3"
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              {/* Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-5 rounded-2xl bg-green-500/10 border border-green-500/20">
                  <div className="flex items-center gap-3 mb-2">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <span className="text-sm text-green-400 font-medium">Импортировано</span>
                  </div>
                  <p className="text-3xl font-bold text-green-300">{result.imported}</p>
                </div>
                <div className="p-5 rounded-2xl bg-yellow-500/10 border border-yellow-500/20">
                  <div className="flex items-center gap-3 mb-2">
                    <AlertTriangle className="w-5 h-5 text-yellow-400" />
                    <span className="text-sm text-yellow-400 font-medium">Пропущено</span>
                  </div>
                  <p className="text-3xl font-bold text-yellow-300">{result.skipped}</p>
                </div>
                <div className="p-5 rounded-2xl bg-red-500/10 border border-red-500/20">
                  <div className="flex items-center gap-3 mb-2">
                    <XCircle className="w-5 h-5 text-red-400" />
                    <span className="text-sm text-red-400 font-medium">Ошибки</span>
                  </div>
                  <p className="text-3xl font-bold text-red-300">{result.errors.length}</p>
                </div>
              </div>

              {/* Error details (expandable) */}
              {result.errors.length > 0 && (
                <div className="rounded-xl border border-red-500/20 overflow-hidden">
                  <button
                    onClick={() => setErrorsExpanded(!errorsExpanded)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-red-500/5 hover:bg-red-500/10 transition-colors"
                  >
                    <span className="text-sm font-medium text-red-400">
                      Детали ошибок ({result.errors.length})
                    </span>
                    {errorsExpanded ? (
                      <ChevronUp className="w-4 h-4 text-red-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-red-400" />
                    )}
                  </button>
                  <AnimatePresence>
                    {errorsExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="max-h-64 overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-white/[0.06]">
                                <th className="px-4 py-2 text-left text-xs font-semibold text-white/40 uppercase tracking-wider bg-white/[0.02] w-24">
                                  Строка
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-semibold text-white/40 uppercase tracking-wider bg-white/[0.02]">
                                  Причина
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {result.errors.map((err, i) => (
                                <tr
                                  key={i}
                                  className="border-b border-white/[0.03] hover:bg-white/[0.02]"
                                >
                                  <td className="px-4 py-2 text-white/50 font-mono">
                                    {err.row}
                                  </td>
                                  <td className="px-4 py-2 text-red-300/80">
                                    {err.reason}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  onClick={restart}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-white/[0.06] text-white/70 hover:bg-white/[0.1] hover:text-white transition-all duration-200"
                >
                  <RotateCcw className="w-4 h-4" />
                  Импортировать ещё
                </button>
                <button
                  onClick={() => navigate('/all-candidates')}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-accent-500 to-accent-600 text-white hover:from-accent-600 hover:to-accent-700 shadow-lg shadow-accent-500/20 transition-all duration-200"
                >
                  <Users className="w-4 h-4" />
                  К кандидатам
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
