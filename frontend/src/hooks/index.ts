export { useWebSocket } from './useWebSocket';
export type {
  WebSocketStatus,
  WebSocketEvent,
  CallProgressEvent,
  CallCompletedEvent,
  CallFailedEvent,
} from './useWebSocket';

export { useOnboarding } from './useOnboarding';
export type {
  TooltipId,
  UseOnboardingReturn,
} from './useOnboarding';

export { useOnboardingTour, DEFAULT_TOUR_STEPS } from './useOnboardingTour';
export type {
  TourStep,
  TourAnalyticsEvent,
  UseOnboardingTourReturn,
} from './useOnboardingTour';

export { useCanAccessFeature } from './useCanAccessFeature';
export type {
  FeatureName,
  UseCanAccessFeatureReturn,
} from './useCanAccessFeature';

export { useUserFeatures } from './useUserFeatures';
export type {
  UseUserFeaturesReturn,
} from './useUserFeatures';

export { useCurrencyRates } from './useCurrencyRates';
export type {
  UseCurrencyRatesReturn,
} from './useCurrencyRates';

export { useSmartSearch, clearSearchHistory } from './useSmartSearch';
export type {
  UseSmartSearchReturn,
} from './useSmartSearch';

export { useResumeUpload } from './useResumeUpload';
export {
  SUPPORTED_FILE_TYPES,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE,
} from './useResumeUpload';
export type {
  UploadingFile,
  FileValidationError,
  UseResumeUploadReturn,
} from './useResumeUpload';

export { useCommandPalette, clearCommandHistory } from './useCommandPalette';
export type {
  UseCommandPaletteReturn,
  CommandPaletteItem,
  ResultCategory,
  ActionItem,
  PageItem,
} from './useCommandPalette';

export { usePrometheusBulkSync, usePrometheusSingleSync } from './usePrometheusSync';
export type {
  UsePrometheusSyncReturn,
  UsePrometheusSingleSyncReturn,
} from './usePrometheusSync';
