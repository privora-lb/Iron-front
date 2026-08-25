import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// The stamp shown at the foot of the start panel: short SHA and the day it was
// built. A screenshot is then enough to tell which code someone is running,
// which is the difference between "my change did not work" and "your browser is
// showing you a cached bundle".
const buildId = (() => {
  let sha = 'unknown';
  try {
    sha = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    /* not a git checkout — a tarball build, say */
  }
  return `${sha} ${new Date().toISOString().slice(0, 10)}`;
})();

export default defineConfig({
  define: { __BUILD__: JSON.stringify(buildId) },

  // Absolute paths so the same build serves from a web root and from the
  // Capacitor webview, which mounts dist/ at the scheme root.
  base: '/',

  server: {
    host: true, // reachable from a phone on the same network
    port: 5173,
    strictPort: false,
  },

  preview: {
    port: 4173,
  },

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Android System WebView on older handsets and iOS 13 Safari still have to
    // parse this. The engine ships its own canvas polyfills on top.
    target: ['es2019', 'chrome80', 'safari13'],
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          // Data tables change far less often than the engine; keeping them in
          // their own chunk means a rules tweak does not invalidate the engine.
          data: [
            './src/data/units.js',
            './src/data/maps.js',
            './src/data/ranks.js',
            './src/data/difficulty.js',
            './src/data/defences.js',
            './src/data/nations.js',
            './src/data/world.js',
          ],
        },
      },
    },
  },

  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
