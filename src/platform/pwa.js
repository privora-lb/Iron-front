// =============================================================================
// Service worker registration.
//
// Only for a production web build: the dev server must not be shadowed by a
// cache, and a packaged native app already serves its files from disk.
// =============================================================================
import { isNative } from './native.js';

const isDev = () => {
  try {
    return Boolean(import.meta.env && import.meta.env.DEV);
  } catch {
    return false;
  }
};

export function registerServiceWorker() {
  if (isDev() || isNative()) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('[iron-front] service worker failed:', err));
  });
}
