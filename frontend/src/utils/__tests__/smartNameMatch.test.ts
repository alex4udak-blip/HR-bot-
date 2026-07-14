import { describe, it, expect } from 'vitest';
import { smartNameMatch, editDistance } from '@/utils/translit';

describe('editDistance', () => {
  it('handles empty strings', () => {
    expect(editDistance('', '')).toBe(0);
    expect(editDistance('abc', '')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });
  it('counts single edits', () => {
    expect(editDistance('иванов', 'иваноф')).toBe(1); // 1 замена
    expect(editDistance('petyhov', 'pituhov')).toBe(2); // 2 замены
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('smartNameMatch — умный поиск имени (клиент)', () => {
  it('пустой запрос — матчит всё', () => {
    expect(smartNameMatch('Иванов Иван', '')).toBe(true);
    expect(smartNameMatch('Иванов Иван', '   ')).toBe(true);
  });

  it('прямое вхождение', () => {
    expect(smartNameMatch('Иванов Иван', 'иван')).toBe(true);
    expect(smartNameMatch('Шобанов', 'шобанов')).toBe(true);
  });

  it('транслитерация EN→RU и RU→EN', () => {
    expect(smartNameMatch('Иванов Иван', 'ivanov ivan')).toBe(true);
    expect(smartNameMatch('Bogdan Petrov', 'богдан')).toBe(true);
  });

  it('независимость от порядка слов', () => {
    expect(smartNameMatch('Иванов Иван', 'иван иванов')).toBe(true);
    expect(smartNameMatch('Иванов Иван', 'иванов иван')).toBe(true);
  });

  it('терпимость к опечаткам (Левенштейн)', () => {
    expect(smartNameMatch('Иванов Иван', 'иваноф')).toBe(true); // опечатка в→ф
    expect(smartNameMatch('Питухов Богдан', 'petyhov')).toBe(true); // транслит+2 опечатки
    expect(smartNameMatch('Иван Тестовый', 'ivan testoviy')).toBe(true); // транслит+опечатка
  });

  it('не матчит чужое имя', () => {
    expect(smartNameMatch('Иванов Иван', 'сидоров')).toBe(false);
    expect(smartNameMatch('Иванов Иван', 'петров')).toBe(false);
  });

  it('короткие токены не прощают опечаток (нет шума)', () => {
    // «оле» (3 буквы) не должно фаззи-матчить «оля» — только точное/транслит
    expect(smartNameMatch('Ольга', 'оль')).toBe(true); // подстрока
    expect(smartNameMatch('Абв', 'xyz')).toBe(false);
  });
});
