import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getPublicForm, submitPublicForm, submitPublicFormWithFiles, getPublicFormByToken, submitPublicFormByToken, submitPublicFormByTokenWithFiles, type SkippedFile, type SubmitWithFilesResult } from '@/services/api/forms';
import type { PublicFormData } from '@/services/api/forms';
import { FieldRenderer } from '@/features/forms/FieldRenderer';

/**
 * PublicFormPage - Light-themed page for candidates to fill out a form.
 * This page is accessible WITHOUT authentication.
 */
export default function PublicFormPage() {
  const { slug, token } = useParams<{ slug?: string; token?: string }>();
  const [searchParams] = useSearchParams();
  // Предпросмотр (из конструктора): форма как видит кандидат, но БЕЗ отправки.
  const isPreview = searchParams.get('preview') === '1';
  const [form, setForm] = useState<PublicFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [skippedFiles, setSkippedFiles] = useState<SkippedFile[]>([]);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [fileUploads, setFileUploads] = useState<Record<string, File>>({});

  useEffect(() => {
    if (!slug && !token) return;
    (async () => {
      try {
        const data = token ? await getPublicFormByToken(token) : await getPublicForm(slug!);
        setForm(data);
        // Initialize default values
        const defaults: Record<string, unknown> = {};
        for (const field of data.fields) {
          if (field.type === 'multiselect') {
            defaults[field.id] = [];
          } else if (field.type === 'scale') {
            defaults[field.id] = null;
          } else {
            defaults[field.id] = '';
          }
        }
        setValues(defaults);
      } catch {
        setError('Форма не найдена или больше не активна');
      } finally {
        setLoading(false);
      }
    })();
  }, [slug, token]);

  const validate = (): boolean => {
    if (!form) return false;
    const errs: Record<string, string> = {};
    for (const field of form.fields) {
      if (field.required) {
        const val = values[field.id];
        if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
          errs[field.id] = 'Обязательное поле';
        }
      }
      // Basic email validation
      if (field.type === 'email' && values[field.id]) {
        const email = String(values[field.id]);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          errs[field.id] = 'Некорректный email';
        }
      }
    }
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPreview) return; // предпросмотр — ничего не отправляем
    if ((!slug && !token) || !validate()) return;

    setSubmitting(true);
    try {
      const files = Object.values(fileUploads);
      let result: SubmitWithFilesResult | undefined;
      if (token) {
        // Личная ссылка: с файлами — multipart, иначе JSON.
        if (files.length > 0) {
          result = await submitPublicFormByTokenWithFiles(token, values, files);
        } else {
          await submitPublicFormByToken(token, values);
        }
      } else if (files.length > 0) {
        result = await submitPublicFormWithFiles(slug!, values, files);
      } else {
        await submitPublicForm(slug!, values);
      }
      // Пропущенные файлы (формат/размер/лимит) — показываем кандидату, чтобы он
      // знал, что часть вложений не доставлена, а не считал анкету полной.
      if (result?.skipped_files?.length) setSkippedFiles(result.skipped_files);
      setSubmitted(true);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(message || 'Произошла ошибка при отправке');
    } finally {
      setSubmitting(false);
    }
  };

  const updateValue = (fieldId: string, value: unknown) => {
    setValues(prev => ({ ...prev, [fieldId]: value }));
    if (validationErrors[fieldId]) {
      setValidationErrors(prev => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      });
    }
  };

  // Light theme — white background for external candidates
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !form) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 text-lg">{error}</p>
        </div>
      </div>
    );
  }

  if (!form) return null;

  // Анкета уже заполнена (рекрутёр открыл по ссылке) — показываем ответы кандидата
  // read-only, а не пустую форму.
  if (form.already_submitted && form.answers) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
          <div className="text-center mb-8">
            <div className="text-sm font-semibold text-blue-600 tracking-wide uppercase mb-2">Enceladus</div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{form.title}</h1>
            <p className="text-green-600 mt-2 text-sm">✓ Анкета заполнена</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8 space-y-4">
            {form.fields.map(field => {
              const raw = form.answers?.[field.id];
              const text = Array.isArray(raw) ? raw.join(', ') : (raw == null || raw === '' ? '—' : String(raw));
              const fileUrl = form.file_links?.[field.id];
              const isUrl = /^https?:\/\//i.test(text);
              return (
                <div key={field.id}>
                  <div className="text-sm text-gray-500">{field.label}</div>
                  {fileUrl ? (
                    <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{text !== '—' ? text : 'Открыть файл'}</a>
                  ) : isUrl ? (
                    <a href={text} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{text}</a>
                  ) : (
                    <div className="text-gray-900 break-words whitespace-pre-wrap">{text}</div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-center text-xs text-gray-400 mt-6">Powered by Enceladus</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Спасибо!</h2>
          <p className="text-gray-500">Ваша анкета успешно отправлена. Мы свяжемся с вами в ближайшее время.</p>
          {skippedFiles.length > 0 && (
            <div className="mt-5 text-left bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-amber-800 mb-1">
                Внимание: часть файлов не была загружена
              </p>
              <ul className="text-sm text-amber-700 list-disc list-inside space-y-0.5">
                {skippedFiles.map((f, i) => (
                  <li key={i}><span className="font-medium">{f.name}</span> — {f.reason}</li>
                ))}
              </ul>
              <p className="text-xs text-amber-600 mt-2">
                Допустимы PDF, DOC/DOCX, JPG, PNG, WEBP до 10 МБ. При необходимости свяжитесь с рекрутёром.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-sm font-semibold text-blue-600 tracking-wide uppercase mb-2">
            Enceladus
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{form.title}</h1>
          {form.vacancy_title && (
            <p className="text-gray-500 mt-1">Вакансия: {form.vacancy_title}</p>
          )}
          {form.description && (
            <p className="text-gray-600 mt-3">{form.description}</p>
          )}
        </div>

        {isPreview && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm text-center">
            Режим предпросмотра — так анкету видит кандидат. Ответы не сохраняются.
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8 space-y-6">
          {form.fields.map(field => (
            <FieldRenderer
              key={field.id}
              field={field}
              value={values[field.id]}
              onChange={val => updateValue(field.id, val)}
              onFileChange={field.type === 'file' ? (file: File | null) => {
                setFileUploads(prev => {
                  const next = { ...prev };
                  if (file) {
                    next[field.id] = file;
                  } else {
                    delete next[field.id];
                  }
                  return next;
                });
              } : undefined}
              selectedFile={fileUploads[field.id] || null}
              error={validationErrors[field.id]}
            />
          ))}

          <button
            type="submit"
            disabled={submitting || isPreview}
            className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPreview ? 'Предпросмотр — отправка отключена' : submitting ? 'Отправка...' : 'Отправить'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          Powered by Enceladus
        </p>
      </div>
    </div>
  );
}
