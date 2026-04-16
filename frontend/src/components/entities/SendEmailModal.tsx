import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, Send, Loader2, Eye, ChevronDown, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getEmailTemplates,
  previewEmail,
  sendEmail,
  type EmailTemplate,
} from '@/services/api/emailTemplates';

interface SendEmailModalProps {
  entityId: number;
  entityName: string;
  entityEmail?: string;
  vacancyId?: number;
  onClose: () => void;
  onSuccess?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  welcome: 'Приветственное',
  rejection: 'Отказ',
  interview_invite: 'Приглашение на собеседование',
  interview_reminder: 'Напоминание',
  offer: 'Оффер',
  screening_request: 'Скрининг',
  test_assignment: 'Тестовое задание',
  follow_up: 'Фоллоу-ап',
  custom: 'Другое',
};

export default function SendEmailModal({
  entityId,
  entityName,
  entityEmail,
  vacancyId,
  onClose,
  onSuccess,
}: SendEmailModalProps) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const loadTemplates = useCallback(async () => {
    try {
      const data = await getEmailTemplates();
      setTemplates(data.filter(t => t.is_active));
    } catch {
      toast.error('Не удалось загрузить шаблоны');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleTemplateSelect = async (templateId: number) => {
    setSelectedTemplateId(templateId);
    setPreviewing(true);
    setShowPreview(false);
    try {
      const preview = await previewEmail({
        template_id: templateId,
        entity_id: entityId,
        vacancy_id: vacancyId,
      });
      setSubject(preview.subject);
      setBody(preview.body_html);
    } catch {
      toast.error('Не удалось загрузить превью');
    } finally {
      setPreviewing(false);
    }
  };

  const handleSend = async () => {
    if (!selectedTemplateId) {
      toast.error('Выберите шаблон');
      return;
    }
    if (!entityEmail) {
      toast.error('У кандидата не указан email');
      return;
    }
    setSending(true);
    try {
      await sendEmail({
        template_id: selectedTemplateId,
        entity_id: entityId,
        vacancy_id: vacancyId,
        subject_override: subject,
        body_override: body,
      });
      toast.success(`Письмо отправлено на ${entityEmail}`);
      onSuccess?.();
      onClose();
    } catch {
      toast.error('Ошибка отправки письма');
    } finally {
      setSending(false);
    }
  };

  // Group templates by type
  const grouped = templates.reduce<Record<string, EmailTemplate[]>>((acc, t) => {
    const type = t.template_type || 'custom';
    if (!acc[type]) acc[type] = [];
    acc[type].push(t);
    return acc;
  }, {});

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-white dark:bg-dark-900 rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Mail className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Отправить письмо</h2>
              <p className="text-xs text-gray-500 dark:text-dark-400">
                {entityName} {entityEmail ? `· ${entityEmail}` : '· email не указан'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {!entityEmail && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
              <p className="text-sm text-red-600 dark:text-red-400">
                У кандидата не указан email. Добавьте email через "Редактировать" перед отправкой.
              </p>
            </div>
          )}

          {/* Template selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-dark-300 mb-1.5">
              Шаблон письма
            </label>
            {loading ? (
              <div className="flex items-center gap-2 py-3">
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                <span className="text-sm text-gray-400">Загрузка шаблонов...</span>
              </div>
            ) : templates.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">Нет доступных шаблонов. Создайте шаблон в разделе "Центр отчётов".</p>
            ) : (
              <div className="relative">
                <select
                  value={selectedTemplateId || ''}
                  onChange={(e) => {
                    const id = parseInt(e.target.value);
                    if (id) handleTemplateSelect(id);
                  }}
                  className="w-full appearance-none bg-white dark:bg-dark-800 border border-gray-300 dark:border-white/10 rounded-xl px-4 py-2.5 pr-10 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value="">Выберите шаблон...</option>
                  {Object.entries(grouped).map(([type, tmpls]) => (
                    <optgroup key={type} label={TYPE_LABELS[type] || type}>
                      {tmpls.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            )}
          </div>

          {/* Subject */}
          {selectedTemplateId && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-dark-300 mb-1.5">
                  Тема письма
                </label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-white dark:bg-dark-800 border border-gray-300 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  placeholder="Тема..."
                />
              </div>

              {/* Body */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-dark-300">
                    Текст письма
                  </label>
                  <button
                    onClick={() => setShowPreview(!showPreview)}
                    className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    {showPreview ? 'Редактор' : 'Превью'}
                  </button>
                </div>
                {previewing ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  </div>
                ) : showPreview ? (
                  <div
                    className="w-full min-h-[200px] max-h-[300px] overflow-y-auto bg-white dark:bg-dark-800 border border-gray-300 dark:border-white/10 rounded-xl p-4 text-sm text-gray-900 dark:text-white prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: body }}
                  />
                ) : (
                  <textarea
                    value={body.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')}
                    onChange={(e) => {
                      const text = e.target.value;
                      setBody(text.split('\n').map(l => l || '<br>').join('<br>'));
                    }}
                    rows={8}
                    className="w-full bg-white dark:bg-dark-800 border border-gray-300 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                    placeholder="Текст письма..."
                  />
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-dark-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !selectedTemplateId || !entityEmail}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Отправить
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
