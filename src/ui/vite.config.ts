import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const uiRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

const loggingPlugin = {
  name: 'engine-logging',
  apply: 'serve' as const,
  configResolved() {
    // noop
  },
  configureServer(server: any) {
    return () => {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url === '/__engine_log__') {
          let body = ''
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString()
          })
          req.on('end', () => {
            try {
              const logs = JSON.parse(body)
              if (Array.isArray(logs)) {
                logs.forEach((log: any) => {
                  const time = new Date(log.timestamp).toISOString().slice(11, 23)
                  const level = log.level.toUpperCase().padEnd(5)
                  const module = `[${log.module}]`.padEnd(12)
                  const msg = log.message
                  const data = log.data ? ` | ${JSON.stringify(log.data)}` : ''
                  console.log(`[${time}] ${level} ${module} ${msg}${data}`)
                })
              }
            } catch (e) {
              // ignore parse errors
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          })
          return
        }
        next()
      })
    }
  },
}

export default defineConfig({
  root: uiRoot,
  plugins: [loggingPlugin, react()],
  resolve: {
    alias: {
      // The real data/ directory. There are no fixtures: the UI reads the same
      // files npm run validate checks, so the two can never drift.
      '@data': fileURLToPath(new URL('../../data', import.meta.url)),
      // Seam for the engine session. Pure modules, imported directly - the game
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
