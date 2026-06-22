import type { FormField } from '@/services/api/forms';

export interface AnketaTemplate { key: string; title: string; description: string; fields: Omit<FormField, 'id'>[]; }

export const ANKETA_TEMPLATES: AnketaTemplate[] = [
  {
    key: 'screening', title: 'Скрининг-анкета', description: 'Базовый отбор кандидата',
    fields: [
      { type: 'text', label: 'ФИО', required: true },
      { type: 'phone', label: 'Телефон', required: true },
      { type: 'email', label: 'Email', required: true },
      { type: 'scale', label: 'Оцените свой уровень для этой роли', required: false, min: 1, max: 10 },
      { type: 'textarea', label: 'Почему вам интересна вакансия?', required: false },
    ],
  },
  {
    key: 'tech', title: 'Тех-анкета', description: 'Технический скрининг',
    fields: [
      { type: 'text', label: 'ФИО', required: true },
      { type: 'multiselect', label: 'Стек', required: false, options: ['Python', 'JavaScript', 'Go', 'Java', 'C#'] },
      { type: 'scale', label: 'Опыт с основным языком (лет)', required: false, min: 1, max: 10 },
      { type: 'url', label: 'GitHub / портфолио', required: false },
    ],
  },
  {
    key: 'preoffer', title: 'Pre-offer', description: 'Перед оффером',
    fields: [
      { type: 'text', label: 'ФИО', required: true },
      { type: 'text', label: 'Ожидания по зарплате', required: true },
      { type: 'radio', label: 'Готовность к релокации', required: false, options: ['Да', 'Нет', 'Обсуждается'] },
      { type: 'text', label: 'Желаемая дата выхода', required: false },
    ],
  },
];
