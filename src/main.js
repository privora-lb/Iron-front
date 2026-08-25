// =============================================================================
// Iron Front — entry point
//
// Boots in a fixed order: polyfills for old webviews, then the native shell
// (status bar, back button, wake lock) so the viewport is settled before the
// canvas measures itself, then the game, then the service worker.
// =============================================================================
import './styles/main.css';

import { installPolyfills } from './core/polyfills.js';
import { initNativeShell } from './platform/native.js';
import { registerServiceWorker } from './platform/pwa.js';
import { startGame } from './game/engine.js';

installPolyfills();

initNativeShell()
  .catch((err) => console.warn('[iron-front] native shell unavailable:', err))
  .finally(() => {
    startGame();
    registerServiceWorker();
  });
