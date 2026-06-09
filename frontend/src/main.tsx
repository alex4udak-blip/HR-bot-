import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// === TEMP DIAGNOSTIC (белый экран) — удалить после фикса ===
function __showFatal(label: string, detail: string) {
  try {
    const d = document.createElement('pre');
    d.id = '__fatal';
    d.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;margin:0;padding:16px;background:#fff;color:#b00020;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow:auto';
    d.textContent = '[' + label + ']\n' + detail;
    document.body.appendChild(d);
  } catch { /* ignore */ }
}
window.addEventListener('error', (e) =>
  __showFatal('window.error', (((e as ErrorEvent).error && (e as ErrorEvent).error.stack) || (e as ErrorEvent).message) + '\n@ ' + ((e as ErrorEvent).filename || '') + ':' + (e as ErrorEvent).lineno),
);
window.addEventListener('unhandledrejection', (e) => {
  const r = (e as PromiseRejectionEvent).reason;
  __showFatal('unhandledrejection', (r && (r.stack || r.message)) || String(r));
});
setTimeout(() => {
  const r = document.getElementById('root');
  if (r && r.childElementCount === 0 && !document.getElementById('__fatal')) {
    __showFatal('no-mount', 'React не отрендерил в #root за 4с. URL=' + location.href);
  }
}, 4000);
// === END DIAGNOSTIC ===

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds - data is fresh for 30 seconds (prevents flickering)
      refetchOnMount: true, // Refetch on component mount if stale
      refetchOnWindowFocus: false, // Disable to prevent flickering on tab switch
      retry: 1,
      placeholderData: keepPreviousData, // Keep old data while fetching new - prevents blank screen flicker
    },
  },
});

try {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
            <Toaster
              position="top-right"
              toastOptions={{
                style: {
                  background: 'var(--toast-bg)',
                  color: 'var(--toast-fg)',
                  border: '1px solid var(--toast-border)',
                },
              }}
            />
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
} catch (err) {
  __showFatal('render-threw', err instanceof Error ? (err.stack || err.message) : String(err));
}
