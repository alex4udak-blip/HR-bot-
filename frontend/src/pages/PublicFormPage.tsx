import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicForm, submitPublicForm } from '@/services/api/forms';
import type { PublicFormData, FormField } from '@/services/api/forms';

/**
 * PublicFormPage - Light-themed page for candidates to fill out a form.
 * This page is accessible WITHOUT authentication.
 */
export default function PublicFormPage() {
  const { slug } = useParams<{ slug: string }>();
  const [form, setForm] = useState<PublicFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const data = await getPublicForm(slug);
        setForm(data);
        // Initialize default values
        const defaults: Record<string, unknown> = {};
        for (const field of data.fields) {
          if (field.type === 'multiselect') {
            defaults[field.id] = [];
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
  }, [slug]);

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
    if (!slug || !validate()) return;

    setSubmitting(true);
    try {
      await submitPublicForm(slug, values);
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
            <FormFieldRenderer
              key={field.id}
              field={field}
              value={values[field.id]}
              onChange={val => updateValue(field.id, val)}
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

// ============================================================
// Field renderer
// ============================================================

function FormFieldRenderer({
  field,
  value,
  onChange,
  error,
}: {
  field: FormField;
  value: unknown;
  onChange: (val: unknown) => void;
  error?: string;
}) {
  const inputClasses = `w-full px-4 py-2.5 border rounded-xl text-gray-900 placeholder-gray-400 outline-none transition-colors focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 ${
    error ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-white'
  }`;

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>

      {field.type === 'text' && (
        <input
          type="text"
          value={String(value || '')}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={inputClasses}
        />
      )}

      {field.type === 'email' && (
        <input
          type="email"
          value={String(value || '')}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder || 'email@example.com'}
          className={inputClasses}
        />
      )}

      {field.type === 'phone' && (
        <input
          type="tel"
          value={String(value || '')}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder || '+7 (999) 123-45-67'}
          className={inputClasses}
        />
      )}

      {field.type === 'textarea' && (
        <textarea
          value={String(value || '')}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          className={inputClasses + ' resize-y'}
        />
      )}

      {field.type === 'select' && (
        <select
          value={String(value || '')}
          onChange={e => onChange(e.target.value)}
          className={inputClasses}
        >
          <option value="">-- Выберите --</option>
          {(field.options || []).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )}

      {field.type === 'radio' && (
        <div className="space-y-2 mt-1">
          {(field.options || []).map(opt => (
            <label key={opt} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="radio"
                name={field.id}
                value={opt}
                checked={value === opt}
                onChange={() => onChange(opt)}
                className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
              <span className="text-gray-700 group-hover:text-gray-900 transition-colors">{opt}</span>
            </label>
          ))}
        </div>
      )}

      {field.type === 'multiselect' && (
        <div className="space-y-2 mt-1">
          {(field.options || []).map(opt => {
            const selected = Array.isArray(value) ? value as string[] : [];
            const isChecked = selected.includes(opt);
            return (
              <label key={opt} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => {
                    if (isChecked) {
                      onChange(selected.filter(v => v !== opt));
                    } else {
                      onChange([...selected, opt]);
                    }
                  }}
                  className="w-4 h-4 rounded text-blue-600 border-gray-300 focus:ring-blue-500"
                />
                <span className="text-gray-700 group-hover:text-gray-900 transition-colors">{opt}</span>
              </label>
            );
          })}
        </div>
      )}

      {field.type === 'file' && (
        <div className="mt-1">
          <label className="flex items-center justify-center w-full px-4 py-6 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
            <div className="text-center">
              <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span className="text-sm text-gray-500">
                {value ? String(value) : 'Нажмите для выбора файла'}
              </span>
            </div>
            <input
              type="file"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) onChange(file.name);
              }}
            />
          </label>
        </div>
      )}

      {error && (
        <p className="text-red-500 text-xs mt-1">{error}</p>
      )}
    </div>
  );
}
