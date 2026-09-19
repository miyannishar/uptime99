import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * Separate from the repo-root vitest.config.ts on purpose.
 *
 * The root config runs `tests/**\/*.test.ts` in a `node` environment against the
 * data layer, and `npm test` must keep doing exactly that. These tests need a
 * DOM, JSX, CSS Modules and `import.meta.glob`, so they get their own project and
 * their own script (`npm run test:ui`).
 */
export default defineConfig({
  // vitest 2.1 bundles vite 5's types while the app runs vite 7, so the `Plugin`
  // shapes differ at the type level only — the plugin itself works (see
  // `npm run test:ui`). Upgrading vitest would touch the 280 data-layer tests
  // another session owns, so the skew is tolerated here rather than resolved.
  // When vitest is upgraded, this directive starts erroring as unused: delete it.
  // @ts-expect-error -- vite 5 vs vite 7 Plugin type skew
  plugins: [react()],
  resolve: {
    alias: {
      '@data': fileURLToPath(new URL('../../data', import.meta.url)),
      '@engine': fileURLToPath(new URL('../engine', import.meta.url)),
    },
  },
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['**/*.test.tsx'],
    environment: 'happy-dom',
    globals: false,
  },
})
