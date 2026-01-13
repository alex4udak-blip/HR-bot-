import { CURRENCIES } from '@/types';
import clsx from 'clsx';

interface CurrencySelectProps {
  value: string;
  onChange: (currency: string) => void;
  className?: string;
  disabled?: boolean;
}

export default function CurrencySelect({
  value,
  onChange,
  className,
  disabled = false
}: CurrencySelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={clsx(
        'px-3 py-2 bg-white/5 border border-white/10 rounded-lg',
        'focus:outline-none focus:border-blue-500',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
    >
      {CURRENCIES.map((currency) => (
        <option key={currency.code} value={currency.code}>
          {currency.code} {currency.symbol}
        </option>
      ))}
    </select>
  );
}
