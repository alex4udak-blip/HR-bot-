import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { buildMergePlan, defaultMergeChoices, type Side } from '../CandidateCompareCard';
import { MergePlanPanel } from '../MergePlanPanel';

/**
 * Пополевое слияние дублей. Раньше «Объединить» молча оставлял всё с левой
 * анкеты, и значения правой терялись. Теперь по каждому расхождению решает
 * рекрутёр — и это решение уходит на бэк как «left/right», без самих значений.
 */

const side = (over: Partial<Side> = {}): Side => ({
  name: '', photo: '', position: '', company: '', phone: '', email: '', telegram: '',
  age: '', birthDate: '', city: '', salary: '', experience: '', source: '', tags: '',
  statusLabel: '', isRejected: false, rejectReason: '', rejectedAt: '', history: [],
  resumes: [], resumeText: '', resumeExtra: { experience: '', skills: '', languages: '', education: '' },
  notes: [], ...over,
});

describe('buildMergePlan', () => {
  it('расхождение — конфликт, пустое слева — заполнение, совпадение — без изменений', () => {
    const plan = buildMergePlan(
      side({ name: 'Гончарова Алиса', company: 'Wildberries', position: '', city: 'Москва' }),
      side({ name: 'Гончарова Алиса Игоревна', company: 'Ozon', position: 'UX-дизайнер', city: 'москва' }),
    );
    const kind = Object.fromEntries(plan.map((r) => [r.key, r.kind]));
    expect(kind.name).toBe('conflict');
    expect(kind.company).toBe('conflict');
    expect(kind.position).toBe('fill');
    expect(kind.city).toBe('keep'); // регистр не считается расхождением
  });

  it('один и тот же телефон в разном формате — не конфликт', () => {
    const plan = buildMergePlan(side({ phone: '+7 903 118-44-01' }), side({ phone: '8 (903) 1184401' }));
    expect(plan.find((r) => r.key === 'phone')?.kind).toBe('keep');
  });

  it('telegram с @ и без — не конфликт', () => {
    const plan = buildMergePlan(side({ telegram: '@Alisa_Old' }), side({ telegram: 'alisa_old' }));
    expect(plan.find((r) => r.key === 'telegram')?.kind).toBe('keep');
  });

  it('поле, пустое с обеих сторон, в план не попадает', () => {
    const plan = buildMergePlan(side({ name: 'А Б' }), side({ name: 'А Б' }));
    expect(plan.find((r) => r.key === 'salary')).toBeUndefined();
  });

  it('по умолчанию: конфликт — как слева (прежнее поведение), пустое — заполнить справа', () => {
    const plan = buildMergePlan(
      side({ name: 'Гончарова Алиса', position: '' }),
      side({ name: 'Гончарова Алиса Игоревна', position: 'UX-дизайнер' }),
    );
    expect(defaultMergeChoices(plan)).toEqual({ name: 'target', position: 'source' });
  });
});

describe('MergePlanPanel', () => {
  const plan = buildMergePlan(
    side({ name: 'Гончарова Алиса', company: 'Wildberries', position: '' }),
    side({ name: 'Гончарова Алиса Игоревна', company: 'Ozon', position: 'UX-дизайнер' }),
  );

  it('показывает обе версии расходящегося поля и отдаёт выбор наверх', async () => {
    const onChoose = vi.fn();
    render(
      <MergePlanPanel plan={plan} choices={defaultMergeChoices(plan)} onChoose={onChoose} leftId={1} rightId={2} />,
    );

    expect(screen.getByText('Wildberries')).toBeTruthy();
    await userEvent.click(screen.getByText('Ozon'));
    expect(onChoose).toHaveBeenCalledWith('company', 'source');
  });

  it('пустое слева предлагает взять справа и позволяет отказаться', async () => {
    const onChoose = vi.fn();
    render(
      <MergePlanPanel plan={plan} choices={defaultMergeChoices(plan)} onChoose={onChoose} leftId={1} rightId={2} />,
    );

    const checkbox = screen.getByRole('checkbox');
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    await userEvent.click(checkbox);
    expect(onChoose).toHaveBeenCalledWith('position', 'target');
  });

  it('если анкеты ни в чём не расходятся — прямо говорит, что выбирать нечего', () => {
    const same = buildMergePlan(side({ name: 'А Б' }), side({ name: 'А Б' }));
    render(<MergePlanPanel plan={same} choices={{}} onChoose={vi.fn()} leftId={1} rightId={2} />);
    expect(screen.getByText(/Выбирать нечего/)).toBeTruthy();
  });
});
