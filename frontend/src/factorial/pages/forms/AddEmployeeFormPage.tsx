import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/factorial/components/ui/input';
import FactorialFormPage from '@/factorial/components/FactorialFormPage';
import FormSection from '@/factorial/components/FormSection';
import FormField from '@/factorial/components/FormField';
import StepNavigator from '@/factorial/components/StepNavigator';
import { useMockSave } from '@/factorial/components/MockSaveToast';
import { useEmployeeStore } from '@/factorial/stores/useEmployeeStore';

const STEPS = [
  { number: 1, label: 'Общая информация' },
  { number: 2, label: 'Личные данные' },
  { number: 3, label: 'Детали работы' },
  { number: 4, label: 'Информация о соглашениях' },
  { number: 5, label: 'Основные настройки' },
];

export default function AddEmployeeFormPage() {
  const navigate = useNavigate();
  const mockSave = useMockSave();
  const addEmployee = useEmployeeStore((s) => s.addEmployee);
  const [step, setStep] = useState(1);
  const [data, setData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    position: '',
    location: 'MSTech L.L.C-FZ',
  });

  const onSubmit = () => {
    addEmployee({
      fullName: `${data.firstName} ${data.lastName}`.trim() || 'Новый сотрудник',
      position: data.position,
      location: data.location,
      hiredAt: new Date().toISOString().slice(0, 10),
      accessStatus: 'active',
      contractStatus: 'pending',
    });
    mockSave();
    navigate('/factorial/employees');
  };

  return (
    <FactorialFormPage
      icon={<UserPlus className="w-7 h-7 text-rose-500" strokeWidth={1.5} />}
      iconBg="bg-rose-50"
      breadcrumb={[{ label: 'Сотрудники', href: '/employees' }, { label: 'Добавить сотрудника' }]}
      title="Добавить сотрудника"
      submitLabel={step < 5 ? 'Далее' : 'Добавить'}
      onSubmit={step < 5 ? () => setStep(step + 1) : onSubmit}
      stepNavigator={<StepNavigator steps={STEPS} activeStep={step} />}
      tipPanel={
        step === 1
          ? 'Если этот сотрудник работает более чем на одном рынке или для нескольких компаний, мы рекомендуем включать его в основное Юридическое лицо.'
          : undefined
      }
    >
      {step === 1 && (
        <>
          <FormSection heading="Mandatory fields">
            <FormField
              label="Электронная почта"
              required
              error={!data.email ? 'Пусто' : undefined}
            >
              <Input
                value={data.email}
                onChange={(e) => setData({ ...data, email: e.target.value })}
                placeholder="alicia.anderson@factorial.com"
                type="email"
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Имя" required>
                <Input
                  value={data.firstName}
                  onChange={(e) => setData({ ...data, firstName: e.target.value })}
                  placeholder="Например, Alicia"
                />
              </FormField>
              <FormField label="Фамилия" required>
                <Input
                  value={data.lastName}
                  onChange={(e) => setData({ ...data, lastName: e.target.value })}
                  placeholder="Например, Anderson"
                />
              </FormField>
            </div>
          </FormSection>
          <FormSection heading="Данные о трудоустройстве">
            <FormField label="Юридическое лицо">
              <Input value="GLOBAL SALES EUROPE LTD" readOnly />
            </FormField>
            <FormField label="Группа сотрудников">
              <Input placeholder="Выберите вариант" readOnly />
            </FormField>
          </FormSection>
          <FormSection heading="Персональные данные">
            <FormField label="Должность">
              <Input
                value={data.position}
                onChange={(e) => setData({ ...data, position: e.target.value })}
                placeholder="Например, Recruiter / General"
              />
            </FormField>
          </FormSection>
        </>
      )}
      {step > 1 && step <= 5 && (
        <FormSection heading={STEPS[step - 1].label}>
          <div className="text-center py-12 text-text-muted">
            <p>Раздел в разработке — оставлено для будущей фазы.</p>
            <p className="text-fx-xs mt-2">
              Нажмите «{step < 5 ? 'Далее' : 'Добавить'}» чтобы продолжить.
            </p>
          </div>
        </FormSection>
      )}
    </FactorialFormPage>
  );
}
