import { defineConfig } from 'vite';

export default defineConfig({
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
