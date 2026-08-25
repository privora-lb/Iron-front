// =============================================================================
// Native shell — everything that only means something inside a Capacitor app.
//
// This file deliberately imports nothing. Capacitor injects its bridge on
// `window.Capacitor` before the first script runs, so we feature-detect it
// instead of bundling the web stubs of six plugin packages. The packages still
// belong in package.json — the native tooling reads them from there to compile
// the Android and iOS halves — but the browser build stays free of them, and
// the headless harness can evaluate this file with no module resolver at all.
//
// On the web every call below is a no-op, so one build runs in a browser, as an
// installed PWA and as a packaged app.
// =============================================================================

const bridge = () => (typeof window !== 'undefined' ? window.Capacitor : undefined);
const plugin = (name) => bridge()?.Plugins?.[name];

export const isNative = () => Boolean(bridge()?.isNativePlatform?.());
export const platform = () => bridge()?.getPlatform?.() ?? 'web';

/** Publish the notch/gesture insets as CSS variables the stylesheets can use. */
function publishSafeArea() {
  const root = document.documentElement;
  for (const side of ['top', 'right', 'bottom', 'left']) {
    root.style.setProperty(`--inset-${side}`, `env(safe-area-inset-${side}, 0px)`);
  }
}

/** Full-screen, edge-to-edge, dark status bar over the battlefield. */
async function immersive() {
  const StatusBar = plugin('StatusBar');
  if (!StatusBar) return;
  await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  await StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
  await StatusBar.hide().catch(() => {});
}

/** Hardware back opens the pause menu instead of killing the app. */
function wireLifecycle() {
  const App = plugin('App');
  if (!App) return;
  App.addListener('backButton', () => {
    if (typeof window.__menu === 'function') window.__menu();
    else App.minimizeApp?.();
  });
  App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive && typeof window.__pause === 'function') window.__pause();
  });
}

/** A short tick when an order lands. Silent everywhere it is not supported. */
export function tap(style = 'LIGHT') {
  const Haptics = plugin('Haptics');
  if (Haptics) {
    Haptics.impact({ style })?.catch?.(() => {});
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
}

/** Keep the screen lit while a battle is running. */
let wakeLock = null;
export async function holdScreenAwake(on) {
  try {
    if (on && !wakeLock && typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => {
        wakeLock = null;
      });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    /* denied, backgrounded or unsupported — the game plays fine without */
  }
}

export async function initNativeShell() {
  if (typeof document === 'undefined') return;
  publishSafeArea();
  document.documentElement.dataset.platform = platform();
  wireLifecycle();
  await immersive();
}
