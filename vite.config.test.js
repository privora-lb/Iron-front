import { defineConfig } from 'vite';

// Bundles the game into one self-executing script for the headless harness in
// test/. Kept separate from vite.config.js so the shipped web build is never
// shaped by a testing constraint.
export default defineConfig({
  build: {
    outDir: 'dist-test',
    emptyOutDir: true,
    target: 'es2019',
    minify: false, // stack traces must point at readable lines
    sourcemap: false,
    lib: {
      entry: 'src/headless.js',
      name: 'IronFront',
      formats: ['iife'],
      fileName: () => 'iron-front.iife.js',
    },
  },
});
