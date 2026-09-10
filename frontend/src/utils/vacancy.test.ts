import { describe, expect, it } from 'vitest';
import type { Vacancy } from '@/types';
import { isExplicitlyAssigned, isRequestVisibleTo } from './vacancy';

const ME = 3;
const vac = (over: Partial<Vacancy> & { accepted_by?: number[]; dismissed_by?: number[] }): Vacancy => {
  const { accepted_by, dismissed_by, ...rest } = over;
  return {
    id: 1,
    status: 'open',
    created_by: 99,
    assigned_to: [],
    assigned_to_all: false,
    extra_data: { accepted_by: accepted_by ?? [], dismissed_by: dismissed_by ?? [] },
    ...rest,
  } as unknown as Vacancy;
};

describe('isExplicitlyAssigned', () => {
  it('true only for an explicit assignee who has not dismissed it', () => {
    expect(isExplicitlyAssigned(vac({ assigned_to: [ME] }), ME)).toBe(true);
    expect(isExplicitlyAssigned(vac({ assigned_to: [ME], dismissed_by: [ME] }), ME)).toBe(false);
  });
  it('creator and «всем рекрутёрам» do not count', () => {
    expect(isExplicitlyAssigned(vac({ created_by: ME }), ME)).toBe(false);
    expect(isExplicitlyAssigned(vac({ assigned_to_all: true }), ME)).toBe(false);
  });
});

describe('isRequestVisibleTo — admin', () => {
  it('sees undistributed requests', () => {
    expect(isRequestVisibleTo(vac({ status: 'pending_review' }), ME, true)).toBe(true);
    expect(isRequestVisibleTo(vac({ status: 'draft' }), ME, true)).toBe(true);
  });
  it('sees an open vacancy assigned to them that someone else already took', () => {
    expect(isRequestVisibleTo(vac({ assigned_to: [4, ME], accepted_by: [4] }), ME, true)).toBe(true);
  });
  it('hides it once taken personally', () => {
    expect(isRequestVisibleTo(vac({ assigned_to: [4, ME], accepted_by: [4, ME] }), ME, true)).toBe(false);
  });
  it('does not surface vacancies they only created or that go to «всем рекрутёрам»', () => {
    expect(isRequestVisibleTo(vac({ created_by: ME, assigned_to: [4], accepted_by: [4] }), ME, true)).toBe(false);
    expect(isRequestVisibleTo(vac({ assigned_to_all: true, accepted_by: [4] }), ME, true)).toBe(false);
  });
});

describe('isRequestVisibleTo — recruiter', () => {
  it('sees an assigned vacancy until taking it', () => {
    expect(isRequestVisibleTo(vac({ assigned_to: [ME], accepted_by: [4] }), ME, false)).toBe(true);
    expect(isRequestVisibleTo(vac({ assigned_to: [ME], accepted_by: [ME] }), ME, false)).toBe(false);
  });
});
