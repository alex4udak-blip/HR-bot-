import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import HireToStaffButton from '../HireToStaffButton';

vi.mock('@/services/api', () => ({
  hireEntity: vi.fn(),
  getDepartments: vi.fn().mockResolvedValue([{ id: 7, name: 'Разработка', parent_id: null }]),
}));

const hireDefaults = vi.fn();
vi.mock('@/services/api/staffBoard', () => ({
  getBoardFolders: vi.fn().mockResolvedValue([]),
  getBoardPositions: vi.fn().mockResolvedValue([]),
  updateBoardRow: vi.fn(),
  getHireDefaults: (id: number) => hireDefaults(id),
}));

beforeEach(() => {
  hireDefaults.mockReset();
  hireDefaults.mockResolvedValue({ position: null, department_id: null, department_name: null, vacancy_title: null });
});

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

describe('HireToStaffButton — подстановка из вакансии', () => {
  const fromVacancy = { position: 'Бэкенд-разработчик', department_id: 7, department_name: 'Разработка', vacancy_title: 'Бэкенд-разработчик' };

  it('пустые должность и отдел берутся из вакансии', async () => {
    hireDefaults.mockResolvedValue(fromVacancy);
    render(<HireToStaffButton {...base} position={null} status="hired" canHire />);
    fireEvent.click(screen.getByRole('button', { name: /в штат/i }));
    expect(await screen.findByDisplayValue('Бэкенд-разработчик')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Разработка/)).toBeInTheDocument());
  });

  it('должность из карточки главнее вакансии', async () => {
    hireDefaults.mockResolvedValue(fromVacancy);
    render(<HireToStaffButton {...base} position="Маркетолог" status="hired" canHire />);
    fireEvent.click(screen.getByRole('button', { name: /в штат/i }));
    await waitFor(() => expect(hireDefaults).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.getByText(/Разработка/)).toBeInTheDocument());
    expect(screen.getByDisplayValue('Маркетолог')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Бэкенд-разработчик')).toBeNull();
  });
});
