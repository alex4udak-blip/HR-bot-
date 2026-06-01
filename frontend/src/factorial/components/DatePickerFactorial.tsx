import { useEffect, useRef, useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  format,
  parse,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  isSameDay,
  isBefore,
  startOfDay,
  addMonths,
  subMonths,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { cn } from '@/factorial/lib/cn';

interface DatePickerFactorialProps {
  /** Selected date in ISO format (YYYY-MM-DD) or empty. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** If true, dates before today are disabled (cannot be clicked). */
  disablePast?: boolean;
}

/**
 * Custom date picker matching Factorial's design:
 * - Button shows 📅 icon + "DD MMM YYYY" (English month abbreviations)
 * - Click → popup calendar with «месяц 2026 г.» header
 * - Smart positioning: opens UP if not enough space below
 * - Russian weekday labels (пн вт ср чт пт сб вс), Mon-first
 * - Today highlighted with light teal circle, selected with darker teal fill
 * - Days outside month are muted
 */
export default function DatePickerFactorial({
  value,
  onChange,
  placeholder = 'дд.мм.гггг',
  disablePast = false,
}: DatePickerFactorialProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<'below' | 'above'>('below');
  const [currentMonth, setCurrentMonth] = useState<Date>(() =>
    value ? parse(value, 'yyyy-MM-dd', new Date()) : new Date()
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Smart positioning when opening
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const popupHeight = 320; // approx height of the calendar popup
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    // Prefer below; if not enough room and above has more room — flip up
    if (spaceBelow < popupHeight && spaceAbove > spaceBelow) {
      setPosition('above');
    } else {
      setPosition('below');
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectedDate = value ? parse(value, 'yyyy-MM-dd', new Date()) : null;
  const displayLabel = selectedDate ? format(selectedDate, 'd MMM yyyy', { locale: ru }) : '';

  const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });
  const weekdays = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

  const today = startOfDay(new Date());

  const isDisabled = (day: Date) => disablePast && isBefore(day, today);

  const handleDayClick = (day: Date) => {
    if (isDisabled(day)) return;
    onChange(format(day, 'yyyy-MM-dd'));
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full inline-flex items-center gap-2 px-3 py-2 rounded-fx-lg border bg-white text-fx-sm text-text-primary hover:bg-sidebar-hover focus:outline-none focus:border-border-hover',
          open ? 'border-primary' : 'border-card-border-soft'
        )}
      >
        <CalendarIcon className="w-4 h-4 text-text-muted shrink-0" strokeWidth={1.5} />
        <span className={cn(!displayLabel && 'text-text-muted')}>{displayLabel || placeholder}</span>
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-30 bg-white rounded-card shadow-card-hover border border-card-border-soft p-3 w-[280px]',
            position === 'below' ? 'top-full mt-1' : 'bottom-full mb-1'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-fx-sm font-medium">
              {format(currentMonth, 'LLLL yyyy', { locale: ru })} г.
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="p-1 rounded hover:bg-sidebar-hover"
                aria-label="Предыдущий месяц"
              >
                <ChevronLeft className="w-4 h-4 text-text-muted" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="p-1 rounded hover:bg-sidebar-hover"
                aria-label="Следующий месяц"
              >
                <ChevronRight className="w-4 h-4 text-text-muted" />
              </button>
            </div>
          </div>

          {/* Weekday labels */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {weekdays.map((wd) => (
              <div
                key={wd}
                className="text-[11px] text-text-muted/70 text-center py-1"
              >
                {wd}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((d) => {
              const inMonth = isSameMonth(d, currentMonth);
              const isSelected = selectedDate && isSameDay(d, selectedDate);
              const isCurrentToday = isToday(d);
              const disabled = isDisabled(d);
              return (
                <button
                  type="button"
                  key={format(d, 'yyyy-MM-dd')}
                  onClick={() => handleDayClick(d)}
                  disabled={disabled}
                  className={cn(
                    'w-9 h-9 rounded-full text-fx-sm flex items-center justify-center transition-colors',
                    disabled && 'text-text-muted/40 cursor-not-allowed',
                    !disabled && !inMonth && 'text-text-muted/40',
                    !disabled && inMonth && !isSelected && !isCurrentToday && 'text-text-primary hover:bg-sidebar-hover',
                    !disabled && inMonth && isCurrentToday && !isSelected && 'bg-teal-50 text-teal-700 font-medium',
                    isSelected && 'bg-teal-500 text-white font-medium'
                  )}
                >
                  {format(d, 'd')}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
