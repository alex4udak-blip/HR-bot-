import { render, screen } from '@testing-library/react';
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
