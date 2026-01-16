import axios, { AxiosError, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

// ============================================================
// REFRESH TOKEN MANAGEMENT
// ============================================================

/**
 * Flag to indicate if a token refresh is currently in progress
 */
let isRefreshing = false;

/**
 * Queue of requests waiting for token refresh to complete
 */
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
  config: InternalAxiosRequestConfig;
}> = [];

/**
 * Process the queue of failed requests after token refresh
 */
const processQueue = (error: Error | null): void => {
  failedQueue.forEach(({ resolve, reject, config }) => {
    if (error) {
      reject(error);
    } else {
      // Retry the request
      resolve(api(config));
    }
  });
  failedQueue = [];
};

/**
 * Silently attempt to refresh the access token
 * Returns true if successful, false otherwise
 */
const attemptTokenRefresh = async (): Promise<boolean> => {
  try {
    const response = await axios.post('/api/auth/refresh', {}, {
      withCredentials: true, // Send cookies
    });
    return response.status === 200;
  } catch {
    return false;
  }
};

/**
 * Redirect to login page (used after refresh token failure)
 */
const redirectToLogin = (): void => {
  // Clear any stored state before redirecting
  if (window.location.pathname !== '/login' && !window.location.pathname.startsWith('/invite')) {
    window.location.href = '/login';
  }
};

// API Configuration
export const API_TIMEOUT = 30000; // 30 seconds
export const MUTATION_DEBOUNCE_MS = 300; // Debounce time for mutation requests

// ============================================================
// REQUEST DEDUPLICATION & DEBOUNCE SYSTEM
// ============================================================

/**
 * Map to store pending GET requests for deduplication
 * Key: method + url + serialized params
 * Value: Promise of the request
 */
const pendingRequests = new Map<string, Promise<AxiosResponse>>();

/**
 * Map to store active AbortControllers for streaming requests
 * Key: unique request identifier
 * Value: AbortController instance
 */
const activeStreamControllers = new Map<string, AbortController>();

/**
 * Map to track last mutation timestamps for debouncing
 * Key: method + url
 * Value: timestamp of last mutation
 */
const mutationTimestamps = new Map<string, number>();

/**
 * Generate a unique key for request deduplication
 */
const generateRequestKey = (
  method: string,
  url: string,
  params?: Record<string, unknown>
): string => {
  const sortedParams = params ? JSON.stringify(params, Object.keys(params).sort()) : '';
  return `${method.toUpperCase()}:${url}:${sortedParams}`;
};

/**
 * Check if a mutation request should be debounced (prevent double-click)
 * Returns true if the request should proceed, false if it should be blocked
 */
const shouldAllowMutation = (method: string, url: string): boolean => {
  const key = `${method.toUpperCase()}:${url}`;
  const now = Date.now();
  const lastTimestamp = mutationTimestamps.get(key);

  if (lastTimestamp && now - lastTimestamp < MUTATION_DEBOUNCE_MS) {
    console.warn(`Mutation debounced: ${method.toUpperCase()} ${url} (too fast, ${now - lastTimestamp}ms since last request)`);
    return false;
  }

  mutationTimestamps.set(key, now);
  return true;
};

/**
 * Cleanup old mutation timestamps periodically (prevent memory leaks)
 */
const cleanupMutationTimestamps = () => {
  const now = Date.now();
  const staleThreshold = 60000; // 1 minute

  mutationTimestamps.forEach((timestamp, key) => {
    if (now - timestamp > staleThreshold) {
      mutationTimestamps.delete(key);
    }
  });
};

// Run cleanup every 5 minutes
setInterval(cleanupMutationTimestamps, 300000);

/**
 * Wrapper for GET requests with deduplication
 * If the same request is already in flight, returns the existing Promise
 */
export const deduplicatedGet = async <T>(
  url: string,
  config?: AxiosRequestConfig
): Promise<AxiosResponse<T>> => {
  const requestKey = generateRequestKey('GET', url, config?.params);

  // Check if identical request is already in flight
  const pendingRequest = pendingRequests.get(requestKey);
  if (pendingRequest) {
    console.debug(`Request deduplicated: GET ${url}`);
    return pendingRequest as Promise<AxiosResponse<T>>;
  }

  // Create new request and store it
  const requestPromise = api.get<T>(url, config);
  pendingRequests.set(requestKey, requestPromise as Promise<AxiosResponse>);

  try {
    const response = await requestPromise;
    return response;
  } finally {
    // Remove from pending requests after completion (success or error)
    pendingRequests.delete(requestKey);
  }
};

/**
 * Wrapper for mutation requests with debounce protection
 * Throws error if request is too fast (double-click protection)
 */
export const debouncedMutation = async <T>(
  method: 'post' | 'put' | 'patch' | 'delete',
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<AxiosResponse<T>> => {
  if (!shouldAllowMutation(method, url)) {
    throw new Error('Request debounced: too many rapid requests');
  }

  switch (method) {
    case 'post':
      return api.post<T>(url, data, config);
    case 'put':
      return api.put<T>(url, data, config);
    case 'patch':
      return api.patch<T>(url, data, config);
    case 'delete':
      return api.delete<T>(url, config);
    default:
      throw new Error(`Unknown method: ${method}`);
  }
};

/**
 * Create an AbortController for a streaming request
 * Returns the controller and a cleanup function
 */
export const createStreamController = (streamId: string): {
  controller: AbortController;
  cleanup: () => void;
} => {
  // Abort any existing stream with the same ID
  const existingController = activeStreamControllers.get(streamId);
  if (existingController) {
    existingController.abort();
    activeStreamControllers.delete(streamId);
  }

  const controller = new AbortController();
  activeStreamControllers.set(streamId, controller);

  const cleanup = () => {
    controller.abort();
    activeStreamControllers.delete(streamId);
  };

  return { controller, cleanup };
};

/**
 * Abort all active streaming requests (useful for cleanup)
 */
export const abortAllStreams = (): void => {
  activeStreamControllers.forEach((controller, streamId) => {
    console.debug(`Aborting stream: ${streamId}`);
    controller.abort();
  });
  activeStreamControllers.clear();
};

/**
 * Get the count of pending requests (for debugging/monitoring)
 */
export const getPendingRequestsCount = (): number => pendingRequests.size;

/**
 * Get the count of active streams (for debugging/monitoring)
 */
export const getActiveStreamsCount = (): number => activeStreamControllers.size;

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,  // Send cookies with requests (httpOnly cookie authentication)
  timeout: API_TIMEOUT,   // Request timeout
});

// Request interceptor - add retry metadata
api.interceptors.request.use(
  (config) => {
    // Add request timestamp for debugging
    (config as AxiosRequestConfig & { metadata?: { startTime: number } }).metadata = { startTime: Date.now() };
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle errors with automatic token refresh
api.interceptors.response.use(
  (response) => {
    // Log slow requests in development
    const config = response.config as AxiosRequestConfig & { metadata?: { startTime: number } };
    if (config.metadata?.startTime) {
      const duration = Date.now() - config.metadata.startTime;
      if (duration > 5000) {
        console.warn(`Slow API request: ${config.method?.toUpperCase()} ${config.url} took ${duration}ms`);
      }
    }
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean; _skipRefresh?: boolean };

    // Handle 401 - Unauthorized (token expired or invalid)
    if (error.response?.status === 401) {
      // Skip refresh logic for certain endpoints
      const skipRefreshUrls = ['/auth/login', '/auth/refresh', '/auth/logout', '/invitations/validate', '/invitations/accept'];
      const shouldSkipRefresh = originalRequest._skipRefresh ||
        skipRefreshUrls.some(url => originalRequest.url?.includes(url));

      // Skip refresh if on login/invite page
      const isAuthPage = window.location.pathname === '/login' || window.location.pathname.startsWith('/invite');

      if (shouldSkipRefresh || isAuthPage) {
        return Promise.reject(error);
      }

      // If this request has already been retried, redirect to login
      if (originalRequest._retry) {
        redirectToLogin();
        return Promise.reject(error);
      }

      // If already refreshing, queue this request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject, config: originalRequest });
        });
      }

      // Mark that we're refreshing
      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Attempt to refresh the token (silently, no error shown to user)
        const refreshSuccess = await attemptTokenRefresh();

        if (refreshSuccess) {
          // Token refreshed successfully, process queued requests and retry original
          processQueue(null);
          return api(originalRequest);
        } else {
          // Refresh failed - redirect to login
          processQueue(new Error('Token refresh failed'));
          redirectToLogin();
          return Promise.reject(error);
        }
      } catch (refreshError) {
        // Refresh threw an error - redirect to login
        processQueue(refreshError instanceof Error ? refreshError : new Error('Token refresh failed'));
        redirectToLogin();
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    // Handle 403 - permission denied
    if (error.response?.status === 403) {
      console.error('Permission denied:', error.config?.url);
    }

    // Handle timeout
    if (error.code === 'ECONNABORTED') {
      console.error('Request timeout:', error.config?.url);
    }

    return Promise.reject(error);
  }
);

export default api;
