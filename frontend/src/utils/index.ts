/**
 * Utility functions barrel export.
 */

export {
  CURRENCY_SYMBOLS,
  CURRENCY_OPTIONS,
  getCurrencySymbol,
  formatCurrency,
  formatSalary,
  getCurrencyDropdownOptions,
} from './currency';
export type { CurrencyCode } from './currency';

export {
  getLocalStorage,
  setLocalStorage,
  removeLocalStorage,
} from './localStorage';
