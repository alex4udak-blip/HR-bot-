import { describe, it, expect } from 'vitest';
import { computeEntityParamUpdate, shouldAdoptUrlEntity } from '../candidateUrl';

describe('computeEntityParamUpdate', () => {
  it('sets entity when a profile opens', () => {
    const next = computeEntityParamUpdate(new URLSearchParams(''), 123, null);
    expect(next?.get('entity')).toBe('123');
  });

  it('returns null when entity already matches the open id (loop guard)', () => {
    const next = computeEntityParamUpdate(new URLSearchParams('entity=123'), 123, 123);
    expect(next).toBeNull();
  });

  it('switches entity when a different profile opens', () => {
    const next = computeEntityParamUpdate(new URLSearchParams('entity=1'), 2, 1);
    expect(next?.get('entity')).toBe('2');
  });

  it('preserves other params when setting entity', () => {
    const next = computeEntityParamUpdate(new URLSearchParams('tab=anketa&q=ivan'), 5, null);
    expect(next?.get('entity')).toBe('5');
    expect(next?.get('tab')).toBe('anketa');
    expect(next?.get('q')).toBe('ivan');
  });

  it('clears entity/edit/tab on a genuine close (selected -> null)', () => {
    const next = computeEntityParamUpdate(new URLSearchParams('entity=9&edit=1&tab=anketa'), null, 9);
    expect(next?.has('entity')).toBe(false);
    expect(next?.has('edit')).toBe(false);
    expect(next?.has('tab')).toBe(false);
  });

  it('does NOT touch entity while a deep-link is pending (null -> null)', () => {
    // selectedCard is still null (board not yet refiltered) but entity is in the URL.
    const next = computeEntityParamUpdate(new URLSearchParams('entity=123'), null, null);
    expect(next).toBeNull();
  });

  it('returns null on close when there was nothing to clear', () => {
    const next = computeEntityParamUpdate(new URLSearchParams('q=ivan'), null, 9);
    expect(next).toBeNull();
  });
});

describe('shouldAdoptUrlEntity', () => {
  it('does NOT adopt when the selection just changed (fresh click, URL lagging)', () => {
    expect(shouldAdoptUrlEntity(2, 1, true)).toBe(false);
  });

  it('adopts a genuine URL change while a different card is shown (toast-navigate / back)', () => {
    expect(shouldAdoptUrlEntity(1, 5, false)).toBe(true);
  });

  it('adopts a deep-link when nothing is selected yet', () => {
    expect(shouldAdoptUrlEntity(null, 5, false)).toBe(true);
  });

  it('does not adopt when already showing the URL entity', () => {
    expect(shouldAdoptUrlEntity(5, 5, false)).toBe(false);
  });

  it('treats an already-synced URL as nothing-to-adopt even mid-click', () => {
    expect(shouldAdoptUrlEntity(5, 5, true)).toBe(false);
  });

  it('trusts the click when selection changed to a third value', () => {
    expect(shouldAdoptUrlEntity(3, 5, true)).toBe(false);
  });
});
