// =============================================================================
// Headless entry — the build the test harness drives.
//
// Same engine as src/main.js, minus the browser-only shell: no stylesheet, no
// status bar, no service worker. Built to a single self-executing script by
// `npm run build:test` so test/dom.js can evaluate it in one VM context with no
// module resolver, exactly as it used to evaluate the inline <script>.
// =============================================================================
import { installPolyfills } from './core/polyfills.js';
import { startGame } from './game/engine.js';

installPolyfills();
startGame();
