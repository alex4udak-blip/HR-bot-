import { useState, useEffect } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import type { ParsedResume, ParsedVacancy } from '@/services/api';
import { getCurrencyDropdownOptions, formatSalary } from '@/utils';

interface ParsedDataPreviewProps {
  type: 'resume' | 'vacancy';
  data: ParsedResume | ParsedVacancy;
  onDataChange: (data: ParsedResume | ParsedVacancy) => void;
}

const CURRENCY_DROPDOWN_OPTIONS = getCurrencyDropdownOptions();

export default function ParsedDataPreview({ type, data, onDataChange }: ParsedDataPreviewProps) {
  const [localData, setLocalData] = useState<ParsedResume | ParsedVacancy>(data);

  useEffect(() => {
    setLocalData(data);
  }, [data]);

  const handleChange = (field: string, value: string | number | string[] | undefined) => {
    const newData = { ...localData, [field]: value };
    setLocalData(newData);
    onDataChange(newData);
  };

  const handleNumberChange = (field: string, value: string) => {
    const numValue = value === '' ? undefined : parseInt(value, 10);
    handleChange(field, numValue);
  };

  const handleSkillsChange = (value: string) => {
    const skills = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
    handleChange('skills', skills);
  };

  if (type === 'resume') {
    const resumeData = localData as ParsedResume;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-green-400 mb-4">
          <Check className="w-5 h-5" />
          <span className="font-medium">Распознано:</span>
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm text-white/60 mb-1">Имя</label>
          <input
            type="text"
            value={resumeData.name || ''}
            onChange={(e) => handleChange('name', e.target.value)}
            className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
            placeholder="Иван Петров"
          />
        </div>

        {/* Email & Phone */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-white/60 mb-1">Email</label>
            <input
              type="email"
              value={resumeData.email || ''}
              onChange={(e) => handleChange('email', e.target.value)}
              className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
              placeholder="ivan@mail.ru"
            />
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-1">Телефон</label>
            <input
              type="text"
              value={resumeData.phone || ''}
              onChange={(e) => handleChange('phone', e.target.value)}
              className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
              placeholder="+7 999 123-45-67"
            />
          </div>
        </div>

        {/* Telegram */}
        <div>
          <label className="block text-sm text-white/60 mb-1">Telegram</label>
          <input
            type="text"
            value={resumeData.telegram || ''}
            onChange={(e) => handleChange('telegram', e.target.value)}
            className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
            placeholder="@username"
          />
        </div>

        {/* Position & Company */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-white/60 mb-1">Должность</label>
            <input
              type="text"
              value={resumeData.position || ''}
              onChange={(e) => handleChange('position', e.target.value)}
              className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
              placeholder="Python Developer"
            />
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-1">Компания</label>
            <input
              type="text"
              value={resumeData.company || ''}
              onChange={(e) => handleChange('company', e.target.value)}
              className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
              placeholder="ООО Компания"
            />
          </div>
        </div>

        {/* Experience & Location */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-white/60 mb-1">Опыт (лет)</label>
            <input
              type="number"
              value={resumeData.experience_years || ''}
              onChange={(e) => handleNumberChange('experience_years', e.target.value)}
              className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
              placeholder="5"
            />
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-1">Локация</label>
            <input
              type="text"
              value={resumeData.location || ''}
              onChange={(e) => handleChange('location', e.target.value)}
              className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
              placeholder="Москва"
            />
          </div>
        </div>

        {/* Salary */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm text-white/60 mb-1">Зарплата от</label>
            <input
              type="number"
              value={resumeData.salary_min || ''}
              onChange={(e) => handleNumberChange('salary_min', e.target.value)}
              className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
              placeholder="200000"
            />
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-1">Зарплата до</label>
            <input
              type="number"
              value={resumeData.salary_max || ''}
              onChange={(e) => handleNumberChange('salary_max', e.target.value)}
              className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
              placeholder="300000"
            />
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-1">Валюта</label>
            <select
              value={resumeData.salary_currency || 'RUB'}
              onChange={(e) => handleChange('salary_currency', e.target.value)}
              className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
            >
              {CURRENCY_DROPDOWN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Formatted salary preview */}
        {(resumeData.salary_min || resumeData.salary_max) && (
          <div className="p-3 glass-light rounded-lg">
            <span className="text-sm text-white/60">Formatted: </span>
            <span className="text-sm font-medium">
              {formatSalary(resumeData.salary_min, resumeData.salary_max, resumeData.salary_currency || 'RUB')}
            </span>
          </div>
        )}

        {/* Skills */}
        <div>
          <label className="block text-sm text-white/60 mb-1">Навыки (через запятую)</label>
          <input
            type="text"
            value={(resumeData.skills || []).join(', ')}
            onChange={(e) => handleSkillsChange(e.target.value)}
            className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
            placeholder="Python, FastAPI, PostgreSQL"
          />
          {resumeData.skills && resumeData.skills.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {resumeData.skills.map((skill, idx) => (
                <span
                  key={idx}
                  className="text-xs px-2 py-0.5 bg-cyan-500/20 text-cyan-300 rounded-full"
                >
                  {skill}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Summary */}
        <div>
          <label className="block text-sm text-white/60 mb-1">Описание</label>
          <textarea
            value={resumeData.summary || ''}
            onChange={(e) => handleChange('summary', e.target.value)}
            rows={3}
            className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm resize-none"
            placeholder="Краткое описание кандидата..."
          />
        </div>
      </div>
    );
  }

  // Vacancy preview
  const vacancyData = localData as ParsedVacancy;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-green-400 mb-4">
        <Check className="w-5 h-5" />
        <span className="font-medium">Распознано:</span>
      </div>

      {/* Title */}
      <div>
        <label className="block text-sm text-white/60 mb-1">Название вакансии *</label>
        <input
          type="text"
          value={vacancyData.title || ''}
          onChange={(e) => handleChange('title', e.target.value)}
          className={clsx(
            'w-full px-3 py-2 glass-light border rounded-lg focus:outline-none focus:border-cyan-500 text-sm',
            !vacancyData.title ? 'border-red-500/50' : 'border-white/10'
          )}
          placeholder="Senior Python Developer"
        />
        {!vacancyData.title && (
          <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Название обязательно
          </p>
        )}
      </div>

      {/* Company & Location */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-white/60 mb-1">Компания</label>
          <input
            type="text"
            value={vacancyData.company_name || ''}
            onChange={(e) => handleChange('company_name', e.target.value)}
            className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
            placeholder="ООО Компания"
          />
        </div>
        <div>
          <label className="block text-sm text-white/60 mb-1">Локация</label>
          <input
            type="text"
            value={vacancyData.location || ''}
            onChange={(e) => handleChange('location', e.target.value)}
            className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
            placeholder="Москва / Удалённо"
          />
        </div>
      </div>

      {/* Employment Type & Experience Level */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-white/60 mb-1">Тип занятости</label>
          <select
            value={vacancyData.employment_type || ''}
            onChange={(e) => handleChange('employment_type', e.target.value)}
            className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
          >
            <option value="">Не указано</option>
            <option value="full-time">Полная занятость</option>
            <option value="part-time">Частичная занятость</option>
            <option value="contract">Контракт</option>
            <option value="remote">Удалённая работа</option>
            <option value="hybrid">Гибрид</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-white/60 mb-1">Уровень</label>
          <select
            value={vacancyData.experience_level || ''}
            onChange={(e) => handleChange('experience_level', e.target.value)}
            className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
          >
            <option value="">Не указано</option>
            <option value="intern">Стажёр</option>
            <option value="junior">Junior</option>
            <option value="middle">Middle</option>
            <option value="senior">Senior</option>
            <option value="lead">Lead</option>
            <option value="manager">Manager</option>
          </select>
        </div>
      </div>

      {/* Salary */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-sm text-white/60 mb-1">Зарплата от</label>
          <input
            type="number"
            value={vacancyData.salary_min || ''}
            onChange={(e) => handleNumberChange('salary_min', e.target.value)}
            className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
            placeholder="200000"
          />
        </div>
        <div>
          <label className="block text-sm text-white/60 mb-1">Зарплата до</label>
          <input
            type="number"
            value={vacancyData.salary_max || ''}
            onChange={(e) => handleNumberChange('salary_max', e.target.value)}
            className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
            placeholder="300000"
          />
        </div>
        <div>
          <label className="block text-sm text-white/60 mb-1">Валюта</label>
          <select
            value={vacancyData.salary_currency || 'RUB'}
            onChange={(e) => handleChange('salary_currency', e.target.value)}
            className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm"
          >
            {CURRENCY_DROPDOWN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Formatted salary preview */}
      {(vacancyData.salary_min || vacancyData.salary_max) && (
        <div className="p-3 glass-light rounded-lg">
          <span className="text-sm text-white/60">Formatted: </span>
          <span className="text-sm font-medium">
            {formatSalary(vacancyData.salary_min, vacancyData.salary_max, vacancyData.salary_currency || 'RUB')}
          </span>
        </div>
      )}

      {/* Description */}
      <div>
        <label className="block text-sm text-white/60 mb-1">Описание</label>
        <textarea
          value={vacancyData.description || ''}
          onChange={(e) => handleChange('description', e.target.value)}
          rows={3}
          className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm resize-none"
          placeholder="Описание вакансии..."
        />
      </div>

      {/* Requirements */}
      <div>
        <label className="block text-sm text-white/60 mb-1">Требования</label>
        <textarea
          value={vacancyData.requirements || ''}
          onChange={(e) => handleChange('requirements', e.target.value)}
          rows={3}
          className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm resize-none"
          placeholder="Требуемые навыки и опыт..."
        />
      </div>

      {/* Responsibilities */}
      <div>
        <label className="block text-sm text-white/60 mb-1">Обязанности</label>
        <textarea
          value={vacancyData.responsibilities || ''}
          onChange={(e) => handleChange('responsibilities', e.target.value)}
          rows={3}
          className="w-full px-3 py-2 glass-light rounded-lg focus:outline-none focus:border-cyan-500 text-sm resize-none"
          placeholder="Основные обязанности..."
        />
      </div>
    </div>
  );
}
