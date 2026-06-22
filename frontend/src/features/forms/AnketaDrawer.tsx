import { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import toast from 'react-hot-toast';
import { Plus, LayoutGrid, Sparkles, X, Send, Inbox } from 'lucide-react';
import { FormBuilder } from './FormBuilder';
import { ANKETA_TEMPLATES } from './formTemplates';
import { AnketaResponses } from './AnketaResponses';
import {
  createForm, createDispatch, getEntityDispatches, markEntityDispatchesSeen,
  type FormDispatchInfo,
} from '@/services/api/forms';
import { useFormBadgeStore } from '@/stores/formBadgeStore';

type Step = 'entry' | 'builder' | 'responses';

export function AnketaDrawer({
  open, onOpenChange, entityId, entityName,
}: { open: boolean; onOpenChange: (v: boolean) => void; entityId: number; entityName: string }) {
  const [step, setStep] = useState<Step>('entry');
  const [formId, setFormId] = useState<number | null>(null);
  const [dispatches, setDispatches] = useState<FormDispatchInfo[]>([]);
  const clearBadge = useFormBadgeStore((s) => s.clear);

  const loadDispatches = useCallback(async () => {
    try { setDispatches(await getEntityDispatches(entityId)); } catch { /* ignore */ }
  }, [entityId]);

  useEffect(() => {
    if (open) { loadDispatches(); }
    else { setStep('entry'); setFormId(null); }
  }, [open, loadDispatches]);

  const openResponses = async () => {
    try {
      await markEntityDispatchesSeen(entityId);
      clearBadge(entityId);
      await loadDispatches();
    } catch { /* ignore */ }
    setStep('responses');
  };

  const startBlank = async () => {
    try {
      const form = await createForm({ title: `Анкета — ${entityName}`, fields: [
        { id: `f${Date.now()}`, type: 'text', label: 'ФИО', required: true },
      ] });
      setFormId(form.id); setStep('builder');
    } catch { toast.error('Не удалось создать анкету'); }
  };

  const startFromTemplate = async (tplKey: string) => {
    const tpl = ANKETA_TEMPLATES.find(t => t.key === tplKey);
    if (!tpl) return;
    try {
      const form = await createForm({
        title: `${tpl.title} — ${entityName}`,
        fields: tpl.fields.map((f, i) => ({ ...f, id: `f${Date.now()}_${i}` })),
      });
      setFormId(form.id); setStep('builder');
    } catch { toast.error('Не удалось создать анкету'); }
  };

  const sendToCandidate = async () => {
    if (!formId) return;
    try {
      const { url } = await createDispatch(formId, entityId);
      const full = `${window.location.origin}${url}`;
      await navigator.clipboard.writeText(full);
      toast.success('Персональная ссылка скопирована');
      await loadDispatches();
    } catch { toast.error('Не удалось создать ссылку'); }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-3xl bg-white shadow-xl flex flex-col">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <Dialog.Title className="text-base font-semibold text-gray-900">Анкета · {entityName}</Dialog.Title>
            <div className="flex items-center gap-3">
              <button onClick={openResponses} className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1">
                <Inbox className="w-4 h-4" /> Ответы
              </button>
              <Dialog.Close className="text-gray-400 hover:text-gray-700" aria-label="Закрыть"><X className="w-5 h-5" /></Dialog.Close>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {step === 'entry' && <EntryStep onBlank={startBlank} onTemplate={startFromTemplate} />}
            {step === 'builder' && formId && (
              <>
                <FormBuilder formId={formId} onClose={() => setStep('entry')} />
                <div className="sticky bottom-0 bg-white border-t px-5 py-3 flex justify-end gap-2">
                  <button onClick={sendToCandidate} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
                    <Send className="w-4 h-4" /> Отправить кандидату
                  </button>
                </div>
              </>
            )}
            {step === 'responses' && <AnketaResponses dispatches={dispatches} />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EntryStep({ onBlank, onTemplate }: { onBlank: () => void; onTemplate: (key: string) => void }) {
  return (
    <div className="p-5 space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button onClick={onBlank} className="border rounded-xl p-4 text-left hover:border-blue-400 transition-colors">
          <Plus className="w-5 h-5 text-gray-500" />
          <p className="mt-2 font-medium text-sm text-gray-900">С нуля</p>
          <p className="text-xs text-gray-500">Пустой конструктор</p>
        </button>
        <div className="border rounded-xl p-4">
          <LayoutGrid className="w-5 h-5 text-gray-500" />
          <p className="mt-2 font-medium text-sm text-gray-900">Из шаблона</p>
          <p className="text-xs text-gray-500 mb-2">Готовые пресеты</p>
          <div className="space-y-1">
            {ANKETA_TEMPLATES.map(t => (
              <button key={t.key} onClick={() => onTemplate(t.key)} className="block w-full text-left text-xs px-2 py-1 rounded hover:bg-gray-100 text-gray-700">
                {t.title}
              </button>
            ))}
          </div>
        </div>
        <div className="border rounded-xl p-4 opacity-60">
          <Sparkles className="w-5 h-5 text-gray-400" />
          <p className="mt-2 font-medium text-sm text-gray-900">AI-генерация</p>
          <p className="text-xs text-gray-500">Скоро</p>
        </div>
      </div>
    </div>
  );
}

// ResponsesStep вынесен в ./AnketaResponses (переиспользуется в табе карточки).
