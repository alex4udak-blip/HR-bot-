import type { FormField } from '@/services/api/forms';

export function FieldRenderer({
  field,
  value,
  onChange,
  onFileChange,
  selectedFile,
  error,
}: {
  field: FormField;
  value: unknown;
  onChange: (val: unknown) => void;
  onFileChange?: (file: File | null) => void;
  selectedFile?: File | null;
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
          inputMode="tel"
          value={String(value || '')}
          // Только телефонные символы: цифры, +, пробел, скобки, дефис. Буквы не пускаем.
          onChange={e => onChange(e.target.value.replace(/[^\d+()\-\s]/g, ''))}
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

      {field.type === 'url' && (
        <input
          type="url"
          value={String(value || '')}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder || 'https://...'}
          className={inputClasses}
        />
      )}

      {field.type === 'scale' && (
        <div className="flex flex-wrap gap-2 mt-1">
          {Array.from({ length: (field.max ?? 10) - (field.min ?? 1) + 1 }, (_, i) => (field.min ?? 1) + i).map(n => (
            <button
              type="button"
              key={n}
              onClick={() => onChange(n)}
              className={`w-10 h-10 rounded-full border text-sm transition-colors ${
                value === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-blue-400'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {field.type === 'file' && (
        <div className="mt-1">
          {selectedFile ? (
            <div className="flex items-center gap-3 px-4 py-3 border border-gray-300 rounded-xl bg-gray-50">
              <svg className="w-6 h-6 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 truncate">{selectedFile.name}</p>
                <p className="text-xs text-gray-500">{(selectedFile.size / 1024 / 1024).toFixed(1)} МБ</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  onFileChange?.(null);
                }}
                className="text-gray-400 hover:text-red-500 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <label className="flex items-center justify-center w-full px-4 py-6 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
              <div className="text-center">
                <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="text-sm text-gray-500">Нажмите для выбора файла</span>
                <span className="block text-xs text-gray-400 mt-1">PDF, DOC, DOCX, JPG, PNG — до 10 МБ</span>
              </div>
              <input
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onChange(file.name);
                    onFileChange?.(file);
                  }
                }}
              />
            </label>
          )}
        </div>
      )}

      {error && (
        <p className="text-red-500 text-xs mt-1">{error}</p>
      )}
    </div>
  );
}
