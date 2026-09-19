import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const uiRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  root: uiRoot,
  plugins: [react()],
  resolve: {
    alias: {
      // The real data/ directory. There are no fixtures: the UI reads the same
      // files npm run validate checks, so the two can never drift.
      '@data': fileURLToPath(new URL('../../data', import.meta.url)),
      // Seam for the engine session. Pure modules, imported directly — the game
      // runs entirely in the browser, so there is no server to start.
      '@engine': fileURLToPath(new URL('../engine', import.meta.url)),
    },
  },
  server: {
    port: 5199,
    open: true,
    // data/ and src/engine/ sit above the Vite root and must be readable.
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: fileURLToPath(new URL('../../dist/ui', import.meta.url)),
    emptyOutDir: true,
  },
})
