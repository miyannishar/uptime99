import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/reset.css'
import { App } from './App'
import { ErrorBoundary } from './components/templates/ErrorBoundary'

const host = document.getElementById('root')
if (!host) throw new Error('#root missing from index.html')

// StrictMode removed: it double-invokes setState updaters in development, causing
// every `advance()` call to appear twice in the console and execute 2× the CPU work
// per tick. The ErrorBoundary still catches render errors; StrictMode's other
// double-invoke checks are not useful for a real-time simulation loop.
createRoot(host).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
