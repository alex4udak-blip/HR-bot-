import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plus,
  Trash2,
  Copy,
  FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getMyForms,
  createForm,
  deleteForm,
} from '@/services/api/forms';
import type { FormTemplate } from '@/services/api/forms';
import { FormBuilder, nextFieldId, fieldWord, submissionWord } from '@/features/forms/FormBuilder';

// ============================================================
// List mode component
// ============================================================

function FormListView() {
  const navigate = useNavigate();
  const [forms, setForms] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const loadForms = useCallback(async () => {
    try {
      const data = await getMyForms();
      setForms(data);
    } catch {
      toast.error('Не удалось загрузить формы');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadForms(); }, [loadForms]);

  const handleCreate = async () => {
    try {
      const form = await createForm({
        title: 'Новая анкета',
        fields: [
          { id: nextFieldId(), type: 'text', label: 'ФИО', required: true, placeholder: 'Иван Иванов' },
          { id: nextFieldId(), type: 'email', label: 'Email', required: true },
        ],
      });
      navigate(`/form-builder/${form.id}`);
    } catch {
      toast.error('Не удалось создать форму');
    }
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Удалить форму? Все ответы будут потеряны.')) return;
    try {
      await deleteForm(id);
      setForms(prev => prev.filter(f => f.id !== id));
      toast.success('Форма удалена');
    } catch {
      toast.error('Не удалось удалить');
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Конструктор форм</h1>
          <p className="text-dark-400 text-sm mt-1">
            Создавайте анкеты для кандидатов и делитесь ссылкой
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent-500 hover:bg-accent-600 text-white rounded-xl font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Создать форму
        </button>
      </div>

      {forms.length === 0 ? (
        <div className="text-center py-20 text-dark-400">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg">Пока нет форм</p>
          <p className="text-sm mt-1">Создайте первую форму для сбора анкет кандидатов</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {forms.map(form => (
            <motion.div
              key={form.id}
              layout
              onClick={() => navigate(`/form-builder/${form.id}`)}
              className="bg-dark-800 border border-dark-700 rounded-xl p-4 hover:border-dark-600 cursor-pointer transition-colors group"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-white truncate">{form.title}</h3>
                    {!form.is_active && (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-dark-600 text-dark-400">
                        Неактивна
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-dark-400">
                    <span>{form.fields.length} {fieldWord(form.fields.length)}</span>
                    <span>{form.submissions_count} {submissionWord(form.submissions_count)}</span>
                    {form.created_at && (
                      <span>{new Date(form.created_at).toLocaleDateString('ru')}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const url = `${window.location.origin}/form/${form.slug}`;
                      navigator.clipboard.writeText(url);
                      toast.success('Ссылка скопирована');
                    }}
                    className="p-2 rounded-lg hover:bg-dark-700 text-dark-400 hover:text-white transition-colors"
                    title="Скопировать ссылку"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => handleDelete(form.id, e)}
                    className="p-2 rounded-lg hover:bg-red-500/20 text-dark-400 hover:text-red-400 transition-colors"
                    title="Удалить"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main page
// ============================================================

export default function FormBuilderPage() {
  const { formId } = useParams<{ formId: string }>();
  const navigate = useNavigate();

  if (formId) {
    return <FormBuilder formId={parseInt(formId, 10)} onClose={() => navigate('/form-builder')} />;
  }

  return <FormListView />;
}
