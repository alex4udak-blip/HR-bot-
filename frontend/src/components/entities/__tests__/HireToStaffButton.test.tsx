import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import HireToStaffButton from '../HireToStaffButton';

vi.mock('@/services/api', () => ({
  hireEntity: vi.fn(),
  getDepartments: vi.fn().mockResolvedValue([]),
}));

const base = {
  entityId: 1, entityName: 'Пётр', email: 'p@x.com',
  phone: null, telegram: null, position: 'Маркетолог', onHired: () => {},
};

describe('HireToStaffButton — видимость', () => {
  it('видна при hired и роли админа', () => {
    render(<HireToStaffButton {...base} status="hired" canHire />);
    expect(screen.getByRole('button', { name: /в штат/i })).toBeInTheDocument();
  });
  it('скрыта при раннем статусе', () => {
    render(<HireToStaffButton {...base} status="screening" canHire />);
    expect(screen.queryByRole('button', { name: /в штат/i })).toBeNull();
  });
  it('скрыта без прав', () => {
    render(<HireToStaffButton {...base} status="hired" canHire={false} />);
    expect(screen.queryByRole('button', { name: /в штат/i })).toBeNull();
  });
});

describe('HireToStaffButton — автозаполнение из кандидата', () => {
  it('подставляет email и должность при открытии', () => {
    render(<HireToStaffButton {...base} email="p@x.com" position="Маркетолог" status="hired" canHire />);
    fireEvent.click(screen.getByRole('button', { name: /в штат/i }));
    expect(screen.getByDisplayValue('p@x.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Маркетолог')).toBeInTheDocument();
  });

  it('НЕ залипает на прежнем кандидате при смене пропов', () => {
    // Кнопка переиспользуется между кандидатами; профиль догружается асинхронно.
    // Регресс: поля держали значения первого кандидата (пустой email, чужая должность).
    const { rerender } = render(
      <HireToStaffButton {...base} entityId={1} email="" position="Маркетолог" status="hired" canHire />,
    );
    rerender(
      <HireToStaffButton {...base} entityId={2} email="grom@x.com" position="Таргетолог" status="hired" canHire />,
    );
    fireEvent.click(screen.getByRole('button', { name: /в штат/i }));
    expect(screen.getByDisplayValue('grom@x.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Таргетолог')).toBeInTheDocument();
  });
});
