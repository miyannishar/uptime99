import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import s from './ErrorBoundary.module.css'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  stack: string | null
}

/**
 * Prints a thrown error on the page.
 *
 * Without this, any runtime throw unmounts the tree and the app is a black
 * rectangle with the real message only in the browser console — which is exactly
 * how the BoardCanvas render loop presented. A dev surface that fails invisibly
 * costs more time than the boundary costs to write.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? null })
    console.error(error)
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children

    return (
      <div className={s.root}>
        <h1 className={s.title}>The UI threw</h1>
        <p className={s.message}>{error.message}</p>
        {error.stack && <pre className={s.stack}>{error.stack}</pre>}
        {stack && (
          <>
            <h2 className={s.sub}>Component stack</h2>
            <pre className={s.stack}>{stack}</pre>
          </>
        )}
        <button type="button" className={s.retry} onClick={() => this.setState({ error: null, stack: null })}>
          retry render
        </button>
      </div>
    )
  }
}
