import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicForm, submitPublicForm, submitPublicFormWithFiles, getPublicFormByToken, submitPublicFormByToken } from '@/services/api/forms';
import type { PublicFormData } from '@/services/api/forms';
import { FieldRenderer } from '@/features/forms/FieldRenderer';

/**
 * PublicFormPage - Light-themed page for candidates to fill out a form.
 * This page is accessible WITHOUT authentication.
 */
export default function PublicFormPage() {
  const { slug, token } = useParams<{ slug?: string; token?: string }>();
  const [form, setForm] = useState<PublicFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
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
    if ((!slug && !token) || !validate()) return;

    setSubmitting(true);
    try {
      const files = Object.values(fileUploads);
      if (token) {
        await submitPublicFormByToken(token, values);
      } else if (files.length > 0) {
        await submitPublicFormWithFiles(slug!, values, files);
      } else {
        await submitPublicForm(slug!, values);
      }
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
            disabled={submitting}
            className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Отправка...' : 'Отправить'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          Powered by Enceladus
        </p>
      </div>
    </div>
  );
}
