import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(fileURLToPath(import.meta.url), '..');

export default defineConfig({
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      // Two entry points so the production bundle ships both the main game
      // (dist/index.html) and the standalone sandbox (dist/sandbox/index.html).
      // The Bun server serves both alongside /ws on the same hostname.
      input: {
        main: resolve(root, 'index.html'),
        sandbox: resolve(root, 'sandbox/index.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) {
            return 'three';
          }
        }
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    open: true,
    watch: {
      // HMR ignores. Add patterns of files that other tooling edits but you
      // don't want triggering a sandbox/main-app full-page reload while you
      // play. Set to `false` to keep watching everything.
      ignored: [
        '**/.git/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/memory/**',
        // Comment out the line below if you're actively iterating on src/
        // and need HMR for it. With it on, edits to the main game source
        // won't reload the sandbox page (useful when another agent / test
        // run is touching src/ files in the background).
        // '**/src/**',
      ],
    },
  }
});
