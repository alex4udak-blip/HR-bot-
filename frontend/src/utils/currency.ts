/**
 * Currency formatting utilities for the HR-bot application.
 * Provides consistent salary and currency display across the frontend.
 */

/**
 * Map of currency codes to their symbols.
 */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  RUB: '\u20bd',  // ₽
  USD: '$',
  EUR: '\u20ac',  // €
  KZT: '\u20b8',  // ₸
  UAH: '\u20b4',  // ₴
  BYN: 'Br',
  GEL: '\u20be',  // ₾
  AED: '\u062f.\u0625',  // د.إ
  TRY: '\u20ba',  // ₺
  GBP: '\u00a3',  // £
};

/**
 * List of supported currencies with their details.
 */
export const CURRENCY_OPTIONS = [
  { code: 'RUB', name: 'Russian Ruble' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'KZT', name: 'Kazakhstani Tenge' },
  { code: 'UAH', name: 'Ukrainian Hryvnia' },
  { code: 'BYN', name: 'Belarusian Ruble' },
  { code: 'GEL', name: 'Georgian Lari' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'GBP', name: 'British Pound' },
] as const;

export type CurrencyCode = typeof CURRENCY_OPTIONS[number]['code'];

/**
 * Gets the currency symbol for a given currency code.
 * @param currency - The currency code (e.g., 'RUB', 'USD')
 * @returns The currency symbol, or the currency code if not found
 */
export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] || currency;
}

/**
 * Formats a number with space as thousands separator (Russian locale).
 * @param amount - The number to format
 * @returns Formatted string with space separators
 */
function formatNumber(amount: number): string {
  return new Intl.NumberFormat('ru-RU').format(amount);
}

/**
 * Formats a single currency amount with its symbol.
 * @param amount - The amount to format
 * @param currency - The currency code (default: 'RUB')
 * @returns Formatted string like "150 000 ₽"
 */
export function formatCurrency(amount: number, currency: string = 'RUB'): string {
  const symbol = getCurrencySymbol(currency);
  return `${formatNumber(amount)} ${symbol}`;
}

/**
 * Formats a salary range with currency symbol.
 * @param min - Minimum salary (optional)
 * @param max - Maximum salary (optional)
 * @param currency - The currency code (default: 'RUB')
 * @returns Formatted salary string like "150 000 - 250 000 ₽" or "Not specified"
 */
export function formatSalary(
  min?: number,
  max?: number,
  currency: string = 'RUB'
): string {
  const symbol = getCurrencySymbol(currency);

  if (min && max) {
    return `${formatNumber(min)} - ${formatNumber(max)} ${symbol}`;
  }
  if (min) {
    return `from ${formatNumber(min)} ${symbol}`;
  }
  if (max) {
    return `up to ${formatNumber(max)} ${symbol}`;
  }
  return 'Not specified';
}

/**
 * Gets currency options formatted for dropdown display.
 * @returns Array of { value, label } objects like { value: 'RUB', label: 'RUB (₽)' }
 */
export function getCurrencyDropdownOptions(): Array<{ value: string; label: string }> {
  return CURRENCY_OPTIONS.map(({ code }) => ({
    value: code,
    label: `${code} (${getCurrencySymbol(code)})`,
  }));
}
